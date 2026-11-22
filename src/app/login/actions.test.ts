import { beforeEach, describe, expect, it, vi } from "vitest";

import { knownBrowser, rememberBrowser } from "@/lib/auth/known-browser";
import { startLoginAttempt } from "@/lib/auth/login-throttle";
import { passwordMatches, startSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";

import { signIn, signInWithForm } from "./actions";
import { loginMessages } from "./messages";

const request = vi.hoisted(() => ({ userAgent: "Mozilla/5.0 Chrome/150.0" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.1, 203.0.113.7", "user-agent": request.userAgent }),
}));
vi.mock("next/navigation", () => ({
  unstable_rethrow: () => {},
  redirect: (to: string) => {
    throw new Error(`redirect ${to}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(),
  passwordMatches: vi.fn(),
  startSession: vi.fn(),
}));
vi.mock("@/lib/auth/login-throttle", () => ({ startLoginAttempt: vi.fn() }));
vi.mock("@/lib/auth/known-browser", () => ({ knownBrowser: vi.fn(async () => null), rememberBrowser: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/profile-data", () => ({ loadProfileName: vi.fn() }));

const succeeded = vi.fn();
const letThrough = () => vi.mocked(startLoginAttempt).mockResolvedValue({ allowed: true, succeeded });

describe("signIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(passwordMatches).mockImplementation(async (candidate) => candidate === "correct horse");
    letThrough();
    vi.mocked(loadProfileName).mockResolvedValue("Jane Doe");
  });

  it("asks for a password when none was entered, without counting it as an attempt", async () => {
    await expect(signIn({ password: "", remember: false })).resolves.toEqual({
      ok: false,
      error: loginMessages.empty,
    });
    expect(startSession).not.toHaveBeenCalled();
    expect(startLoginAttempt).not.toHaveBeenCalled();
  });

  it("counts the attempt for the client's IP before checking the password, and refuses a wrong one (#329)", async () => {
    vi.mocked(passwordMatches).mockImplementation(async (candidate) => {
      expect(startLoginAttempt).toHaveBeenCalledWith(prisma, { ip: "203.0.113.7", browser: null });
      return candidate === "correct horse";
    });
    await expect(signIn({ password: "hunter2", remember: false })).resolves.toEqual({
      ok: false,
      error: loginMessages.wrong,
    });
    expect(succeeded).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(rememberBrowser).not.toHaveBeenCalled();
  });

  it("refuses to even check the password while the IP is blocked", async () => {
    vi.mocked(startLoginAttempt).mockResolvedValue({ allowed: false, waitMs: 29_500, limit: "client" });
    await expect(signIn({ password: "correct horse", remember: false })).resolves.toEqual({
      ok: false,
      error: "Too many attempts. Try again in 30 seconds.",
    });
    expect(passwordMatches).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });

  it("starts a session, resets the IP's counter and welcomes the user by first name", async () => {
    await expect(
      signIn({ password: "correct horse", remember: true, next: "/applications/abc" }),
    ).resolves.toEqual({
      ok: true,
      data: { redirectTo: "/applications/abc" },
      toast: "Welcome back, Jane.",
    });
    expect(succeeded).toHaveBeenCalledOnce();
    expect(startSession).toHaveBeenCalledWith({ persistent: true });
    expect(rememberBrowser).toHaveBeenCalledOnce();
  });

  it("keeps a browser's session only when asked, and the desktop app's always (#359)", async () => {
    await signIn({ password: "correct horse", remember: false });
    expect(startSession).toHaveBeenLastCalledWith({ persistent: false });
    request.userAgent = "Mozilla/5.0 Chrome/150.0 Electron/45.2.3 DossierDesktop/1.15.0";
    try {
      await signIn({ password: "correct horse", remember: false });
      expect(startSession).toHaveBeenLastCalledWith({ persistent: true });
    } finally {
      request.userAgent = "Mozilla/5.0 Chrome/150.0";
    }
  });

  it("counts a browser that signed in before for itself (#334)", async () => {
    vi.mocked(knownBrowser).mockResolvedValueOnce("b-1");
    await signIn({ password: "correct horse", remember: false });
    expect(startLoginAttempt).toHaveBeenCalledWith(prisma, { ip: "203.0.113.7", browser: "b-1" });
  });

  it("says how to get past a block on everyone that this browser didn't cause (#334)", async () => {
    vi.mocked(startLoginAttempt).mockResolvedValue({ allowed: false, waitMs: 15 * 60_000, limit: "everyone" });
    await expect(signIn({ password: "correct horse", remember: false })).resolves.toEqual({
      ok: false,
      error:
        "Too many wrong passwords were tried lately, so new browsers have to wait 15 minutes. A browser you've signed in with before can sign in now, and restarting Dossier ends the wait.",
    });
    expect(passwordMatches).not.toHaveBeenCalled();
  });

  it("says 'there' before the profile has a name, and ignores unsafe redirects", async () => {
    vi.mocked(loadProfileName).mockResolvedValue("");
    await expect(
      signIn({ password: "correct horse", remember: false, next: "https://evil.example" }),
    ).resolves.toMatchObject({ data: { redirectTo: "/" }, toast: "Welcome back, there." });
    expect(startSession).toHaveBeenCalledWith({ persistent: false });
  });
});

describe("signInWithForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(passwordMatches).mockImplementation(async (candidate) => candidate === "correct horse");
    letThrough();
    vi.mocked(loadProfileName).mockResolvedValue("Jane Doe");
  });

  function form(fields: Record<string, string>): FormData {
    const data = new FormData();
    for (const [name, value] of Object.entries(fields)) data.set(name, value);
    return data;
  }

  it("returns the error for the page to show", async () => {
    await expect(signInWithForm(null, form({ password: "hunter2" }))).resolves.toEqual({ error: loginMessages.wrong });
    await expect(signInWithForm(null, form({}))).resolves.toEqual({ error: loginMessages.empty });
    expect(startSession).not.toHaveBeenCalled();
  });

  it("signs in and goes on to the next page", async () => {
    await expect(
      signInWithForm(null, form({ password: "correct horse", remember: "on", next: "/profile" })),
    ).rejects.toThrow("redirect /profile");
    expect(startSession).toHaveBeenCalledWith({ persistent: true });
  });

  it("goes to the dashboard when there's no next page, and remembers only when ticked", async () => {
    await expect(signInWithForm({ error: loginMessages.wrong }, form({ password: "correct horse" }))).rejects.toThrow(
      /^redirect \/$/,
    );
    expect(startSession).toHaveBeenCalledWith({ persistent: false });
  });
});
