import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

const db = createTestClient();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("the database client", () => {
  it("keeps a write made while a transaction is open out of that transaction", async () => {
    let opened!: () => void;
    const open = new Promise<void>((resolve) => (opened = resolve));
    const undone = db
      .$transaction(async (tx) => {
        await tx.fact.create({ data: { text: "inside" } });
        opened();
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new Error("undo");
      })
      .catch((error: Error) => error.message);

    await open;
    await db.fact.create({ data: { text: "outside" } });

    expect(await undone).toBe("undo");
    expect((await db.fact.findMany()).map((fact) => fact.text)).toEqual(["outside"]);
  });

  it("compares skill names without case", async () => {
    await db.skill.create({ data: { profileId: TEST_PROFILE_ID, name: "TypeScript" } });
    expect(await db.skill.findUnique({ where: { profileId_name: { profileId: TEST_PROFILE_ID, name: "typescript" } } })).toMatchObject({ name: "TypeScript" });
    await expect(db.skill.create({ data: { profileId: TEST_PROFILE_ID, name: "TYPESCRIPT" } })).rejects.toThrow();
  });
});
