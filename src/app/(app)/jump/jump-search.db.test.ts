import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase, TEST_PROFILE_ID } from "@/test/db";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

const { match, searchJump } = await import("./jump-search");

const prisma = () => db.client!;

beforeEach(() => resetDatabase(prisma()));
afterAll(() => prisma().$disconnect());

const labels = (groups: Awaited<ReturnType<typeof searchJump>>) => Object.fromEntries(groups.map((group) => [group.label, group.results.map((result) => result.label)]));

describe("Jump to's search (E27-6)", () => {
  it("shows the screens and the latest applications before anything is typed", async () => {
    await prisma().application.create({ data: { role: "Designer", company: "Ledgerly", status: "SENT" } });
    await prisma().application.create({ data: { role: "Old", company: "Gone", archivedAt: new Date() } });
    const groups = await searchJump("  ");
    expect(groups.map((group) => group.label)).toEqual(["Screens", "Recent applications"]);
    expect(labels(groups)["Recent applications"]).toEqual(["Designer at Ledgerly"]);
    expect(labels(groups).Screens).toContain("New application");
  });

  it("finds applications in any case and with accents, archived ones marked", async () => {
    const sent = await prisma().application.create({ data: { role: "Product Designer", company: "Café Ledger", status: "SENT" } });
    await prisma().application.create({ data: { role: "Engineer", company: "Ledgerly", status: "DRAFT", archivedAt: new Date() } });
    await prisma().application.create({ data: { role: "Agent's draft", company: "Ledger Inc", awaitingReview: true } });
    const [group] = (await searchJump("cafe ledger")).filter((entry) => entry.label === "Applications");
    expect(group.results).toEqual([{ id: `application:${sent.id}`, label: "Product Designer at Café Ledger", detail: "Sent", href: `/applications/${sent.id}` }]);

    const all = (await searchJump("LEDGER")).find((entry) => entry.label === "Applications")!;
    expect(all.results.map((result) => result.detail).sort()).toEqual(["Draft · Archived", "Sent"]);
  });

  it("finds saved and new postings, not dismissed or archived ones", async () => {
    const base = { source: "JSEARCH", company: "Northwind" };
    await prisma().posting.create({ data: { ...base, externalId: "1", title: "Designer, saved", savedAt: new Date(), seenAt: new Date() } });
    await prisma().posting.create({ data: { ...base, externalId: "2", title: "Designer, new" } });
    await prisma().posting.create({ data: { ...base, externalId: "3", title: "Designer, seen", seenAt: new Date() } });
    await prisma().posting.create({ data: { ...base, externalId: "4", title: "Designer, dismissed", dismissedAt: new Date() } });
    await prisma().posting.create({ data: { ...base, externalId: "5", title: "Designer, archived", archivedAt: new Date() } });
    const group = (await searchJump("designer northwind")).find((entry) => entry.label === "Positions")!;
    expect(group.results.map(({ label, detail, href }) => ({ label, detail, href })).sort((a, b) => a.label.localeCompare(b.label))).toEqual([
      { label: "Designer, new", detail: "New · Northwind", href: "/jobs?show=new&focus=JSEARCH%3A2" },
      { label: "Designer, saved", detail: "Saved · Northwind", href: "/jobs?show=saved&focus=JSEARCH%3A1" },
    ]);
  });

  it("finds profiles, profile sections, Settings sections and screens", async () => {
    await prisma().profile.update({ where: { id: TEST_PROFILE_ID }, data: { name: "Backend" } });
    expect(labels(await searchJump("back"))).toMatchObject({ Profiles: ["Backend"] });
    expect(labels(await searchJump("experience"))).toMatchObject({ Profiles: ["Experience"] });
    expect((await searchJump("experience")).find((group) => group.label === "Profiles")!.results[0].href).toBe("/profile?section=experience");
    expect(labels(await searchJump("google"))).toMatchObject({ Settings: ["Google"] });
    expect(labels(await searchJump("inbox"))).toMatchObject({ Screens: ["Inbox"] });
  });

  it("says nothing when nothing matches", async () => {
    expect(await searchJump("zzzz")).toEqual([]);
  });
});

describe("match", () => {
  it("needs every word, and ranks a start of the text over a start of a word over the middle", () => {
    expect(match("Product Designer", "designer product")).toBe(1);
    expect(match("Product Designer", "sign")).toBe(0);
    expect(match("Product Designer", "product des")).toBe(2);
    expect(match("Senior Product Designer", "designer")).toBe(1);
    expect(match("Redesigner", "designer")).toBe(0);
    expect(match("Product Designer", "engineer")).toBeNull();
  });
});
