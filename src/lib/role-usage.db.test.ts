import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

import { loadRoleUsage } from "./role-usage";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

/** An application with a tailored resume holding these units. */
async function applied(profileId: string | null, unitIds: string[], extra: { awaitingReview?: boolean } = {}) {
  await prisma().application.create({
    data: {
      profileId,
      ...extra,
      documents: { create: [{ kind: "RESUME", units: unitIds.map((id) => ({ id, label: "", text: "" })) }, { kind: "COVER_LETTER", units: [{ id: "experience:a", label: "", text: "" }] }] },
    },
  });
}

describe("loadRoleUsage (E33-2)", () => {
  it("counts the profile's tailored resumes, with those that have no profile for the first one, but no drafts waiting for review", async () => {
    await prisma().profile.create({ data: { id: "second", name: "Second" } });
    await applied(TEST_PROFILE_ID, ["summary", "experience:a", "experience:b"]);
    await applied(null, ["experience:a"]);
    await applied(TEST_PROFILE_ID, ["experience:a"], { awaitingReview: true });
    await applied("second", ["experience:c"]);
    await prisma().application.create({ data: { profileId: TEST_PROFILE_ID } });

    expect(await loadRoleUsage(TEST_PROFILE_ID)).toEqual({ resumes: 2, roles: { a: 2, b: 1 } });
    expect(await loadRoleUsage("second")).toEqual({ resumes: 1, roles: { c: 1 } });
  });
});
