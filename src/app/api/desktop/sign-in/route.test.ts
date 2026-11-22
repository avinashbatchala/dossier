import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ DOSSIER_DESKTOP_TOKEN: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env: config }));
const session = vi.hoisted(() => ({ startSession: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/session", () => session);

const { GET } = await import("./route");

const asked = (token?: string) => new Request("http://127.0.0.1:47318/api/desktop/sign-in", { headers: token ? { "x-dossier-desktop-token": token } : {} });

beforeEach(() => {
  config.DOSSIER_DESKTOP_TOKEN = undefined;
  session.startSession.mockClear();
});

describe("GET /api/desktop/sign-in", () => {
  it("signs the desktop app in with this launch's token, and goes to the dashboard", async () => {
    config.DOSSIER_DESKTOP_TOKEN = "launch-token";
    const response = await GET(asked("launch-token"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(session.startSession).toHaveBeenCalledWith({ persistent: true });
  });

  it("doesn't exist for any other token, or without one", async () => {
    config.DOSSIER_DESKTOP_TOKEN = "launch-token";
    for (const request of [asked("other-token"), asked()]) {
      expect((await GET(request)).status).toBe(404);
    }
    expect(session.startSession).not.toHaveBeenCalled();
  });

  it("doesn't exist on a server the desktop app didn't start", async () => {
    for (const request of [asked("launch-token"), asked("undefined"), asked()]) {
      expect((await GET(request)).status).toBe(404);
    }
    expect(session.startSession).not.toHaveBeenCalled();
  });
});
