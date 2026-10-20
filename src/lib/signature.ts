// A signature is a small PNG or JPEG. Keep the limit well under the route
// body cap so the browser never sends a file the server has to reject after
// reading it.

export const SIGNATURE_MAX_BYTES = 512 * 1024;

export const SIGNATURE_MESSAGES = {
  tooBig: "That signature is over 500 KB. Use a smaller PNG or JPG (a few hundred pixels wide is plenty).",
  notImage: "Choose a PNG or JPG image. A transparent background works best for PNG.",
};

/** What a signature may be stored as; the image's own bytes decide. */
export type SignatureMime = "image/png" | "image/jpeg";

/** The eight bytes every PNG starts with. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Every JPEG starts with these three bytes. */
const JPEG = [0xff, 0xd8, 0xff];

const startsWith = (bytes: Uint8Array, prefix: number[]) =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

/** Whether the bytes are a PNG, whatever the browser called the file. */
export function isPng(bytes: Uint8Array): boolean {
  return startsWith(bytes, PNG);
}

/** Whether the bytes are a JPEG, whatever the browser called the file. */
export function isJpeg(bytes: Uint8Array): boolean {
  return startsWith(bytes, JPEG);
}

/** The image type the bytes really are, or null when they're neither PNG nor JPEG. */
export function signatureMime(bytes: Uint8Array): SignatureMime | null {
  if (isPng(bytes)) return "image/png";
  if (isJpeg(bytes)) return "image/jpeg";
  return null;
}
