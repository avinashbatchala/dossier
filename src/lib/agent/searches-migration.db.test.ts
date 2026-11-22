import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { isSqliteUrl } from "@/lib/database";
import { testDatabaseUrl } from "@/test/db";

import { legacyAgentQuery } from "./search";

type Upgraded = {
  searches: { id: string; name: string; enabled: boolean | number; sort: number; query: Record<string, unknown> }[];
  settings: { key: string; value: string }[];
  attributions: unknown[];
};

/** PostgreSQL: the actual migration against a minimal pre-upgrade schema, in a transaction that rolls back, schema and all. */
async function upgradePostgres(value: string | null): Promise<Upgraded> {
  const db = new Client({ connectionString: testDatabaseUrl() });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("CREATE SCHEMA agent_search_upgrade_test");
    await db.query("SET LOCAL search_path TO agent_search_upgrade_test");
    await db.query('CREATE TABLE "Setting" ("key" text PRIMARY KEY, "value" text)');
    await db.query('CREATE TABLE "AgentCandidate" ("id" text PRIMARY KEY)');
    if (value !== null) await db.query('INSERT INTO "Setting" VALUES ($1, $2)', ["agentQuery", value]);
    await db.query('INSERT INTO "Setting" VALUES ($1, $2)', ["jsearchKeyEnc", "untouched"]);
    await db.query(await readFile("prisma/migrations/20261108140000_agent_searches/migration.sql", "utf8"));
    return {
      searches: (await db.query('SELECT * FROM "AgentSearch"')).rows,
      settings: (await db.query('SELECT * FROM "Setting"')).rows,
      attributions: (await db.query('SELECT * FROM "AgentCandidateSearch"')).rows,
    };
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
}

/** SQLite: its own migration, against the same minimal schema in memory. */
async function upgradeSqlite(value: string | null): Promise<Upgraded> {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec('CREATE TABLE "Setting" ("key" TEXT PRIMARY KEY, "value" TEXT)');
    db.exec('CREATE TABLE "AgentCandidate" ("id" TEXT PRIMARY KEY)');
    if (value !== null) db.prepare('INSERT INTO "Setting" VALUES (?, ?)').run("agentQuery", value);
    db.prepare('INSERT INTO "Setting" VALUES (?, ?)').run("jsearchKeyEnc", "untouched");
    db.exec(await readFile("prisma/sqlite/migrations/20261108114959_agent_searches/migration.sql", "utf8"));
    const searches = db.prepare('SELECT * FROM "AgentSearch"').all() as unknown as (Omit<Upgraded["searches"][number], "query"> & { query: string })[];
    return {
      searches: searches.map((row) => ({ ...row, query: JSON.parse(row.query) as Record<string, unknown> })),
      settings: db.prepare('SELECT * FROM "Setting"').all() as unknown as Upgraded["settings"],
      attributions: db.prepare('SELECT * FROM "AgentCandidateSearch"').all(),
    };
  } finally {
    db.close();
  }
}

const upgrade = (value: string | null) => (isSqliteUrl(testDatabaseUrl()) ? upgradeSqlite(value) : upgradePostgres(value));

// The job agent's one search becomes its first recurring search on upgrade (public PR 61),
// exactly as an import of an older file converts it.
describe("Agent search SQL upgrade", () => {
  it.each([
    [JSON.stringify({ keywords: "  Designer ", place: " Berlin ", country: " DE ", radiusKm: 50, remoteOnly: true, postedWithin: "week" }), true],
    [JSON.stringify({ keywords: "Engineer" }), true],
    [JSON.stringify({ keywords: "Engineer", place: " x".repeat(300), country: "invalid", radiusKm: 42, remoteOnly: "yes", postedWithin: "invalid" }), true],
    [JSON.stringify({ keywords: " " }), false],
    [JSON.stringify({ keywords: "\t\n " }), false],
    [JSON.stringify({ keywords: 42 }), false],
    ["{broken", false],
    ["null", false],
    [null, false],
  ])("migrates only a meaningful query (%s)", async (value, expected) => {
    const { searches, settings, attributions } = await upgrade(value);
    expect(searches).toHaveLength(expected ? 1 : 0);
    if (expected) {
      expect(searches[0]).toMatchObject({ id: "agent-search-legacy", name: "My search", sort: 0 });
      expect(Boolean(searches[0].enabled)).toBe(true);
      expect(searches[0].query.keywords).toBe(JSON.parse(value!).keywords.trim());
      expect(searches[0].query.country).toBe(value?.includes("DE") ? "de" : "");
      expect((searches[0].query.place as string).length).toBeLessThanOrEqual(200);
      expect(searches[0].query).toEqual(legacyAgentQuery(value!));
    }
    expect(settings).toEqual([{ key: "jsearchKeyEnc", value: "untouched" }]);
    expect(attributions).toEqual([]);
  });
});
