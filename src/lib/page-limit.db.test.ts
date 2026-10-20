import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { demoProfile, demoResumeUnits } from "@/lib/demo-profile";
import { createTestClient, resetDatabase } from "@/test/db";

import { describeTrim, fitResumeToPages, nextCut } from "./page-limit";
import { countPdfPages } from "./pdf/pages";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/pdf/render", () => ({ renderPdf: vi.fn() }));

const prisma = () => db.client!;
const profile = demoProfile();
const units = demoResumeUnits();
// The demo roles, oldest first: Studio Brik (e3), Fieldnote (e2), Northwind (e1); and one project (p1).
const resume = async () => (await prisma().document.findFirstOrThrow({ where: { applicationId: "app-1", kind: "RESUME" } }));

beforeEach(async () => {
  await resetDatabase(prisma());
  await prisma().application.create({ data: { id: "app-1", documents: { create: { kind: "RESUME", units } } } });
});
afterAll(() => prisma().$disconnect());

describe("nextCut (E10-10)", () => {
  it("leaves out the oldest role first", () => {
    const cut = nextCut(units, profile)!;
    expect(cut.trimmed).toEqual({ kind: "unit", unit: units.find((unit) => unit.id === "experience:e3"), index: units.findIndex((unit) => unit.id === "experience:e3") });
    expect(cut.units.map((unit) => unit.id)).not.toContain("experience:e3");
  });

  it("then shortens the last role left, keeping its first bullet", () => {
    const one = units.filter((unit) => unit.id !== "experience:e2" && unit.id !== "experience:e3");
    const bullets = one.find((unit) => unit.id === "experience:e1")!.text.split("\n");
    const cut = nextCut(one, profile)!;
    expect(cut.trimmed).toEqual({ kind: "bullets", unitId: "experience:e1", label: "Northwind Logistics role", lines: bullets.slice(-1) });
  });

  it("then leaves out the oldest project, and then has nothing left to cut (PRO-13)", () => {
    const one = units.filter((unit) => unit.id !== "experience:e2" && unit.id !== "experience:e3");
    const single = { ...one.find((unit) => unit.id === "experience:e1")!, text: one.find((unit) => unit.id === "experience:e1")!.text.split("\n")[0] };
    const shortest = one.map((unit) => (unit.id === single.id ? single : unit));
    const cut = nextCut(shortest, profile)!;
    expect(cut.trimmed).toEqual({ kind: "unit", unit: units.find((unit) => unit.id === "project:p1"), index: shortest.findIndex((unit) => unit.id === "project:p1") });
    expect(describeTrim([cut.trimmed], profile, false, 1)[0]).toBe("Left out the Tidewater design tokens project to fit one page");
    expect(nextCut(cut.units, profile)).toBeNull();
  });
});

describe("fitResumeToPages (E10-10)", () => {
  it("leaves a resume that fits alone", async () => {
    expect(await fitResumeToPages("app-1", profile, 1, async () => 1)).toEqual({ trimmed: [], fits: true });
    expect(await fitResumeToPages("app-1", profile, 2, async () => 2)).toEqual({ trimmed: [], fits: true });
    expect((await resume()).trimmed).toBeNull();
  });

  it("cuts the oldest roles until it fits, and keeps what it cut", async () => {
    // Two pages while all three roles are there.
    const pages = vi.fn(async () => ((await resume()).units as { id: string }[]).filter((unit) => unit.id.startsWith("experience:")).length > 2 ? 2 : 1);
    const { trimmed, fits } = await fitResumeToPages("app-1", profile, 1, pages);
    expect(fits).toBe(true);
    expect(trimmed.map((item) => (item.kind === "unit" ? item.unit.id : item.unitId))).toEqual(["experience:e3"]);
    expect(pages).toHaveBeenCalledWith("/print/resume/app-1");
    const saved = await resume();
    expect((saved.units as { id: string }[]).map((unit) => unit.id)).not.toContain("experience:e3");
    expect(saved.trimmed).toEqual(trimmed);
    expect(describeTrim(trimmed, profile, fits, 1)).toEqual(["Left out Studio Brik (2015–2018) to fit one page"]);
    // The trimmed resume is a version, one click from the draft before it (E8-10).
    expect(await db.client!.documentVersion.findMany({ select: { cause: true, units: true } })).toEqual([{ cause: "TRIMMED", units: saved.units }]);
  });

  it("trims to two pages when that's the limit", async () => {
    const pages = vi.fn(async () => ((await resume()).units as { id: string }[]).filter((unit) => unit.id.startsWith("experience:")).length > 2 ? 3 : 2);
    const { trimmed, fits } = await fitResumeToPages("app-1", profile, 2, pages);
    expect(fits).toBe(true);
    expect(describeTrim(trimmed, profile, fits, 2)).toEqual(["Left out Studio Brik (2015–2018) to fit two pages"]);
  });

  it("gives up after cutting all it can, and says so", async () => {
    const { trimmed, fits } = await fitResumeToPages("app-1", profile, 1, async () => 2);
    expect(fits).toBe(false);
    expect(trimmed.map((item) => item.kind)).toEqual(["unit", "unit", "bullets", "unit"]);
    const lines = describeTrim(trimmed, profile, fits, 1);
    expect(lines[2]).toMatch(/^Shortened the Northwind Logistics role by \d bullets to fit one page$/);
    expect(lines.at(-1)).toBe("It still runs over one page, so shorten it by hand if it has to fit");
  });
});

describe("countPdfPages", () => {
  it("counts page objects, not the page tree", () => {
    const pdf = new TextEncoder().encode("<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page /Parent 1 0 R >>");
    expect(countPdfPages(pdf)).toBe(2);
  });
});
