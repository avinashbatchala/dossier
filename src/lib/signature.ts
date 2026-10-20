// A signature is a small, transparent PNG. Keep the limit well under the
// route body cap so the browser never sends a file the server has to reject
// after reading it.

export const SIGNATURE_MAX_BYTES = 512 * 1024;

export const SIGNATURE_MESSAGES = {
  tooBig: "That signature is over 500 KB. Use a smaller PNG (a few hundred pixels wide is plenty).",
  notPng: "Choose a PNG image. A transparent background works best.",
  missing: "There's no signature uploaded yet.",
};

/** The eight bytes every PNG starts with. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Whether the bytes are a PNG, whatever the browser called the file. */
export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG.length && PNG.every((byte, index) => bytes[index] === byte);
}
