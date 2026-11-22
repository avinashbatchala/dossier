import { describe, expect, it } from "vitest";

import { isDesktopClient } from "./desktop-client";

describe("isDesktopClient (#359)", () => {
  it("knows the desktop app's window by its user agent", () => {
    expect(isDesktopClient("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/150.0 Electron/45.2.3 Safari/537.36 DossierDesktop/1.15.0")).toBe(true);
    expect(isDesktopClient("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/150.0 Safari/537.36")).toBe(false);
    expect(isDesktopClient("NotDossierDesktop/1.0")).toBe(false);
    expect(isDesktopClient("DossierDesktop/")).toBe(false);
    expect(isDesktopClient(null)).toBe(false);
  });
});
