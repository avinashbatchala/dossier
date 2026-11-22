"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ApplicationStatus } from "@/generated/prisma/enums";
import { action } from "@/lib/action";
import { parseStatusParam, SORT_KEYS, statusParamValue, VIEWS } from "@/lib/applications-list";
import { boardOrder, withShownOrder } from "@/lib/board-order";
import { prisma } from "@/lib/prisma";
import { loadSettings, saveSettings } from "@/lib/settings-data";

/**
 * Remembers how the Applications screen was left (LST-7), for the next
 * visit: the sort, and the view, for all applications or for the status on
 * show (E29-1, LB1), where Board is remembered over the list.
 */
export const rememberListView = action(
  z.object({
    view: z.enum(VIEWS),
    status: z.string().nullable().optional(),
    sort: z.object({ key: z.enum(SORT_KEYS), reversed: z.boolean() }),
  }),
  async ({ view, status, sort }) => {
    const applicationsSort = `${sort.reversed ? "-" : ""}${sort.key}`;
    const asked = status ? parseStatusParam(status) : null;
    if (!asked) {
      await saveSettings({ applicationsView: view, applicationsSort });
      return null;
    }
    const key = statusParamValue(asked);
    const { applicationsBoardStatuses } = await loadSettings();
    const others = applicationsBoardStatuses.filter((entry) => entry !== key);
    await saveSettings({ applicationsSort, applicationsBoardStatuses: view === "board" ? [...others, key] : others });
    return null;
  },
);

/**
 * Writes a board column's new order (public issue 60). `ids` are the cards on
 * screen; the whole column gets a place, so what a search or the archive
 * hides stays where it is. Reordering isn't news, so "Updated" stays as it was.
 */
export const reorderBoard = action(
  z.object({
    status: z.enum(ApplicationStatus),
    ids: z.array(z.string().min(1)).min(1),
  }),
  async ({ status, ids }) => {
    const column = await prisma.application.findMany({
      where: { status, awaitingReview: false },
      select: { id: true, boardSort: true, updatedAt: true },
    });
    await prisma.$transaction(
      withShownOrder(column.sort(boardOrder), ids).map(({ id, updatedAt }, boardSort) =>
        prisma.application.updateMany({ where: { id, status }, data: { boardSort, updatedAt } }),
      ),
    );
    revalidatePath("/applications");
    return null;
  },
);
