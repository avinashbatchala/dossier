import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

// The user's time zone, with and without a request (E9-9, E15).

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const request = vi.hoisted(() => ({ cookie: undefined as string | undefined, inRequest: true }));
vi.mock("next/headers", () => ({
  cookies: async () => {
    if (!request.inRequest) throw new Error("`cookies` was called outside a request scope.");
    return { get: (name: string) => (name === "dossier-tz" && request.cookie ? { value: request.cookie } : undefined) };
  },
}));

import { lastKnownTimeZone, rememberBrowserTimeZone, userTimeZone } from "./time-zone";

const prisma = () => db.client!;
const saved = async () => (await prisma().setting.findUnique({ where: { key: "browserTimeZone" } }))?.value;

beforeEach(async () => {
  await resetDatabase(prisma());
  request.cookie = undefined;
  request.inRequest = true;
});
afterAll(async () => prisma().$disconnect());

describe("the user's time zone", () => {
  it("reads the browser's zone from its cookie, and ignores one that isn't a zone", async () => {
    request.cookie = encodeURIComponent("Europe/Berlin");
    expect(await userTimeZone()).toBe("Europe/Berlin");
    request.cookie = "Mars/Olympus";
    expect(await userTimeZone()).toBeUndefined();
  });

  it("remembers it for work without a request, and only writes a change", async () => {
    await rememberBrowserTimeZone(undefined);
    expect(await saved()).toBeUndefined();
    await rememberBrowserTimeZone("Europe/Berlin");
    expect(await saved()).toBe("Europe/Berlin");
    const { updatedAt } = await prisma().setting.findUniqueOrThrow({ where: { key: "browserTimeZone" } });
    await rememberBrowserTimeZone("Europe/Berlin");
    expect((await prisma().setting.findUniqueOrThrow({ where: { key: "browserTimeZone" } })).updatedAt).toEqual(updatedAt);
  });

  it("uses the request's zone, else the remembered one, else the server's", async () => {
    request.cookie = "America/New_York";
    expect(await lastKnownTimeZone()).toBe("America/New_York");
    request.inRequest = false;
    expect(await lastKnownTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    await rememberBrowserTimeZone("Europe/Berlin");
    expect(await lastKnownTimeZone()).toBe("Europe/Berlin");
  });
});
