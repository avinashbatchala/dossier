import "server-only";

import type { Metadata } from "next";

import type { DocumentKind } from "@/generated/prisma/enums";
import { DOCUMENT_LABELS } from "@/lib/file-name";
import { loadProfileName } from "@/lib/profile-data";

/**
 * A print page's metadata. Its title becomes the PDF's Title, which some
 * viewers show instead of the file name, so it names the person and the
 * document, as the default file name does: "Jane Doe – Resume" (public issue
 * 131). No company, and no "· Dossier".
 */
export async function printMetadata(kind: DocumentKind): Promise<Metadata> {
  const name = (await loadProfileName()).trim();
  const label = DOCUMENT_LABELS[kind];
  return { title: { absolute: name ? `${name} – ${label}` : label }, robots: { index: false } };
}
