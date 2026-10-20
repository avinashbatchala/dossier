import { describe, expect, it } from "vitest";

import { DateFormat } from "@/generated/prisma/enums";

import { DATE_FORMATS, formatDocumentDate, maxPages, pagesInWords, settingsFromRows, settingValue, type SettingsData } from "./settings";

const date = new Date(Date.UTC(2026, 8, 7));

describe("document dates", () => {
  it("formats each style as its label shows", () => {
    const example = new Date(Date.UTC(2026, 8, 27));
    for (const { value, label } of DATE_FORMATS) {
      expect(formatDocumentDate(example, value)).toBe(label);
    }
  });

  it("doesn't pad the day in written styles, but does in the numeric one", () => {
    expect(formatDocumentDate(date, DateFormat.DAY_MONTH_YEAR)).toBe("7 September 2026");
    expect(formatDocumentDate(date, DateFormat.MONTH_DAY_YEAR)).toBe("September 7, 2026");
    expect(formatDocumentDate(date, DateFormat.NUMERIC)).toBe("07-09-2026");
  });

  it("writes month names in the document's language", () => {
    expect(formatDocumentDate(date, DateFormat.DAY_MONTH_YEAR, "nl")).toBe("7 september 2026");
  });
});

describe("stored settings", () => {
  it("reads an empty table as the prototype's defaults", () => {
    expect(settingsFromRows([])).toEqual({
      provider: null,
      baseUrl: null,
      model: null,
      apiKeyEnc: null,
      creativity: "BALANCED",
      strict: true,
      showDiff: true,
      paper: "A4",
      dateFormat: "DAY_MONTH_YEAR",
      defaultTone: "WARM",
      docLanguage: null,
      resumeLanguage: null,
      customLanguages: [],
      fileNamePattern: "{name} – {company} – {doc}",
      includeRefs: false,
      pageLimit: "1",
      nightlyBackup: true,
      jobRetentionHours: 24,
      baseThemeId: "editorial",
      applicationsView: "board",
      applicationsFilter: "all",
      applicationsSort: "updated",
      dashboardPeriod: "all",
      quietDays: 7,
      experienceOrder: "date",
      projectOrder: "date",
      educationOrder: "date",
      backupProblem: null,
      jobSource: null,
      jsearchKeyEnc: null,
      jsearchHost: "openwebninja",
      adzunaAppId: null,
      adzunaKeyEnc: null,
      agentEnabled: false,
      agentQuery: { keywords: "", place: "", country: "", radiusKm: 25, remoteOnly: false, postedWithin: "any" },
      agentHour: 7,
      agentMinScore: 70,
      agentMaxScores: 15,
      agentMaxDrafts: 3,
      agentAutoDraft: false,
      agentRuns: [],
      updateCheck: true,
      latestVersion: null,
      latestVersionUrl: null,
      updateCheckDay: null,
      updateDismissed: null,
      googleClientId: null,
      googleClientSecretEnc: null,
      gmailRead: true,
      gmailScope: "known",
      gmailInterval: 10,
      calendarAvailability: true,
      calendarEvents: true,
      calendarId: "primary",
      workDays: [1, 2, 3, 4, 5],
      workStart: "09:00",
      workEnd: "17:00",
      workTimeZone: null,
      slotMinutes: 45,
      bufferMinutes: 15,
      usagePingId: null,
      usagePingDay: null,
      usagePingChoice: null,
      usagePingChoiceAt: null,
      usagePingChoiceText: null,
      browserTimeZone: null,
    });
  });

  it("reads back what it stores", () => {
    const saved = {
      provider: "OPENAI",
      strict: false,
      paper: "LETTER",
      customLanguages: ["Farsi", "Hebrew"],
      docLanguage: "Dutch",
      quietDays: 14,
      jobRetentionHours: 168,
    } satisfies Partial<SettingsData>;
    const rows = Object.entries(saved).map(([key, value]) => ({ key, value: settingValue(value)! }));
    expect(rows).toContainEqual({ key: "strict", value: "false" });
    expect(rows).toContainEqual({ key: "customLanguages", value: '["Farsi","Hebrew"]' });
    expect(rows).toContainEqual({ key: "quietDays", value: "14" });
    expect(settingsFromRows(rows)).toMatchObject(saved);
    expect(settingValue(null)).toBeNull();
  });

  it("reads values that don't fit as the default, and ignores unknown keys", () => {
    const settings = settingsFromRows([
      { key: "provider", value: "GEMINI" },
      { key: "paper", value: "A5" },
      { key: "strict", value: "maybe" },
      { key: "customLanguages", value: "Farsi, Hebrew" },
      { key: "quietDays", value: "0" },
      { key: "jobRetentionHours", value: "5" },
      { key: "theme", value: "dark" },
    ]);
    expect(settings).toMatchObject({ provider: null, paper: "A4", strict: true, customLanguages: [], quietDays: 7, jobRetentionHours: 24 });
    expect(settings).not.toHaveProperty("theme");
  });

  it("reads the old one-page switch as a page limit (SET-9)", () => {
    expect(settingsFromRows([{ key: "onePage", value: "false" }]).pageLimit).toBe("none");
    expect(settingsFromRows([{ key: "onePage", value: "true" }]).pageLimit).toBe("1");
    // A limit chosen since wins over the old switch.
    expect(settingsFromRows([{ key: "onePage", value: "false" }, { key: "pageLimit", value: "2" }]).pageLimit).toBe("2");
    expect(settingsFromRows([{ key: "pageLimit", value: "3" }]).pageLimit).toBe("1");
  });
});

describe("the job agent's settings (E16)", () => {
  it("reads its search and runs as JSON, and values out of range as the defaults", () => {
    const query = { keywords: "Data scientist", place: "Berlin", country: "de", radiusKm: 50, remoteOnly: true, postedWithin: "week" } as const;
    const runs = [{ at: "2026-10-20T07:00:00.000Z", manual: false, message: "2 new postings scored." }];
    const rows = Object.entries({ agentQuery: query, agentRuns: runs, agentEnabled: true, agentHour: 9 }).map(([key, value]) => ({ key, value: settingValue(value)! }));
    expect(rows).toContainEqual({ key: "agentQuery", value: JSON.stringify(query) });
    expect(settingsFromRows(rows)).toMatchObject({ agentQuery: query, agentRuns: runs, agentEnabled: true, agentHour: 9 });

    const odd = settingsFromRows([
      { key: "agentQuery", value: "{not json" },
      { key: "agentRuns", value: '[{"at":"yesterday"}]' },
      { key: "agentHour", value: "24" },
      { key: "agentMinScore", value: "101" },
      { key: "agentMaxScores", value: "0" },
      { key: "agentMaxDrafts", value: "11" },
    ]);
    expect(odd).toMatchObject({ agentQuery: { keywords: "", country: "" }, agentRuns: [], agentHour: 7, agentMinScore: 70, agentMaxScores: 15, agentMaxDrafts: 3 });
  });
});

describe("page limits (SET-9)", () => {
  it("counts the pages a resume may have", () => {
    expect([maxPages("1"), maxPages("2"), maxPages("none")]).toEqual([1, 2, null]);
    expect([pagesInWords(1), pagesInWords(2)]).toEqual(["one page", "two pages"]);
  });
});
