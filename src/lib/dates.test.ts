import { describe, expect, it } from "vitest";

import { daysBetween, formatCalendarDate, formatDate, formatDateTime, formatShortCalendarDate, formatShortDate, formatTime, isoInZone } from "./dates";

describe("dates", () => {
  it("shows a calendar date as stored, whatever the time zone", () => {
    expect(formatCalendarDate(new Date("2026-10-15T00:00:00Z"))).toBe("15 Oct 2026");
  });

  it("shows a moment as day, short month and year", () => {
    expect(formatDate(new Date(2026, 8, 27, 14, 30))).toBe("27 Sep 2026");
  });

  it("leaves the year out within the same year", () => {
    const now = new Date(2026, 9, 5);
    expect(formatShortDate(new Date(2026, 9, 3, 9), now)).toBe("3 Oct");
    expect(formatShortDate(new Date(2025, 11, 30, 9), now)).toBe("30 Dec 2025");
  });

  it("shortens a calendar date within the year", () => {
    const now = new Date(2026, 9, 5);
    expect(formatShortCalendarDate(new Date("2026-10-15T00:00:00Z"), now)).toBe("15 Oct");
    expect(formatShortCalendarDate(new Date("2027-01-15T00:00:00Z"), now)).toBe("15 Jan 2027");
  });

  it("shows a moment's weekday, date and time in the user's time zone (E9-9)", () => {
    const at = new Date("2026-10-08T12:00:00Z");
    const now = new Date("2026-09-29T09:00:00Z");
    expect(formatDateTime(at, "Europe/Amsterdam", now)).toBe("Thu 8 Oct, 14:00");
    expect(formatDateTime(at, "America/New_York", now)).toBe("Thu 8 Oct, 08:00");
    expect(formatDateTime(at, "UTC", new Date("2025-12-01T09:00:00Z"))).toBe("Thu 8 Oct 2026, 12:00");
    expect(formatTime(new Date("2026-10-08T21:05:00Z"), "UTC")).toBe("21:05");
  });

  it("counts calendar days in the user's time zone", () => {
    const now = new Date("2026-09-29T21:30:00Z");
    const later = new Date("2026-09-29T23:00:00Z");
    // 23:30 → 01:00 in Amsterdam is the next day; 17:30 → 19:00 in New York is the same one.
    expect(daysBetween(now, later, "Europe/Amsterdam")).toBe(1);
    expect(daysBetween(now, later, "America/New_York")).toBe(0);
    expect(daysBetween(now, new Date("2026-09-28T12:00:00Z"), "UTC")).toBe(-1);
  });
});

describe("isoInZone", () => {
  it("writes a moment as the zone's wall clock with its offset, DST included", () => {
    expect(isoInZone(new Date("2026-10-18T11:00:00Z"), "Europe/Berlin")).toBe("2026-10-18T13:00:00+02:00");
    expect(isoInZone(new Date("2026-11-02T11:00:00Z"), "Europe/Berlin")).toBe("2026-11-02T12:00:00+01:00");
    expect(isoInZone(new Date("2026-10-18T11:00:00Z"), "America/New_York")).toBe("2026-10-18T07:00:00-04:00");
    expect(isoInZone(new Date("2026-10-18T11:00:00Z"), "UTC")).toBe("2026-10-18T11:00:00+00:00");
  });
});
