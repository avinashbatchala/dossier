import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { loadSignature, loadSignatureBytes, removeSignature, saveSignature } from "./signature-data";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

const prisma = () => db.client!;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

describe("the stored signature (E17)", () => {
  it("returns the right data URL for a PNG and a JPEG, and replaces one with the other", async () => {
    expect(await loadSignature()).toBeNull();

    await saveSignature(PNG, "image/png");
    expect(await loadSignatureBytes()).toMatchObject({ mimeType: "image/png" });
    expect(await loadSignature()).toBe(`data:image/png;base64,${Buffer.from(PNG).toString("base64")}`);

    await saveSignature(JPEG, "image/jpeg");
    expect(await loadSignatureBytes()).toMatchObject({ mimeType: "image/jpeg" });
    expect(await loadSignature()).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}`);
    expect(await prisma().signature.count()).toBe(1);
  });

  it("removes the signature", async () => {
    await saveSignature(PNG, "image/png");
    await removeSignature();
    expect(await loadSignature()).toBeNull();
  });
});
