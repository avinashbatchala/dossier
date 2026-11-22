import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ DOSSIER_DESKTOP_TOKEN: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env: config }));
const session = vi.hoisted(() => ({ startSession: vi.fn(async () => {}) }));
vi.mock("@/lib/auth/session", () => session);

const { POST } = await import("./route");
const { GET } = await import("../browser-sign-in/route");

const ask = (next: unknown, token?: string) =>
  new Request("http://127.0.0.1:47318/api/desktop/browser-link", {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-dossier-desktop-token": token } : {}) },
    body: JSON.stringify({ next }),
  });
const open = (path: string) => GET(new Request(`http://127.0.0.1:47318${path}`));

beforeEach(() => {
  config.DOSSIER_DESKTOP_TOKEN = "launch-token";
  session.startSession.mockClear();
});

describe("signing the system browser in from the desktop app (#365, #327)", () => {
  it("gives the app a one-time link that signs the browser in and goes on, once", async () => {
    const { path } = (await (await POST(ask("/api/google/connect?scopes=calendar", "launch-token"))).json()) as { path: string };
    expect(path).toMatch(/^\/api\/desktop\/browser-sign-in\?code=[\w-]{40,}$/);

    const first = await open(path);
    expect(first.status).toBe(303);
    expect(first.headers.get("location")).toBe("/api/google/connect?scopes=calendar");
    expect(session.startSession).toHaveBeenCalledWith({ persistent: false });

    // Used once: the second time goes to the sign-in page, which says how to get a new one.
    const again = await open(path);
    expect(again.headers.get("location")).toBe("/login?link=expired");
    expect(session.startSession).toHaveBeenCalledTimes(1);
  });

  it("only goes on to a page of this server", async () => {
    const { path } = (await (await POST(ask("https://evil.example/", "launch-token"))).json()) as { path: string };
    expect((await open(path)).headers.get("location")).toBe("/");
  });

  it("gives nothing without this launch's token, and doesn't exist elsewhere", async () => {
    for (const request of [ask("/", "other-token"), ask("/")]) expect((await POST(request)).status).toBe(404);
    expect((await open("/api/desktop/browser-sign-in?code=made-up")).headers.get("location")).toBe("/login?link=expired");
    config.DOSSIER_DESKTOP_TOKEN = undefined;
    expect((await POST(ask("/", "launch-token"))).status).toBe(404);
    expect((await open("/api/desktop/browser-sign-in?code=anything")).status).toBe(404);
    expect(session.startSession).not.toHaveBeenCalled();
  });
});
