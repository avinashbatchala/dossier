# AGENTS.md

Dossier is a self-hosted, single-user job-search app: Next.js 16 App Router, React 19, Prisma 7 + PostgreSQL 18, Tailwind v4, Yarn 4. `DEVELOPMENT.md` is the detailed engineering guide; `README.md` is the operator guide; `INFRASTRUCTURE.md` is the AWS/Lightsail operations runbook. Read the relevant section before changing behavior.

## Bootstrap and Docker

- There is no committed `.env` and no host `node_modules`. The supported workflow runs everything in Docker.
- First run:

  ```bash
  cp .env.example .env
  docker compose build
  docker/bin/yarn hash-password   # put the output in DOSSIER_PASSWORD
  # set DOSSIER_SECRET to 32+ random characters
  docker compose up
  ```

- `DOSSIER_PASSWORD` must be the `argon2id:...` hash, never the password itself. The server refuses to start on missing/short secrets or invalid config.
- `docker/bin/yarn <script>` runs Yarn in the running `app` container, or a one-off one if it is stopped. Do not run `yarn`, `next`, `vitest`, or `playwright` on the host.
- The dev `app` container runs `prisma generate`, `prisma migrate deploy`, `prisma db seed`, then `next dev` on every start. Logs: `docker compose logs -f app`. Health: `GET /api/health`.
- After pulling changes to `yarn.lock`, run `docker/bin/yarn install`.
- Never run `docker compose down -v` unless the user asks: it deletes the Postgres and `node_modules` volumes.

## Commands

```bash
docker/bin/yarn lint
docker/bin/yarn typecheck        # runs `next typegen`, then tsc
docker/bin/yarn test [path]      # all Vitest projects; pass a file or `-t "name"`
docker/bin/yarn test:coverage    # enforces the thresholds in vitest.config.mts
docker/bin/yarn build && docker/bin/yarn test:e2e [spec]
```

Run lint, typecheck, and tests before finishing. CI runs `prisma generate`, then lint → typecheck → test:coverage, and e2e in a separate job.

`typecheck` generates Next's route types. Pages use generated `LayoutProps`/`RouteContext` types, so run it after adding or renaming routes.

## Tests

- Tests sit next to the code they cover. The extension selects the Vitest project:
  - `*.test.ts` — Node (server code, pure logic)
  - `*.test.tsx` — jsdom with Testing Library
  - `*.db.test.ts` — real PostgreSQL; files run serially and each test calls `resetDatabase()` from `src/test/db.ts`
- Database tests create and migrate `dossier_test` (or `TEST_DATABASE_URL`); e2e uses `dossier_e2e` (or `E2E_DATABASE_URL`). Both harnesses refuse database names that do not end in `_test` / `_e2e`; do not bypass that guard.
- `test:coverage` fails below the ratcheting thresholds in `vitest.config.mts`. Raise them when coverage improves; never lower them.
- E2E always needs a fresh `docker/bin/yarn build`: it serves `.next/standalone` on port 3100 with its own database, fake AI server (`e2e/fake-ai.mts`), and fake job sources (`e2e/fake-jobs.mts`). It resets to demo data before specs that mutate data.
- Live AI/job-source tests are skipped unless `AI_LIVE` / `JOBS_LIVE` is set. The normal suite uses fakes; see `DEVELOPMENT.md` for the live commands.

## Data and Prisma

- Schema: `prisma/schema.prisma`. Prisma config: `prisma7.config.ts` (not `prisma.config.ts`); the seed command is configured there.
- The Prisma client is generated into gitignored `src/generated/prisma`. Import from `@/generated/prisma/client` or `@/generated/prisma/enums`, not `@prisma/client`.
- After schema edits, create/apply a migration and restart the app:

  ```bash
  docker/bin/yarn prisma migrate dev --name <name>
  docker compose restart app
  ```

  Prisma 7's `migrate dev` no longer runs `prisma generate`; the restart does it and picks up the new client.

- Use the shared client from `@/lib/prisma`; do not construct `PrismaClient` in app code.
- Seed behavior: built-in themes, empty profile, and defaults on every start. `prisma db seed -- --demo` adds Jane Doe sample data; add `--reset` to replace an existing profile and applications.
- JSON columns (extracted posting, match, document units, chat edits) are validated with the zod schemas in `src/lib/application-data.ts`.
- Profile basics and settings are key-value tables (`ProfileField`, `Setting`). Add typed keys in `src/lib/profile.ts` / `src/lib/settings.ts`; new fields usually need no migration.
- Change application status only through `setStatus` in `src/lib/status-actions.ts` or `changeStatus()` in client code. The status module owns `furthestStage` and `sentAt`; direct writes break funnel figures.
- Built-in themes are seeded, read-only, and keyed by slug; do not edit or delete them in app code.

## Server conventions

- Application config comes from `env` in `@/lib/env`, not `process.env`. `process.env` is only for `NODE_ENV` and test-harness variables.
- Server Actions are the default mutation path: define them with `action(schema, handler)` in a `"use server"` file. Input is zod-validated and the result is `{ ok: true, data, toast? } | { ok: false, error, fieldErrors? }`. Throw `ActionError` for a message the user should see.
- On the client, pass the result through `toastResult()` from `@/components/toast`.
- Route handlers are for files, uploads, and progress streams; wrap them in `route()` from `@/lib/route`, which enforces same-origin plus a session. Server Action bodies are limited to 1 MB, so large uploads need a route handler.
- Auth: `verifySession()` in pages/layouts redirects signed-out visitors; `getSession()` returns null when signed out. `action()` and `route()` already check the session.
- `publicAction()` is only for actions that must work signed out (for example sign-in); it must not return private data.

## Architecture and naming

- `src/app/(app)/` — signed-in shell; `src/app/api/` — route handlers; `src/app/print/` — PDF print views; `src/app/dev/` — development-only screens that 404 in production.
- `src/lib/` — domain logic; `src/lib/ai/` — providers, tasks, fact guard; `src/lib/job-search/` — job-source adapters; `src/lib/jobs/` — background job runner; `src/lib/pdf/` — PDF rendering.
- In this codebase a **job** is a background task. A job ad is a **posting** (`src/lib/postings.ts`, `Posting` model). Keep that vocabulary.
- Request middleware is `src/proxy.ts` (Next 16's proxy naming), not `middleware.ts`. It issues a per-request CSP nonce and does the optimistic login redirect.
- The CSP forbids third-party origins and inline scripts without the nonce. The root layout calls `connection()` so pages render per request; do not assume static rendering.
- Startup work (env validation, interrupted-job recovery, nightly backup timer) lives in `src/instrumentation.ts`.
- The app is single-user and single-instance by design: background jobs, backups, and the PDF Chromium run in-process. Do not add multi-replica assumptions.

## UI and accessibility

- Tailwind v4 is configured CSS-first in `src/app/globals.css` through `@theme`; there is no `tailwind.config.*`. Prefer the semantic token utilities (`bg-card`, `text-muted`, `rounded-card`, …) over raw colors.
- `e2e/accessibility.spec.ts` runs axe on every screen and its open menus/dialogs, and checks keyboard focus. New UI must avoid serious/critical WCAG 2.2 AA violations.
- Import files are capped at 10 MB by Next's `experimental.proxyClientMaxBodySize` (default) and `IMPORT_MAX_BYTES` in `src/lib/import-limits.ts`. To raise the cap, set the option in `next.config.ts` and raise `IMPORT_MAX_BYTES` too.

When a change affects setup, commands, environment variables, or user-facing behavior, update `DEVELOPMENT.md`/`README.md` in the same change.
