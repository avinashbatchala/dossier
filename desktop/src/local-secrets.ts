import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

// What the server on this computer needs that a person would otherwise set in
// .env. It lives next to the database and goes with it, so moving the folder keeps
// saved keys readable, and it's readable only by this user.

export type LocalSecrets = {
  /** DOSSIER_SECRET: encrypts saved API keys and sessions. */
  secret: string;
  /** DOSSIER_PASSWORD: random bytes in the shape of a hash, so no password opens the sign-in page. */
  passwordHash: string;
  port: number;
};

/** Far from the ports people's other servers use. It stays once chosen, since Google's redirect address needs it. */
const DEFAULT_PORT = 47318;

const make = (): LocalSecrets => ({
  secret: randomBytes(32).toString("base64url"),
  passwordHash: `argon2id:m=19456,t=2,p=1:${randomBytes(16).toString("base64url")}:${randomBytes(32).toString("base64url")}`,
  port: DEFAULT_PORT,
});

const isUsable = (saved: Partial<LocalSecrets>): saved is LocalSecrets =>
  typeof saved.secret === "string" && saved.secret.length >= 32 && typeof saved.passwordHash === "string" && Number.isInteger(saved.port);

/** What's saved, or a new set the first time. A file that can't be read is an error, not a new secret, since that would lose every saved key. */
export function loadLocalSecrets(file: string): LocalSecrets {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const secrets = make();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    return secrets;
  }
  const saved = JSON.parse(text) as Partial<LocalSecrets>;
  if (!isUsable(saved)) throw new Error(`${file} isn't what Dossier saved. Restore it from a backup, or remove it to start over, which loses saved keys.`);
  return saved;
}
