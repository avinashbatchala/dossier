import { describe, expect, it } from "vitest";

import { agenda, dayOf, isDay, itemsOnDay, monthDays, monthTitle, shiftMonth, shortDayLabel, startOfDay, type CalendarItem, type TimedItem } from "./calendar-view";

const zone = "Europe/Berlin";
const timed = (id: string, start: string, end: string): TimedItem => ({ id, title: id, kind: "event", href: null, external: false, allDay: false, start: new Date(start), end: new Date(end) });

describe("the calendar's days (E15-6)", () => {
  it("shows the whole weeks a month touches, from Monday", () => {
    const october = monthDays("2026-10-22");
    expect(october).toHaveLength(35);
    expect([october[0], october.at(-1)]).toEqual(["2026-09-28", "2026-11-01"]);
    // February 2027 starts on a Monday and ends on a Sunday; August 2026 spans six weeks.
    expect(monthDays("2027-02-10")).toHaveLength(28);
    expect(monthDays("2026-08-01")).toHaveLength(42);
  });

  it("steps by a month, and titles it", () => {
    expect(shiftMonth("2026-01-31", -1)).toBe("2025-12-01");
    expect(shiftMonth("2026-12-15", 1)).toBe("2027-01-01");
    expect(monthTitle("2026-10-22")).toBe("October 2026");
    expect(shortDayLabel("2026-10-20")).toBe("Tue 20 Oct");
  });

  it("reads days in the user's time zone", () => {
    expect(dayOf(new Date("2026-10-18T23:30:00Z"), zone)).toBe("2026-10-19");
    expect(startOfDay("2026-10-25", zone).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(startOfDay("2026-10-26", zone).toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect([isDay("2026-10-19"), isDay("2026-13-40"), isDay("today"), isDay(undefined)]).toEqual([true, false, false, false]);
  });
});

describe("the agenda", () => {
  it("lists a day's items, all-day ones first", () => {
    const items: CalendarItem[] = [
      timed("late", "2026-10-19T15:00:00Z", "2026-10-19T16:00:00Z"),
      timed("early", "2026-10-19T07:00:00Z", "2026-10-19T08:00:00Z"),
      { id: "trip", title: "Trip", kind: "event", href: null, external: false, allDay: true, startDay: "2026-10-18", endDay: "2026-10-20" },
    ];
    expect(itemsOnDay(items, "2026-10-19", zone).map((item) => item.id)).toEqual(["trip", "early", "late"]);
    expect(itemsOnDay(items, "2026-10-20", zone)).toEqual([]);
  });

  it("lists seven days from the one picked, leaving out empty ones", () => {
    const items: CalendarItem[] = [
      timed("before", "2026-10-19T09:00:00Z", "2026-10-19T10:00:00Z"),
      // Over midnight in Berlin: on both days.
      timed("late", "2026-10-20T21:00:00Z", "2026-10-20T23:30:00Z"),
      timed("last", "2026-10-26T09:00:00Z", "2026-10-26T10:00:00Z"),
      timed("after", "2026-10-27T09:00:00Z", "2026-10-27T10:00:00Z"),
    ];
    expect(agenda(items, "2026-10-20", zone).map(({ day, items }) => [day, items.map((item) => item.id)])).toEqual([
      ["2026-10-20", ["late"]],
      ["2026-10-21", ["late"]],
      ["2026-10-26", ["last"]],
    ]);
    expect(agenda([], "2026-10-20", zone)).toEqual([]);
  });
});
