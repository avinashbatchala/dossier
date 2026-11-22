import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { seedBuiltIns } from "../../prisma/seed/built-ins";
import { seedDemo } from "../../prisma/seed/demo";

import { loadDashboard } from "./dashboard-data";

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});

const prisma = () => db.client!;
const now = new Date(2026, 8, 27, 12);

beforeEach(async () => {
  await resetDatabase(prisma());
  await seedBuiltIns(prisma());
  await seedDemo(prisma(), { now });
});
afterAll(() => prisma().$disconnect());

describe("loadDashboard against the demo seed (E9-6)", () => {
  it("has 7 sent, 5 heard back (71%) and 3 that reached an interview", async () => {
    const figures = await loadDashboard({}, now);
    expect(figures).toMatchObject({ sent: 7, heardBack: 5, heardBackPercent: 71, reachedInterview: 3 });
    expect(figures.funnel.map((step) => step.count)).toEqual([7, 5, 3, 2, 0]);
    expect(figures.funnel.map((step) => step.stopped)).toEqual([
      { open: 2, rejected: 0, declined: 0, archived: 0 },
      { open: 1, rejected: 1, declined: 0, archived: 0 },
      { open: 1, rejected: 0, declined: 0, archived: 0 },
      { open: 1, rejected: 0, declined: 1, archived: 0 },
      { open: 0, rejected: 0, declined: 0, archived: 0 },
    ]);
    expect(figures.byStatus).toEqual({ DRAFT: 2, SENT: 2, SCREENING: 1, INTERVIEW: 1, OFFER: 1, ACCEPTED: 0, REJECTED: 1, DECLINED: 1 });
  });

  it("lists what needs you this week first, then the offer (E28-4)", async () => {
    const figures = await loadDashboard({ timeZone: "Europe/Amsterdam" }, now);
    expect(figures.needsYou.map((item) => `${item.company}: ${item.reason}${item.due ? ` · ${item.due}` : ""}`)).toEqual([
      "Kestrel Maps: Sent Sun 20 Sep, no reply. · quiet for 7 days",
      "Northstar Health: Interview. · tomorrow, 14:00",
      "Brightline Transit: Still a draft. · apply by Sat 3 Oct · 6 days",
      // Ledgerly's deadline is three weeks out: not this week, and not undated.
      "Oaken Studio: An offer is waiting on your decision.",
    ]);
    expect(figures.needsYou.map((item) => item.soon)).toEqual([true, true, true, false]);
  });

  it("nudges sooner or later as set (E9-9)", async () => {
    const quiet = async (quietDays: number) =>
      (await loadDashboard({ quietDays }, now)).needsYou.filter((item) => item.action === "Follow up").map((item) => item.company);
    expect(await quiet(3)).toEqual(["Kestrel Maps", "Tidewater Energy", "Meridian Bank"]);
    expect(await quiet(14)).toEqual([]);
  });

  it("still counts archived applications in the funnel", async () => {
    await prisma().application.updateMany({ where: { company: "Quill & Co" }, data: { archivedAt: now } });
    const figures = await loadDashboard({}, now);
    expect(figures).toMatchObject({ sent: 7, heardBack: 5, reachedInterview: 3 });
    expect(figures.byStatus.DECLINED).toBe(1);
    // Closed before it was archived, so it still counts as declined.
    expect(figures.funnel[3].stopped).toMatchObject({ declined: 1, archived: 0 });
  });

  it("counts an application archived while still open apart (decided 16 October 2026)", async () => {
    await prisma().application.updateMany({ where: { company: "Kestrel Maps" }, data: { archivedAt: now } });
    const figures = await loadDashboard({}, now);
    expect(figures.funnel[0].stopped).toEqual({ open: 1, rejected: 0, declined: 0, archived: 1 });
  });
});
