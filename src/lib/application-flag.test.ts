import { describe, expect, it } from "vitest";

import { ApplicationStatus } from "@/generated/prisma/enums";

import { applicationFlag, daysQuiet, quietSince, sentLine, type FlagApplication } from "./application-flag";

// Monday 16 November 2026, 10:00 in Berlin.
const now = new Date("2026-11-16T09:00:00Z");
const options = { now, quietDays: 10, timeZone: "Europe/Berlin" };
const base: FlagApplication = {
  status: ApplicationStatus.DRAFT,
  deadline: null,
  sentAt: null,
  lastStatusChange: null,
  updatedAt: now,
  nextInterviewAt: null,
};
const flag = (application: Partial<FlagApplication>) => applicationFlag({ ...base, ...application }, options);
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

describe("applicationFlag (E27-2)", () => {
  it("gives a draft its deadline, with the days left", () => {
    expect(flag({ deadline: new Date("2026-11-19T00:00:00Z") })).toEqual({
      kind: "apply-by",
      text: "Apply by Thu 19 Nov · 3 days",
      due: new Date("2026-11-19T00:00:00Z"),
      soon: true,
    });
    expect(flag({ deadline: new Date("2026-11-16T00:00:00Z") })?.text).toBe("Apply by Mon 16 Nov · today");
    expect(flag({ deadline: new Date("2026-11-12T00:00:00Z") })).toMatchObject({ text: "Apply by Thu 12 Nov · passed", soon: true });
    expect(flag({ deadline: new Date("2026-12-04T00:00:00Z") })).toMatchObject({ text: "Apply by Fri 4 Dec · 18 days", soon: false });
    expect(flag({})).toBeNull();
  });

  it("reads a deadline as the same calendar day in any time zone", () => {
    const deadline = new Date("2026-11-17T00:00:00Z");
    // 16 November, 20:00 in Los Angeles: the deadline is still tomorrow there.
    const evening = new Date("2026-11-17T04:00:00Z");
    expect(applicationFlag({ ...base, deadline }, { now: evening, quietDays: 10, timeZone: "America/Los_Angeles" })?.text).toBe("Apply by Tue 17 Nov · tomorrow");
  });

  it("says how long ago a sent application went out, then how long it's been quiet", () => {
    expect(flag({ status: ApplicationStatus.SENT, sentAt: daysAgo(2) })).toEqual({ kind: "sent", text: "Sent 2 days ago", due: null, soon: false });
    expect(flag({ status: ApplicationStatus.SENT, sentAt: now })?.text).toBe("Sent today");
    expect(flag({ status: ApplicationStatus.SENT, sentAt: daysAgo(14) })).toEqual({
      kind: "quiet",
      text: "Quiet for 14 days",
      due: daysAgo(4),
      soon: true,
    });
    // Screening says nothing until it's quiet.
    expect(flag({ status: ApplicationStatus.SCREENING, lastStatusChange: daysAgo(3) })).toBeNull();
    expect(flag({ status: ApplicationStatus.SCREENING, lastStatusChange: daysAgo(11) })?.text).toBe("Quiet for 11 days");
  });

  it("puts a waiting reply first", () => {
    expect(flag({ status: ApplicationStatus.SENT, sentAt: daysAgo(14), waitingReplies: 1 })).toEqual({ kind: "reply", text: "A reply is waiting", due: null, soon: true });
    expect(flag({ status: ApplicationStatus.INTERVIEW, waitingReplies: 2 })?.text).toBe("2 replies are waiting");
    expect(flag({ status: ApplicationStatus.REJECTED, waitingReplies: 1 })).toBeNull();
  });

  it("gives the next interview's time and round, and asks after one that's passed", () => {
    const at = new Date("2026-11-19T13:00:00Z");
    expect(flag({ status: ApplicationStatus.INTERVIEW, nextInterviewAt: at, round: 2 })).toEqual({
      kind: "interview",
      text: "Thu 19 Nov, 14:00 · round 2",
      due: at,
      soon: true,
    });
    expect(flag({ status: ApplicationStatus.INTERVIEW, nextInterviewAt: at })?.text).toBe("Thu 19 Nov, 14:00");
    expect(flag({ status: ApplicationStatus.INTERVIEW, nextInterviewAt: new Date("2026-11-16T15:00:00Z") })?.text).toBe("Today, 16:00");
    expect(flag({ status: ApplicationStatus.INTERVIEW, nextInterviewAt: new Date("2026-11-17T08:30:00Z"), round: 2 })?.text).toBe("Tomorrow, 09:30 · round 2");
    expect(flag({ status: ApplicationStatus.INTERVIEW, nextInterviewAt: new Date("2026-12-10T13:00:00Z") })?.soon).toBe(false);
    expect(flag({ status: ApplicationStatus.INTERVIEW, nextInterviewAt: daysAgo(2) })).toMatchObject({ text: "Interview was Sat 14 Nov", soon: true });
    expect(flag({ status: ApplicationStatus.INTERVIEW })).toBeNull();
  });

  it("gives an offer its decide-by date", () => {
    expect(flag({ status: ApplicationStatus.OFFER, decideBy: new Date("2026-11-20T00:00:00Z") })).toMatchObject({ text: "Decide by Fri 20 Nov", soon: true });
    expect(flag({ status: ApplicationStatus.OFFER })).toBeNull();
  });

  it("has nothing for a closed application", () => {
    for (const status of [ApplicationStatus.ACCEPTED, ApplicationStatus.REJECTED, ApplicationStatus.DECLINED]) {
      expect(flag({ status, deadline: new Date("2026-11-19T00:00:00Z"), sentAt: daysAgo(30) })).toBeNull();
    }
  });
});

describe("daysQuiet", () => {
  it("counts from the last status change, else from sending, else from the last edit", () => {
    expect(daysQuiet({ lastStatusChange: daysAgo(3), sentAt: daysAgo(9), updatedAt: now }, now)).toBe(3);
    expect(daysQuiet({ lastStatusChange: null, sentAt: daysAgo(9), updatedAt: now }, now)).toBe(9);
    expect(daysQuiet({ lastStatusChange: null, sentAt: null, updatedAt: daysAgo(1) }, now)).toBe(1);
  });
});

describe("mail restarts the quiet (E29-7)", () => {
  it("counts from the latest email, in or out, when that's after the last change", () => {
    const fields = { lastStatusChange: daysAgo(12), sentAt: daysAgo(12), updatedAt: daysAgo(12) };
    expect(daysQuiet({ ...fields, lastContactAt: daysAgo(3) }, now)).toBe(3);
    expect(quietSince({ ...fields, lastContactAt: daysAgo(20) })).toEqual(daysAgo(12));
    expect(flag({ status: ApplicationStatus.SENT, sentAt: daysAgo(12), lastStatusChange: daysAgo(12), lastContactAt: daysAgo(3) })?.kind).toBe("sent");
  });
});

describe("sentLine (E29-7)", () => {
  it("says when, in the user's time zone, and how when it's known", () => {
    const at = new Date("2026-11-02T23:30:00Z");
    expect(sentLine(at, "GMAIL", { now, timeZone: "Europe/Berlin" })).toBe("Sent 3 Nov by Gmail");
    expect(sentLine(at, "PORTAL", { now, timeZone: "America/New_York" })).toBe("Sent 2 Nov on their site");
    expect(sentLine(at, null, { now, timeZone: "Europe/Berlin" })).toBe("Sent 3 Nov");
  });
});
