import { afterEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ DOSSIER_DESKTOP_TOKEN: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env: config }));

const { isDesktopApp, isDesktopToken } = await import("./desktop");

afterEach(() => {
  config.DOSSIER_DESKTOP_TOKEN = undefined;
});

describe("isDesktopApp", () => {
  it("is only so when the desktop app started this server", () => {
    expect(isDesktopApp()).toBe(false);
    config.DOSSIER_DESKTOP_TOKEN = "launch-token";
    expect(isDesktopApp()).toBe(true);
  });
});

describe("isDesktopToken", () => {
  it("takes only this launch's token", () => {
    config.DOSSIER_DESKTOP_TOKEN = "launch-token";
    expect(isDesktopToken("launch-token")).toBe(true);
    for (const given of ["other-token", "launch-toke", "launch-token ", "", null]) expect(isDesktopToken(given), String(given)).toBe(false);
  });

  it("is never true on a server the desktop app didn't start", () => {
    for (const given of ["", "undefined", "anything", null]) expect(isDesktopToken(given), String(given)).toBe(false);
  });
});
