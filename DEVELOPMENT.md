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

### Profiles

A user has one or more profiles (E24), each a resume of its own. `Profile` holds a profile's name, headline, summary and its own settings (`settings`, read by `src/lib/profile-settings.ts`: the Base resume's theme, sections and headings, language and Fit to one page, and the order of its entries), and every section table (`Skill`, `Experience`, `Project`, `Education`, `Certification`, `Publication`, `Reference`, `CustomSection`) has a `profileId`. The other basics (`ProfileField`), the languages and the facts about me are shared by every profile. A skill's name is unique in its profile. Each custom section says what it counts as (`countsAs`: Work experience, Education or Extra activities, the default); an entries section that counts as Work experience adds its dates to the years of experience (`experienceMonths()`), and volunteering never does.

There is always at least one profile: `firstProfileId()` in `src/lib/profiles.ts` makes one when there's none, and the first (lowest `sort`, then oldest) is the one used wherever none is chosen. `loadProfile(profileId)` and `loadProfileSettings(profileId)` read one profile, the first when the id is missing or gone. Profile and Base resume open the profile in `?profile=`, or else the one last opened (`openProfileId()`, setting `openProfileId`), with a switcher at the top (`profile-switcher.tsx`) to open another, make one (empty, a copy made by `copyProfile()`, or empty and then read from a resume file), rename or delete it; the last one can't be deleted. Their links keep `?profile=`, so another tab can't change which profile a page saves to, and their actions say which profile they add to, order or change (`useProfileId()`); changes to an entry go by its id. The Base resume prints and downloads with `?profile=` too (`printBasePath(fit, profileId)`). Each profile has the levels it's for (`levelFrom`, `levelTo`, over the search's steps, `src/lib/profile-levels.ts`), chosen by the user, in the New profile form for an empty one, or by Guess with AI (the `guess-levels` task) or the resume import's guess, which the user confirms. Until a profile has them, the Profile page asks for them and scoring against it waits (`levelsProblem()`: Score, New application's score, the score jobs and the job agent); nothing guesses a level while scoring. Each profile also says where it wants to work (`workplace`, `src/lib/profile-workplace.ts`): the ways of working it takes, how far from the shared address's city and which other places, remote for employers where, and moving. It's stored, starting at the defaults (on-site and hybrid within 50 km, remote in the country, not moving), and the Profile page asks the user to check it until they've opened it once (`workplaceSeenAt`). Database tests start with one empty profile, `TEST_PROFILE_ID` in `src/test/db.ts`, as a migrated database does.

Everything that reads the profile knows which one (E24-6). An application keeps the profile it was made from (`Application.profileId`, null once that profile is deleted; `applicationProfileId()` reads the first then): New application asks which one when there are several (the last one opened to start with), and the reading, match, documents, refining, regenerating, scoring the resume, emails and replies, sections added later and the frozen copy of a sent application all read that one. An agent search has a profile too (`AgentSearch.profileId`; deleting a profile moves its searches to the first of the others): a new search starts with its levels as the Level range (`experience` to `experienceTo` in `SearchQuery`, `experienceRangeAskedFor()`), the shared city and country, its radius and Remote only when that's the only way it works (`profileSearchDefaults()`), which the user can change. The agent scores each posting with the profile of the first search that found it, and waits only for profiles without levels; its drafts use the profile of the search that first found the candidate. The connector's `get_profile`, `save_application` and `draft_application` take a `profile` by name or id, the first when there's none (`profileNamed()`), and New application's hand-off to Claude names the chosen one. Its `update_application` (public #116) changes a Draft's resume, cover letter or match in place, as a version of its own, checked against the application's own profile. Startups are matched against every profile and keep the best (`Startup.profileId`), and the screen names it when there are several.

### SQLite

Dossier also runs on an SQLite file, when `DATABASE_URL` is one (`file:/data/dossier.db`), for a single container without a database server. `src/lib/database.ts` picks the client, and `prisma7.config.ts` the schema and migrations, from `DATABASE_URL`. The SQLite schema, `prisma/sqlite/schema.prisma`, is made from `prisma/schema.prisma`, which stays the only one to edit. After changing it, update the SQLite schema and make its migration too:

```bash
docker/bin/yarn sqlite-schema
docker/bin/yarn prisma migrate dev --name <migration-name>                                                   # PostgreSQL
docker compose exec -e DATABASE_URL=file:/app/data/dev.db app yarn prisma migrate dev --name <migration-name> # SQLite
```

`yarn generate` makes both clients (the container does it on start). The code uses the PostgreSQL client's types for both, so keep to what both databases do:

- No `skipDuplicates` (SQLite doesn't have it) and no `SELECT … FOR UPDATE`: lock a row with a write that changes nothing, `UPDATE "Application" SET id = id WHERE id = …`, which works in both.
- Inside `prisma.$transaction(async (tx) => …)`, query through `tx` only. SQLite has one connection, so a query through `prisma` waits until the transaction ends, and the transaction times out.
- SQLite sorts enums by name, PostgreSQL in the order they're declared.
- What Prisma doesn't manage is added to both migrations by hand: the built-in themes' delete trigger, and `COLLATE NOCASE` for the unique Skill and Language names (citext in PostgreSQL). SQLite's NOCASE only ignores the case of ASCII letters.
- SQLite can't change most columns in place, so for those Prisma's migration rebuilds the table: it creates `new_<Table>`, copies the rows, drops the old table and renames the new one. That drops the trigger (on Theme) and `COLLATE NOCASE` (on Skill and Language) too. When a migration rebuilds one of these tables, add them back by hand: `COLLATE NOCASE` in its `CREATE TABLE`, and the trigger after the rename, as in `prisma/sqlite/migrations/20261102120000_init/migration.sql`. The database tests on SQLite fail when one is missing.
- `yarn lint` refuses `skipDuplicates`, and a test checks that the SQLite migrations make exactly the SQLite schema.

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

Dossier reads job postings and writes drafts with the model you choose in Settings → AI provider: a local model through Ollama or llama.cpp, LM Studio, any OpenAI-compatible server, Anthropic or Mistral. Until you save a choice there, the `DOSSIER_AI_*` variables decide (see `.env.example`). API keys are stored encrypted with a key derived from `DOSSIER_SECRET`, and never sent back to the browser.

A server that speaks OpenAI's API with a difference (an address people tend to get wrong, a header it requires, a field every request needs) doesn't need a provider of its own: give it an entry in `src/lib/ai/providers/servers.ts` and a case in `servers.test.ts`. DeepSeek, OpenRouter and OpenCode are there already.

Long AI tasks run as background jobs (`src/lib/jobs`): the page follows their named steps as they happen and picks them up again after a reload. A job's input and result hold personal data, so they don't last: a job that works on an application names it (`startJob(…, { applicationId })`) and is deleted with it, and finished jobs are deleted once they're older than **Keep task data for** in Settings → Your data (`src/lib/jobs/retention.ts`). Keep nothing in a job that has to outlast that; Undo on a toast and a page reattaching after a reload are fine. The prompts live in `src/lib/ai/tasks`; in strict mode ("Never invent experience", on by default) a fact guard flags names and numbers that aren't in the profile or the posting.

The Usage screen shows the tokens each task used, as the servers counted them. Every request names its task (`task`, one of `USAGE_TASKS` in `src/lib/usage.ts`, where a new task gets its label), and a provider passes each answer's counts to `call.used`, null where the server sends none. That includes answers it asks again and answers that end in an error, since those used tokens too. Nothing of the prompt or the answer is kept.

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

`AI_LIVE=mistral` checks Mistral instead, with the key saved in Settings → AI provider while Mistral is chosen there, or with `DOSSIER_AI_KEY` (and `DOSSIER_AI_MODEL`) passed with `-e`.

`AI_LIVE=anthropic` checks Anthropic in `providers.live.test.ts` the same way, with the key saved while Anthropic is chosen, or with `-e DOSSIER_AI_KEY=…` (and `DOSSIER_AI_MODEL`, by default `claude-haiku-4-5`). Besides the provider checks, it imports a profile from a short resume: the profile's schema is too large for the API's structured output, so it goes in the prompt instead (#230).

`AI_LIVE=lmstudio` checks LM Studio, with the model saved in Settings while LM Studio is chosen there, or with `-e DOSSIER_AI_MODEL=…` (and `DOSSIER_AI_URL`, by default `http://host.docker.internal:1234`). A model that isn't loaded gets loaded and stays loaded until you eject it.

## Job search

Positions (`/jobs`) searches every portal switched on in Settings → Job search that lists jobs in the search's country, four at a time, in the background. Until Settings is saved, `DOSSIER_JOBS_SOURCE` and the key variables decide (see `.env.example`). In the code, "job" already means a background task (`Job`, `src/lib/jobs`), so a job ad is a "posting", and job search lives in `src/lib/job-search` and `src/lib/portals`:

- `src/lib/job-search/search.ts` and `sources.ts`: the query and posting shapes every portal maps to, the library's filters, the URL format, and what each portal covers. Shared with the browser.
- `src/lib/job-search/config.ts`: which portals are on and their fields (setting `portals`), each portal's secrets encrypted on their own (`portalKeysEnc`), so a key only ever goes to its portal; the built-ins' `DOSSIER_*` variables are mapped here, since configs never name environment variables.
- `src/lib/posting-searches.ts`: a search, kept until the user removes it, with each portal's state (`PostingSearch.portals`); `runPortals` asks them, and the `portal-search` job runs it in the background. `src/lib/library.ts`: Positions, every posting once (`Posting`), which search found it on which portal (`PostingFind`), and its filters. `src/lib/dedupe.ts`: the same job from several portals, merged in layers (`Posting.mergedIntoId`). `src/lib/archive.ts`: untouched postings move to the Archive. The job agent's runs are searches too (`PostingSearch.agentSearchId`).

### Portal configs

Every portal is a config, read by one engine in `src/lib/portals` (E22): the four built-ins are `src/lib/portals/built-in/*.json`. A config is data, never code, and may only reach the hosts it lists:

- `format.ts` is the format, checked with zod, and written as `portal-config.schema.json` by `yarn portal-schema` for editors. A config says its id, name and the countries and kinds of work it covers; its fields (a key, a choice, a server, a list); how to search (the request, from templates such as `{keywords}` or `{fields.key}`, where the postings are in the answer and how each value maps to a posting); how to page (cursor, page, offset or none); and how to get a posting's whole text (none, its page, or a request).
- A portal that can't be searched is read whole and matched on the server (`search.localFilter`: every word of the search in the title or company, the place unless it's remote, Remote only, Posted within, and the country the posting can be done from, read by `src/lib/job-search/regions.ts` from lines such as "USA only" or "LATAM, Europe"). `search.keepMinutes` keeps such an answer and shares one download between searches, as a feed's terms ask. `search.each` asks once for each entry of a list field, such as the companies' boards on Greenhouse, Lever and Ashby (`{each}` in its templates, a few at a time); a board that can't be read is skipped and named in the search's progress (`SearchPage.note`), and Test connection names it. `maxMegabytes` raises the 5 MB answer limit for a whole board.
- `engine.ts` turns a config, its fields and a search into requests and postings, follows redirects only to its hosts, and gives a `PortalAdapter` with `search`, `details` and `test`. `template.ts`, `values.ts`, `xml.ts` and `jobposting.ts` read templates, JSON values, feeds and schema.org JobPosting pages.

The catalog's configs, the built-ins included, are written and reviewed in the public [dossier-portals](https://github.com/AienTech/dossier-portals) repository (CC0), whose CONTRIBUTING.md has the catalog's rules. It's the built-ins' one source: before a release, `docker/bin/yarn portals-snapshot` copies their current configs into `src/lib/portals/built-in/`, checked against the format, for the release to bundle.

A portal the user adds (Settings → Job search → Add portal, E23-3) is kept as a pinned copy in `InstalledPortal` (`src/lib/portals/installed.ts`), shown first with every host it reaches, and read again at start, on every page (the layouts pass the plain facts to the browser through `PortalRegistry`) and whenever the job search config is read. Its ids are known to `isJobSource` and `sourceInfo` like the built-ins'; a built-in's id can't be taken. Its requests go through a connection that refuses private addresses (the posting fetcher's `guardedLookup`), unless a host is one the user or the tests named. To try your own config in the app, add it from a file there.

The catalog (E23) is read from the project's backend, `GET /v1/portals` (dossier-admin's `docs/api-v1.md`; its JSON Schema is copied in `src/lib/announcements/api-v1.schema.json`), by `src/lib/portals/catalog.ts`: anonymously, with an ETag, at most once a day after a page loads, and when Browse portals or the setup guide's Job search step opens (at most once a minute). The last answer is kept in `PortalCatalog`; an entry whose config this Dossier can't read is left out. Settings → Job search → Browse portals adds a reviewed portal with the same host preview as Add portal; a config added from a file or a link that's exactly a catalog entry counts as reviewed. `src/lib/portals/updates.ts` compares an installed portal, or a built-in, with the catalog's version: Update installs it, after the user approves any new host. A built-in's update is an `InstalledPortal` row with the built-in's id, used while it's newer than the bundled config. A portal the catalog withdraws is paused (`enabledPortals` and `credentialsFor` leave it out) until the user removes it or keeps it (setting `portalWithdrawalsKept`). The end-to-end tests' fake backend serves a catalog a spec sets (`fakeCatalog` in `e2e/support.ts`).

To try a config, copy the built-in closest to it (FreeHire for one without a key, Adzuna for one with), change it, and check it against the format and saved answers in a test, as `src/lib/portals/engine.test.ts` does with `src/lib/portals/samples.test-data.ts`. Check first that the portal's terms allow this use and what credit they ask for, as was done for Adzuna and the Bundesagentur für Arbeit (#223).

### Tests

The tests use saved answers in each portal's shape (`src/test/job-search-fixtures.ts`). The live test checks the real services, and is skipped unless `JOBS_LIVE` names portals by id, in any case. It uses the fields and key saved in Settings → Job search, or the built-ins' variables in `.env`, and saves nothing. A portal with a plan spends a search, the next page, a posting's details and the connection test:

```bash
docker compose exec -e JOBS_LIVE=freehire app yarn vitest run src/lib/portals/live.test.ts
docker compose exec -e JOBS_LIVE=jsearch,adzuna app yarn vitest run src/lib/portals/live.test.ts
```

With the app container stopped, `docker compose run --rm -T -e JOBS_LIVE=… app yarn vitest run src/lib/portals/live.test.ts` does the same.

## Scoring

Score in Positions, New application's score and the job agent go through one scoring engine (E25, `src/lib/scoring`). A scoring model judges six factors about one posting and one profile; Dossier adds the answers up. Nothing is judged in code: code only prepares inputs (the posting's lines, the years of paid work) and weighs the answers.

- **The questions** (`questions.ts`) are typed, the same for every model: for each line `posting-lines.ts` finds, a Choice (must-have, nice-to-have, or not a requirement) and a yes-or-no (does the profile show it); a Score each for work experience, extra activities and education, on levels whose meaning is written out; a Choice each for seniority (far below, below, fits, above, far above the profile's levels) and location (fits, a stretch, can't); and whether the posting is too thin to judge. `scoringState()` gives the model the profile grouped by the factor that reads it: paid roles and Work experience custom sections, extra activities (projects, volunteering, certifications, publications, Extra activities sections), education and Education sections, the levels and years, where the profile wants to work. Items kept off resumes count; names, contact details, references and links are never sent.
- **Adding up** (`factors.ts`, client-safe): weights 35 requirements, 25 work, 15 seniority, 10 location, 10 education, 5 extra, over the factors that could be judged (Requirements drops out when the posting lists none). A must-have counts three times a nice-to-have. Caps: one must-have missing 69, two or more 49, a seniority gap of two steps either way 69, a location the profile can't take 49, a thin posting 60; the lowest that holds wins, and the breakdown names it only when it lowered the score. `fitFromAnswers()` in `src/lib/fit.ts` gives the score, the breakdown (`PostingScore.breakdown`) and the breakdown as plain reasons and red flags for stores that keep lines (the agent's drafts). `FitDetails` shows one line per factor, requirements first, and the cap. Scores from before the engine have no breakdown and say so (`isOlderScore()`).
- **The scoring models** are one list: their names, keys, privacy notes and Usage rows in `scorers.ts` (client-safe), how each scores, why it can't and its connection test in `models.ts`, keys in `config.ts` (each encrypted for it only, never exported, kept on import: `SCORER_KEY_SETTINGS`). Adding one is an entry in both. The AI model answers the questions as JSON with a reason per factor (`score-posting@3`); decision models answer them as typed questions and each factor's line says what its level means (`answersFromTyped()`). Jev (`jev.ts`, TypeSafe's System One, through `typesafe.ts`, which retries 429 and 529) is one. Until a choice is saved, `DOSSIER_SCORER` and the models' key variables decide. Scoring needs the profile's levels: `loadScoringProfile()` fails while they aren't chosen.

A posting keeps a score for each profile it was scored against (E25-5: `PostingScore` is keyed by source, external id and profile; deleting a profile deletes its scores). `postingStates()` gives each posting its scores in the profiles' order and the best of them (`bestFit()`), named by profile only when there are several. Positions' Score asks which profile when there are several, or all of them (`scorePostingJob` skips those without levels), the card shows the best with its profile, and the library's Fits filter (`fits` in the URL) makes the Score filter and the order go by one profile's score. An agent search scores against its profile, or every profile with `allProfiles` (the cap counts postings; the candidate keeps the best score, and its draft uses the profile that scored best). New application from a posting starts on the profile that scored it best.

How you match comes from the engine too (E25-7): reading a posting (`readPostingJob`) has the AI model pick out its details, then scores it against the chosen profile, and the score's requirements are the match (`matchFromRequirements()`: covered with what covers it, or a gap, a must-have or a nice-to-have, and the skill "+ Add to profile" adds, which only the AI model names). A Positions posting already scored against that profile reuses its answers (`scored` in the job's input), and one scored now keeps its score there. Matches from before keep their covered, partly covered and gap rows. `match-requirements` is gone; its Usage row stays for the requests it made.

Two more scoring models are on the list (E25-3, E25-4). **OpenAI Decisions** (`decisions.ts`, adapted from MichaelDanCurtis's experimental adapter, public issue 105) asks `POST /v1/decisions` with `gpt-6-luna`: the engine's Nouls become predicates, Choices choices and Scores scores, the profile goes as `input_json`, and its answers are checked before the engine reads them (a refusal, a missing or second answer, an unknown choice or a score out of range fails). **OpenRouter** scores with `score-posting@3` through an OpenAI-compatible provider at openrouter.ai with its own key and model (`openrouterScoringModel`, `openai/gpt-6-luna` by default); the servers registry asks it for `data_collection: "deny"`, and its tokens go on their own Usage row. Their keys are saved in Settings only (`decisionsKeyEnc`, `openrouterScoringKeyEnc`, each encrypted for its model); `DOSSIER_SCORER` takes `openai-decisions` and `openrouter`. Their live tests score two postings against the demo profile with the keys saved in Settings, and spend a little on those accounts:

```bash
docker compose exec -e SCORING_LIVE=openai-decisions app yarn vitest run src/lib/scoring/models.live.test.ts
docker compose exec -e SCORING_LIVE=openrouter app yarn vitest run src/lib/scoring/models.live.test.ts
```

The live test asks the real Jev with the key saved in Settings → Scoring, or `DOSSIER_TYPESAFE_KEY`, and spends tokens on that account. It scores two postings against the demo profile, one it fits and one it doesn't:

```bash
docker compose exec -e JEV_LIVE=check app yarn vitest run src/lib/scoring/jev.live.test.ts
```

## Your data

Settings → Your data exports everything (profile, custom themes, settings, applications with their history, documents, chat and notes, and Positions with its searches) as one JSON file, and imports such a file to restore it. An import replaces all data in one transaction, after writing a backup of the current data to `DOSSIER_DATA_DIR/backups` (default `/data`; `./data` in development, which git ignores). "Download all PDFs" zips every tailored document there too, in `downloads`, and removes the zip once it's downloaded.

With "Nightly backups" on (the default), the app writes the same export to `backups` every night at 03:00 server time and deletes backups older than `DOSSIER_BACKUP_RETENTION_DAYS` (14 by default). The timer runs inside the app process, so run a single instance of the app. These are the app's own backups: back up the PostgreSQL database itself too, the way your host does it (for example `pg_dump` on a schedule), or the SQLite file: stop the app and copy the file.

### Import size limit

Import files are capped at 10 MB, roughly 500 applications. The limit comes from Next.js, which buffers request bodies up to [`experimental.proxyClientMaxBodySize`](https://nextjs.org/docs/app/api-reference/config/next-config-js/proxyClientMaxBodySize) (10 MB by default) because `src/proxy.ts` runs on every request; larger bodies are cut off, so the app refuses them up front. To accept bigger files, raise that option in `next.config.ts` and `IMPORT_MAX_BYTES` in `src/lib/import-limits.ts`. Behind a reverse proxy, its own limit applies as well: with nginx, raise `client_max_body_size` (see [Troubleshooting](https://github.com/AienTech/dossier/wiki/Troubleshooting) in the wiki).

## Job agent

The job agent (`src/lib/agent`, the `/agent` screen and Settings → Job agent) runs up to three named recurring searches on one shared daily schedule, scores what's new and can prepare drafts. Disabled searches count toward the three-search storage cap but consume no source requests:

- **`agent-scan`** (`run.ts`, defined in `jobs.ts` with the key `agent`): one batch, protected by a PostgreSQL session advisory lock (on SQLite, one process on one file, a lock held in the process; `scan-lock.ts`). The other agent locks are transaction advisory locks through `lockForTransaction()` (`src/lib/db-lock.ts`), which does nothing on SQLite, where transactions already run one at a time. It snapshots all enabled searches and the portals switched on, and runs each search in saved order as a search of its own (`PostingSearch.agentSearchId`, with the search's name then): `runPortals()` asks every portal that covers its country for its first page, four at a time, never the Bundesagentur für Arbeit, and what they find lands in Positions, "Found by the agent". One portal's failure doesn't stop the rest. It drops what Positions has saved, dismissed, applied for or archived and what the agent has seen (`newPostings()`, by source and id or by `agentDedupeKey()`, a hash of the link without tracking parameters, else of company, title and place); a posting scored before keeps its score without asking the AI. Unique new postings are scored round-robin across searches, newest first within each, with one shared score cap and automatic-draft cap, not one cap per search.
  Scoring uses the provider chosen in Settings → Scoring (`src/lib/scoring`, see [Scoring](#scoring)).
- **`agent-draft`** (`draft.ts`, keyed `agent-candidate:<id>`): one draft. The candidate is claimed (SCORED → DRAFTING → DRAFTED) so nothing makes two, and the documents are written by `createApplicationFromDocuments()` in `src/lib/application-create.ts`, which New application uses too. The draft is `origin: AGENT` with `awaitingReview` set, which keeps it off Applications, the board, the dashboard, the inbox and Positions until Approve. Positions has Prepare draft on a posting the agent scored, and the Agent screen keeps the drafts to review.
- **Limits** (`runs.ts`): the durable `agentRuns` ledger counts source requests, not batches or Job rows (which the task-data sweep deletes). At most **3 requests to each portal in any rolling 24 hours** (E22-8), including attempted failures; each slot names its portal (`sourceRequestPortals`), and one from before counts against every portal. Admission reserves a slot for every search on every portal it asks, atomically; a batch waits when a portal lacks room, rather than running a subset. Dispatch timestamps move slots to actual attempt time. Interrupted scans conservatively keep every reserved slot, even if not sent, because dispatch and persistence cannot be atomic; reconciliation marks their outcome interrupted. Manual runs also wait at least an hour after the previous run. AI evaluation and drafts use the shared `agentMaxScores` and `agentMaxDrafts` limits.
- **Schedule** (`schedule.ts`): a timer in the process, like the nightly backups, that checks every 15 minutes and starts the day's batch after `agentHour` in `lastKnownTimeZone()`, with an additional wake at quota expiry. Budget deferral can shift the effective daily run time until the whole batch fits. Run one app instance. At startup, candidates left DRAFTING go back to SCORED.

Recurring searches are stored in `AgentSearch`, through `src/lib/agent/searches.ts` (`listAgentSearches`, `saveAgentSearch`, `deleteAgentSearch`). `src/lib/agent/search.ts` shares the normalized input schema and fixed cap of three with forms. Settings uses authenticated Server Actions for create/edit/reorder/toggle/delete; execution reads the collection directly, with no legacy settings bridge. Toggles patch only `enabled` by ID under the shared search-write lock and validate the current query's country when enabling, so a stale tab cannot overwrite another tab's name, query or order. Explicit editor saves still replace the submitted form values; they are not a general edit-conflict merge. Writes and imports serialize the cap check with a transaction advisory lock; disabled searches count too. Attribution takes the same lock before reading, so imports and wipes cannot remove its foreign-key targets mid-write. `AgentCandidateSearch` links only kept candidates, with immutable name snapshots and a nullable search link, so renaming or deleting a search doesn't rewrite history. Deleting a search leaves candidates, applications and historical labels intact; deleting a candidate cascades its attribution. Candidate dismissal takes the same lock and deletes its attribution, including deleted-search labels. Undo restores the candidate's content, not its old labels. `attributeAgentCandidates()` checks eligibility through its transaction and links source results to existing candidates, including overlaps, without storing raw result pages. Later independent saves or dismissals in Positions do not erase historical candidate labels.

Backup/export schema **11** includes `agentSearches` and `agentCandidateSearches`, with stable IDs, query/order/enabled state and historical labels (including deleted-search labels). Imports of schemas 1–10 convert a meaningful `agentQuery` setting to “My search”, repairing optional fields just like SQL, without inventing past attribution. SQL performs that conversion during an upgrade and removes the setting; v8 imports ignore `agentQuery`. Provider credentials remain global and excluded unless explicitly requested on export. The `agentRuns` ledger is installation-local, excluded from exports and preserved across imports so a restore cannot reset quota. Delete everything removes it with searches, candidates and attribution.

Per-search history reports **source collection**, not successful AI evaluation: found/new counts can overlap between searches and precede batch dedupe/scoring. A completed source request can coexist with model failure; its batch outcome is shown separately. Candidate attribution retains historical names after search rename/delete, but candidate dismissal removes it. Rendering is read-only: it shows interrupted reservations when no queued/live scan owns them, without acquiring the execution lock or changing the ledger; the next scan persists reconciliation under execution ownership. The broader scan-versus-destructive-import lifecycle race is pre-existing and not solved by the narrow attribution lock: an import/wipe can replace scan inputs while a batch is in flight. Do not treat that lock as whole-scan lifecycle serialization.

The end-to-end specs `e2e/agent.spec.ts` and `e2e/agent-searches.spec.ts` run against the fake JSearch and fake AI, which scores by title (`posting_score` in `e2e/fake-ai.mts`). They cover multiple-search CRUD, cross-tab cap/stale errors, source partial failure, shared quota/score limits, attribution after rename/delete, v8 exports, mobile layout and accessibility. Database tests cover migration/bootstrap, backup round-trips, exclusion/overlap, reservation accounting and schedule deferral. No real source or paid AI requests are needed.

## Notifications

Settings → Notifications (E26) sends events to the user's channels: an email over SMTP (`nodemailer`), a webhook, or an ntfy topic. Each type formats the same message its own way (`src/lib/notifications/send.ts`): an email gets a subject, the text and the link; a webhook the whole event as JSON, signed with the channel's secret in `X-Dossier-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`; ntfy the title, the text and the link as the tap action, through its JSON publishing. Addresses on the local network are allowed, since the user sets them. Each channel's secret (the SMTP password, the webhook's signing secret, which Dossier makes, or the ntfy token) is encrypted with `DOSSIER_SECRET`, never exported, and kept on import by the channel's id.

To add an event:

1. Add its data to `EventData` and its entry to `EVENTS` in `src/lib/notifications/events.ts`: the grid's label and hint, whether it's on by default, how it builds its title, text and `path` (a page of Dossier's, made absolute with `DOSSIER_PUBLIC_URL` or the address the user last opened, and left out on the desktop app's "On this computer") or `url`, and, for "Only when there's something new", `hasNews`. The data is what a webhook gets: never profile content, documents, posting descriptions, mail content or keys.
2. Call `emit("<name>", data)` where it happens (`src/lib/notifications/notify.ts`). It builds the message once, creates a `NotificationDelivery` for each channel that wants the event (its own choice in the grid, else the event's default) and queues one `notification-delivery` job each, beside the AI jobs. It never fails the caller.

Where each event is sent (E26-4 to E26-7): **agent run finished** after a scheduled run only (`runSummary()` in `src/lib/agent/run.ts`; Run now and Positions' searches never send it), linking to Positions filtered to its one search, or to everything the agent found when it ran several; **portal withdrawn** and **portal update** after a catalog read that brought something new, once per withdrawal and per version (`src/lib/portals/notices.ts`, remembered in `portalNotices`); **draft ready** when the agent prepared a draft on its own (`agentDraftJob` with `auto`); **reply arrived** from the scheduled Gmail check only (`syncInbox({ notify: true })`), with who replied and about which application; and **interview tomorrow**, **follow-up due** (the dashboard's `quietApplications()`) and **new version** from the daily check at 18:00 in the user's time zone (`src/lib/notifications/daily.ts`, once a day by `notificationsDay`; a version once by `notifiedVersion`).

A failed delivery is tried again after 1, 5 and 30 minutes, then marked failed; a channel with 10 failed deliveries in a row is paused until the user resumes it. A timer every minute (`startNotificationSchedule()`) queues what's due, and the log keeps the newest 200 deliveries; Settings shows 50. Send a test sends at once and logs the result.

## Usage ping

The usage ping is opt-in. A production server asks once after sign-in (`src/app/(app)/usage-ping-dialog.tsx`, shown by the signed-in layout while nobody has answered and `DOSSIER_TELEMETRY` isn't set) and sends nothing before a yes. After one, on each day someone signed in opens a page, it sends `https://telemetry.dossier.aien.me/ping` the install's random ID and the version, once (`src/lib/usage-ping.ts`, called with `after()` from the signed-in layout). `DOSSIER_TELEMETRY=on` or `off` answers in advance and wins while it's set.

The answer, when it was given and the version of the question's text are the settings `usagePingChoice`, `usagePingChoiceAt` and `usagePingChoiceText`; the ID and the day of the last ping are `usagePingId` and `usagePingDay`. Exports leave them all out and imports keep them (`INSTALL_SETTINGS` in `src/lib/data-export.ts`). A no deletes the ID. When the question's text changes, raise `USAGE_PING_TEXT_VERSION`, and everyone is asked again. Development servers and tests never ask or send it (`NODE_ENV` isn't `production`). The end-to-end run is a production build: `resetData()` answers no, `e2e/usage-ping.spec.ts` asks, and a yes goes to the fake job sources (`DOSSIER_USAGE_PING_TEST_URL`), never the project.

The receiving end is a small service on the project's own server that isn't published with the app. Change what the ping sends only together with it, the wiki's [Privacy](https://github.com/AienTech/dossier/wiki/Privacy) page and Settings → About.

## Announcements

The project can publish short notices, such as a security fix, and each page shows them in a card over the page (`src/app/(app)/announcement-notice.tsx`), one at a time, until they're dismissed. The sidebar's notice is for updates only. The signed-in layout starts the check after a page load, using the settings it read anyway, so a page costs nothing until a check is due (`src/lib/announcements/check.ts`). When to ask next comes from the answer's `Cache-Control`, between 1 hour and 7 days.

- **The request carries nothing about the install,** only `User-Agent: Dossier`. Which notices apply (version range, expiry, dismissed) is decided on the install (`src/lib/announcements/visible.ts`).
- **A failure changes nothing:** the last good answer stays, and nothing is shown or logged.
- **Notices are plain text,** with one optional link, which can go anywhere on the web. Anything but `http` or `https` is dropped, because the link becomes an `href`. This is not a channel for advertising.

The answer and the dismissed IDs are the settings `announcementFeed` and `announcementsDismissed`, which exports leave out and imports keep (`INSTALL_SETTINGS` in `src/lib/data-export.ts`).

The backend is the project's own service and isn't published with the app. `src/lib/announcements/api-v1.schema.json` is a copy of its contract, and a test compares it with what the app reads, so update the copy when the contract grows. The API only grows, so the app ignores what it doesn't know.

A production server asks `https://api.dossier.aien.me/v1`. A development server only asks while `DOSSIER_API_URL` is set, and then on every page, so a change shows without the wait: the first reload asks, and the next one shows it. To try it against a local copy of the backend, set that variable, for example in an untracked `compose.override.yml`. The variable isn't in `.env.example` or `compose.production.yml`, because nobody running the image needs it. `e2e/announcements.spec.ts` points it at the fake job sources.
## The desktop app

`desktop/` is the app for Linux and Windows, built with Electron. One download, two modes, chosen on first launch: **On my server** opens the user's own Dossier in a window, and **On this computer** runs Dossier itself. There's no auto-update: people download each new version from the release page.

It has its own `package.json` and `yarn.lock`, so the image doesn't carry Electron.

The window has no title bar or menu row of the system's. `desktop/bar/` is the app's own top bar, with the system's window buttons drawn over it, and the page is a view below it, so no server version has to know about the bar. The bar takes its colours from the page's `body` (`bar-colors.ts`), read again when the page loads and when the `dossier_theme` cookie changes.

On this computer runs the same standalone server as the image, on a plain Node binary that ships inside the app, and on SQLite in the user's app folder. So nothing native is built for Electron, and an Electron update, which is how Chromium's security fixes arrive, can't be held back by it. `desktop/scripts/prepare-server.mjs` puts it together for one platform, checking every download against a pinned hash, and the app's own Chromium prints the PDFs (`print-service.ts`, `src/lib/pdf/desktop-print.ts`). The server listens on 127.0.0.1 only. The app makes a secret on first launch and a token at each launch, and signs itself in with the token (`src/lib/desktop.ts`): there's no password, but the sign-in page stays, so other programs reaching the port get nowhere.

Migrations run without Prisma's tools (`server-tools/migrate.mjs`) and **not in a transaction**, because SQLite ignores the files' `PRAGMA foreign_keys=OFF` inside one, and rebuilding a table would then delete the rows that point at it. It copies the database first, and refuses a database from a newer version.

A view showing a server has no preload and is treated as any web page: other sites and mail go to the system browser (`window-rules.ts`), and the page may ask for nothing but writing to the clipboard, for the app's Copy buttons. Only the app's own start screen and bar get the small APIs in `preload.ts` and `bar-preload.ts`.

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
With an SQLite `DATABASE_URL`, they run against the file next to it with `_test` added to its name (`file:/app/data/dev_test.db`).

GitHub Actions (`.github/workflows/ci.yml`) runs lint, type-check and tests with coverage, with a Postgres service for the database tests (then runs those again on SQLite), on release branches (`release/1.12.0`), when one is pushed and on each push after that, and shows the coverage in the job summary. A newer push to the same branch cancels the run it replaces. Nothing else runs them: pull requests aren't checked, so run the checks yourself before you open one. The public repository has no release branches: `image.yml` runs the same jobs there after each merge or publish to `main`, before it builds the image. The coverage thresholds in `vitest.config.mts` ratchet: they sit a few points below the coverage when they were set, and CI fails if coverage drops below them. Raise them when you add tests.

### End-to-end tests

[Playwright](https://playwright.dev) tests in `e2e/` click through the main flows in headless Chromium: signing in, the profile, the theme builder and PDFs, finding a job and applying from it, a new application, refining and undoing, the application email, the board and table, the dashboard, and export, delete and import. `e2e/accessibility.spec.ts` runs [axe](https://github.com/dequelabs/axe-core) on every screen and its open menus and dialogs (no serious or critical WCAG 2.2 AA violations allowed) and checks where keyboard focus goes. They run against a production build, on the standalone server the image uses, so build first:

```bash
docker/bin/yarn build && docker/bin/yarn test:e2e
```

The run starts its own server on port 3100 with a separate `dossier_e2e` database (created and migrated on the way, reset to the demo data before the specs that change data), a fake OpenAI-compatible server on port 3999 (`e2e/fake-ai.mts`) that answers each AI task with plausible output, fake job sources on port 3998 (`e2e/fake-jobs.mts`), which the app reaches through `DOSSIER_JOBS_TEST_BASE_URL`, a variable for the tests only, and a fake Google on port 3997 (`e2e/fake-google.mts`) for sign-in, Gmail and Calendar (`DOSSIER_GOOGLE_TEST_BASE_URL`), which only comes into play once a spec enters an OAuth client in Settings → Google. The daily update check asks the same fake instead of GitHub (`DOSSIER_UPDATES_TEST_BASE_URL`), which says no release is out, so a spec can store the latest release itself, and so does Jev (`DOSSIER_TYPESAFE_TEST_BASE_URL`), with answers made from the questions. The same fake answers for the project's backend (`DOSSIER_API_URL`), with no notices until a spec says otherwise. Your development server and data are never touched: the tests refuse any database whose name doesn't end in `_e2e`. CI runs them in a job of their own and keeps the report of a failed run as an artifact.

## The production image

The `Dockerfile`'s last stage is the production image (the `dev` stage is what Compose runs here). It holds the standalone Next.js server, Playwright's Chromium for PDFs, and Prisma's CLI for migrations, runs as `node`, and starts with `docker/start.sh`: `prisma migrate deploy`, the seed (compiled with esbuild at build time), then the server. To build and try it next to the development stack:

```bash
docker build -t dossier:local .
DOSSIER_IMAGE=dossier:local DOSSIER_PORT=3300 docker compose -f compose.production.yml -p dossier-local up -d
```

In the public repository, `image.yml` pushes an image for every commit on `main` to `ghcr.io/<owner>/<repository>:<sha>` (lower case), once the checks and the end-to-end tests pass. A version tag (`v1.0.0`) then tags that commit's image with the version and `latest`.

## The website

`site/` is the project's website, plain HTML, CSS and a little JavaScript. `site/build.sh` puts it together in `_site/` with the README's screenshots (`.github/images/`), the app's icons and three of its fonts, so there's one copy of each. To look at it, serve `_site/` with any static server, for example `docker run --rm -p 8080:80 -v "$PWD/_site:/usr/share/nginx/html:ro" nginx:alpine`, then open http://localhost:8080. The public repository's Pages workflow publishes it when any of those change on `main`, and once a day. When the README's screenshots change, the site's change with them.

The number above the hero's buttons is the Docker image's download count. GitHub's API has no download counts for `ghcr.io`, so `build.sh` reads it from the package page (the `title` of the number under "Total downloads") and writes it into `_site/index.html`, rounded down. The daily run keeps it current. If the page can't be read (you're offline, or GitHub changed its markup), the build prints a warning and keeps the floor written in `site/index.html`. Raise that floor now and then, and update the `sed` in `build.sh` if the warning keeps coming.

## Reset

```bash
docker compose down -v   # stops everything and deletes the database and node_modules volumes
```
