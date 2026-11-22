import { describe, expect, it } from "vitest";

import { USAGE_TASKS, usageFigures, usageSince, type UsageGroup } from "./usage";

const group = (task: string, figures: Partial<Omit<UsageGroup, "task">> = {}): UsageGroup => ({
  task,
  requests: 1,
  inputRequests: 1,
  input: 0,
  outputRequests: 1,
  output: 0,
  ...figures,
});

describe("usageFigures (#290)", () => {
  it("lists every task, those that used the most tokens first and the rest in their usual order", () => {
    const { rows } = usageFigures([
      group("extract-posting", { requests: 2, inputRequests: 2, input: 3_000, outputRequests: 2, output: 500 }),
      group("tailor-resume", { input: 6_000, output: 2_000 }),
    ]);
    expect(rows.map((row) => row.task)).toEqual([
      "tailor-resume",
      "extract-posting",
      ...USAGE_TASKS.map(({ task }) => task).filter((task) => task !== "tailor-resume" && task !== "extract-posting"),
    ]);
    expect(rows[1]).toEqual({
      task: "extract-posting",
      label: "Reading postings",
      hint: expect.any(String),
      requests: 2,
      input: { tokens: 3_000, unreported: 0 },
      output: { tokens: 500, unreported: 0 },
      total: 3_500,
    });
    expect(rows.at(-1)).toMatchObject({ requests: 0, input: { tokens: 0, unreported: 0 }, output: { tokens: 0, unreported: 0 }, total: 0 });
  });

  it("says Not reported (null) when no request's server counted, and how many didn't when some did", () => {
    const { rows } = usageFigures([
      group("classify-reply", { requests: 3, inputRequests: 0, outputRequests: 0 }),
      group("score-posting-jev", { requests: 4, inputRequests: 4, input: 8_000, outputRequests: 0 }),
      group("draft-reply", { requests: 5, inputRequests: 3, input: 900, outputRequests: 3, output: 300 }),
    ]);
    const row = (task: string) => rows.find((entry) => entry.task === task);
    expect(row("classify-reply")).toMatchObject({ requests: 3, input: { tokens: null, unreported: 3 }, output: { tokens: null, unreported: 3 }, total: null });
    expect(row("score-posting-jev")).toMatchObject({ input: { tokens: 8_000, unreported: 0 }, output: { tokens: null, unreported: 4 }, total: 8_000 });
    expect(row("draft-reply")).toMatchObject({ input: { tokens: 900, unreported: 2 }, output: { tokens: 300, unreported: 2 }, total: 1_200 });
  });

  it("adds every task up, leaving out tasks this version doesn't know", () => {
    const { total } = usageFigures([
      group("extract-posting", { input: 1_000, output: 200 }),
      group("score-posting-jev", { requests: 2, inputRequests: 2, input: 4_000, outputRequests: 0 }),
      group("an-old-task", { requests: 9, inputRequests: 9, input: 99_999 }),
    ]);
    expect(total).toEqual({ requests: 3, input: { tokens: 5_000, unreported: 0 }, output: { tokens: 200, unreported: 2 }, total: 5_200 });
  });

  it("counts nothing before the first request", () => {
    const { rows, total } = usageFigures([]);
    expect(rows).toHaveLength(USAGE_TASKS.length);
    expect(total).toEqual({ requests: 0, input: { tokens: 0, unreported: 0 }, output: { tokens: 0, unreported: 0 }, total: 0 });
  });
});

describe("usageSince", () => {
  it("starts the period that many days back, and all time never", () => {
    const now = new Date("2026-11-01T12:00:00Z");
    expect(usageSince("30d", now)).toEqual(new Date("2026-10-02T12:00:00Z"));
    expect(usageSince("90d", now)).toEqual(new Date("2026-08-03T12:00:00Z"));
    expect(usageSince("all", now)).toBeNull();
  });
});
