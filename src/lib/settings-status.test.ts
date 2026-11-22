import { describe, expect, it } from "vitest";

import type { SearchPortal } from "@/lib/job-search/search";

import { portalTrouble, problemsBanner, settingsStatus, type StatusInputs } from "./settings-status";

const now = new Date("2026-11-17T10:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const answer = (id: string, status: SearchPortal["status"], problem?: string, message: string | null = null): SearchPortal => ({ id: id as SearchPortal["id"], status, found: 0, next: null, message, problem });

const healthy: StatusInputs = {
  now,
  ai: { configured: true, name: "Anthropic", model: "claude-sonnet-5-5", local: false, keyProblem: null, test: { at: daysAgo(1), ok: true, seconds: 1.4, error: null } },
  documents: { paper: "A4", language: "English", tone: "Warm" },
  scoring: { name: "Your AI model", problem: null, scoredThisMonth: 412 },
  jobs: { portals: [{ id: "JSEARCH", name: "JSearch", on: true, setupProblem: null }, { id: "ADZUNA", name: "Adzuna", on: true, setupProblem: null }, { id: "FREEHIRE", name: "FreeHire", on: false, setupProblem: null }], runs: [] },
  agent: { enabled: true, searches: 3, hour: 7, maxDrafts: 2, nextRun: "tomorrow, 07:00", lastRun: { at: daysAgo(1), failed: false, message: "Found 4." }, setupProblem: null },
  google: { status: "connected", email: "jane@example.com", canRead: true, canUseCalendar: true, lastSync: "today at 09:56", problem: null },
  notifications: { channels: [{ name: "Email", summary: "jane@example.com", paused: false }], lastSent: "Draft ready, 17 Nov, 07:06" },
  connector: { on: false },
  data: { nightly: true, retentionDays: 14, lastBackup: daysAgo(0.3), lastBackupWords: "today at 02:00", problem: null },
  about: { version: "1.15.0", update: null, database: "PostgreSQL", applications: 11 },
};

describe("portalTrouble (E34-1)", () => {
  it("finds a portal failing in its last two searches, since the first of the failures in a row", () => {
    const runs = [
      { at: daysAgo(0), portals: [answer("ADZUNA", "failed", "key", "Adzuna rejected the key.")] },
      { at: daysAgo(2), portals: [answer("ADZUNA", "skipped", undefined, "Adzuna doesn't cover Brazil.")] },
      { at: daysAgo(3), portals: [answer("ADZUNA", "failed", "key")] },
      { at: daysAgo(5), portals: [answer("ADZUNA", "failed", "key")] },
      { at: daysAgo(6), portals: [answer("ADZUNA", "done")] },
    ];
    expect(portalTrouble("ADZUNA", runs)).toEqual({ kind: "failing", since: daysAgo(5), message: "Adzuna rejected the key." });
    expect(portalTrouble("ADZUNA", runs.slice(0, 2))).toBeNull();
    expect(portalTrouble("JSEARCH", runs)).toBeNull();
  });

  it("finds one out of searches in its last search", () => {
    expect(portalTrouble("JSEARCH", [{ at: daysAgo(1), portals: [answer("JSEARCH", "skipped", "quota", "Out of searches until 1 Dec.")] }])).toEqual({ kind: "quota", since: daysAgo(1), message: "Out of searches until 1 Dec." });
    expect(portalTrouble("JSEARCH", [{ at: daysAgo(0), portals: [answer("JSEARCH", "done")] }, { at: daysAgo(1), portals: [answer("JSEARCH", "skipped", "quota")] }])).toBeNull();
  });
});

describe("settingsStatus (E34-1)", () => {
  it("is all on when everything works, with a state, a meta and a note for each", () => {
    const status = settingsStatus(healthy);
    expect(Object.fromEntries(Object.entries(status).map(([id, section]) => [id, section.tone]))).toEqual({
      ai: "on", documents: "on", scoring: "on", jobs: "on", agent: "on", google: "on", notifications: "on", connector: "off", data: "on", about: "on",
    });
    expect(status.ai).toMatchObject({ state: "Anthropic · claude-sonnet-5-5 · tested 1.4 s", meta: "Your profile leaves the server when it writes", note: "Anthropic · claude-sonnet-5-5" });
    expect(status.documents.state).toBe("A4 · English · warm tone");
    expect(status.scoring.meta).toBe("412 postings scored this month");
    expect(status.jobs).toMatchObject({ state: "2 portals on", meta: "JSearch, Adzuna" });
    expect(status.agent).toMatchObject({ state: "3 searches, daily at 07:00 · up to 2 drafts", meta: "Next run tomorrow, 07:00" });
    expect(status.google).toMatchObject({ state: "Gmail and Calendar as jane@example.com", meta: "Checked for replies today at 09:56" });
    expect(status.about.state).toBe("You have 1.15.0, the latest");
    expect(problemsBanner(status)).toBeNull();
  });

  it("says nothing leaves a local model, and Off for what isn't set up", () => {
    const status = settingsStatus({
      ...healthy,
      ai: { ...healthy.ai, name: "Local model", model: "qwen2.5:3b", local: true },
      jobs: { ...healthy.jobs, portals: healthy.jobs.portals.map((portal) => ({ ...portal, on: false })) },
      agent: { ...healthy.agent, enabled: false },
      google: { status: "disconnected", email: null, canRead: false, canUseCalendar: false, lastSync: null, problem: null },
      notifications: { channels: [], lastSent: null },
    });
    expect(status.ai.meta).toBe("Nothing leaves this computer");
    expect([status.jobs.tone, status.agent.tone, status.google.tone, status.notifications.tone]).toEqual(["off", "off", "off", "off"]);
    expect(settingsStatus({ ...healthy, ai: { ...healthy.ai, configured: false } }).ai).toMatchObject({ tone: "off", note: "Not chosen yet" });
  });

  it("needs a look for each rule in ST2, and the banner lists them in order with the first fix", () => {
    const status = settingsStatus({
      ...healthy,
      ai: { ...healthy.ai, keyProblem: "unreadable" },
      jobs: { ...healthy.jobs, runs: [0, 1].map((days) => ({ at: daysAgo(days + 4), portals: [answer("ADZUNA", "failed", "key")] })) },
      scoring: { ...healthy.scoring, problem: "Jev needs its key." },
      agent: { ...healthy.agent, lastRun: { at: daysAgo(1), failed: true, message: "The agent scan was interrupted. Try again." } },
      google: { ...healthy.google, problem: "Google asks you to sign in again." },
      notifications: { channels: [{ name: "Phone", summary: "ntfy.sh/jane", paused: true }], lastSent: null },
      data: { ...healthy.data, lastBackup: daysAgo(4), lastBackupWords: "on 13 Nov at 02:00" },
      about: { ...healthy.about, update: "1.16.0" },
    });
    expect(Object.values(status).filter((section) => section.tone === "look")).toHaveLength(8);
    expect(status.jobs).toMatchObject({ state: "1 of 2 portals working. Adzuna has failed since 12 Nov.", meta: "JSearch", note: "Adzuna stopped working" });
    expect(status.notifications.note).toBe("Phone is paused");
    expect(status.data.note).toBe("No recent backup");

    expect(problemsBanner(status)).toEqual({
      title: "Eight things to look at.",
      summary:
        "Your Anthropic key can't be read, Adzuna has failed since 12 Nov, scoring can't run, the job agent's run on 16 Nov failed, Google stopped syncing, the Phone channel is paused, there's no backup from the last 3 days and Dossier 1.16.0 is out.",
      fix: { label: "Enter the key", section: "ai" },
    });
  });

  it("asks for a missing key, a failed test, a portal's key, a quota, an agent that can't run and a failed backup", () => {
    expect(settingsStatus({ ...healthy, ai: { ...healthy.ai, keyProblem: "missing" } }).ai.problem).toEqual({ summary: "your Anthropic key is missing", fix: "Add the key" });
    const failedTest = settingsStatus({ ...healthy, ai: { ...healthy.ai, test: { at: daysAgo(1), ok: false, seconds: null, error: "Anthropic rejected the key." } } }).ai;
    expect(failedTest).toMatchObject({ tone: "look", meta: "Anthropic rejected the key.", problem: { summary: "the AI connection test failed on 16 Nov", fix: "Test again" } });
    const keyless = settingsStatus({ ...healthy, jobs: { ...healthy.jobs, portals: [{ id: "ADZUNA", name: "Adzuna", on: true, setupProblem: "Add your Adzuna key." }] } }).jobs;
    expect(keyless).toMatchObject({ tone: "look", note: "Adzuna needs its key", problem: { fix: "Fix Adzuna" } });
    const quota = settingsStatus({ ...healthy, jobs: { ...healthy.jobs, runs: [{ at: daysAgo(1), portals: [answer("JSEARCH", "skipped", "quota")] }] } }).jobs;
    expect(quota.problem?.summary).toBe("JSearch is out of searches");
    expect(settingsStatus({ ...healthy, agent: { ...healthy.agent, setupProblem: "Switch on a portal first." } }).agent).toMatchObject({ tone: "look", meta: "Switch on a portal first." });
    expect(settingsStatus({ ...healthy, data: { ...healthy.data, problem: "The disk is full." } }).data).toMatchObject({ tone: "look", note: "Backup failed" });
    expect(problemsBanner(settingsStatus({ ...healthy, about: { ...healthy.about, update: "1.16.0" } }))).toEqual({ title: "One thing to look at.", summary: "Dossier 1.16.0 is out.", fix: { label: "See what's new", section: "about" } });
  });
});
