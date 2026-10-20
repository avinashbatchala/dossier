import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { unzipSync } from "fflate";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { renderPdf } from "@/lib/pdf/render";
import { createTestClient, resetDatabase } from "@/test/db";

import { countTailoredDocuments, zipPdfsJob } from "./zip-pdfs";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
const dataDir = vi.hoisted(() => ({ path: "" }));
vi.mock("@/lib/env", () => ({ env: { get DOSSIER_DATA_DIR() { return dataDir.path; } } }));
vi.mock("@/lib/pdf/render", () => ({ renderPdf: vi.fn(async (page: string) => new TextEncoder().encode(`%PDF ${page}`)) }));
vi.mock("@/lib/profile-data", () => ({ loadProfileName: async () => "Jane Doe" }));
vi.mock("./runner", () => ({ defineJob: <T,>(definition: T) => definition }));

const prisma = () => db.client!;
const steps: string[] = [];
const context = { id: "test-job", step: async (name: string) => void steps.push(name), signal: new AbortController().signal };

beforeEach(async () => {
  dataDir.path = await mkdtemp(path.join(tmpdir(), "dossier-zip-"));
  steps.length = 0;
  vi.mocked(renderPdf).mockClear();
  await resetDatabase(prisma());
  const both = { create: [{ kind: "RESUME" as const, units: [] }, { kind: "COVER_LETTER" as const, units: [] }] };
  await prisma().application.create({ data: { id: "a1", company: "Ledgerly", role: "Designer", documents: both } });
  await prisma().application.create({ data: { id: "a2", company: "Ledgerly", role: "Designer", documents: { create: { kind: "RESUME", units: [] } } } });
  await prisma().application.create({ data: { id: "a3", company: "Oaken / Studio", documents: both } });
  await prisma().application.create({ data: { id: "a4", company: "No documents Inc" } });
  // An email is never a PDF.
  await prisma().application.create({ data: { id: "a5", company: "Email only", documents: { create: { kind: "EMAIL", units: [] } } } });
  await prisma().document.create({ data: { applicationId: "a1", kind: "EMAIL", units: [] } });
});
afterAll(async () => {
  await rm(dataDir.path, { recursive: true, force: true });
  await prisma().$disconnect();
});

describe("zipPdfsJob (E10-5)", () => {
  it("zips every tailored document into a folder per company", async () => {
    const result = await zipPdfsJob.run({}, context);
    expect(result).toMatchObject({ documents: 5, fileName: expect.stringMatching(/^dossier-pdfs-\d{4}-\d{2}-\d{2}\.zip$/) });
    expect(renderPdf).toHaveBeenCalledWith("/print/resume/a1");
    expect(renderPdf).toHaveBeenCalledWith("/print/letter/a3");

    const zip = unzipSync(await readFile(path.join(dataDir.path, "downloads", result.file)));
    expect(Object.keys(zip).sort()).toEqual([
      "Ledgerly/Jane Doe – Ledgerly – Cover letter.pdf",
      "Ledgerly/Jane Doe – Ledgerly – Resume (2).pdf",
      "Ledgerly/Jane Doe – Ledgerly – Resume.pdf",
      "Oaken Studio/Jane Doe – Oaken Studio – Cover letter.pdf",
      "Oaken Studio/Jane Doe – Oaken Studio – Resume.pdf",
    ]);
    expect(new TextDecoder().decode(zip["Ledgerly/Jane Doe – Ledgerly – Resume.pdf"])).toBe("%PDF /print/resume/a1");
    expect(steps).toEqual(["Rendering 5 documents", ...[1, 2, 3, 4, 5].map((n) => `Rendered ${n} of 5`), "Zipping"]);
    expect(await countTailoredDocuments()).toBe(5);
  });

  it("clears out zips nobody collected", async () => {
    const first = await zipPdfsJob.run({}, context);
    vi.useFakeTimers({ now: Date.now() + 2 * 60 * 60 * 1000, toFake: ["Date"] });
    try {
      const second = await zipPdfsJob.run({}, context);
      expect(await readdir(path.join(dataDir.path, "downloads"))).toEqual([second.file]);
      expect(second.file).not.toBe(first.file);
    } finally {
      vi.useRealTimers();
    }
  });
});
