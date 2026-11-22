import { Client } from "pg";
import { expect, it } from "vitest";

import { isSqliteUrl } from "@/lib/database";
import { testDatabaseUrl } from "@/test/db";

import { AGENT_SCAN_LOCK_ID, withAgentScanLock } from "./scan-lock";

const sqlite = isSqliteUrl(testDatabaseUrl());

it.skipIf(sqlite)("releases scan ownership when a process connection disappears, without a stale lease", async () => {
  const oldProcess = new Client({ connectionString: testDatabaseUrl() });
  await oldProcess.connect();
  try {
    await oldProcess.query("SELECT pg_advisory_lock($1::bigint)", [AGENT_SCAN_LOCK_ID]);
    let dispatched = false;
    expect(await withAgentScanLock(async () => { dispatched = true; }, testDatabaseUrl())).toBeNull();
    expect(dispatched).toBe(false);
  } finally { await oldProcess.end(); }
  expect(await withAgentScanLock(async () => "recovered", testDatabaseUrl())).toBe("recovered");
});

it.runIf(sqlite)("on SQLite, holds the scan in this process: a second scan waits its turn (public PR 61)", async () => {
  let release!: () => void;
  const first = withAgentScanLock(() => new Promise<string>((resolve) => (release = () => resolve("first"))), testDatabaseUrl());
  expect(await withAgentScanLock(async () => "second", testDatabaseUrl())).toBeNull();
  release();
  expect(await first).toBe("first");
  expect(await withAgentScanLock(async () => "after", testDatabaseUrl())).toBe("after");
});

it("also releases ownership after an unexpected evaluation failure", async () => {
  await expect(withAgentScanLock(async () => { throw new Error("interrupted"); }, testDatabaseUrl())).rejects.toThrow("interrupted");
  expect(await withAgentScanLock(async () => "next scan", testDatabaseUrl())).toBe("next scan");
});
