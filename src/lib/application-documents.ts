import "server-only";

// Loading an application with its tailored documents, for its page (E8)
// and for printing them (E8-8).

import { notFound } from "next/navigation";
import { cache } from "react";
import type { z } from "zod";

import { DocumentKind } from "@/generated/prisma/enums";
import { extractedSchema, trimmedSchema, unitsSchema, type Trimmed, type Unit } from "@/lib/application-data";
import { frozenProfile, readFrozenCopy } from "@/lib/frozen-copy";
import { prisma } from "@/lib/prisma";
import { loadProfile } from "@/lib/profile-data";
import { sectionLayoutSchema } from "@/lib/resume-sections";
import { loadProfileSettings } from "@/lib/profiles";
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
      documents: { include: { theme: { select: THEME_FIELDS }, _count: { select: { versions: true } } } },
      messages: { orderBy: { createdAt: "asc" } },
      notes: true,
      events: { select: { id: true, to: true, at: true } },
      facts: { select: { id: true, text: true }, orderBy: [{ sort: "asc" }, { createdAt: "asc" }] },
      knownGaps: { select: { requirement: true } },
      interviews: { orderBy: { round: "asc" } },
      offer: true,
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
  const application = await loadApplication(id);
  // Drawn from the profile it was made from (E24-6), or the first when that's gone.
  const [liveProfile, liveSettings, own] = await Promise.all([loadProfile(application.profileId), loadSettings(), loadProfileSettings(application.profileId)]);
  const baseTheme = (await loadTheme(own.baseThemeId)) ?? BUILT_IN_THEMES[0];
  // Once it was sent, it's drawn from what it was sent with (#299).
  const copy = readFrozenCopy(application.frozen);
  const profile = copy ? frozenProfile(copy, liveProfile) : liveProfile;
  const settings = copy ? { ...liveSettings, paper: copy.paper, dateFormat: copy.dateFormat } : liveSettings;
  const documentData = (kind: DocumentKind): DocumentData | null => {
    const document = application.documents.find((entry) => entry.kind === kind);
    const units = document && readJson(unitsSchema, document.units);
    const trimmed = document && readJson(trimmedSchema, document.trimmed);
    const frozenTheme = kind === DocumentKind.EMAIL ? null : copy?.themes[kind];
    return document && units ? { units, theme: frozenTheme ?? document.theme ?? baseTheme, ...(trimmed?.length ? { trimmed } : {}) } : null;
  };
  const extracted = readJson(extractedSchema, application.extracted);
  const ownSections = readJson(sectionLayoutSchema, application.sections);
  const sections = ownSections ?? own.resumeSections;
  return {
    application,
    profile,
    /** The profile as it is now, whatever the application was sent with: what its Sections menu can add. */
    liveProfile,
    /** It was sent, so it's drawn from its copy. */
    sent: copy !== null,
    settings,
    /** The Base resume's theme, which a document without its own uses. */
    baseThemeId: own.baseThemeId,
    extracted,
    resume: documentData(DocumentKind.RESUME),
    letter: documentData(DocumentKind.COVER_LETTER),
    /** The email's units, once it's been written (Email tab). */
    email: documentData(DocumentKind.EMAIL)?.units ?? null,
    /** Settings → "Include references", when the posting asks for them (SET-9). */
    includeReferences: (copy ? copy.includeReferences : settings.includeRefs && extracted?.asksForReferences === true) || sections.withReferences === true,
    /** Its sections' order and which are off: its own, or the base resume's (#297). */
    sections,
    ownSections: ownSections !== null,
    /** Dated the day it was sent; until then, today. */
    letterDate: calendarDay(application.sentAt ?? undefined),
  };
}
