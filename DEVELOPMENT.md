# Developing Dossier

Next.js 16 (App Router) + Prisma 7 + PostgreSQL 18, run with Docker Compose and Yarn 4. Nothing runs on the host: every command goes through the containers. For installing and running Dossier, see the [README](README.md); for how it's secured, [SECURITY.md](SECURITY.md).

## Getting started

```bash
cp .env.example .env
docker compose build
docker/bin/yarn hash-password   # set DOSSIER_PASSWORD in .env to what it prints
# set DOSSIER_SECRET (openssl rand -base64 32) in .env
docker compose up
```

Open [http://localhost:3000](http://localhost:3000). Source is bind-mounted, so edits hot-reload.

`.env.example` documents every variable. The server refuses to start while `DOSSIER_PASSWORD` or `DOSSIER_SECRET` is missing, `DOSSIER_PASSWORD` isn't a password hash, or the secret is shorter than 32 characters, and logs which variable to fix.
Server code reads configuration from the validated `env` object instead of `process.env`:

```ts
import { env } from "@/lib/env";
```

On every start the `app` container runs `prisma generate`, `prisma migrate deploy`, then `next dev`.
Postgres is also exposed on `localhost:5432` for host tools, using `DATABASE_URL` from `.env`.

## Yarn

Dependencies live in the container (a named `node_modules` volume), not on the host.
Run yarn through `docker/bin/yarn`, which uses the running `app` container or, if it's stopped, a one-off one:

```bash
docker/bin/yarn add <package>
docker/bin/yarn install   # after pulling changes to yarn.lock
docker/bin/yarn lint
```

## Database

Define models in `prisma/schema.prisma`, then create and apply a migration:

```bash
docker/bin/yarn prisma migrate dev --name <migration-name>
docker compose restart app
```

The restart regenerates the Prisma Client and picks it up; since Prisma 7, `migrate dev` no longer runs `prisma generate` on its own.

To browse and edit rows in Prisma Studio, start it on demand (plain `docker compose up` leaves it off) and open [http://localhost:5555](http://localhost:5555):

```bash
docker compose up -d studio
docker compose stop studio   # when you're done
```

Query the database from server code with the shared client:

```ts
import { prisma } from "@/lib/prisma";
```

JSON columns (document units, the posting's extracted details, the match, chat edits) are validated with the zod schemas in `src/lib/application-data.ts`.
Change an application's status only through `setStatus` in `src/lib/status-actions.ts` (or `changeStatus()` in client code, which adds the Undo toast), so the funnel figures stay consistent.

### Seed data

Each start runs `prisma db seed`, which creates the six built-in themes, an empty profile and default settings. It never overwrites your profile or settings. To load the prototype's sample data (Jane Doe and nine applications):

```bash
docker/bin/yarn prisma db seed -- --demo           # refuses if you already have a profile or applications
docker/bin/yarn prisma db seed -- --demo --reset   # deletes your profile and applications first
```

## Mutations and private routes

Every mutation goes through one of two helpers. Both check the session first, keep unexpected errors out of responses (they're logged on the server without the data involved), and let `redirect()` and `notFound()` work as usual.

**Server Actions** are the default. Define them with `action(schema, handler)` in a `"use server"` file: the input is validated with zod, and the action returns `{ ok: true, data, toast? } | { ok: false, error, fieldErrors? }`, with messages written for the user.

```ts
// src/app/(app)/settings/actions.ts
"use server";

import { z } from "zod";

import { action, ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";

export const renameTheme = action(
  z.object({ id: z.string(), name: z.string().trim().min(1, "Give the theme a name.") }),
  async ({ id, name }, { toast }) => {
    const theme = await prisma.theme.findUnique({ where: { id } });
    if (!theme) throw new ActionError("That theme no longer exists."); // shown to the user
    await prisma.theme.update({ where: { id }, data: { name } });
    toast(`Renamed to “${name}”.`);
    return { id, name };
  },
);
```

On the client, `toastResult()` from `@/components/toast` shows the action's `toast` or its error, and `toast("…")` shows any other message:

```tsx
const result = toastResult(await renameTheme({ id, name }));
```

Next.js already refuses Server Actions whose `Origin` doesn't match the host (or `X-Forwarded-Host` behind a proxy), so keep `experimental.serverActions.allowedOrigins` empty unless the proxy rewrites the host. Action bodies are limited to 1 MB, so large uploads such as imports go through a route handler.

**Route handlers** are for responses a Server Action can't give: files (PDFs, exports), uploads and progress streams. Wrap them in `route()`, which also refuses cross-origin requests (403) and signed-out ones (401), and marks responses `Cache-Control: private, no-store` unless the handler sets its own.

```ts
// src/app/api/pdf/[id]/route.ts
import { route } from "@/lib/route";

export const GET = route<RouteContext<"/api/pdf/[id]">>(async (request, { params }) => {
  const { id } = await params;
  const pdf = await renderPdf(id);
  return new Response(pdf, { headers: { "content-type": "application/pdf" } });
});
```

Both get the session from `getSession()` in `src/lib/auth/session.ts` (see [Sign-in](#sign-in)).

## Sign-in

Dossier has one user and no accounts: you sign in with the password that `DOSSIER_PASSWORD` is a hash of. The session is an encrypted token (JWE, keyed from `DOSSIER_SECRET`) in an HttpOnly, SameSite=Lax cookie, so nothing is stored on the server. It lasts until the browser closes, but at most 24 hours; with "Keep me signed in", 30 days.

The hash is argon2id with OWASP's settings (19 MiB, 2 passes, 1 lane) from Node's own `crypto.argon2`, made by `docker/bin/yarn hash-password` (`scripts/hash-password.ts`, which the image bundles as the `hash-password` command). Checking a password against it is in `src/lib/auth/password-hash.ts`, and `src/lib/env.ts` refuses anything that isn't a hash. It's written as `argon2id:m=19456,t=2,p=1:<salt>:<hash>` rather than the usual `$argon2id$v=19$…`, because Next.js and Docker Compose expand `$` in `.env` files, even inside quotes. The settings are part of each hash, so stronger ones can come later without breaking existing hashes.

Sign out from the sidebar ends the session in that browser. To sign out everywhere, set `DOSSIER_PASSWORD` to a new hash (even of the same password, since each has its own salt) or rotate `DOSSIER_SECRET` and restart: every session carries a fingerprint of the password and is encrypted with a key from the secret, so all existing sessions stop working. Rotating the secret also means API keys saved in Settings have to be entered again, since they're encrypted with it too.

In server code, `getSession()` returns the session or null, and `verifySession()` (for pages and layouts) sends the visitor to `/login` when there is none. `action()` and `route()` already check it.

Failed sign-ins are rate-limited in Postgres: after 5 failures within a minute from one IP, attempts are refused for 30 seconds, then 60, 120 and so on up to 15 minutes. The IP is the last `X-Forwarded-For` entry, which is the real client behind a reverse proxy but can be faked when the app is exposed directly, so 30 failures within 10 minutes from all IPs together also trigger the backoff. If you lock yourself out while developing, clear the counters with `docker compose exec db psql -U postgres -d dossier -c 'DELETE FROM "LoginThrottle"'`.

## AI provider

Dossier reads job postings and writes drafts with the model you choose in Settings → AI provider: a local model through Ollama or llama.cpp, any OpenAI-compatible server, or Anthropic. Until you save a choice there, the `DOSSIER_AI_*` variables decide (see `.env.example`). API keys are stored encrypted with a key derived from `DOSSIER_SECRET`, and never sent back to the browser.

Long AI tasks run as background jobs (`src/lib/jobs`): the page follows their named steps as they happen and picks them up again after a reload. A job's input and result hold personal data, so they don't last: a job that works on an application names it (`startJob(…, { applicationId })`) and is deleted with it, and finished jobs are deleted once they're older than **Keep task data for** in Settings → Your data (`src/lib/jobs/retention.ts`). Keep nothing in a job that has to outlast that; Undo on a toast and a page reattaching after a reload are fine. The prompts live in `src/lib/ai/tasks`; in strict mode ("Never invent experience", on by default) a fact guard flags names and numbers that aren't in the profile or the posting.

To try the AI features without a hosted provider, run a small model in Docker:

```bash
docker compose up -d ollama
docker compose exec ollama ollama pull qwen2.5:3b   # about 2 GB
```

Then pick Local model in Settings with the address `http://ollama:11434` (inside Docker, `localhost` is the app's own container). The Ollama image takes about 9 GB of disk, and a 3B model about 3 GB of memory while it runs; `docker compose stop ollama` when you're done.

The tests use a mock provider. To check the providers and prompts against real models, run the live tests, which are skipped otherwise:

```bash
docker compose exec -e AI_LIVE=ollama app yarn vitest run src/lib/ai/providers.live.test.ts src/lib/ai/tasks/tasks.live.test.ts
```

## Job search

Find jobs (`/jobs`) searches the job source chosen in Settings → Job search: JSearch, Adzuna or the Bundesagentur für Arbeit. Until a choice is saved, `DOSSIER_JOBS_SOURCE` and the key variables decide (see `.env.example`). In the code, "job" already means a background task (`Job`, `src/lib/jobs`), so a job ad is a "posting", and job search lives in `src/lib/job-search`:

- `search.ts` and `sources.ts`: the query and posting shapes every source maps to, the URL format, and what each source covers. Shared with the browser.
- One adapter per source (`jsearch.ts`, `adzuna.ts`, `arbeitsagentur.ts`), behind `index.ts`, which checks the country, caches answers in memory for 30 minutes and logs a source that changed or isn't answering, without the search. Failures are a `JobSearchError` with a message for the screen.
- `config.ts`: which source and key are in effect. Job source keys are encrypted like the AI key, each kind of secret under its own derived key (`src/lib/secrets.ts`).
- `src/lib/postings.ts`: the `Posting` table holds what the user saved, dismissed or started an application from. `src/lib/posting-searches.ts`: every search, kept with what it found (`PostingSearch`) until the user removes it, so opening one again asks the source nothing.

The tests use answers in each source's shape (`src/test/job-search-fixtures.ts`). The live tests check the real services, and are skipped otherwise. JSearch and Adzuna spend searches from your plan; the Arbeitsagentur is free:

```bash
docker compose exec -e JOBS_LIVE=jsearch -e JSEARCH_TEST_KEY=… app yarn vitest run src/lib/job-search/jsearch.live.test.ts
docker compose exec -e JOBS_LIVE=arbeitsagentur app yarn vitest run src/lib/job-search/sources.live.test.ts
docker compose exec -e JOBS_LIVE=adzuna -e ADZUNA_TEST_APP_ID=… -e ADZUNA_TEST_KEY=… app yarn vitest run src/lib/job-search/sources.live.test.ts
```

## Your data

Settings → Your data exports everything (profile, custom themes, settings, applications with their history, documents, chat and notes, and the postings kept from Find jobs) as one JSON file, and imports such a file to restore it. An import replaces all data in one transaction, after writing a backup of the current data to `DOSSIER_DATA_DIR/backups` (default `/data`; `./data` in development, which git ignores). "Download all PDFs" zips every tailored document there too, in `downloads`, and removes the zip once it's downloaded.

With "Nightly backups" on (the default), the app writes the same export to `backups` every night at 03:00 server time and deletes backups older than `DOSSIER_BACKUP_RETENTION_DAYS` (14 by default). The timer runs inside the app process, so run a single instance of the app. These are the app's own backups: back up the PostgreSQL database itself too, the way your host does it (for example `pg_dump` on a schedule).

### Import size limit

Import files are capped at 10 MB, roughly 500 applications. The limit comes from Next.js, which buffers request bodies up to [`experimental.proxyClientMaxBodySize`](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize) (10 MB by default) because `src/proxy.ts` runs on every request; larger bodies are cut off, so the app refuses them up front. To accept bigger files, raise that option in `next.config.ts` and `IMPORT_MAX_BYTES` in `src/lib/import-limits.ts`. Behind a reverse proxy, its own limit applies as well: with nginx, raise `client_max_body_size` (see Troubleshooting in the README).

## Usage ping

On each day someone signed in opens a page, a production server sends `https://telemetry.dossier.aien.me/ping` the install's random ID and the version, once (`src/lib/usage-ping.ts`, called with `after()` from the signed-in layout). The ID and the day of the last ping are the settings `usagePingId` and `usagePingDay`: exports leave them out and imports keep them (`INSTALL_SETTINGS` in `src/lib/data-export.ts`). Development servers and tests never send it (`NODE_ENV` isn't `production`), and the end-to-end run sets `DOSSIER_TELEMETRY=off`, since it runs a production build.

The receiving end is a Cloudflare Worker that isn't published with the app. Change what the ping sends only together with it, the README's Privacy section and Settings → About.

## Tests and checks

Tests use [Vitest](https://vitest.dev) and run inside the container like everything else:

```bash
docker/bin/yarn test          # run all tests once
docker/bin/yarn test:watch    # re-run tests on change
docker/bin/yarn test:coverage # run once with coverage (report in coverage/index.html)
docker/bin/yarn lint
docker/bin/yarn typecheck     # generates Next.js route types, then runs tsc
```

Put tests next to the code they cover. `*.test.ts` files run in Node (server code, pure logic);
`*.test.tsx` files run in jsdom with [Testing Library](https://testing-library.com) and its `jest-dom` matchers (components and hooks).
`*.db.test.ts` files run against a real Postgres database: `dossier_test` on the same server (or `TEST_DATABASE_URL`), which is created and migrated at the start of each run, and which each test empties with `resetDatabase()` from `src/test/db.ts`.
They refuse to run against a database whose name doesn't end in `_test`, so your development data is never touched.

GitHub Actions (`.github/workflows/ci.yml`) runs lint, type-check and tests with coverage, with a Postgres service for the database tests, on every pull request and push to `main`, and shows the coverage in the job summary. A newer push to the same branch or pull request cancels the run it replaces. On `main`, a pull request's merge commit isn't checked a second time when it holds exactly the code its pull request's run checked (the branch was up to date with `main`); every other push to `main` is. The coverage thresholds in `vitest.config.mts` ratchet: they sit a few points below the coverage when they were set, and CI fails if coverage drops below them. Raise them when you add tests.

### End-to-end tests

[Playwright](https://playwright.dev) tests in `e2e/` click through the main flows in headless Chromium: signing in, the profile, the theme builder and PDFs, finding a job and applying from it, a new application, refining and undoing, the application email, the board and table, the dashboard, and export, delete and import. `e2e/accessibility.spec.ts` runs [axe](https://github.com/dequelabs/axe-core) on every screen and its open menus and dialogs (no serious or critical WCAG 2.2 AA violations allowed) and checks where keyboard focus goes. They run against a production build, on the standalone server the image uses, so build first:

```bash
docker/bin/yarn build && docker/bin/yarn test:e2e
```

The run starts its own server on port 3100 with a separate `dossier_e2e` database (created and migrated on the way, reset to the demo data before the specs that change data), a fake OpenAI-compatible server on port 3999 (`e2e/fake-ai.mts`) that answers each AI task with plausible output, fake job sources on port 3998 (`e2e/fake-jobs.mts`), which the app reaches through `DOSSIER_JOBS_TEST_BASE_URL`, a variable for the tests only, and a fake Google on port 3997 (`e2e/fake-google.mts`) for sign-in, Gmail and Calendar (`DOSSIER_GOOGLE_TEST_BASE_URL`), which only comes into play once a spec enters an OAuth client in Settings → Google. The daily update check asks the same fake instead of GitHub (`DOSSIER_UPDATES_TEST_BASE_URL`), which says no release is out, so a spec can store the latest release itself. Your development server and data are never touched: the tests refuse any database whose name doesn't end in `_e2e`. CI runs them in a job of their own and keeps the report of a failed run as an artifact.

## The production image

The `Dockerfile`'s last stage is the production image (the `dev` stage is what Compose runs here). It holds the standalone Next.js server, Playwright's Chromium for PDFs, and Prisma's CLI for migrations, runs as `node`, and starts with `docker/start.sh`: `prisma migrate deploy`, the seed (compiled with esbuild at build time), then the server. To build and try it next to the development stack:

```bash
docker build -t dossier:local .
DOSSIER_IMAGE=dossier:local DOSSIER_PORT=3300 docker compose -f compose.production.yml -p dossier-local up -d
```

CI pushes an image for every commit on `main` to `ghcr.io/<owner>/<repository>:<sha>` (lower case), once the checks and the end-to-end tests pass, on `main` or in the commit's pull request. A version tag (`v1.0.0`) then tags that commit's image with the version and `latest`.

## Reset

```bash
docker compose down -v   # stops everything and deletes the database and node_modules volumes
```
