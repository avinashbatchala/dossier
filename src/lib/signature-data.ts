import "server-only";

import { prisma } from "@/lib/prisma";

import { SIGNATURE_MAX_BYTES, SIGNATURE_MESSAGES, type SignatureMime } from "./signature";

// The uploaded signature (E17): one row, read only where a cover letter is
// drawn or Settings → Documents shows the upload, never with every settings read.

export type SignatureBytes = { data: Uint8Array; mimeType: SignatureMime };

/** A stored PNG or JPEG as the data URL an <img> can show, in the page and in the PDF. */
export function signatureDataUrl(bytes: Uint8Array, mimeType: SignatureMime): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** The stored image, or null when none is uploaded. */
export async function loadSignatureBytes(): Promise<SignatureBytes | null> {
  const row = await prisma.signature.findUnique({ where: { id: "signature" }, select: { data: true, mimeType: true } });
  return row ? { data: new Uint8Array(row.data), mimeType: row.mimeType as SignatureMime } : null;
}

/** The stored image as a data URL for an <img>, or null. */
export async function loadSignature(): Promise<string | null> {
  const row = await loadSignatureBytes();
  return row ? signatureDataUrl(row.data, row.mimeType) : null;
}

/** Stores a checked PNG or JPEG, replacing the previous one. */
export async function saveSignature(bytes: Uint8Array, mimeType: SignatureMime): Promise<void> {
  if (bytes.length > SIGNATURE_MAX_BYTES) throw new Error(SIGNATURE_MESSAGES.tooBig);
  await prisma.signature.upsert({
    where: { id: "signature" },
    create: { id: "signature", data: Buffer.from(bytes), mimeType },
    update: { data: Buffer.from(bytes), mimeType },
  });
}

/** Removes the uploaded signature; letters stop showing it. */
export async function removeSignature(): Promise<void> {
  await prisma.signature.deleteMany({ where: { id: "signature" } });
}
