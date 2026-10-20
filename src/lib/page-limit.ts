import "server-only";

import { DocumentKind, VersionCause } from "@/generated/prisma/enums";
import { trimmedSchema, unitsSchema, type Trimmed, type Unit } from "@/lib/application-data";
import { updateDocuments } from "@/lib/document-units";
import { saveVersion } from "@/lib/document-versions";
import { countPdfPages } from "@/lib/pdf/pages";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import type { ProfileData } from "@/lib/profile";
import { pagesInWords } from "@/lib/settings";
import { bulletLines } from "@/lib/unit-text";

// "Resume length" (E10-10, SET-9): a new tailored resume that runs over its
// page limit is trimmed once, when the application is created (decided 28
// September 2026). Measured in the real PDF: the oldest roles go first, then
// the last bullets of the oldest roles left, then the oldest projects. What's
// cut is kept on the document, so it can be put back.

/** Enough for any resume: roles and bullets run out long before. */
const MAX_CUTS = 30;

type Cut = { trimmed: Trimmed[number]; units: Unit[] };

/** The units of a role or project, oldest first, with where they are. */
function oldestFirst(units: Unit[], entries: { id: string; startYear: number | null; startMonth: number | null }[], prefix: string) {
  const start = new Map(entries.map((entry) => [`${prefix}${entry.id}`, (entry.startYear ?? 0) * 12 + (entry.startMonth ?? 1)]));
  return units
    .map((unit, index) => ({ unit, index }))
    .filter(({ unit }) => start.has(unit.id))
    .sort((a, b) => start.get(a.unit.id)! - start.get(b.unit.id)!);
}

const leaveOut = (units: Unit[], { unit, index }: { unit: Unit; index: number }): Cut => ({
  trimmed: { kind: "unit", unit, index },
  units: units.filter((_, position) => position !== index),
});

/** The next thing to leave out, or null when there's nothing left to cut. */
export function nextCut(units: Unit[], profile: ProfileData): Cut | null {
  const roles = oldestFirst(units, profile.experience, "experience:");

  // The oldest role, while more than one is left.
  if (roles.length > 1) return leaveOut(units, roles[0]);
  // Then the last bullet of the oldest role that has more than one.
  for (const { unit } of roles) {
    const lines = bulletLines(unit.text).split("\n");
    if (lines.length > 1) {
      const kept = { ...unit, text: lines.slice(0, -1).join("\n") };
      return {
        trimmed: { kind: "bullets", unitId: unit.id, label: unit.label, lines: lines.slice(-1) },
        units: units.map((entry) => (entry.id === unit.id ? kept : entry)),
      };
    }
  }
  // Then the oldest project (PRO-13).
  const projects = oldestFirst(units, profile.projects, "project:");
  return projects.length > 0 ? leaveOut(units, projects[0]) : null;
}

/** Bullets cut from the same role one at a time are kept together. */
function merge(list: Trimmed, cut: Trimmed[number]): Trimmed {
  if (cut.kind === "bullets") {
    const earlier = list.findIndex((entry) => entry.kind === "bullets" && entry.unitId === cut.unitId);
    if (earlier >= 0) {
      const entry = list[earlier] as Extract<Trimmed[number], { kind: "bullets" }>;
      return list.map((item, index) => (index === earlier ? { ...entry, lines: [...cut.lines, ...entry.lines] } : item));
    }
  }
  return [...list, cut];
}

/**
 * Trims the application's tailored resume to `maxPages`. Returns what was
 * cut, oldest first, and whether it fits now.
 */
export async function fitResumeToPages(
  applicationId: string,
  profile: ProfileData,
  maxPages: number,
  pages: (path: string) => Promise<number> = async (path) => countPdfPages(await renderPdf(path)),
): Promise<{ trimmed: Trimmed; fits: boolean }> {
  const fits = async () => (await pages(`/print/resume/${applicationId}`)) <= maxPages;
  let trimmed: Trimmed = [];
  if (await fits()) return { trimmed, fits: true };

  for (let cuts = 0; cuts < MAX_CUTS; cuts++) {
    const cut = await updateDocuments(applicationId, async (documents) => {
      const units = documents[DocumentKind.RESUME];
      const next = units && nextCut(units, profile);
      if (!units || !next) return null;
      documents[DocumentKind.RESUME] = next.units;
      return next.trimmed;
    });
    if (!cut) break;
    trimmed = merge(trimmed, cut);
    await prisma.document.updateMany({
      where: { applicationId, kind: DocumentKind.RESUME },
      data: { trimmed: trimmedSchema.parse(trimmed) },
    });
    if (await fits()) return saveTrimmed(applicationId, trimmed, true);
  }
  return saveTrimmed(applicationId, trimmed, false);
}

/** Once trimming is done, the resume as it is now becomes a version (E8-10), so the untrimmed draft stays one click away. */
async function saveTrimmed(applicationId: string, trimmed: Trimmed, fits: boolean): Promise<{ trimmed: Trimmed; fits: boolean }> {
  if (trimmed.length > 0) {
    await prisma.$transaction(async (tx) => {
      const resume = await tx.document.findUnique({ where: { applicationId_kind: { applicationId, kind: DocumentKind.RESUME } } });
      if (resume) await saveVersion(tx, resume.id, unitsSchema.parse(resume.units), { cause: VersionCause.TRIMMED });
    });
  }
  return { trimmed, fits };
}

/** The opening message's lines about what was cut (E10-10): "Left out Studio Brik (2015–2018) to fit one page". */
export function describeTrim(trimmed: Trimmed, profile: ProfileData, fits: boolean, maxPages: number): string[] {
  const limit = pagesInWords(maxPages);
  const lines = trimmed.map((cut) => {
    if (cut.kind === "bullets") {
      const count = cut.lines.length;
      return `Shortened the ${cut.label} by ${count} ${count === 1 ? "bullet" : "bullets"} to fit ${limit}`;
    }
    const project = profile.projects.find((entry) => `project:${entry.id}` === cut.unit.id);
    if (project) return `Left out the ${project.name.trim() || "untitled"} project to fit ${limit}`;
    const entry = profile.experience.find((role) => `experience:${role.id}` === cut.unit.id);
    const name = entry?.company.trim() || entry?.role.trim() || cut.unit.label;
    const years = entry?.startYear ? ` (${entry.startYear}–${entry.current ? "now" : (entry.endYear ?? "")})` : "";
    return `Left out ${name}${years} to fit ${limit}`;
  });
  if (!fits && trimmed.length > 0) lines.push(`It still runs over ${limit}, so shorten it by hand if it has to fit`);
  return lines;
}
