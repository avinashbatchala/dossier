import { createHash } from "node:crypto";

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
const request = (path: string, headers: Record<string, string> = {}) => new NextRequest(`${origin}${path}`, { headers: { host: "localhost:3000", ...headers } });
/** The browser that started the sign-in, with its PKCE verifier (#358). */
const fromThisBrowser = { cookie: "dossier_google_pkce=the-verifier" };
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
    // PKCE (#358): the challenge goes to Google, the verifier stays in a cookie for the callback only.
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const cookie = response.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^dossier_google_pkce=[\w-]{43};/);
    expect(cookie).toMatch(/Path=\/api\/google\/callback/);
    expect(cookie).toMatch(/HttpOnly/i);
    const verifier = /^dossier_google_pkce=([\w-]+)/.exec(cookie)![1];
    expect(url.searchParams.get("code_challenge")).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("goes back to Settings when Google isn't set up", async () => {
    env.DOSSIER_GOOGLE_CLIENT_ID = undefined;
    const response = await connect(request("/api/google/connect"), undefined);
    expect(response.headers.get("location")).toBe(`${origin}/settings?section=google&google=not-configured`);
  });
});

describe("GET /api/google/callback", () => {
  const back = (response: Response) => new URL(response.headers.get("location")!).searchParams.get("google");

  it("saves the account from a valid state, code and PKCE verifier, and forgets the verifier", async () => {
    const state = await signState("/settings?section=google");
    const response = await callback(request(`/api/google/callback?state=${state}&code=abc`, { cookie: "dossier_google_pkce=the-verifier" }));
    expect(back(response)).toBe("connected");
    expect(exchangeCode).toHaveBeenCalledWith("abc", `${origin}/api/google/callback`, "the-verifier");
    expect(response.headers.get("set-cookie")).toMatch(/^dossier_google_pkce=;.*Max-Age=0/);
    expect(saveGoogleAccount).toHaveBeenCalledWith({ email: "jane@gmail.com", refreshToken: "r", scopes: "openid email" });
  });

  it("goes back to the setup guide when it started there (E21-5)", async () => {
    const started = await connect(request(`/api/google/connect?return=${encodeURIComponent("/welcome?step=google")}`), undefined);
    const state = new URL(started.headers.get("location")!).searchParams.get("state")!;
    const response = await callback(request(`/api/google/callback?state=${state}&code=abc`, fromThisBrowser));
    expect(response.headers.get("location")).toBe(`${origin}/welcome?step=google&google=connected`);

    // Anywhere else isn't on the way back.
    const elsewhere = await connect(request(`/api/google/connect?return=${encodeURIComponent("https://evil.example/")}`), undefined);
    const other = new URL(elsewhere.headers.get("location")!).searchParams.get("state")!;
    expect((await callback(request(`/api/google/callback?state=${other}&code=abc`, fromThisBrowser))).headers.get("location")).toBe(`${origin}/settings?section=google&google=connected`);

    env.DOSSIER_GOOGLE_CLIENT_ID = undefined;
    const missing = await connect(request(`/api/google/connect?return=${encodeURIComponent("/welcome?step=google")}`), undefined);
    expect(missing.headers.get("location")).toBe(`${origin}/welcome?step=google&google=not-configured`);
  });

  it("refuses a forged state, a denial, and a visitor who isn't signed in", async () => {
    expect(back(await callback(request("/api/google/callback?state=forged&code=abc")))).toBe("expired");
    const state = await signState("/settings?section=google");
    expect(back(await callback(request(`/api/google/callback?state=${state}&error=access_denied`)))).toBe("denied");
    expect(back(await callback(request(`/api/google/callback?state=${state}`)))).toBe("failed");
    // A code without the browser that asked for it (#358).
    expect(back(await callback(request(`/api/google/callback?state=${state}&code=abc`)))).toBe("expired");
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await callback(request(`/api/google/callback?state=${state}&code=abc`))).headers.get("location")).toBe(`${origin}/login`);
    expect(saveGoogleAccount).not.toHaveBeenCalled();
  });
});
