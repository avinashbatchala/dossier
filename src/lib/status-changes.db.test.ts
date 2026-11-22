import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestClient, resetDatabase } from "@/test/db";

import { applyStatusChange, undoStatusChange } from "./status-changes";

const db = createTestClient();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const t = (minute: number) => new Date(Date.UTC(2026, 8, 27, 12, minute));

async function fields(id: string) {
  return db.application.findUniqueOrThrow({
    where: { id },
    select: { status: true, furthestStage: true, sentAt: true },
  });
}

describe("applyStatusChange", () => {
  it("updates the application and records the event in one go", async () => {
    const { id } = await db.application.create({ data: { company: "Ledgerly" } });
    const result = await applyStatusChange(db, id, "SENT", t(0));

    expect(result).toMatchObject({
      outcome: "changed",
      event: { applicationId: id, from: "DRAFT", to: "SENT", at: t(0), previousFurthestStage: null, previousSentAt: null },
    });
    expect(await fields(id)).toEqual({ status: "SENT", furthestStage: "SENT", sentAt: t(0) });
  });

  it("records nothing when the status doesn't change", async () => {
    const { id } = await db.application.create({ data: {} });
    expect(await applyStatusChange(db, id, "DRAFT", t(0))).toEqual({ outcome: "unchanged" });
    expect(await db.statusEvent.count()).toBe(0);
  });

  it("reports a missing application", async () => {
    expect(await applyStatusChange(db, "missing", "SENT", t(0))).toEqual({ outcome: "not-found" });
  });

  it("applies concurrent changes one after the other", async () => {
    const { id } = await db.application.create({ data: {} });
    await Promise.all([
      applyStatusChange(db, id, "SENT", t(0)),
      applyStatusChange(db, id, "SCREENING", t(1)),
    ]);
    const events = await db.statusEvent.findMany({ orderBy: { at: "asc" } });
    // Whichever ran second saw the first one's result.
    expect(events).toHaveLength(2);
    expect(events[1].from).toBe(events[0].to);
    expect((await fields(id)).furthestStage).toBe("SCREENING");
  });
});

describe("a card's place on the board (public issue 60)", () => {
  const place = async (id: string) => (await db.application.findUniqueOrThrow({ where: { id } })).boardSort;

  it("gives it up on a status change, so the card goes on top of its new column", async () => {
    const { id } = await db.application.create({ data: { boardSort: 3 } });
    expect(await applyStatusChange(db, id, "SENT", t(0))).toMatchObject({ event: { previousBoardSort: 3 } });
    expect(await place(id)).toBeNull();
  });

  it("gets it back on Undo", async () => {
    const { id } = await db.application.create({ data: { boardSort: 3 } });
    const change = await applyStatusChange(db, id, "SENT", t(0));
    if (change.outcome !== "changed") throw new Error("expected a change");
    await undoStatusChange(db, change.event.id);
    expect(await place(id)).toBe(3);
  });
});

describe("undoStatusChange", () => {
  it("restores the previous status, stage and sent date, and deletes the event", async () => {
    const { id } = await db.application.create({ data: {} });
    await applyStatusChange(db, id, "SCREENING", t(0));
    const accidental = await applyStatusChange(db, id, "OFFER", t(1));
    if (accidental.outcome !== "changed") throw new Error("expected a change");

    expect(await undoStatusChange(db, accidental.event.id)).toEqual({ outcome: "undone", status: "SCREENING" });
    expect(await fields(id)).toEqual({ status: "SCREENING", furthestStage: "SCREENING", sentAt: t(0) });
    expect(await db.statusEvent.count()).toBe(1);
  });

  it("undoes a first move out of Draft completely", async () => {
    const { id } = await db.application.create({ data: {} });
    const sent = await applyStatusChange(db, id, "SENT", t(0));
    if (sent.outcome !== "changed") throw new Error("expected a change");

    await undoStatusChange(db, sent.event.id);
    expect(await fields(id)).toEqual({ status: "DRAFT", furthestStage: null, sentAt: null });
  });

  it("only undoes the latest change", async () => {
    const { id } = await db.application.create({ data: {} });
    const first = await applyStatusChange(db, id, "SENT", t(0));
    await applyStatusChange(db, id, "INTERVIEW", t(1));
    if (first.outcome !== "changed") throw new Error("expected a change");

    expect(await undoStatusChange(db, first.event.id)).toEqual({ outcome: "superseded" });
    expect((await fields(id)).status).toBe("INTERVIEW");
    expect(await undoStatusChange(db, "missing")).toEqual({ outcome: "not-found" });
  });
});

describe("how it was sent (E29-7)", () => {
  const via = async (id: string) => (await db.application.findUniqueOrThrow({ where: { id }, select: { sentVia: true } })).sentVia;

  it("keeps it on the first send only, and forgets it when that send is undone", async () => {
    const { id } = await db.application.create({ data: { company: "Ledgerly" } });
    const sent = await applyStatusChange(db, id, "SENT", t(0), { sentVia: "GMAIL" });
    expect(await via(id)).toBe("GMAIL");

    // Moving on later doesn't change how it went out.
    await applyStatusChange(db, id, "SCREENING", t(1), { sentVia: "EMAIL" });
    expect(await via(id)).toBe("GMAIL");

    await undoStatusChange(db, (await db.statusEvent.findFirstOrThrow({ where: { to: "SCREENING" } })).id);
    expect(await via(id)).toBe("GMAIL");
    if (sent.outcome !== "changed") throw new Error("not sent");
    await undoStatusChange(db, sent.event.id);
    expect(await via(id)).toBeNull();
  });

  it("stays unsaid when it isn't given", async () => {
    const { id } = await db.application.create({ data: {} });
    await applyStatusChange(db, id, "SENT", t(0));
    expect(await via(id)).toBeNull();
  });
});
