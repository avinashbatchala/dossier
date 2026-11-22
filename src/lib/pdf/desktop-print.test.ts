import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "a".repeat(32), DOSSIER_DESKTOP_TOKEN: "launch-token" } }));

const { printWithDesktopApp } = await import("./desktop-print");
const { verifyPrintToken } = await import("./print-token");

describe("printWithDesktopApp", () => {
  it("asks the desktop app with the launch's token and a token for that page", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new Uint8Array([37, 80, 68, 70])));
    expect(await printWithDesktopApp("http://127.0.0.1:5000", "/print/base?fit=1", fetch)).toEqual(new Uint8Array([37, 80, 68, 70]));
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:5000");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ "x-dossier-desktop-token": "launch-token" });
    const { page, printToken } = JSON.parse(init?.body as string) as { page: string; printToken: string };
    expect(page).toBe("/print/base?fit=1");
    expect(await verifyPrintToken(printToken, "/print/base?fit=1")).toBe(true);
    expect(await verifyPrintToken(printToken, "/print/base")).toBe(false);
  });

  it("throws when it can't, so a failure is never a wrong PDF", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("The print page redirected.", { status: 500 }));
    await expect(printWithDesktopApp("http://127.0.0.1:5000", "/print/base", fetch)).rejects.toThrow("The print page redirected.");
  });
});
