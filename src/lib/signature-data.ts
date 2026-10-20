import "server-only";

import { prisma } from "@/lib/prisma";

import { SIGNATURE_MAX_BYTES, SIGNATURE_MESSAGES } from "./signature";

// The uploaded signature (E17): one row, read only where a cover letter is
// drawn or Settings → Documents shows the upload, never with every settings read.

export type SignatureBytes = { data: Uint8Array; mimeType: string };

/** A stored PNG as the data URL an <img> can show, in the page and in the PDF. */
export function signatureDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

/** The stored PNG, or null when none is uploaded. */
export async function loadSignatureBytes(): Promise<SignatureBytes | null> {
  const row = await prisma.signature.findUnique({ where: { id: "signature" }, select: { data: true, mimeType: true } });
  return row ? { data: new Uint8Array(row.data), mimeType: row.mimeType } : null;
}

/** The stored PNG as a data URL for an <img>, or null. */
export async function loadSignature(): Promise<string | null> {
  const row = await loadSignatureBytes();
  return row ? signatureDataUrl(row.data) : null;
}

/** Stores a checked PNG, replacing the previous one. */
export async function saveSignature(bytes: Uint8Array): Promise<void> {
  if (bytes.length > SIGNATURE_MAX_BYTES) throw new Error(SIGNATURE_MESSAGES.tooBig);
  await prisma.signature.upsert({
    where: { id: "signature" },
    create: { id: "signature", data: Buffer.from(bytes), mimeType: "image/png" },
    update: { data: Buffer.from(bytes), mimeType: "image/png" },
  });
}

/** Removes the uploaded signature; letters stop showing it. */
export async function removeSignature(): Promise<void> {
  await prisma.signature.deleteMany({ where: { id: "signature" } });
}
