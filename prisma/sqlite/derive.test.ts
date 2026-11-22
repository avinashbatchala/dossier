import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { POSTGRES_SCHEMA, SQLITE_SCHEMA, sqliteSchema } from "./derive";

describe("sqliteSchema", () => {
  it("is what prisma/sqlite/schema.prisma holds (run `yarn sqlite-schema` after changing the schema)", () => {
    expect(readFileSync(SQLITE_SCHEMA, "utf8").replace(/\r\n/g, "\n")).toBe(sqliteSchema(readFileSync(POSTGRES_SCHEMA, "utf8")));
  });

  it("refuses a PostgreSQL type it doesn't know", () => {
    const schema = readFileSync(POSTGRES_SCHEMA, "utf8").replace("key       String   @id", "key       String   @id @db.Uuid");
    expect(() => sqliteSchema(schema)).toThrow("SQLite has no @db.Uuid");
  });
});

describe("the SQLite migrations", () => {
  it("make exactly prisma/sqlite/schema.prisma (make a migration for SQLite too, see DEVELOPMENT.md)", () => {
    // `migrate diff --exit-code` exits with 2, and lists the difference, when there is one.
    const diff = spawnSync(
      process.execPath,
      ["node_modules/prisma/build/index.js", "migrate", "diff", "--from-migrations", "prisma/sqlite/migrations", "--to-schema", SQLITE_SCHEMA, "--exit-code"],
      { encoding: "utf8" },
    );
    expect(diff.status, diff.stdout + diff.stderr).toBe(0);
  }, 30_000);
});
