import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import { loadGoogleAccount, saveGoogleAccount } from "@/lib/google/account";
import { exchangeCode, signState } from "@/lib/google/oauth";

import { GET as callback } from "./callback/route";
import { GET as connect } from "./connect/route";

// Connecting Google (E15-1): the redirect to Google's consent page and the
// way back, with Google's token endpoint mocked.

const env = vi.hoisted(() => ({ DOSSIER_SECRET: "s".repeat(40), DOSSIER_GOOGLE_CLIENT_ID: "client" as string | undefined, DOSSIER_GOOGLE_CLIENT_SECRET: "secret" }));
vi.mock("@/lib/env", () => ({ env }));
// Nothing saved in Settings → Google: the client comes from the environment.
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => ({ googleClientId: null, googleClientSecretEnc: null }) }));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/google/account", () => ({ loadGoogleAccount: vi.fn(), saveGoogleAccount: vi.fn() }));
vi.mock("@/lib/google/oauth", async (original) => ({ ...(await original<typeof import("@/lib/google/oauth")>()), exchangeCode: vi.fn() }));

const origin = "http://localhost:3000";
const request = (path: string) => new NextRequest(`${origin}${path}`, { headers: { host: "localhost:3000" } });
const idToken = (email: string) => `h.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.s`;

beforeEach(() => {
  env.DOSSIER_GOOGLE_CLIENT_ID = "client";
  vi.mocked(getSession).mockResolvedValue({ persistent: false, issuedAt: new Date(), expiresAt: new Date() });
  vi.mocked(loadGoogleAccount).mockResolvedValue(null);
  vi.mocked(saveGoogleAccount).mockReset().mockResolvedValue();
  vi.mocked(exchangeCode).mockReset().mockResolvedValue({ access_token: "a", expires_in: 3600, refresh_token: "r", scope: "openid email", id_token: idToken("jane@gmail.com") });
});

describe("GET /api/google/connect", () => {
  it("sends the browser to Google's consent page for the features asked", async () => {
    const response = await connect(request("/api/google/connect?scopes=send,calendar,bogus"), undefined);
    const url = new URL(response.headers.get("location")!);
    expect(url.host).toBe("accounts.google.com");
    expect(url.searchParams.get("redirect_uri")).toBe(`${origin}/api/google/callback`);
    expect(url.searchParams.get("scope")).toContain("gmail.send");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
    expect(url.searchParams.get("scope")).not.toContain("gmail.readonly");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("goes back to Settings when Google isn't set up", async () => {
    env.DOSSIER_GOOGLE_CLIENT_ID = undefined;
    const response = await connect(request("/api/google/connect"), undefined);
    expect(response.headers.get("location")).toBe(`${origin}/settings?section=google&google=not-configured`);
  });
});

describe("GET /api/google/callback", () => {
  const back = (response: Response) => new URL(response.headers.get("location")!).searchParams.get("google");

  it("saves the account from a valid state and code", async () => {
    const state = await signState("/settings?section=google");
    const response = await callback(request(`/api/google/callback?state=${state}&code=abc`));
    expect(back(response)).toBe("connected");
    expect(exchangeCode).toHaveBeenCalledWith("abc", `${origin}/api/google/callback`);
    expect(saveGoogleAccount).toHaveBeenCalledWith({ email: "jane@gmail.com", refreshToken: "r", scopes: "openid email" });
  });

  it("refuses a forged state, a denial, and a visitor who isn't signed in", async () => {
    expect(back(await callback(request("/api/google/callback?state=forged&code=abc")))).toBe("expired");
    const state = await signState("/settings?section=google");
    expect(back(await callback(request(`/api/google/callback?state=${state}&error=access_denied`)))).toBe("denied");
    expect(back(await callback(request(`/api/google/callback?state=${state}`)))).toBe("failed");
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await callback(request(`/api/google/callback?state=${state}&code=abc`))).headers.get("location")).toBe(`${origin}/login`);
    expect(saveGoogleAccount).not.toHaveBeenCalled();
  });
});
