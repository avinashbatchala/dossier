import { beforeEach, describe, expect, it, vi } from "vitest";

import { deriveKey } from "@/lib/keys";

import {
  decodeKnownBrowser,
  encodeKnownBrowser,
  KNOWN_BROWSER_COOKIE,
  KNOWN_BROWSER_LIFETIME,
  knownBrowser,
  rememberBrowser,
} from "./known-browser";
import { passwordFingerprint } from "./session";

const jar = vi.hoisted(() => ({ values: new Map<string, string>(), set: vi.fn(), proto: null as string | null }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined),
    set: (name: string, value: string, options: object) => {
      jar.values.set(name, value);
      jar.set(name, value, options);
    },
  }),
  headers: async () => new Headers(jar.proto ? { "x-forwarded-proto": jar.proto } : {}),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(32), DOSSIER_PASSWORD: "correct horse" } }));

beforeEach(() => {
  jar.values.clear();
  jar.set.mockClear();
  jar.proto = null;
});

const options = () => ({ key: deriveKey("known-browser"), fingerprint: passwordFingerprint() });

describe("a browser that signed in before (#334)", () => {
  it("gets a year-long, HTTP-only cookie with a new id at each sign-in, which reads back", async () => {
    jar.proto = "https";
    await rememberBrowser();
    expect(jar.set).toHaveBeenCalledWith(KNOWN_BROWSER_COOKIE, expect.any(String), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: true,
      maxAge: KNOWN_BROWSER_LIFETIME,
    });
    const first = await knownBrowser();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);

    await rememberBrowser();
    expect(await knownBrowser()).not.toBe(first);
  });

  it("is a new browser without the cookie", async () => {
    expect(await knownBrowser()).toBeNull();
  });

  it("isn't known with a token that was tampered with, has run out, or is from another password or secret", async () => {
    const now = new Date("2026-11-05T12:00:00Z");
    const token = await encodeKnownBrowser("b-1", { ...options(), now });
    expect(await decodeKnownBrowser(token, { ...options(), now })).toBe("b-1");

    expect(await decodeKnownBrowser(`${token.slice(0, -2)}xx`, { ...options(), now })).toBeNull();
    const later = new Date(now.getTime() + (KNOWN_BROWSER_LIFETIME + 1) * 1000);
    expect(await decodeKnownBrowser(token, { ...options(), now: later })).toBeNull();
    expect(await decodeKnownBrowser(token, { ...options(), fingerprint: passwordFingerprint("another password"), now })).toBeNull();
    expect(await decodeKnownBrowser(token, { key: deriveKey("known-browser", "t".repeat(32)), fingerprint: passwordFingerprint(), now })).toBeNull();
    // A session token is no browser token, though both use the same format.
    expect(await decodeKnownBrowser(token, { key: deriveKey("session"), fingerprint: passwordFingerprint(), now })).toBeNull();
  });
});
