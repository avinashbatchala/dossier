// Puts together what "On this computer" runs: the standalone Dossier server, its
// database setup, and a Node binary, for one platform, in build-server/. Every
// download is checked against a hash pinned here. Run after the app's own build:
//
//   node scripts/prepare-server.mjs --next ../.next --seed ../.next/desktop-seed.mjs --platform win32

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

const NODE_VERSION = "24.22.3";
const NODE_ABI = "137";
const BETTER_SQLITE3_VERSION = "12.11.1";

const DOWNLOADS = {
  linux: {
    node: { url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.gz`, sha256: "061ec3e3062115705b56b51fa9cc330ab50d34b6969387d4e4b1a50c6809acc2" },
    sqlite: { sha256: "99c43785639d5d3690c396ba245ee680ac8b469a46b19233a3546f0eb7f8e312" },
  },
  win32: {
    node: { url: `https://nodejs.org/dist/v${NODE_VERSION}/win-x64/node.exe`, sha256: "86fc4785327db5f5c7558dc6156c543b433c313e813a222e088086222ab4afa6" },
    sqlite: { sha256: "4ee5e653174d6ddd301605d351798cdae2613da06c4f37ecdce263021fcf1255" },
  },
};

const desktop = path.join(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    next: { type: "string", default: path.join(desktop, "..", ".next") },
    seed: { type: "string", default: path.join(desktop, "..", ".next", "desktop-seed.mjs") },
    platform: { type: "string", default: process.platform },
  },
});
const downloads = DOWNLOADS[values.platform];
if (!downloads) throw new Error(`There's no desktop app for ${values.platform}.`);

async function download(url, sha256) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== sha256) throw new Error(`${url} isn't the file expected: its hash is ${actual}.`);
  return bytes;
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed.`);
}

const out = path.join(desktop, "build-server");
const server = path.join(out, "server");
const scratch = mkdtempSync(path.join(tmpdir(), "dossier-prepare-"));
rmSync(out, { recursive: true, force: true });

/**
 * Replaces every link under a folder with what it points at: an installer can't
 * carry links, and these point at this machine. Node finds a package's
 * dependencies from where it really is, so a package nested in another's
 * node_modules needs the ones next to it brought along, or a copy can't find them.
 */
function replaceLinks(folder, topLevel) {
  for (const entry of readdirSync(folder)) {
    const entryPath = path.join(folder, entry);
    const stat = lstatSync(entryPath);
    if (stat.isSymbolicLink()) {
      const target = realpathSync(entryPath);
      rmSync(entryPath);
      cpSync(target, entryPath, { recursive: true, dereference: true });
      const parent = path.dirname(target);
      if (path.basename(parent) !== "node_modules" || parent === topLevel) continue;
      for (const sibling of readdirSync(parent)) {
        if (sibling !== path.basename(target)) cpSync(path.join(parent, sibling), path.join(entryPath, "node_modules", sibling), { recursive: true, dereference: true });
      }
    } else if (stat.isDirectory()) {
      replaceLinks(entryPath, topLevel);
    }
  }
}

/** Every file under a folder, for checking what's about to ship. */
function* filesUnder(folder) {
  for (const entry of readdirSync(folder)) {
    const entryPath = path.join(folder, entry);
    if (lstatSync(entryPath).isDirectory()) yield* filesUnder(entryPath);
    else yield entryPath;
  }
}

// The server. Next.js links its native packages from .next/node_modules.
cpSync(path.join(values.next, "standalone"), server, { recursive: true, verbatimSymlinks: true });
replaceLinks(path.join(server, ".next", "node_modules"), realpathSync(path.join(server, "node_modules")));
cpSync(path.join(values.next, "static"), path.join(server, ".next", "static"), { recursive: true });
cpSync(path.join(desktop, "..", "public"), path.join(server, "public"), { recursive: true });

// Only what the server needs, as a list of what to keep. The standalone folder
// also holds whatever Next.js traced from the project, and it copies .env into
// it: on a developer's machine, that's their real secrets.
const KEEP = new Set([".next", "node_modules", "package.json", "public", "server.js"]);
for (const entry of readdirSync(server)) {
  if (!KEEP.has(entry)) rmSync(path.join(server, entry), { recursive: true, force: true });
}
// Nothing uses sharp, which is only for next/image, and it's the other native package.
for (const unused of ["node_modules/sharp", "node_modules/@img"]) rmSync(path.join(server, unused), { recursive: true, force: true });

// The SQLite driver, for this platform.
const sqliteAsset = `better-sqlite3-v${BETTER_SQLITE3_VERSION}-node-v${NODE_ABI}-${values.platform}-x64.tar.gz`;
const sqliteArchive = path.join(scratch, sqliteAsset);
writeFileSync(sqliteArchive, await download(`https://github.com/WiseLibs/better-sqlite3/releases/download/v${BETTER_SQLITE3_VERSION}/${sqliteAsset}`, downloads.sqlite.sha256));
run("tar", ["-xzf", sqliteArchive, "-C", scratch]);
const sqliteBinary = path.join(scratch, "build", "Release", "better_sqlite3.node");
const nextModules = path.join(server, ".next", "node_modules");
const sqliteFolders = [
  path.join(server, "node_modules", "better-sqlite3"),
  ...(existsSync(nextModules) ? readdirSync(nextModules).filter((name) => name.startsWith("better-sqlite3-")).map((name) => path.join(nextModules, name)) : []),
];
for (const folder of sqliteFolders) {
  const version = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")).version;
  if (version !== BETTER_SQLITE3_VERSION) throw new Error(`The build has better-sqlite3 ${version}; this script pins ${BETTER_SQLITE3_VERSION}.`);
  cpSync(sqliteBinary, path.join(folder, "build", "Release", "better_sqlite3.node"));
}

// What sets the database up and starts the server.
cpSync(path.join(desktop, "..", "prisma", "sqlite", "migrations"), path.join(server, "migrations"), { recursive: true });
cpSync(values.seed, path.join(server, "seed.mjs"));
cpSync(path.join(desktop, "server-tools"), server, { recursive: true });

// Node.
const nodeFolder = path.join(out, "node");
mkdirSync(nodeFolder, { recursive: true });
if (values.platform === "win32") {
  writeFileSync(path.join(nodeFolder, "node.exe"), await download(downloads.node.url, downloads.node.sha256));
} else {
  const archive = path.join(scratch, "node.tar.gz");
  writeFileSync(archive, await download(downloads.node.url, downloads.node.sha256));
  run("tar", ["-xzf", archive, "-C", scratch, "--strip-components=2", `node-v${NODE_VERSION}-linux-x64/bin/node`]);
  cpSync(path.join(scratch, "node"), path.join(nodeFolder, "node"));
  chmodSync(path.join(nodeFolder, "node"), 0o755);
}

rmSync(scratch, { recursive: true, force: true });

// The last check before this can reach anyone.
for (const file of filesUnder(out)) {
  if (/^\.env/.test(path.basename(file))) throw new Error(`${file} must never ship: it can hold secrets.`);
  if (lstatSync(file).isSymbolicLink()) throw new Error(`${file} is a link, which an installer can't carry.`);
}
console.log(`Ready for ${values.platform}: ${out}`);
