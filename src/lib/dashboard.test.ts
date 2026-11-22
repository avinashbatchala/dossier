import { describe, expect, it } from "vitest";

import { dashboardFigures, periodFromParam, type DashboardApplication } from "./dashboard";

const now = new Date(2026, 8, 28, 12);
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const app = (id: string, extra: Partial<DashboardApplication> = {}): DashboardApplication => ({
  id,
  company: id,
  role: "Designer",
  status: "SENT",
  furthestStage: "SENT",
  archived: false,
  deadline: null,
  lastStatusChange: daysAgo(2),
  sentAt: daysAgo(2),
  nextInterviewAt: null,
  createdAt: daysAgo(3),
  updatedAt: daysAgo(2),
  ...extra,
});

describe("dashboardFigures (E9-6)", () => {
  it("counts the funnel by the furthest stage reached, closed ones included", () => {
    const figures = dashboardFigures(
      [
        app("draft", { status: "DRAFT", furthestStage: null, sentAt: null }),
        app("sent"),
        app("rejected", { status: "REJECTED", furthestStage: "SCREENING" }),
        app("declined", { status: "DECLINED", furthestStage: "OFFER" }),
      ],
      now,
    );
    const none = { open: 0, rejected: 0, declined: 0, archived: 0 };
    expect(figures.funnel).toEqual([
      { stage: "SENT", count: 3, conversion: null, stopped: { ...none, open: 1 } },
      { stage: "SCREENING", count: 2, conversion: 67, stopped: { ...none, rejected: 1 } },
      { stage: "INTERVIEW", count: 1, conversion: 50, stopped: none },
      { stage: "OFFER", count: 1, conversion: 100, stopped: { ...none, declined: 1 } },
      { stage: "ACCEPTED", count: 0, conversion: 0, stopped: none },
    ]);
    expect(figures).toMatchObject({ sent: 3, heardBack: 2, heardBackPercent: 67, reachedInterview: 1 });
    expect(figures.byStatus).toEqual({ DRAFT: 1, SENT: 1, SCREENING: 0, INTERVIEW: 0, OFFER: 0, ACCEPTED: 0, REJECTED: 1, DECLINED: 1 });
  });

  it("says where the ones that went no further are now, archived open ones apart (decided 16 October 2026)", () => {
    const figures = dashboardFigures(
      [
        app("waiting"),
        app("let-go", { archived: true }),
        app("rejected-archived", { status: "REJECTED", archived: true }),
        app("withdrawn", { status: "DECLINED" }),
        app("back-to-draft", { status: "DRAFT" }),
        app("moved-back", { status: "SCREENING", furthestStage: "INTERVIEW" }),
        app("offer-archived", { status: "OFFER", furthestStage: "OFFER", archived: true }),
      ],
      now,
    );
    const stopped = Object.fromEntries(figures.funnel.map((step) => [step.stage, step.stopped]));
    expect(stopped.SENT).toEqual({ open: 2, rejected: 1, declined: 1, archived: 1 });
    expect(stopped.SCREENING).toEqual({ open: 0, rejected: 0, declined: 0, archived: 0 });
    expect(stopped.INTERVIEW).toEqual({ open: 1, rejected: 0, declined: 0, archived: 0 });
    expect(stopped.OFFER).toEqual({ open: 0, rejected: 0, declined: 0, archived: 1 });
  });

  it("ends at Accepted, whatever happened after", () => {
    const figures = dashboardFigures([app("accepted", { status: "ACCEPTED", furthestStage: "ACCEPTED" }), app("rescinded", { status: "REJECTED", furthestStage: "ACCEPTED" })], now);
    expect(figures.funnel.at(-1)).toEqual({ stage: "ACCEPTED", count: 2, conversion: 100, stopped: { open: 0, rejected: 0, declined: 0, archived: 0 } });
    // Each stage before it lost none.
    expect(figures.funnel.map((step) => step.count)).toEqual([2, 2, 2, 2, 2]);
  });

  it("has no percentages before anything was sent", () => {
    const figures = dashboardFigures([app("draft", { status: "DRAFT", furthestStage: null })], now);
    expect(figures).toMatchObject({ sent: 0, heardBackPercent: null });
    expect(figures.funnel.map((step) => step.conversion)).toEqual([null, null, null, null, null]);
  });

  it("counts archived applications, but they never need you", () => {
    const figures = dashboardFigures([app("offer", { status: "OFFER", furthestStage: "OFFER", archived: true })], now);
    expect(figures.byStatus.OFFER).toBe(1);
    expect(figures.funnel[3].count).toBe(1);
    expect(figures.needsYou).toEqual([]);
  });
});

describe("the period (E9-8)", () => {
  const applications = [
    app("new", { createdAt: daysAgo(5), sentAt: daysAgo(4), furthestStage: "SCREENING", status: "SCREENING" }),
    app("month", { createdAt: daysAgo(40), sentAt: daysAgo(38) }),
    app("old", { createdAt: daysAgo(200), sentAt: null, furthestStage: null, status: "DRAFT" }),
  ];

  it("counts the funnel and the breakdown for applications created in it, and keeps the total", () => {
    const month = dashboardFigures(applications, now, { period: "30d" });
    expect(month.total).toBe(3);
    expect(month.sent).toBe(1);
    expect(month.heardBack).toBe(1);
    expect(Object.values(month.byStatus).reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(dashboardFigures(applications, now, { period: "90d" }).sent).toBe(2);
    expect(dashboardFigures(applications, now).byStatus.DRAFT).toBe(1);
  });

  it("keeps Needs you about now, whatever the period", () => {
    const quiet = [app("quiet", { createdAt: daysAgo(100), lastStatusChange: daysAgo(20), sentAt: daysAgo(20) })];
    expect(dashboardFigures(quiet, now, { period: "30d" }).needsYou.map((item) => item.id)).toEqual(["quiet"]);
  });

  it("reads the period from the address", () => {
    expect(periodFromParam("90d")).toBe("90d");
    expect(periodFromParam("7d")).toBeNull();
    expect(periodFromParam(undefined)).toBeNull();
  });
});

describe("weekly activity (E9-8)", () => {
  it("counts applications started and sent per week, Monday to Sunday, over the period", () => {
    // Monday 28 September 2026, noon.
    const weeks = dashboardFigures(
      [
        app("a", { createdAt: new Date(2026, 8, 28, 9), sentAt: null }),
        app("b", { createdAt: new Date(2026, 8, 22), sentAt: new Date(2026, 8, 27, 23) }),
        app("c", { createdAt: new Date(2026, 8, 21, 0, 0), sentAt: new Date(2026, 8, 28, 10) }),
        // Started before the period: not counted, even though it was sent in it.
        app("d", { createdAt: new Date(2026, 7, 1), sentAt: new Date(2026, 8, 23) }),
      ],
      now,
      { period: "30d" },
    ).weeks;
    expect(weeks.map((week) => week.start.toDateString())).toEqual([
      "Mon Aug 24 2026",
      "Mon Aug 31 2026",
      "Mon Sep 07 2026",
      "Mon Sep 14 2026",
      "Mon Sep 21 2026",
      "Mon Sep 28 2026",
    ]);
    expect(weeks.at(-2)).toMatchObject({ created: 2, sent: 1 });
    expect(weeks.at(-1)).toMatchObject({ created: 1, sent: 1 });
  });

  it("starts at the first application for all time, and shows at most a year", () => {
    expect(dashboardFigures([], now).weeks).toEqual([]);
    const weeks = dashboardFigures([app("x", { createdAt: new Date(2024, 0, 3) })], now).weeks;
    expect(weeks).toHaveLength(52);
    expect(weeks.at(-1)!.start.toDateString()).toBe("Mon Sep 28 2026");
  });
});

describe("the follow-up threshold (E9-9)", () => {
  const applications = [app("four", { lastStatusChange: daysAgo(4) }), app("eight", { lastStatusChange: daysAgo(8) })];

  it("nudges after 7 days by default", () => {
    expect(dashboardFigures(applications, now).needsYou.map((item) => item.id)).toEqual(["eight"]);
  });

  it("follows the setting", () => {
    expect(dashboardFigures(applications, now, { quietDays: 3 }).needsYou.map((item) => item.id)).toEqual(["eight", "four"]);
    expect(dashboardFigures(applications, now, { quietDays: 10 }).needsYou).toEqual([]);
  });
});

describe("Needs you (E28-4)", () => {
  // Monday 28 September, 10:00 in Amsterdam.
  const monday = new Date("2026-09-28T08:00:00Z");
  const options = { timeZone: "Europe/Amsterdam" };
  const interview = (id: string, at: string | null) =>
    app(id, { status: "INTERVIEW", furthestStage: "INTERVIEW", nextInterviewAt: at ? new Date(at) : null, updatedAt: new Date(monday.getTime() - 60_000) });
  const draft = (id: string, deadline: string | null) => app(id, { status: "DRAFT", furthestStage: null, deadline: deadline ? new Date(deadline) : null });
  const rows = (items: ReturnType<typeof dashboardFigures>["needsYou"]) => items.map(({ id, reason, due, soon, action }) => [id, reason, due, soon, action]);

  it("puts what's due this week first, soonest first, then what has no date", () => {
    const figures = dashboardFigures(
      [
        interview("undated", null),
        interview("next-month", "2026-10-28T12:00:00Z"),
        interview("tomorrow", "2026-09-29T07:30:00Z"),
        interview("past", "2026-09-25T12:00:00Z"),
        interview("thursday", "2026-10-01T12:00:00Z"),
        draft("no-deadline", null),
        draft("far", "2026-10-20T00:00:00Z"),
        draft("friday", "2026-10-02T00:00:00Z"),
        draft("missed", "2026-09-26T00:00:00Z"),
        app("quiet", { lastStatusChange: new Date("2026-09-14T08:00:00Z"), sentAt: new Date("2026-09-14T08:00:00Z") }),
        app("offer", { status: "OFFER", furthestStage: "OFFER", updatedAt: monday }),
      ],
      monday,
      options,
    );
    expect(rows(figures.needsYou)).toEqual([
      ["quiet", "Sent Mon 14 Sep, no reply.", "quiet for 14 days", true, "Follow up"],
      ["past", "Your interview was on Fri 25 Sep. How did it go?", null, true, "Update"],
      ["missed", "Still a draft.", "apply by Sat 26 Sep · passed", true, "Finish draft"],
      ["tomorrow", "Interview.", "tomorrow, 09:30", true, "Prepare"],
      ["thursday", "Interview.", "Thu 1 Oct, 14:00", true, "Prepare"],
      ["friday", "Still a draft.", "apply by Fri 2 Oct · 4 days", true, "Finish draft"],
      // No date: offers, then interviews, then drafts.
      ["offer", "An offer is waiting on your decision.", null, false, "Review offer"],
      ["undated", "You're interviewing. Add the next interview's date.", null, false, "Add the date"],
      ["no-deadline", "Still a draft. Ready when you are.", null, false, "Finish draft"],
    ]);
  });

  it("says today or tomorrow in the user's time zone", () => {
    // 23:30 in Amsterdam, 17:30 in New York; the interview is at 01:30 or 19:30.
    const evening = new Date("2026-09-28T21:30:00Z");
    const applications = [interview("late", "2026-09-28T23:30:00Z")];
    expect(dashboardFigures(applications, evening, { timeZone: "Europe/Amsterdam" }).needsYou[0].due).toBe("tomorrow, 01:30");
    expect(dashboardFigures(applications, evening, { timeZone: "America/New_York" }).needsYou[0].due).toBe("today, 19:30");
  });

  it("ignores the interview date once the application has moved on", () => {
    const moved = app("offer", { status: "OFFER", furthestStage: "OFFER", nextInterviewAt: new Date("2026-09-29T07:30:00Z") });
    expect(rows(dashboardFigures([moved], monday).needsYou)).toEqual([["offer", "An offer is waiting on your decision.", null, false, "Review offer"]]);
  });

  it("puts replies waiting for an answer at the top, in place of the application's other item (E15-3)", () => {
    const replies = new Map([
      ["quiet", { count: 1, summary: "Invites you to a call." }],
      ["offer", { count: 2, summary: "Asks about your start date." }],
    ]);
    const { needsYou } = dashboardFigures(
      [app("quiet", { lastStatusChange: daysAgo(10), sentAt: daysAgo(10) }), app("offer", { status: "OFFER", furthestStage: "OFFER" }), app("other", { status: "OFFER", furthestStage: "OFFER" })],
      now,
      { replies },
    );
    expect(needsYou.map((item) => [item.id, item.action, item.tab ?? null, item.reason, item.soon])).toEqual([
      ["quiet", "Answer", "conversation", "A reply is waiting: Invites you to a call.", true],
      ["offer", "Answer", "conversation", "2 replies are waiting. Asks about your start date.", true],
      ["other", "Review offer", null, "An offer is waiting on your decision.", false],
    ]);
  });
});
