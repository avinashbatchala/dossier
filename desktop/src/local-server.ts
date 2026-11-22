import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";

import { loadLocalSecrets } from "./local-secrets";

// "On this computer": Dossier's own server, on a plain Node binary next to
// Electron, as in the Docker image. Nothing native is built for Electron, so an
// Electron update, which is how Chromium's security fixes arrive, can't be held
// back by it. The server listens on this computer only.

/** migrate.mjs's exit code for a database from a newer version. */
const NEWER_DATABASE = 3;
const START_TIMEOUT_MS = 90_000;

export type LocalBundle = { server: string; node: string };

export type LocalProblem = { kind: "newer-database" | "port-busy" | "failed"; detail: string; log: string };

export class LocalServerError extends Error {
  constructor(readonly problem: LocalProblem) {
    super(problem.detail);
  }
}

/** The server and Node that came with the app; null if this build has none. */
export function localBundle(resources: string): LocalBundle | null {
  const server = path.join(resources, "server");
  const node = path.join(resources, "node", process.platform === "win32" ? "node.exe" : "node");
  return existsSync(path.join(server, "server.js")) && existsSync(node) ? { server, node } : null;
}

export type RunningServer = { origin: string; token: string; stop: () => void };

const portIsFree = (port: number) =>
  new Promise<boolean>((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });

/** Sets the database up and starts the server, and answers once it's serving. */
export async function startLocalServer({
  bundle,
  dataDir,
  version,
  printUrl,
  token = randomBytes(32).toString("base64url"),
  isHealthy,
}: {
  bundle: LocalBundle;
  dataDir: string;
  version: string;
  printUrl: string;
  token?: string;
  isHealthy: (origin: string) => Promise<boolean>;
}): Promise<RunningServer> {
  const logs = path.join(dataDir, "logs");
  mkdirSync(logs, { recursive: true });
  const log = path.join(logs, "server.log");
  const fail = (kind: LocalProblem["kind"], detail: string) => new LocalServerError({ kind, detail, log });

  const secrets = loadLocalSecrets(path.join(dataDir, "secrets.json"));
  const file = path.join(dataDir, "dossier.db");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(secrets.port),
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: `file:${file}`,
    DOSSIER_DATABASE_FILE: file,
    DOSSIER_APP_VERSION: version,
    DOSSIER_DATA_DIR: path.join(dataDir, "files"),
    DOSSIER_SECRET: secrets.secret,
    DOSSIER_PASSWORD: secrets.passwordHash,
    DOSSIER_DESKTOP_TOKEN: token,
    DOSSIER_DESKTOP_PRINT_URL: printUrl,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  /** Runs a setup script to its end, without holding up the window. */
  const step = (script: string) =>
    new Promise<{ status: number | null; stderr: string }>((resolve) => {
      const child = spawn(bundle.node, [path.join(bundle.server, script)], { cwd: bundle.server, env, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      child.once("error", (error) => resolve({ status: 1, stderr: error.message }));
      child.once("close", (status) => resolve({ status, stderr }));
    });

  const migrated = await step("migrate.mjs");
  if (migrated.status === NEWER_DATABASE) throw fail("newer-database", migrated.stderr.trim());
  if (migrated.status !== 0) throw fail("failed", migrated.stderr.trim() || "The database couldn't be brought up to date.");
  const seeded = await step("seed.mjs");
  if (seeded.status !== 0) throw fail("failed", seeded.stderr.trim() || "The built-in themes couldn't be loaded.");

  if (!(await portIsFree(secrets.port))) throw fail("port-busy", `Port ${secrets.port} on this computer is taken by another program.`);

  const origin = `http://127.0.0.1:${secrets.port}`;
  const output = createWriteStream(log);
  const child: ChildProcess = spawn(bundle.node, [path.join(bundle.server, "start.mjs")], { cwd: bundle.server, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  child.stdout?.pipe(output);
  child.stderr?.pipe(output);

  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  const stop = () => {
    if (!exited) child.kill();
  };

  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) throw fail("failed", "The server stopped while starting.");
    if (await isHealthy(origin)) return { origin, token, stop };
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  stop();
  throw fail("failed", "The server took too long to start.");
}
