import path from "node:path";

import { describe, expect, it } from "vitest";

import { EnvError, parseEnv } from "./env";

// A hash of "correct horse" (scripts/hash-password.ts).
const PASSWORD_HASH = "argon2id:m=19456,t=2,p=1:CLZW5wQoCjh3Q9CHBp_JWw:Ak2xS7TYlYYrhemlgBkVxFmWXfcMq_rjd0mJGZcZFfA";

const valid = {
  DOSSIER_PASSWORD: PASSWORD_HASH,
  DOSSIER_SECRET: "a".repeat(32),
  DATABASE_URL: "postgresql://postgres:postgres@db:5432/dossier",
};

function problems(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
  throw new Error("Expected parseEnv to throw");
}

describe("parseEnv", () => {
  it("accepts the required variables and fills in defaults", () => {
    expect(parseEnv(valid)).toEqual({
      ...valid,
      DOSSIER_DATA_DIR: "/data",
      DOSSIER_BACKUP_RETENTION_DAYS: 14,
      DOSSIER_TELEMETRY: undefined,
    });
  });

  it("reads whether the usage ping is on", () => {
    // Unset or empty: not decided, so Dossier asks (#172).
    expect(parseEnv({ ...valid, DOSSIER_TELEMETRY: "" }).DOSSIER_TELEMETRY).toBeUndefined();
    expect(parseEnv(valid).DOSSIER_TELEMETRY).toBeUndefined();
    expect(parseEnv({ ...valid, DOSSIER_TELEMETRY: "ON" }).DOSSIER_TELEMETRY).toBe("on");
    expect(parseEnv({ ...valid, DOSSIER_TELEMETRY: " Off " }).DOSSIER_TELEMETRY).toBe("off");
    expect(problems({ ...valid, DOSSIER_TELEMETRY: "false" })).toEqual(['DOSSIER_TELEMETRY must be on or off (got "false").']);
  });

  it("reads the optional variables", () => {
    const env = parseEnv({
      ...valid,
      DOSSIER_DATA_DIR: "/srv/dossier",
      DOSSIER_BACKUP_RETENTION_DAYS: "30",
      DOSSIER_AI_PROVIDER: "local",
      DOSSIER_AI_URL: "http://ollama:11434",
      DOSSIER_AI_MODEL: "llama3.1:8b",
      DOSSIER_AI_KEY: "sk-test",
    });
    expect(env).toMatchObject({
      DOSSIER_DATA_DIR: "/srv/dossier",
      DOSSIER_BACKUP_RETENTION_DAYS: 30,
      DOSSIER_AI_PROVIDER: "local",
      DOSSIER_AI_URL: "http://ollama:11434",
      DOSSIER_AI_MODEL: "llama3.1:8b",
      DOSSIER_AI_KEY: "sk-test",
    });
  });

  it("reads the AI timeout in seconds", () => {
    expect(parseEnv({ ...valid, DOSSIER_AI_TIMEOUT_SECONDS: " 300 " }).DOSSIER_AI_TIMEOUT_SECONDS).toBe(300);
    expect(() => parseEnv({ ...valid, DOSSIER_AI_TIMEOUT_SECONDS: "5m" })).toThrow(/whole number of seconds/);
    expect(() => parseEnv({ ...valid, DOSSIER_AI_TIMEOUT_SECONDS: "1" })).toThrow(/at least 5/);
  });

  it("resolves a relative data directory", () => {
    const env = parseEnv({ ...valid, DOSSIER_DATA_DIR: "./data" });
    expect(env.DOSSIER_DATA_DIR).toBe(path.resolve("data"));
  });

  it("treats empty values as unset", () => {
    const env = parseEnv({ ...valid, DOSSIER_AI_KEY: "", DOSSIER_DATA_DIR: " " });
    expect(env.DOSSIER_AI_KEY).toBeUndefined();
    expect(env.DOSSIER_DATA_DIR).toBe("/data");
    expect(problems({ ...valid, DOSSIER_PASSWORD: "" })).toEqual([
      expect.stringMatching(/^DOSSIER_PASSWORD is not set\./),
    ]);
  });

  it("names every missing required variable", () => {
    expect(problems({})).toEqual([
      expect.stringMatching(/^DOSSIER_PASSWORD is not set\. Set it to/),
      expect.stringMatching(/^DOSSIER_SECRET is not set\. .*openssl rand/),
      expect.stringMatching(/^DATABASE_URL is not set\. /),
    ]);
  });

  it("wants a hash of the password, not the password itself", () => {
    expect(problems({ ...valid, DOSSIER_PASSWORD: "correct horse" })).toEqual([
      expect.stringMatching(/^DOSSIER_PASSWORD must be a hash of your password, not the password itself\. .*hash-password/),
    ]);
    expect(parseEnv({ ...valid, DOSSIER_PASSWORD: ` ${PASSWORD_HASH}\n` }).DOSSIER_PASSWORD).toBe(PASSWORD_HASH);
  });

  it("rejects a secret shorter than 32 characters", () => {
    expect(problems({ ...valid, DOSSIER_SECRET: "short" })).toEqual([
      expect.stringMatching(/^DOSSIER_SECRET is too short \(5 characters\)\./),
    ]);
  });

  it("never echoes secret values", () => {
    const messages = problems({
      DOSSIER_PASSWORD: "hunter2",
      DOSSIER_SECRET: "tiny-secret",
      DATABASE_URL: "mysql://root:db-password@db/dossier",
    }).join("\n");
    expect(messages).not.toContain("hunter2");
    expect(messages).not.toContain("tiny-secret");
    expect(messages).not.toContain("db-password");
    expect(messages).toMatch(/DATABASE_URL must be a PostgreSQL connection string/);
  });

  it("rejects invalid optional values", () => {
    expect(
      problems({
        ...valid,
        DOSSIER_BACKUP_RETENTION_DAYS: "two weeks",
        DOSSIER_AI_PROVIDER: "gemini",
        DOSSIER_AI_URL: "ftp://example.com",
      }),
    ).toEqual([
      'DOSSIER_BACKUP_RETENTION_DAYS must be a whole number of days (got "two weeks").',
      'DOSSIER_AI_PROVIDER must be one of local, openai, anthropic, mistral, lmstudio (got "gemini").',
      "DOSSIER_AI_URL must be an http:// or https:// URL.",
    ]);
    expect(problems({ ...valid, DOSSIER_BACKUP_RETENTION_DAYS: "0" })).toEqual([
      "DOSSIER_BACKUP_RETENTION_DAYS must be at least 1.",
    ]);
  });
});

describe("job search variables (E14-4)", () => {
  it("reads the source and its keys", () => {
    expect(
      parseEnv({
        ...valid,
        DOSSIER_JOBS_SOURCE: "jsearch",
        DOSSIER_JSEARCH_KEY: "ak_test",
        DOSSIER_JSEARCH_HOST: "rapidapi",
        DOSSIER_ADZUNA_APP_ID: "app",
        DOSSIER_ADZUNA_KEY: "adz",
        DOSSIER_FREEHIRE_URL: "https://jobs.example/",
      }),
    ).toMatchObject({
      DOSSIER_JOBS_SOURCE: "jsearch",
      DOSSIER_JSEARCH_KEY: "ak_test",
      DOSSIER_JSEARCH_HOST: "rapidapi",
      DOSSIER_ADZUNA_APP_ID: "app",
      DOSSIER_ADZUNA_KEY: "adz",
      DOSSIER_FREEHIRE_URL: "https://jobs.example",
    });
    expect(parseEnv({ ...valid, DOSSIER_JOBS_SOURCE: "freehire" }).DOSSIER_JOBS_SOURCE).toBe("freehire");
  });

  it("reads whether the Bundesagentur für Arbeit is offered, and refuses choosing it while it's off (#223)", () => {
    expect(parseEnv(valid).DOSSIER_JOBS_ARBEITSAGENTUR).toBeUndefined();
    expect(parseEnv({ ...valid, DOSSIER_JOBS_ARBEITSAGENTUR: " OFF " }).DOSSIER_JOBS_ARBEITSAGENTUR).toBe("off");
    expect(problems({ ...valid, DOSSIER_JOBS_ARBEITSAGENTUR: "no" })).toEqual(['DOSSIER_JOBS_ARBEITSAGENTUR must be on or off (got "no").']);
    expect(problems({ ...valid, DOSSIER_JOBS_SOURCE: "arbeitsagentur", DOSSIER_JOBS_ARBEITSAGENTUR: "off" })).toEqual([
      "DOSSIER_JOBS_SOURCE is arbeitsagentur, but DOSSIER_JOBS_ARBEITSAGENTUR is off. Choose another source, or remove one of the two.",
    ]);
  });

  it("rejects sources and hosts it doesn't know, without echoing keys", () => {
    expect(problems({ ...valid, DOSSIER_JOBS_SOURCE: "linkedin", DOSSIER_JSEARCH_HOST: "google", DOSSIER_JSEARCH_KEY: "ak_secret" })).toEqual([
      'DOSSIER_JOBS_SOURCE must be one of jsearch, adzuna, arbeitsagentur, freehire, off (got "linkedin").',
      'DOSSIER_JSEARCH_HOST must be openwebninja or rapidapi (got "google").',
    ]);
  });
});
