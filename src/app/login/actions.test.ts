import { beforeEach, describe, expect, it, vi } from "vitest";

import { loginWaitMs, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/login-throttle";
import { passwordMatches, startSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { loadProfileName } from "@/lib/profile-data";

import { signIn, signInWithForm } from "./actions";
import { loginMessages } from "./messages";

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.1, 203.0.113.7" }),
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
vi.mock("@/lib/auth/login-throttle", () => ({
  loginWaitMs: vi.fn(),
  recordLoginFailure: vi.fn(),
  recordLoginSuccess: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/profile-data", () => ({ loadProfileName: vi.fn() }));

describe("signIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(passwordMatches).mockImplementation(async (candidate) => candidate === "correct horse");
    vi.mocked(loginWaitMs).mockResolvedValue(0);
    vi.mocked(loadProfileName).mockResolvedValue("Jane Doe");
  });

  it("asks for a password when none was entered, without counting it as a failure", async () => {
    await expect(signIn({ password: "", remember: false })).resolves.toEqual({
      ok: false,
      error: loginMessages.empty,
    });
    expect(startSession).not.toHaveBeenCalled();
    expect(recordLoginFailure).not.toHaveBeenCalled();
  });

  it("refuses a wrong password and counts the failure for the client's IP", async () => {
    await expect(signIn({ password: "hunter2", remember: false })).resolves.toEqual({
      ok: false,
      error: loginMessages.wrong,
    });
    expect(recordLoginFailure).toHaveBeenCalledWith(prisma, "203.0.113.7");
    expect(startSession).not.toHaveBeenCalled();
  });

  it("refuses to even check the password while the IP is blocked", async () => {
    vi.mocked(loginWaitMs).mockResolvedValue(29_500);
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
    expect(recordLoginSuccess).toHaveBeenCalledWith(prisma, "203.0.113.7");
    expect(startSession).toHaveBeenCalledWith({ persistent: true });
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
    vi.mocked(loginWaitMs).mockResolvedValue(0);
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
