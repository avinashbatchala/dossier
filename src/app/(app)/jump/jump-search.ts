import "server-only";

import { postingKey } from "@/lib/job-search/search";
import { NAV } from "@/lib/nav";
import { prisma } from "@/lib/prisma";
import { statusLabel } from "@/lib/applications-list";

import { SECTIONS as PROFILE_SECTIONS } from "../profile/sections";
import { SETTINGS_SECTIONS, settingsSectionHref } from "../settings/sections";

// Jump to (E27-6, SH3): screens, applications (archived ones marked), saved
// and new postings, profiles and their sections, and Settings sections. One
// user's data is small, and both databases have to agree on case, so matching
// happens here rather than in SQL.

export type JumpResult = { id: string; label: string; detail?: string; href: string };
export type JumpGroup = { label: string; results: JumpResult[] };

/** At most this many results in a group. */
const PER_GROUP = 6;

/** Lower case without accents, so "cafe" finds "Café". */
const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();

/**
 * Whether every word of the query is in the text; and how well: 2 when the
 * text starts with the query, 1 when a word does, 0 otherwise.
 */
export function match(text: string, query: string): number | null {
  const haystack = fold(text);
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.every((word) => haystack.includes(word))) return null;
  const whole = words.join(" ");
  if (haystack.startsWith(whole)) return 2;
  return haystack.split(/[\s,·/()-]+/).some((part) => part.startsWith(words[0])) ? 1 : 0;
}

/** The entries that match, best first, then in their own order. */
function best<T>(entries: readonly T[], text: (entry: T) => string, query: string): T[] {
  return entries
    .map((entry, index) => ({ entry, index, rank: match(text(entry), query) }))
    .filter((found): found is { entry: T; index: number; rank: number } => found.rank !== null)
    .sort((a, b) => b.rank - a.rank || a.index - b.index)
    .slice(0, PER_GROUP)
    .map(({ entry }) => entry);
}

const SCREENS: JumpResult[] = [
  ...NAV.flatMap((group) => group.items).map(({ href, label }) => ({ id: `screen:${href}`, label, href })),
  { id: "screen:/new", label: "New application", href: "/new?fresh=1" },
];

const applicationLabel = ({ role, company }: { role: string; company: string }) =>
  role && company ? `${role} at ${company}` : role || company || "Untitled application";

/** What Jump to shows for a query; with none, the screens and the latest applications. */
export async function searchJump(rawQuery: string): Promise<JumpGroup[]> {
  const query = rawQuery.trim().slice(0, 200);
  const groups: JumpGroup[] = [];
  const add = (label: string, results: JumpResult[]) => results.length > 0 && groups.push({ label, results });

  if (!query) {
    const recent = await prisma.application.findMany({
      where: { archivedAt: null, awaitingReview: false },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: { id: true, role: true, company: true, status: true },
    });
    add("Screens", SCREENS);
    add(
      "Recent applications",
      recent.map((application) => ({ id: `application:${application.id}`, label: applicationLabel(application), detail: statusLabel(application.status), href: `/applications/${application.id}` })),
    );
    return groups;
  }

  const [applications, postings, profiles] = await Promise.all([
    prisma.application.findMany({
      where: { awaitingReview: false },
      orderBy: { updatedAt: "desc" },
      select: { id: true, role: true, company: true, status: true, archivedAt: true },
    }),
    // Saved and new ones (SH3): not dismissed, archived, removed or merged into another.
    prisma.posting.findMany({
      where: { removedAt: null, mergedIntoId: null, dismissedAt: null, archivedAt: null, OR: [{ savedAt: { not: null } }, { seenAt: null }] },
      orderBy: { createdAt: "desc" },
      select: { source: true, externalId: true, title: true, company: true, savedAt: true },
    }),
    prisma.profile.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }], select: { id: true, name: true } }),
  ]);

  add("Screens", best(SCREENS, (screen) => screen.label, query));
  add(
    "Applications",
    best(applications, (application) => `${application.role} ${application.company}`, query).map((application) => ({
      id: `application:${application.id}`,
      label: applicationLabel(application),
      detail: [statusLabel(application.status), application.archivedAt ? "Archived" : ""].filter(Boolean).join(" · "),
      href: `/applications/${application.id}`,
    })),
  );
  add(
    "Positions",
    best(postings, (posting) => `${posting.title} ${posting.company}`, query).map((posting) => {
      const show = posting.savedAt ? "saved" : "new";
      return {
        id: `posting:${postingKey(posting)}`,
        label: posting.title || "Untitled posting",
        detail: [posting.savedAt ? "Saved" : "New", posting.company].filter(Boolean).join(" · "),
        href: `/jobs?show=${show}&focus=${encodeURIComponent(postingKey(posting))}`,
      };
    }),
  );
  add("Profiles", [
    ...best(profiles, (profile) => profile.name, query).map((profile) => ({ id: `profile:${profile.id}`, label: profile.name, detail: "Profile", href: `/profile?profile=${profile.id}` })),
    ...best(PROFILE_SECTIONS, (section) => section.label, query).map((section) => ({
      id: `profile-section:${section.id}`,
      label: section.label,
      detail: "Profile section",
      href: `/profile?section=${section.id}`,
    })),
  ].slice(0, PER_GROUP));
  add(
    "Settings",
    best(SETTINGS_SECTIONS, (section) => section.label, query).map((section) => ({ id: `settings:${section.id}`, label: section.label, detail: "Settings", href: settingsSectionHref(section.id) })),
  );
  return groups;
}
