import { describe, expect, it } from "vitest";

import { formatSlot, freeSlots, zonedTime, type WorkingHours } from "./slots";

const hours: WorkingHours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00", timeZone: "Europe/Berlin", slotMinutes: 45, bufferMinutes: 15 };
// Sunday 18 October 2026, 12:00 in Berlin (CEST, UTC+2).
const now = new Date("2026-10-18T10:00:00Z");

describe("zonedTime", () => {
  it("turns a wall-clock time into an instant, across DST", () => {
    expect(zonedTime(2026, 10, 20, 9, 0, "Europe/Berlin").toISOString()).toBe("2026-10-20T07:00:00.000Z");
    // After the switch to winter time on 25 October.
    expect(zonedTime(2026, 10, 26, 9, 0, "Europe/Berlin").toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(zonedTime(2026, 10, 20, 9, 0, "America/New_York").toISOString()).toBe("2026-10-20T13:00:00.000Z");
  });
});

describe("freeSlots", () => {
  it("offers working-hour times on working days, a day apart first", () => {
    const slots = freeSlots([], hours, { from: now, days: 5, max: 3 });
    expect(slots.map((slot) => formatSlot(slot, hours.timeZone))).toEqual(["Mon 19 Oct, 12:00–12:45", "Tue 20 Oct, 09:00–09:45", "Wed 21 Oct, 09:00–09:45"]);
  });

  it("keeps clear of busy times and their buffer", () => {
    const busy = [{ start: new Date("2026-10-20T07:00:00Z"), end: new Date("2026-10-20T08:30:00Z") }];
    const [tuesday] = freeSlots(busy, hours, { from: new Date("2026-10-19T16:00:00Z"), days: 2, max: 1, noticeHours: 0 });
    // Busy 09:00–10:30 Berlin, plus 15 minutes.
    expect(formatSlot(tuesday, hours.timeZone)).toBe("Tue 20 Oct, 11:00–11:45");
  });

  it("gives nothing outside working days", () => {
    expect(freeSlots([], { ...hours, days: [6] }, { from: now, days: 5 })).toEqual([]);
  });
});
