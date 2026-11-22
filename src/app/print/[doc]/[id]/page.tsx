import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { TailoredLetter, TailoredResume } from "@/components/documents/tailored-documents";
import { DocumentKind } from "@/generated/prisma/enums";
import { loadDocuments } from "@/lib/application-documents";
import { verifyPrintAccess } from "@/lib/pdf/print-access";
import { printMetadata } from "@/lib/pdf/print-title";
import { printCss } from "@/lib/themes";

export async function generateMetadata({ params }: PageProps<"/print/[doc]/[id]">): Promise<Metadata> {
  const { doc, id } = await params;
  if (doc !== "resume" && doc !== "letter") notFound();
  await verifyPrintAccess(`/print/${doc}/${id}`);
  return printMetadata(doc === "resume" ? DocumentKind.RESUME : DocumentKind.COVER_LETTER);
}

/**
 * An application's tailored resume (/print/resume/{id}) or cover letter
 * (/print/letter/{id}) on its own, for the PDF renderer (E8-8) to print.
 */
export default async function PrintTailoredDocumentPage({ params }: PageProps<"/print/[doc]/[id]">) {
  const { doc, id } = await params;
  if (doc !== "resume" && doc !== "letter") notFound();
  await verifyPrintAccess(`/print/${doc}/${id}`);
  const { application, profile, settings, resume, letter, includeReferences, sections, letterDate, signature } = await loadDocuments(id);
  const document = doc === "resume" ? resume : letter;
  if (!document) notFound();

  return (
    <>
      <style>{printCss(document.theme, settings.paper)}</style>
      {doc === "resume" ? (
        <TailoredResume
          resume={document}
          profile={profile}
          paper={settings.paper}
          followThemeLayout={application.followThemeLayout}
          showPhoto={application.showPhoto}
          language={application.language}
          includeReferences={includeReferences}
          sections={sections}
        />
      ) : (
        <TailoredLetter
          letter={document}
          profile={profile}
          paper={settings.paper}
          company={application.company}
          location={application.location}
          tone={application.tone}
          date={letterDate}
          dateFormat={settings.dateFormat}
          language={application.language}
          signature={application.signatureOnLetter ? signature : null}
        />
      )}
    </>
  );
}
