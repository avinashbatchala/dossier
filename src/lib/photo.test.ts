import { describe, expect, it } from "vitest";

import {
  centredCrop,
  clampCrop,
  cropSource,
  isPhotoDataUrl,
  MAX_ZOOM,
  PHOTO_MAX_LENGTH,
  photoFromFields,
  zoomCrop,
} from "./photo";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const base64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));

describe("isPhotoDataUrl (#224)", () => {
  it("takes JPEG, PNG and WebP data URLs whose bytes start like one", () => {
    expect(isPhotoDataUrl(PNG)).toBe(true);
    expect(isPhotoDataUrl(`data:image/jpeg;base64,${base64([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])}`)).toBe(true);
    const webp = [..."RIFF"].map((char) => char.charCodeAt(0)).concat([0, 0, 0, 0], [..."WEBPVP8 "].map((char) => char.charCodeAt(0)));
    expect(isPhotoDataUrl(`data:image/webp;base64,${base64(webp)}`)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isPhotoDataUrl("")).toBe(false);
    expect(isPhotoDataUrl("https://example.com/me.jpg")).toBe(false);
    expect(isPhotoDataUrl(`data:image/svg+xml;base64,${btoa("<svg/>")}`)).toBe(false);
    // A PNG's name on other bytes.
    expect(isPhotoDataUrl(`data:image/png;base64,${base64([0xff, 0xd8, 0xff, 0xe0])}`)).toBe(false);
    expect(isPhotoDataUrl(`${PNG}"><script>`)).toBe(false);
    expect(isPhotoDataUrl(PNG.replace("base64,", "base64,!"))).toBe(false);
    expect(isPhotoDataUrl(PNG + "A".repeat(PHOTO_MAX_LENGTH))).toBe(false);
  });
});

describe("photoFromFields (#224)", () => {
  it("reads the photo, shown on resumes unless turned off", () => {
    expect(photoFromFields([{ key: "name", value: "Jane" }])).toBeNull();
    expect(photoFromFields([{ key: "photo", value: PNG }])).toEqual({ src: PNG, onResumes: true });
    expect(photoFromFields([{ key: "photo", value: PNG }, { key: "photoOnResumes", value: "false" }])).toEqual({ src: PNG, onResumes: false });
  });

  it("ignores a photo it wouldn't draw, e.g. from a damaged import", () => {
    expect(photoFromFields([{ key: "photo", value: "javascript:alert(1)" }])).toBeNull();
  });
});

describe("cropping (#224)", () => {
  const frame = { width: 240, height: 320 };
  const landscape = { width: 1200, height: 800 };

  it("starts with the image's middle covering the frame", () => {
    // Scaled to the frame's height: 480 × 320, so 120 px stick out on each side.
    expect(centredCrop(landscape, frame)).toEqual({ zoom: 1, x: -120, y: 0 });
    expect(cropSource(centredCrop(landscape, frame), landscape, frame)).toEqual({ x: 300, y: 0, width: 600, height: 800 });
  });

  it("never moves the image off the frame's edges, and keeps the zoom in range", () => {
    expect(clampCrop({ zoom: 1, x: 50, y: 50 }, landscape, frame)).toEqual({ zoom: 1, x: 0, y: 0 });
    expect(clampCrop({ zoom: 1, x: -500, y: -10 }, landscape, frame)).toEqual({ zoom: 1, x: -240, y: 0 });
    expect(clampCrop({ zoom: 9, x: 0, y: 0 }, landscape, frame).zoom).toBe(MAX_ZOOM);
    expect(clampCrop({ zoom: 0.2, x: 0, y: 0 }, landscape, frame).zoom).toBe(1);
  });

  it("zooms around the frame's middle", () => {
    const zoomed = zoomCrop(centredCrop(landscape, frame), 2, landscape, frame);
    expect(zoomed).toEqual({ zoom: 2, x: -360, y: -160 });
    const middle = (crop: ReturnType<typeof cropSource>) => [crop.x + crop.width / 2, crop.y + crop.height / 2];
    expect(middle(cropSource(zoomed, landscape, frame))).toEqual([600, 400]);
    expect(zoomCrop(zoomed, 1, landscape, frame)).toEqual(centredCrop(landscape, frame));
  });
});
