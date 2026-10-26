import "server-only";

import { prisma } from "@/lib/prisma";
import { BUILT_IN_THEMES, type ThemeData } from "@/lib/themes";

/** The columns a ThemeData needs, for `select`. */
export const THEME_FIELDS = {
  id: true,
  name: true,
  builtIn: true,
  headFont: true,
  bodyFont: true,
  accent: true,
  layout: true,
  align: true,
  headingStyle: true,
  density: true,
  headerStyle: true,
  sidebarStyle: true,
  dateStyle: true,
  photoShape: true,
  photoPosition: true,
} as const;

const builtInOrder = new Map(BUILT_IN_THEMES.map((theme, index) => [theme.id, index]));

/** Every theme: the built-ins in the picker's order, then the user's own, oldest first. */
export async function loadThemes(): Promise<ThemeData[]> {
  const themes = await prisma.theme.findMany({ select: THEME_FIELDS, orderBy: { createdAt: "asc" } });
  const rank = (theme: ThemeData) => builtInOrder.get(theme.id) ?? builtInOrder.size;
  // Array.prototype.sort is stable, so custom themes keep their creation order.
  return themes.sort((a, b) => rank(a) - rank(b));
}

/** How many applications' documents use each theme, by theme id (E5-7). */
export async function loadThemeUsage(): Promise<Record<string, number>> {
  const uses = await prisma.document.findMany({
    where: { themeId: { not: null } },
    distinct: ["applicationId", "themeId"],
    select: { themeId: true },
  });
  const usage: Record<string, number> = {};
  for (const { themeId } of uses) usage[themeId!] = (usage[themeId!] ?? 0) + 1;
  return usage;
}

/** One theme, or null when it doesn't exist. */
export async function loadTheme(id: string): Promise<ThemeData | null> {
  return prisma.theme.findUnique({ where: { id }, select: THEME_FIELDS });
}
