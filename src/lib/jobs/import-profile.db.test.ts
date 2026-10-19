import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { discardProfileImports } from "./import-profile";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

const prisma = () => db.client!;

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().job.createMany({
    data: [
      { id: "read", type: "import-profile", key: "profile-import", status: "DONE", input: { resume: "Jane Doe, jane@example.com" } },
      { id: "failed", type: "import-profile", key: "profile-import", status: "FAILED", input: { resume: "John Doe" } },
      { id: "posting", type: "read-posting", status: "DONE", input: { posting: "…" } },
    ],
  });
});
afterAll(() => prisma().$disconnect());

describe("discardProfileImports (E4-10)", () => {
  it("deletes every resume reading, with the resume's text, and nothing else", async () => {
    await discardProfileImports();
    expect(await prisma().job.findMany({ select: { id: true } })).toEqual([{ id: "posting" }]);
  });

  it("deletes one reading when given its id", async () => {
    await discardProfileImports("read");
    expect(await prisma().job.findMany({ select: { id: true }, orderBy: { id: "asc" } })).toEqual([{ id: "failed" }, { id: "posting" }]);
  });
});
