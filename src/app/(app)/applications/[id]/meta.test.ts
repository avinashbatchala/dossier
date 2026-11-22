import { describe, expect, it } from "vitest";

import { metaLine, roleLabel } from "./meta";

const application = {
  location: "Amsterdam",
  mode: "Hybrid · 3 days in office",
  salary: "€75–90k",
  deadline: new Date("2026-10-15T00:00:00Z"),
  createdAt: new Date(2026, 8, 27, 10),
};

describe("metaLine (APP-1)", () => {
  it("lists location, work mode, salary, deadline and creation date", () => {
    expect(metaLine(application)).toEqual([
      "Amsterdam",
      "Hybrid · 3 days in office",
      "€75–90k",
      "Apply by 15 Oct 2026",
      "Created 27 Sep 2026",
    ]);
  });

  it("leaves out what isn't known", () => {
    expect(metaLine({ ...application, location: " ", salary: "", deadline: null })).toEqual([
      "Hybrid · 3 days in office",
      "Created 27 Sep 2026",
    ]);
  });

  it("ends with the profile it was made from, when given (E24-6)", () => {
    expect(metaLine({ ...application, location: "", salary: "", deadline: null }, "Backend")).toEqual(["Hybrid · 3 days in office", "Created 27 Sep 2026", "From “Backend”"]);
  });

  it("says when and how it was sent, once it was (E29-7)", () => {
    const sent = { location: "", mode: "", salary: "", deadline: null, createdAt: new Date("2026-10-01T10:00:00Z"), sentAt: new Date("2026-11-02T10:00:00Z"), sentVia: "GMAIL" as const };
    expect(metaLine(sent, "", { now: new Date("2026-11-16T10:00:00Z"), timeZone: "Europe/Berlin" }).at(-1)).toBe("Sent 2 Nov by Gmail");
  });
});

describe("roleLabel (E30-5)", () => {
  it("names a role by its company and years", () => {
    expect(roleLabel({ company: "Northwind Logistics", role: "Designer", startYear: 2021, endYear: null, current: true })).toBe("Northwind Logistics, 2021 – now");
    expect(roleLabel({ company: " ", role: "Designer", startYear: 2015, endYear: 2018, current: false })).toBe("Designer, 2015 – 2018");
    expect(roleLabel({ company: "", role: "", startYear: null, endYear: null, current: false })).toBe("A role without a name");
  });
});
