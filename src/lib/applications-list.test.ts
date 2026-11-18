import { describe, expect, it } from "vitest";

import {
  DEFAULT_SORT,
  listHref,
  listSummary,
  parseListParams,
  resolveListParams,
  sidebarStatuses,
  laneNotes,
  actionHref,
  rowAction,
  sortRows,
  statusesIn,
  statusesShown,
  statusSummary,
  type SummaryRow,
  updatedAgo,
  type Sortable,
} from "./applications-list";

const row = (id: string, extra: Partial<Sortable> = {}): Sortable & { id: string } => ({
  id,
  role: "Designer",
  company: "Acme",
  status: "SENT",
  match: null,
  location: "",
  sentAt: null,
  updatedAt: new Date(2026, 8, 1),
  ...extra,
});
const ids = (rows: { id: string }[]) => rows.map((entry) => entry.id);

describe("the list's URL (E9-1, E29-1)", () => {
  it("reads view, status, search, sort and archived, and the old names for the list and Closed", () => {
    expect(parseListParams({ view: "table", filter: "closed", q: "  ledgerly ", sort: "-match", archived: "1" })).toEqual({
      view: "list",
      status: "closed",
      q: "ledgerly",
      sort: { key: "match", reversed: true },
      archived: true,
    });
    expect(parseListParams({ status: "sent", view: "list" })).toEqual({ status: "SENT", view: "list", q: "" });
    expect(parseListParams({ status: "Closed" })).toEqual({ status: "closed", q: "" });
    // In progress was a filter; it's All now.
    expect(parseListParams({ filter: "active" })).toEqual({ q: "" });
  });

  it("ignores what it doesn't know", () => {
    expect(parseListParams({ view: "grid", status: "nope", sort: "salary" })).toEqual({ q: "" });
  });

  it("leaves defaults out of links, and gives a status its view", () => {
    expect(listHref({ view: "board", status: null, q: "", sort: DEFAULT_SORT, archived: false })).toBe("/applications");
    expect(listHref({ view: "list", status: null, q: "a b", sort: { key: "role", reversed: true }, archived: true })).toBe("/applications?view=list&q=a+b&sort=-role&archived=1");
    expect(listHref({ view: "list", status: "SENT", q: "", sort: DEFAULT_SORT, archived: false })).toBe("/applications?status=sent&view=list");
    expect(listHref({ view: "board", status: "closed", q: "", sort: DEFAULT_SORT, archived: false })).toBe("/applications?status=closed&view=board");
  });
});

describe("statuses (E27-4, E29-1)", () => {
  it("shows only that status, the three closed ones, or all", () => {
    expect(statusesShown({ status: "INTERVIEW" })).toEqual(["INTERVIEW"]);
    expect(statusesShown({ status: "closed" })).toEqual(["ACCEPTED", "REJECTED", "DECLINED"]);
    expect(statusesShown({ status: null })).toEqual(statusesIn("all"));
  });

  it("gives the sidebar and the tabs five statuses and Closed, with counts and links that leave the view to the status", () => {
    const rows = sidebarStatuses(new Map([["SENT", 2], ["REJECTED", 1], ["DECLINED", 1]] as const));
    expect(rows.map(({ label, count }) => `${label} ${count}`)).toEqual(["Draft 0", "Sent 2", "Screening 0", "Interview 0", "Offer 0", "Closed 2"]);
    expect(rows[1].href).toBe("/applications?status=sent");
    expect(rows[5].href).toBe("/applications?status=closed");
  });

  it("splits the statuses into in progress and closed", () => {
    expect(statusesIn("active")).toEqual(["DRAFT", "SENT", "SCREENING", "INTERVIEW", "OFFER"]);
    expect(statusesIn("closed")).toEqual(["ACCEPTED", "REJECTED", "DECLINED"]);
    expect(statusesIn("all")).toHaveLength(8);
  });
});

describe("statusSummary (E29-1)", () => {
  const summaryRow = (status: SummaryRow["status"], extra: Partial<SummaryRow> = {}): SummaryRow => ({
    status,
    company: "Acme",
    role: "Designer",
    quietDays: null,
    waiting: 0,
    nextInterview: null,
    flag: null,
    ...extra,
  });

  it("says what stands out in each status", () => {
    expect(statusSummary("SENT", [summaryRow("SENT", { company: "Meridian Bank", quietDays: 14, flag: { kind: "quiet", soon: true, due: null } }), summaryRow("SENT"), summaryRow("DRAFT")])).toBe(
      "2 waiting to hear back. Meridian Bank has been quiet for 14 days.",
    );
    expect(statusSummary("DRAFT", [summaryRow("DRAFT", { flag: { kind: "apply-by", soon: true, due: null } }), summaryRow("DRAFT")])).toBe("2 drafts. 1 due this week.");
    expect(statusSummary("SCREENING", [summaryRow("SCREENING", { waiting: 2 })])).toBe("1 in screening. 2 replies are waiting for you.");
    expect(
      statusSummary("INTERVIEW", [
        summaryRow("INTERVIEW", { company: "Later", nextInterview: "Fri 20 Nov, 10:00", flag: { kind: "interview", soon: true, due: new Date("2026-11-20T09:00:00Z") } }),
        summaryRow("INTERVIEW", { company: "Northstar", nextInterview: "Thu 19 Nov, 14:00", flag: { kind: "interview", soon: true, due: new Date("2026-11-19T13:00:00Z") } }),
      ]),
    ).toBe("2 interviewing. Next: Northstar, Thu 19 Nov, 14:00.");
    expect(statusSummary("OFFER", [summaryRow("OFFER")])).toBe("1 offer to decide on.");
    expect(statusSummary("closed", [summaryRow("REJECTED"), summaryRow("DECLINED"), summaryRow("SENT")])).toBe("2 closed: 0 accepted, 1 rejected, 1 declined.");
    expect(statusSummary("OFFER", [])).toBe("Nothing in Offer right now.");
  });
});

describe("sortRows (E9-3)", () => {
  it("sorts the latest update first by default", () => {
    const rows = [row("old", { updatedAt: new Date(2026, 7, 1) }), row("new", { updatedAt: new Date(2026, 8, 20) })];
    expect(ids(sortRows(rows, DEFAULT_SORT))).toEqual(["new", "old"]);
    expect(ids(sortRows(rows, { key: "updated", reversed: true }))).toEqual(["old", "new"]);
  });

  it("puts statuses in pipeline order and the best match first", () => {
    const rows = [row("offer", { status: "OFFER", match: { hit: 3, total: 7 } }), row("draft", { status: "DRAFT", match: { hit: 6, total: 7 } }), row("none")];
    expect(ids(sortRows(rows, { key: "status", reversed: false }))).toEqual(["draft", "none", "offer"]);
    expect(ids(sortRows(rows, { key: "match", reversed: false }))).toEqual(["draft", "offer", "none"]);
  });

  it("keeps never-sent applications last under Sent, both ways", () => {
    const rows = [row("draft"), row("aug", { sentAt: new Date(2026, 7, 10) }), row("sep", { sentAt: new Date(2026, 8, 10) })];
    expect(ids(sortRows(rows, { key: "sent", reversed: false }))).toEqual(["sep", "aug", "draft"]);
    expect(ids(sortRows(rows, { key: "sent", reversed: true }))).toEqual(["aug", "sep", "draft"]);
  });

  it("sorts roles and locations alphabetically, ignoring case", () => {
    const rows = [row("b", { role: "product designer", location: "Utrecht" }), row("a", { role: "Lead", location: "amsterdam" })];
    expect(ids(sortRows(rows, { key: "role", reversed: false }))).toEqual(["a", "b"]);
    expect(ids(sortRows(rows, { key: "location", reversed: false }))).toEqual(["a", "b"]);
  });
});

describe("listSummary (LST-1)", () => {
  it("counts who's waiting and who's talking", () => {
    expect(listSummary(["DRAFT", "SENT", "SCREENING", "INTERVIEW", "OFFER", "REJECTED"])).toBe(
      "6 applications: 2 waiting to hear back, 2 in conversation. Nice momentum.",
    );
    expect(listSummary(["SENT"])).toBe("1 application: 1 waiting to hear back, 0 in conversation.");
  });

  it("has its own words for none", () => {
    expect(listSummary([])).toMatch(/^No applications yet\./);
  });
});

describe("updatedAgo", () => {
  const now = new Date(2026, 8, 28, 9);
  it("says how long ago in days, then weeks", () => {
    expect(updatedAgo(new Date(2026, 8, 28, 1), now)).toBe("Today");
    expect(updatedAgo(new Date(2026, 8, 27, 23), now)).toBe("Yesterday");
    expect(updatedAgo(new Date(2026, 8, 21), now)).toBe("7 days ago");
    expect(updatedAgo(new Date(2026, 8, 7), now)).toBe("3 weeks ago");
  });
});

describe("resolveListParams (E9-4, LST-7, E29-1)", () => {
  const remembered = { applicationsView: "list", applicationsSort: "-match", applicationsBoardStatuses: ["interview"] };

  it("brings back the view and sort last used", () => {
    expect(resolveListParams({}, remembered)).toEqual({ view: "list", status: null, sort: { key: "match", reversed: true }, q: "", archived: false });
  });

  it("opens a status as a list, unless Board was chosen there (LB1)", () => {
    expect(resolveListParams({ status: "sent" }, { ...remembered, applicationsView: "board" }).view).toBe("list");
    expect(resolveListParams({ status: "interview" }, remembered).view).toBe("board");
    expect(resolveListParams({ status: "interview", view: "list" }, remembered).view).toBe("list");
  });

  it("lets the URL win", () => {
    expect(resolveListParams({ view: "board", q: "ledg" }, remembered)).toMatchObject({ view: "board", q: "ledg" });
  });

  it("falls back to the defaults when nothing usable was remembered", () => {
    expect(resolveListParams({}, { applicationsView: "grid", applicationsSort: "salary", applicationsBoardStatuses: [] })).toEqual({
      view: "board",
      status: null,
      sort: DEFAULT_SORT,
      q: "",
      archived: false,
    });
  });
});

describe("rowAction (E29-2, E29-4)", () => {
  const base = { waiting: 0, docs: { resume: true, letter: true }, flag: null };
  it("names the next thing to do, shorter on a card, with a waiting reply first", () => {
    expect(rowAction({ ...base, status: "DRAFT" }, "card")).toEqual({ label: "Send", tab: "email" });
    expect(rowAction({ ...base, status: "DRAFT", docs: { resume: false, letter: false } }, "list")).toEqual({ label: "Finish draft", tab: "resume" });
    expect(rowAction({ ...base, status: "SENT" }, "card")).toBeNull();
    expect(rowAction({ ...base, status: "SENT", flag: { kind: "quiet" } }, "card")).toEqual({ label: "Follow up", tab: "email", start: "follow-up" });
    expect(rowAction({ ...base, status: "SCREENING", waiting: 1 }, "card")).toEqual({ label: "Answer", tab: "conversation" });
    expect(rowAction({ ...base, status: "INTERVIEW" }, "card")).toEqual({ label: "Prepare", tab: "resume", start: "prepare" });
    expect(rowAction({ ...base, status: "OFFER" }, "list")).toEqual({ label: "Review offer", tab: "resume" });
    expect(rowAction({ ...base, status: "REJECTED", waiting: 1 }, "card")).toBeNull();
    // The application's header says it in full (E30-2).
    expect(rowAction({ ...base, status: "DRAFT" }, "header")).toEqual({ label: "Review and send", tab: "email" });
    expect(rowAction({ ...base, status: "SCREENING", waiting: 2 }, "header")).toEqual({ label: "Answer reply", tab: "conversation" });
  });
});

describe("laneNotes (E29-3)", () => {
  const lane = (status: SummaryRow["status"], furthestStage: "SENT" | "SCREENING" | "INTERVIEW" | "OFFER" | null, extra: Partial<SummaryRow> = {}) => ({
    status,
    furthestStage,
    company: "Acme",
    role: "Designer",
    quietDays: null,
    waiting: 0,
    nextInterview: null,
    flag: null,
    ...extra,
  });

  it("says how far each stage's applications went on, and what needs doing in it", () => {
    const notes = laneNotes([
      lane("DRAFT", null, { flag: { kind: "apply-by", soon: true, due: null } }),
      lane("SENT", "SENT", { flag: { kind: "quiet", soon: true, due: null } }),
      lane("SENT", "SENT"),
      lane("SCREENING", "SCREENING", { waiting: 1 }),
      lane("REJECTED", "SCREENING"),
      lane("INTERVIEW", "INTERVIEW", { nextInterview: "Thu 19 Nov, 14:00", flag: { kind: "interview", soon: true, due: new Date("2026-11-19T13:00:00Z") } }),
      lane("OFFER", "OFFER"),
    ]);
    expect(notes).toEqual({
      DRAFT: "1 due this week",
      SENT: "1 quiet for a while",
      // 4 of 6 sent heard back; 2 of 4 reached interview; 1 of 2 an offer.
      SCREENING: "67% heard back · 1 reply waiting",
      INTERVIEW: "50% of screening · Next: Thu 19 Nov, 14:00",
      OFFER: "50% of interview",
    });
  });
});

describe("actionHref (E30-6)", () => {
  it("opens the tab, and says what the click starts", () => {
    expect(actionHref("a1", { label: "Prepare", tab: "resume", start: "prepare" })).toBe("/applications/a1?start=prepare");
    expect(actionHref("a1", { label: "Answer", tab: "conversation" })).toBe("/applications/a1?tab=conversation");
    expect(actionHref("a1", { label: "Finish draft", tab: "resume" })).toBe("/applications/a1");
  });
});
