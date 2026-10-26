import type { DateFormat, PaperSize, Tone } from "@/generated/prisma/enums";
import type { DocumentData } from "@/lib/application-documents";
import type { ProfileData } from "@/lib/profile";
import { withoutSidebar } from "@/lib/themes";

import { CoverLetterDocument } from "./cover-letter-document";
import type { UnitRenderer } from "./document-page";
import { ResumeDocument } from "./resume-document";

// An application's tailored documents, drawn the same way on its page and
// for its PDFs (E8-8); only the page passes a unit renderer.

export function TailoredResume({
  resume,
  profile,
  paper,
  followThemeLayout,
  showPhoto,
  language,
  includeReferences,
  renderUnit,
}: {
  resume: DocumentData;
  profile: ProfileData;
  paper: PaperSize;
  /** The theme's own layout, sidebar included; otherwise its sidebar folds into a single column (APP-4). */
  followThemeLayout: boolean;
  /** The application's Photo switch (#224); null follows the profile. */
  showPhoto: boolean | null;
  language: string;
  includeReferences: boolean;
  renderUnit?: UnitRenderer;
}) {
  return (
    <ResumeDocument
      theme={resume.theme}
      profile={profile}
      paper={paper}
      units={resume.units}
      layout={followThemeLayout ? undefined : withoutSidebar(resume.theme.layout)}
      showPhoto={showPhoto}
      language={language}
      includeReferences={includeReferences}
      renderUnit={renderUnit}
    />
  );
}

export function TailoredLetter({
  letter,
  profile,
  paper,
  company,
  location,
  tone,
  date,
  dateFormat,
  language,
  signature,
  renderUnit,
}: {
  letter: DocumentData;
  profile: ProfileData;
  paper: PaperSize;
  company: string;
  location: string;
  tone: Tone;
  date: Date;
  dateFormat: DateFormat;
  language: string;
  /** The uploaded image as a data URL, when this letter is signed (E17). */
  signature?: string | null;
  renderUnit?: UnitRenderer;
}) {
  return (
    <CoverLetterDocument
      theme={letter.theme}
      paper={paper}
      basics={profile.basics}
      units={letter.units}
      company={company}
      location={location}
      tone={tone}
      date={date}
      dateFormat={dateFormat}
      language={language}
      signature={signature}
      renderUnit={renderUnit}
    />
  );
}
