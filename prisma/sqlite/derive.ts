// The SQLite schema is made from the PostgreSQL one, so the data model has
// one source. After editing prisma/schema.prisma, run `yarn sqlite-schema`,
// then make a migration for each database (see DEVELOPMENT.md).

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HEADER = `// Made from ../schema.prisma by \`yarn sqlite-schema\`: edit that file, not this one.
// SQLite has no citext: the unique Skill and Language names compare without
// case through COLLATE NOCASE, which the migrations add by hand.

`;

/** Replaces `from` once, and fails loudly when the PostgreSQL schema no longer has it. */
function replaceOnce(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`prisma/schema.prisma no longer contains ${from}: update prisma/sqlite/derive.ts.`);
  return text.replace(from, to);
}

/** The SQLite schema for the PostgreSQL schema `postgres`, with LF line endings. */
export function sqliteSchema(postgres: string): string {
  let schema = replaceOnce(postgres.replace(/\r\n/g, "\n"), 'output   = "../src/generated/prisma"', 'output   = "../../src/generated/prisma-sqlite"');
  schema = replaceOnce(schema, 'provider = "postgresql"', 'provider = "sqlite"');
  // A citext column becomes TEXT (see HEADER), and a date a full timestamp.
  schema = schema.replace(/ @db\.(Citext|Date)\b/g, "");
  const unknown = /@db\.\w+/.exec(schema);
  if (unknown) throw new Error(`SQLite has no ${unknown[0]}: say in prisma/sqlite/derive.ts what it becomes.`);
  return HEADER + schema;
}

export const POSTGRES_SCHEMA = fileURLToPath(new URL("../schema.prisma", import.meta.url));
export const SQLITE_SCHEMA = fileURLToPath(new URL("schema.prisma", import.meta.url));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(SQLITE_SCHEMA, sqliteSchema(readFileSync(POSTGRES_SCHEMA, "utf8")));
  console.log("Wrote prisma/sqlite/schema.prisma.");
}
