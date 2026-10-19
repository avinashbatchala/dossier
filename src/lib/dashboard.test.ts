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

  it("counts archived applications, but doesn't list them as worth a look", () => {
    const figures = dashboardFigures([app("offer", { status: "OFFER", furthestStage: "OFFER", archived: true })], now);
    expect(figures.byStatus.OFFER).toBe(1);
    expect(figures.funnel[3].count).toBe(1);
    expect(figures.attention).toEqual([]);
  });

  it("orders what's worth a look: offers, drafts by deadline, quiet ones, interviews", () => {
    const figures = dashboardFigures(
      [
        app("interview", { status: "INTERVIEW", furthestStage: "INTERVIEW" }),
        app("quiet-9", { lastStatusChange: daysAgo(9) }),
        app("quiet-14", { status: "SCREENING", furthestStage: "SCREENING", lastStatusChange: daysAgo(14) }),
        app("recent", { lastStatusChange: daysAgo(3) }),
        app("no-deadline", { status: "DRAFT", furthestStage: null }),
        app("late", { status: "DRAFT", furthestStage: null, deadline: new Date("2026-10-15T00:00:00Z") }),
        app("soon", { status: "DRAFT", furthestStage: null, deadline: new Date("2026-10-03T00:00:00Z") }),
        app("past", { status: "DRAFT", furthestStage: null, deadline: new Date("2026-09-20T00:00:00Z") }),
        app("offer", { status: "OFFER", furthestStage: "OFFER" }),
      ],
      now,
    );
    expect(figures.attention.map(({ id, reason, action }) => [id, reason, action])).toEqual([
      ["offer", "An offer is waiting on your decision.", "Review"],
      ["past", "Still a draft, and the deadline was 20 Sep.", "Finish"],
      ["soon", "Still a draft, and applications close 3 Oct.", "Finish"],
      ["late", "Still a draft, and applications close 15 Oct.", "Finish"],
      ["no-deadline", "Still a draft. Ready when you are.", "Finish"],
      ["quiet-14", "No news for 14 days. A short, friendly follow-up could help.", "Open"],
      ["quiet-9", "No news for 9 days. A short, friendly follow-up could help.", "Open"],
      ["interview", "You're interviewing. Add the next interview's date and it shows up here.", "Open"],
    ]);
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

  it("keeps what's worth a look about now, whatever the period", () => {
    const quiet = [app("quiet", { createdAt: daysAgo(100), lastStatusChange: daysAgo(20), sentAt: daysAgo(20) })];
    expect(dashboardFigures(quiet, now, { period: "30d" }).attention.map((item) => item.id)).toEqual(["quiet"]);
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
    expect(dashboardFigures(applications, now).attention.map((item) => item.id)).toEqual(["eight"]);
  });

  it("follows the setting", () => {
    expect(dashboardFigures(applications, now, { quietDays: 3 }).attention.map((item) => item.id)).toEqual(["eight", "four"]);
    expect(dashboardFigures(applications, now, { quietDays: 10 }).attention).toEqual([]);
  });
});

describe("interviews in Worth a look (E9-9)", () => {
  // Monday 28 September, 10:00 in Amsterdam.
  const monday = new Date("2026-09-28T08:00:00Z");
  const interview = (id: string, at: string | null) =>
    app(id, { status: "INTERVIEW", furthestStage: "INTERVIEW", nextInterviewAt: at ? new Date(at) : null });

  it("lists interviews by date, flags today and tomorrow, and puts those first", () => {
    const figures = dashboardFigures(
      [
        interview("undated", null),
        interview("next-week", "2026-10-05T12:00:00Z"),
        interview("tomorrow", "2026-09-29T07:30:00Z"),
        interview("past", "2026-09-25T12:00:00Z"),
        interview("earlier", "2026-09-28T06:00:00Z"),
        interview("today", "2026-09-28T13:00:00Z"),
        app("offer", { status: "OFFER", furthestStage: "OFFER" }),
      ],
      monday,
      { timeZone: "Europe/Amsterdam" },
    );
    expect(figures.attention.map(({ id, reason, soon }) => [id, reason, Boolean(soon)])).toEqual([
      ["today", "Interview today at 15:00. Worth re-reading your tailored letter first.", true],
      ["tomorrow", "Interview tomorrow at 09:30. Worth re-reading your tailored letter first.", true],
      ["offer", "An offer is waiting on your decision.", false],
      ["next-week", "Interview on Mon 5 Oct, 14:00. Worth re-reading your tailored letter first.", false],
      ["earlier", "Your interview was earlier today. How did it go? Move it on, or add the next round's date.", false],
      ["past", "Your interview was on Fri 25 Sep. How did it go? Move it on, or add the next round's date.", false],
      ["undated", "You're interviewing. Add the next interview's date and it shows up here.", false],
    ]);
  });

  it("says today or tomorrow in the user's time zone", () => {
    // 23:30 in Amsterdam, 17:30 in New York; the interview is at 01:30 or 19:30.
    const evening = new Date("2026-09-28T21:30:00Z");
    const applications = [interview("late", "2026-09-28T23:30:00Z")];
    expect(dashboardFigures(applications, evening, { timeZone: "Europe/Amsterdam" }).attention[0].reason).toMatch(/^Interview tomorrow at 01:30\./);
    expect(dashboardFigures(applications, evening, { timeZone: "America/New_York" }).attention[0].reason).toMatch(/^Interview today at 19:30\./);
  });

  it("ignores the date once the application has moved on", () => {
    const moved = app("offer", { status: "OFFER", furthestStage: "OFFER", nextInterviewAt: new Date("2026-09-29T07:30:00Z") });
    expect(dashboardFigures([moved], monday).attention).toEqual([
      expect.objectContaining({ id: "offer", reason: "An offer is waiting on your decision." }),
    ]);
  });
});

describe("replies in Worth a look (E15-3)", () => {
  it("puts replies waiting for an answer first, in place of the application's other item", () => {
    const replies = new Map([
      ["quiet", { count: 1, summary: "Invites you to a call." }],
      ["offer", { count: 2, summary: "Asks about your start date." }],
    ]);
    const { attention } = dashboardFigures(
      [app("quiet", { lastStatusChange: daysAgo(10), sentAt: daysAgo(10) }), app("offer", { status: "OFFER", furthestStage: "OFFER" }), app("other", { status: "OFFER", furthestStage: "OFFER" })],
      now,
      { replies },
    );
    expect(attention.map((item) => [item.id, item.action, item.tab ?? null, item.reason])).toEqual([
      ["quiet", "Answer", "conversation", "A reply is waiting: Invites you to a call."],
      ["offer", "Answer", "conversation", "2 replies are waiting. Asks about your start date."],
      ["other", "Review", null, "An offer is waiting on your decision."],
    ]);
  });
});
