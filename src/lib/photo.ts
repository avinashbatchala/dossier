// The profile photo (#224): cropped 3:4 in the browser and kept as a data
// URL in the ProfileField table, so exports, backups and Delete everything
// cover it like the rest of the profile. It's only ever drawn on resumes:
// never sent to the AI.

/** The stored photo's size in pixels: 3:4, enough for about 400 dpi at its largest on paper. */
export const PHOTO_WIDTH = 480;
export const PHOTO_HEIGHT = 640;

/** The ProfileField keys: the photo, and "false" while it's kept off resumes. */
export const PHOTO_KEY = "photo";
export const PHOTO_ON_RESUMES_KEY = "photoOnResumes";

/** The longest data URL accepted, well under a Server Action's 1 MB. */
export const PHOTO_MAX_LENGTH = 700_000;

export type ProfilePhoto = {
  /** "data:image/jpeg;base64,…" */
  src: string;
  /** "Show on resumes": on unless turned off. */
  onResumes: boolean;
};

const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

/** The first bytes of each image type a photo may be. */
const SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  jpeg: (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  png: (bytes) => [0x89, 0x50, 0x4e, 0x47].every((byte, index) => bytes[index] === byte),
  webp: (bytes) => ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP",
};

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));

/**
 * Whether a value is a photo Dossier draws: a JPEG, PNG or WebP data URL
 * whose bytes really start like one, and not too big. Anything else (a
 * link, an SVG, a damaged import) is ignored.
 */
export function isPhotoDataUrl(value: string): boolean {
  if (value.length > PHOTO_MAX_LENGTH) return false;
  const match = DATA_URL.exec(value);
  if (!match) return false;
  const [, type, base64] = match;
  try {
    const bytes = Uint8Array.from(atob(base64.slice(0, 24)), (char) => char.charCodeAt(0));
    return SIGNATURES[type](bytes);
  } catch {
    return false;
  }
}

/** The photo from ProfileField rows, or null without a usable one. */
export function photoFromFields(rows: readonly { key: string; value: string }[]): ProfilePhoto | null {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const src = values.get(PHOTO_KEY);
  if (!src || !isPhotoDataUrl(src)) return null;
  return { src, onResumes: values.get(PHOTO_ON_RESUMES_KEY) !== "false" };
}

// ─── Cropping ────────────────────────────────────────────────────────────────
// The crop dialog shows the picked image in a 3:4 frame. A crop is the zoom
// (1 just covers the frame) and where the image's top-left corner is,
// relative to the frame's, in the frame's pixels.

export type Size = { width: number; height: number };
export type Crop = { zoom: number; x: number; y: number };

export const MAX_ZOOM = 4;

/** How much the image is scaled in the frame at a zoom. */
export const cropScale = (image: Size, frame: Size, zoom: number) =>
  Math.max(frame.width / image.width, frame.height / image.height) * zoom;

/** The crop with the zoom in range and the frame covered: the image can't move past its edges. */
export function clampCrop(crop: Crop, image: Size, frame: Size): Crop {
  const zoom = Math.min(Math.max(crop.zoom, 1), MAX_ZOOM);
  const scale = cropScale(image, frame, zoom);
  const clamp = (value: number, min: number) => Math.min(0, Math.max(min, value));
  return {
    zoom,
    x: clamp(crop.x, frame.width - image.width * scale),
    y: clamp(crop.y, frame.height - image.height * scale),
  };
}

/** The whole frame covered, with the image's middle in it. */
export function centredCrop(image: Size, frame: Size): Crop {
  const scale = cropScale(image, frame, 1);
  return { zoom: 1, x: (frame.width - image.width * scale) / 2, y: (frame.height - image.height * scale) / 2 };
}

/** Zooms in or out around the frame's middle, which stays on the same part of the image. */
export function zoomCrop(crop: Crop, zoom: number, image: Size, frame: Size): Crop {
  const factor = cropScale(image, frame, zoom) / cropScale(image, frame, crop.zoom);
  const [middleX, middleY] = [frame.width / 2, frame.height / 2];
  return clampCrop({ zoom, x: middleX - (middleX - crop.x) * factor, y: middleY - (middleY - crop.y) * factor }, image, frame);
}

/** The part of the image the frame shows, in the image's own pixels. */
export function cropSource(crop: Crop, image: Size, frame: Size): { x: number; y: number } & Size {
  const scale = cropScale(image, frame, crop.zoom);
  // 0 - x rather than -x, which would give -0 for 0.
  return { x: (0 - crop.x) / scale, y: (0 - crop.y) / scale, width: frame.width / scale, height: frame.height / scale };
}
