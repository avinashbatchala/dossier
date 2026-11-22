import { type NextRequest, NextResponse } from "next/server";

import { DocumentKind } from "@/generated/prisma/enums";
import { resolveFileName } from "@/lib/file-name";
import { holdPdf, pdfDownload } from "@/lib/pdf/downloads";
import { countPdfPages, printBasePath } from "@/lib/pdf/pages";
import { renderPdf } from "@/lib/pdf/render";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";
import { loadProfileSettings, profileIdOr } from "@/lib/profiles";
import { loadSettings } from "@/lib/settings-data";
import { route } from "@/lib/route";
import { FIT_LEVELS } from "@/lib/themes";

/** The documents an application can download, by their `doc=` value. */
const TAILORED = { resume: DocumentKind.RESUME, letter: DocumentKind.COVER_LETTER } as const;

/** Application ids are cuids; anything else never reaches a print path. */
const APPLICATION_ID = /^[a-z0-9]{1,64}$/i;

const notFound = (error: string) => NextResponse.json({ error }, { status: 404 });

/**
 * Downloads a document as a PDF (RES-5, APP-12): `?doc=base` for the base
 * resume, `?doc=resume&application={id}` or `?doc=letter&application={id}`
 * for an application's tailored resume or cover letter. The file is named
 * with Settings → PDF file name (SET-8).
 */
export const GET = route(async (request) => {
  const rendered = await renderRequested(request);
  return rendered instanceof Response ? rendered : pdfDownload(rendered.pdf, rendered.fileName);
});

/**
 * Renders the same documents and holds the PDF for a few minutes, answering
 * with the link to download it from: `{ url }`. The download button uses
 * this, so the browser saves the file from a link of its own.
 */
export const POST = route(async (request) => {
  const rendered = await renderRequested(request);
  if (rendered instanceof Response) return rendered;
  return NextResponse.json({ url: `/api/pdf/${holdPdf(rendered.pdf, rendered.fileName)}` });
});

/** The PDF and file name of the document the query asks for, or a 404 response. */
async function renderRequested(request: NextRequest): Promise<{ pdf: Uint8Array; fileName: string } | Response> {
  const params = request.nextUrl.searchParams;
  const doc = params.get("doc");
  const [name, settings] = await Promise.all([loadProfileName(), loadSettings()]);
  const date = new Date();

  if (doc === "base") {
    // A profile's own Base resume (E24-2), the first one's without `&profile=`.
    const profileId = await profileIdOr(params.get("profile"));
    const own = await loadProfileSettings(profileId);
    // "Fit to one page" (public issue 69): squeezed a step at a time until it fits, as the preview does.
    let pdf = await renderPdf(printBasePath(0, profileId));
    for (let fit = 1; own.fitBaseResume && fit <= FIT_LEVELS && countPdfPages(pdf) > 1; fit++) pdf = await renderPdf(printBasePath(fit, profileId));
    return { pdf, fileName: resolveFileName(settings.fileNamePattern, { name, doc: DocumentKind.RESUME, date }) };
  }

  if (doc !== "resume" && doc !== "letter") return notFound("There's no such document to download.");
  const id = params.get("application") ?? "";
  const application = APPLICATION_ID.test(id)
    ? await prisma.application.findUnique({
        where: { id },
        select: { company: true, role: true, documents: { where: { kind: TAILORED[doc] }, select: { id: true } } },
      })
    : null;
  if (!application) return notFound("That application no longer exists.");
  if (application.documents.length === 0) {
    return notFound(doc === "resume" ? "This application has no tailored resume." : "This application has no cover letter.");
  }

  return {
    pdf: await renderPdf(`/print/${doc}/${id}`),
    fileName: resolveFileName(settings.fileNamePattern, { name, company: application.company, role: application.role, doc: TAILORED[doc], date }),
  };
}
