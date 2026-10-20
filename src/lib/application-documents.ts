import "server-only";

// Loading an application with its tailored documents, for its page (E8)
// and for printing them (E8-8).

import { notFound } from "next/navigation";
import { cache } from "react";
import type { z } from "zod";

import { DocumentKind } from "@/generated/prisma/enums";
import { extractedSchema, trimmedSchema, unitsSchema, type Trimmed, type Unit } from "@/lib/application-data";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { loadSettings } from "@/lib/settings-data";
import { loadTheme, THEME_FIELDS } from "@/lib/theme-data";
import { BUILT_IN_THEMES, type ThemeData } from "@/lib/themes";

/**
 * The application for its page, with its documents and their themes, or the
 * not-found page when there's no such application. Cached per request, so the
 * page and its metadata share it.
 */
export const loadApplication = cache(async (id: string) => {
  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      documents: { include: { theme: { select: THEME_FIELDS } } },
      messages: { orderBy: { createdAt: "asc" } },
      notes: true,
      events: { select: { id: true, to: true, at: true } },
    },
  });
  if (!application) notFound();
  return application;
});

/**
 * A JSON column read with its schema. Data that doesn't fit, such as rows
 * written by an older version, reads as null rather than breaking the page.
 */
export function readJson<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Today's date (or `date`'s) in the server's time zone, at UTC midnight, as documents expect. */
export function calendarDay(date = new Date()): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

/** A tailored document's units and the theme it's shown in, with what was left out to fit its page limit. */
export type DocumentData = { units: Unit[]; theme: ThemeData; trimmed?: Trimmed };

/**
 * An application's tailored documents with everything needed to draw them,
 * the same for the page and for printing (E8-8).
 */
export async function loadDocuments(id: string) {
  const [application, profile, settings] = await Promise.all([loadApplication(id), loadProfile(), loadSettings()]);
  const baseTheme = (await loadTheme(settings.baseThemeId)) ?? BUILT_IN_THEMES[0];
  const documentData = (kind: DocumentKind): DocumentData | null => {
    const document = application.documents.find((entry) => entry.kind === kind);
    const units = document && readJson(unitsSchema, document.units);
    const trimmed = document && readJson(trimmedSchema, document.trimmed);
    return document && units ? { units, theme: document.theme ?? baseTheme, ...(trimmed?.length ? { trimmed } : {}) } : null;
  };
  const extracted = readJson(extractedSchema, application.extracted);
  return {
    application,
    profile,
    settings,
    extracted,
    resume: documentData(DocumentKind.RESUME),
    letter: documentData(DocumentKind.COVER_LETTER),
    /** The email's units, once it's been written (Email tab). */
    email: documentData(DocumentKind.EMAIL)?.units ?? null,
    /** Settings → "Include references", when the posting asks for them (SET-9). */
    includeReferences: settings.includeRefs && extracted?.asksForReferences === true,
    /** Dated the day it was sent; until then, today. */
    letterDate: calendarDay(application.sentAt ?? undefined),
  };
}
