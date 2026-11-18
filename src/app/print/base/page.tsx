import type { Metadata } from "next";

import { ResumeDocument } from "@/components/documents/resume-document";
import { DocumentKind } from "@/generated/prisma/enums";
import { printBasePath } from "@/lib/pdf/pages";
import { verifyPrintAccess } from "@/lib/pdf/print-access";
import { printMetadata } from "@/lib/pdf/print-title";
import { loadProfile } from "@/lib/profile-data";
import { loadProfileSettings, profileIdOr } from "@/lib/profiles";
import { loadSettings } from "@/lib/settings-data";
import { loadTheme } from "@/lib/theme-data";
import { BUILT_IN_THEMES, FIT_LEVELS, printCss } from "@/lib/themes";

export async function generateMetadata({ searchParams }: PageProps<"/print/base">): Promise<Metadata> {
  const { fit, profile } = await searchParams;
  await verifyPrintAccess(printBasePath(fitLevel(fit), one(profile)));
  return printMetadata(DocumentKind.RESUME);
}

/**
 * The base resume on its own, for the PDF renderer (E5-5) to print.
 * `?fit=1` to `?fit=4` squeeze it that far, for "Fit to one page" (public
 * issue 69): the renderer tries the levels in turn until it fits.
 */
export default async function PrintBaseResumePage({ searchParams }: PageProps<"/print/base">) {
  const params = await searchParams;
  const fit = fitLevel(params.fit);
  await verifyPrintAccess(printBasePath(fit, one(params.profile)));
  // A profile's own Base resume (E24-2); the first one's without `?profile=`.
  const profileId = await profileIdOr(one(params.profile));
  const [profile, own, settings] = await Promise.all([loadProfile(profileId), loadProfileSettings(profileId), loadSettings()]);
  const theme = (await loadTheme(own.baseThemeId)) ?? BUILT_IN_THEMES[0];

  return (
    <>
      <style>{printCss(theme, settings.paper, fit)}</style>
      <ResumeDocument theme={theme} profile={profile} paper={settings.paper} includeReferences={settings.includeRefs} sections={own.resumeSections} language={own.resumeLanguage} fit={fit} />
    </>
  );
}

const one = (value: string | string[] | undefined) => (typeof value === "string" && value ? value : undefined);

const fitLevel = (value: string | string[] | undefined) => {
  const level = Number(typeof value === "string" ? value : 0);
  return Number.isInteger(level) && level > 0 ? Math.min(level, FIT_LEVELS) : 0;
};
