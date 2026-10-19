import { describe, expect, it } from "vitest";

import { dayOf, isDay, itemsOnDay, placeDay, rangeTitle, shiftAnchor, startOfDay, visibleDays, type CalendarItem, type TimedItem } from "./calendar-view";

const zone = "Europe/Berlin";
const timed = (id: string, start: string, end: string): TimedItem => ({ id, title: id, kind: "event", href: null, external: false, allDay: false, start: new Date(start), end: new Date(end) });

describe("the calendar's days (E15-6)", () => {
  it("shows a week from Monday, and six whole weeks for a month", () => {
    expect(visibleDays("week", "2026-10-22")).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    const month = visibleDays("month", "2026-10-22");
    expect(month).toHaveLength(42);
    expect([month[0], month[41]]).toEqual(["2026-09-28", "2026-11-08"]);
  });

  it("steps by a week or a month, and titles each", () => {
    expect(shiftAnchor("week", "2026-10-22", 1)).toBe("2026-10-26");
    expect(shiftAnchor("week", "2026-10-22", -1)).toBe("2026-10-12");
    expect(shiftAnchor("month", "2026-01-31", -1)).toBe("2025-12-01");
    expect(rangeTitle("week", "2026-10-22")).toBe("19–25 Oct 2026");
    expect(rangeTitle("week", "2026-10-01")).toBe("28 Sept – 4 Oct 2026");
    expect(rangeTitle("week", "2026-12-30")).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(rangeTitle("month", "2026-10-22")).toBe("October 2026");
  });

  it("reads days in the user's time zone", () => {
    expect(dayOf(new Date("2026-10-18T23:30:00Z"), zone)).toBe("2026-10-19");
    expect(startOfDay("2026-10-25", zone).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(startOfDay("2026-10-26", zone).toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect([isDay("2026-10-19"), isDay("2026-13-40"), isDay("today"), isDay(undefined)]).toEqual([true, false, false, false]);
  });
});

describe("placing events", () => {
  it("puts overlapping events side by side, and the rest full width", () => {
    const placed = placeDay(
      [
        timed("a", "2026-10-19T07:00:00Z", "2026-10-19T08:00:00Z"),
        timed("b", "2026-10-19T07:30:00Z", "2026-10-19T09:00:00Z"),
        timed("c", "2026-10-19T08:15:00Z", "2026-10-19T08:45:00Z"),
        timed("d", "2026-10-19T12:00:00Z", "2026-10-19T12:30:00Z"),
      ],
      "2026-10-19",
      zone,
    );
    expect(placed.map(({ item, top, height, column, columns }) => [item.id, top, height, column, columns])).toEqual([
      ["a", 540, 60, 0, 2],
      ["b", 570, 90, 1, 2],
      ["c", 615, 30, 0, 2],
      ["d", 840, 30, 0, 1],
    ]);
  });

  it("shows an event over midnight on both days", () => {
    const late = timed("late", "2026-10-19T21:00:00Z", "2026-10-20T00:30:00Z");
    expect(placeDay([late], "2026-10-19", zone)).toMatchObject([{ top: 1380, height: 60, startsBefore: false, endsAfter: true }]);
    expect(placeDay([late], "2026-10-20", zone)).toMatchObject([{ top: 0, height: 150, startsBefore: true, endsAfter: false }]);
    expect(placeDay([late], "2026-10-21", zone)).toEqual([]);
  });

  it("lists a day's items for the month, all-day ones first", () => {
    const items: CalendarItem[] = [
      timed("late", "2026-10-19T15:00:00Z", "2026-10-19T16:00:00Z"),
      timed("early", "2026-10-19T07:00:00Z", "2026-10-19T08:00:00Z"),
      { id: "trip", title: "Trip", kind: "event", href: null, external: false, allDay: true, startDay: "2026-10-18", endDay: "2026-10-20" },
    ];
    expect(itemsOnDay(items, "2026-10-19", zone).map((item) => item.id)).toEqual(["trip", "early", "late"]);
    expect(itemsOnDay(items, "2026-10-20", zone)).toEqual([]);
  });
});
