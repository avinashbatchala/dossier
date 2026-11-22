// Brings the app's SQLite database up to date, without Prisma's command-line
// tools, which are most of the image's size. It keeps Prisma's own table, in
// Prisma's own format, so the file stays a normal Dossier database.
//
// Each file runs as it is and NOT in a transaction. The migrations turn foreign
// keys off to rebuild a table, SQLite ignores that inside a transaction, and then
// DROP TABLE cascades and deletes the rows in the tables that point at it. So a
// failure can leave a file half applied, which is what the copy made first is for.

import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Copies of the database kept from before an update. */
const COPIES_KEPT = 3;
/** The exit code for a database from a newer version: the app says to download that version. */
export const NEWER_DATABASE = 3;

export class NewerDatabase extends Error {
  name = "NewerDatabase";
}

const TABLE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

const knownMigrations = (folder) =>
  readdirSync(folder)
    .filter((name) => statSync(path.join(folder, name)).isDirectory())
    .sort();

const appliedMigrations = (db) => {
  const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '_prisma_migrations'`).get();
  if (!table) return [];
  return db.prepare(`SELECT migration_name AS name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`).all().map((row) => row.name);
};

/** A copy of the file from before this update, keeping the last few. */
function keepCopy(file, version) {
  if (!existsSync(file) || statSync(file).size === 0) return null;
  const folder = path.dirname(file);
  const stem = `${path.basename(file)}.before-`;
  const copy = path.join(folder, `${stem}${version}`);
  copyFileSync(file, copy);
  const older = readdirSync(folder)
    .filter((name) => name.startsWith(stem))
    .map((name) => path.join(folder, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  for (const stale of older.slice(COPIES_KEPT)) rmSync(stale, { force: true });
  return copy;
}

/**
 * Applies what's pending, and answers with what it did. A database with a
 * migration this version doesn't know comes from a newer version: it's refused
 * and left untouched, since this version can't know what that changed.
 */
export function migrate({ file, migrations, version, Database }) {
  const known = knownMigrations(migrations);
  let db = new Database(file);
  const applied = appliedMigrations(db);
  const unknown = applied.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    db.close();
    throw new NewerDatabase(`This database was last used by a newer version of Dossier (it has ${unknown.join(", ")}).`);
  }
  const pending = known.filter((name) => !applied.includes(name));
  if (pending.length === 0) {
    db.close();
    return { applied: [], copy: null };
  }
  db.close();
  const copy = keepCopy(file, version);

  db = new Database(file);
  try {
    db.exec(TABLE);
    for (const name of pending) {
      const sql = readFileSync(path.join(migrations, name, "migration.sql"));
      const id = randomUUID();
      db.prepare(`INSERT INTO "_prisma_migrations" (id, checksum, migration_name) VALUES (?, ?, ?)`).run(id, createHash("sha256").update(sql).digest("hex"), name);
      db.exec(sql.toString("utf8"));
      db.prepare(`UPDATE "_prisma_migrations" SET finished_at = current_timestamp, applied_steps_count = 1 WHERE id = ?`).run(id);
    }
  } catch (error) {
    error.copy = copy;
    throw error;
  } finally {
    db.close();
  }
  return { applied: pending, copy };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const require = createRequire(import.meta.url);
  const here = path.dirname(process.argv[1]);
  try {
    const { applied, copy } = migrate({
      file: process.env.DOSSIER_DATABASE_FILE,
      migrations: path.join(here, "migrations"),
      version: process.env.DOSSIER_APP_VERSION ?? "unknown",
      Database: require("better-sqlite3"),
    });
    console.log(applied.length ? `Applied ${applied.length} migrations${copy ? `; the old database is at ${copy}` : ""}.` : "The database is up to date.");
  } catch (error) {
    console.error(error.message);
    if (error.copy) console.error(`The database from before this update is at ${error.copy}.`);
    process.exit(error instanceof NewerDatabase ? NEWER_DATABASE : 1);
  }
}
