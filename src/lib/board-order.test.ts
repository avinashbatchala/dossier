import { describe, expect, it } from "vitest";

import type { ApplicationRow } from "./applications-data";
import { boardOrder, orderedColumn, withShownOrder } from "./board-order";
import { applicationRow } from "@/test/application-row";

const row = (id: string, extra: Partial<ApplicationRow> = {}): ApplicationRow => applicationRow(id, { company: "Acme", role: "Engineer", location: "", mode: "", match: null, sent: null, updated: "Today", updatedAt: 100, ...extra });
const ids = (rows: { id: string }[]) => rows.map((entry) => entry.id);

describe("board order (public issue 60)", () => {
  it("stays newest first when nothing was reordered", () => {
    expect(ids(orderedColumn([row("old", { updatedAt: 1 }), row("new", { updatedAt: 3 }), row("mid", { updatedAt: 2 })], "SENT"))).toEqual(["new", "mid", "old"]);
  });

  it("puts cards without a place on top, then the others by place, whatever their updates", () => {
    const mixed = [row("second", { updatedAt: 9, boardSort: 1 }), row("first", { updatedAt: 1, boardSort: 0 }), row("moved-in", { updatedAt: 5 })];
    expect(ids(orderedColumn(mixed, "SENT"))).toEqual(["moved-in", "first", "second"]);
  });

  it("keeps to the column asked for", () => {
    expect(ids(orderedColumn([row("sent"), row("draft", { status: "DRAFT" })], "DRAFT"))).toEqual(["draft"]);
  });

  it("compares the server's dates like the board's numbers", () => {
    expect(boardOrder({ boardSort: null, updatedAt: new Date(1) }, { boardSort: null, updatedAt: new Date(2) })).toBeGreaterThan(0);
  });
});

describe("withShownOrder", () => {
  const column = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

  it("orders the whole column when everything shows", () => {
    expect(ids(withShownOrder(column, ["d", "c", "b", "a"]))).toEqual(["d", "c", "b", "a"]);
  });

  it("leaves hidden cards in their places", () => {
    expect(ids(withShownOrder(column, ["c", "a"]))).toEqual(["c", "b", "a", "d"]);
  });

  it("ignores cards that left the column and repeated ones", () => {
    expect(ids(withShownOrder(column, ["gone", "b", "a", "b"]))).toEqual(["b", "a", "c", "d"]);
  });
});
