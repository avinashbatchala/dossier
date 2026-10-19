<p align="center">
  <img src="src/app/icon.svg" alt="" width="80" height="80">
</p>

<h1 align="center">Dossier</h1>

<p align="center">
  Your job search, on your own server: one profile, a tailored resume and cover letter for every job, and every application tracked from draft to offer.
</p>

<p align="center">
  <a href="https://github.com/AienTech/dossier/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/AienTech/dossier?label=release"></a>
  <a href="https://github.com/AienTech/dossier/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/AienTech/dossier/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <a href="https://github.com/AienTech/dossier/pkgs/container/dossier"><img alt="Docker image: ghcr.io/aientech/dossier" src="https://img.shields.io/badge/image-ghcr.io%2Faientech%2Fdossier-2496ED?logo=docker&logoColor=white"></a>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs">
  <img alt="PostgreSQL 18" src="https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white">
</p>

Dossier keeps your career history in one profile and turns it into a clean resume. For every job you apply to, it reads the posting, shows how you match, and drafts a tailored resume and cover letter that only use facts from your profile. You refine them in a chat, download them as PDFs and track each application from draft to offer.

It's for one person on a small server: one password, your data in your own PostgreSQL database, and an AI model of your choice. That can be a local model through Ollama, so nothing leaves your server, or a hosted one (any OpenAI-compatible API, or Anthropic).

## Demo

![Dossier in use: the dashboard, dragging a card on the board, a new application from a pasted posting, refining the tailored resume in the chat, the cover letter, and switching resume themes](.github/images/demo.gif)

<sub>Recorded with the demo data (Jane Doe is made up) and a stand-in AI server that answers at once, played at 1.2× speed. With a real model, reading a posting and writing the documents takes from a few seconds to a few minutes.</sub>

## Features

- **Profile:** basics, skills and languages, experience, education and references, in the order you choose, with a strength meter. Start it from an existing resume (PDF, Word or Markdown) if you like.
- **Base resume:** twelve themes and a theme builder, previewed live and printed to PDF on the server. Duplicate themes, or share them as files.
- **Find jobs:** search postings near your city, or anywhere you choose, through JSearch (LinkedIn, Indeed and more), Adzuna or Germany's Bundesagentur für Arbeit. Save the good ones, dismiss the rest, and start an application from a posting with one click.
- **New application:** paste a posting; Dossier pulls out the details and requirements, matches them against your profile, and writes a tailored resume and cover letter in the tone you pick.
- **Never invents experience:** drafts only use facts from your profile. What the posting asks for and your profile doesn't have is shown as a gap, not made up.
- **Refine:** ask for changes in a chat, edit or regenerate any part (every part of the cover letter too: sender, date, recipient, greeting and sign-off, written in the letter's language), undo AI changes or go back to any earlier version, keep private notes.
- **Send:** an email to go with each application, to whoever the posting says to send it to, ready to copy or open in your mail app, with the resume and cover letter PDFs to attach. Edit, rewrite or refine it like the documents.
- **Track:** a board and a table of every application, and a dashboard with your funnel (last 30 days, 90 days or all time), a week-by-week chart and what's worth a look next, upcoming interviews included.
- **Your data:** export and import everything as one file, nightly backups, and Delete everything.

## Screenshots

![The dashboard: your funnel, a week-by-week chart and what's worth a look next](.github/images/dashboard.png)

<table>
  <tr>
    <td width="50%"><img src=".github/images/application.png" alt="An application with its tailored resume and the chat that refines it"><br>An application: the tailored resume, and a chat to refine it</td>
    <td width="50%"><img src=".github/images/new-application.png" alt="A new application, showing how the profile matches the posting's requirements"><br>A new application: how you match the posting</td>
  </tr>
  <tr>
    <td><img src=".github/images/applications.png" alt="The applications board, with columns from draft to offer"><br>Every application on a board, from draft to offer</td>
    <td><img src=".github/images/find-jobs.png" alt="Find jobs: postings near the profile's city, with one open"><br>Find jobs and start an application from a posting</td>
  </tr>
  <tr>
    <td><img src=".github/images/resume.png" alt="The base resume next to its themes"><br>The base resume, with twelve themes and a theme builder</td>
    <td><img src=".github/images/profile.png" alt="The profile editor, with its sections and strength meter"><br>One profile that every resume and letter comes from</td>
  </tr>
</table>

<sub>The screenshots show the demo data: Jane Doe is made up.</sub>

## Self-hosting

Dossier runs as two containers, the app and PostgreSQL, from one Compose file. These four steps take a fresh server to Dossier on your own domain, with HTTPS.

### 1. Get a VPS

Any Linux server you can reach over SSH works, from any provider. Give it:

- **At least 2 vCPUs and 2 GB of memory.** Dossier uses up to about 1 GB, since it prints PDFs with a built-in Chromium; PostgreSQL and the system need the rest (see [Performance and sizing](#performance-and-sizing)).
- **A few GB of disk.** The image is about 1.7 GB; your data takes far less.
- **More for a local model:** about 6 GB of extra memory and 4 or more cores for `qwen2.5:7b` (see [Local model with Ollama](#local-model-with-ollama)). With a hosted AI provider, you don't need any of that.
- **A domain name** for HTTPS, such as `dossier.example.com`, with a DNS `A` record pointing at the server.

The commands below are for Debian or Ubuntu. Only SSH (port 22) and the web (80 and 443) need to be open to the internet.

### 2. Install Docker and Docker Compose

Docker's install script sets up Docker Engine and the Compose plugin:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

The last line lets you run `docker` without `sudo` (membership in the `docker` group is as good as root, so only add accounts you trust). Log out and back in for it to apply, then check:

```bash
docker compose version
```

To install by hand instead, follow [Docker's guide for your distribution](https://docs.docker.com/engine/install/).

### 3. Set up the database

Dossier keeps everything in PostgreSQL 18, which runs in its own container next to the app. Nothing outside can reach it, only the app, and its data lives in a Docker volume that survives restarts and upgrades.

Make a folder for Dossier, fetch the Compose file into it, and give the database a random password:

```bash
mkdir ~/dossier && cd ~/dossier
curl -fsSL -o compose.yml https://raw.githubusercontent.com/AienTech/dossier/main/compose.production.yml
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" > .env
chmod 600 .env
```

`.env` holds your secrets, so it's readable only by you. The database starts with the app in the next step; Compose waits until it's ready before it starts Dossier.

### 4. Set up the app

Dossier needs two more secrets in `.env`:

- **`DOSSIER_SECRET`:** 32 or more random characters. It signs sessions and encrypts saved API keys.
- **`DOSSIER_PASSWORD`:** a hash of the password you'll sign in with. Dossier only takes the hash, never the password itself, so reading the server's settings doesn't reveal it.

```bash
echo "DOSSIER_SECRET=$(openssl rand -base64 32)" >> .env
docker run --rm -it ghcr.io/aientech/dossier hash-password
```
_Note_: In case you are building or running it locally on Apple Silicon (M-series Mac), use the following command to specify the platform:
```bash
docker run --platform linux/amd64 --rm -it ghcr.io/aientech/dossier hash-password
```

Type your password twice. The command prints one line that starts with `argon2id:`; add it to `.env` as `DOSSIER_PASSWORD=argon2id:…` (for example with `nano .env`). Then start Dossier and watch it come up:

```bash
docker compose up -d
docker compose logs -f app
```

On every start, Dossier applies the database migrations and loads its built-in themes before it serves, and the log shows each step. Press Ctrl+C to stop following it. `curl -s localhost:3000/api/health` answers `{"status":"ok", …}` once it's up.

**HTTPS.** Dossier only listens on the server itself (`127.0.0.1:3000`), so put a reverse proxy with HTTPS in front of it. [Caddy](https://caddyserver.com) gets and renews the certificate on its own. Install it (on older releases, see [Caddy's install guide](https://caddyserver.com/docs/install)) and replace its default configuration with your domain:

```bash
sudo apt install -y caddy
sudo tee /etc/caddy/Caddyfile > /dev/null <<'EOF'
dossier.example.com {
    reverse_proxy localhost:3000
}
EOF
sudo systemctl reload caddy
```

Open `https://dossier.example.com` and sign in. Then pick an AI model in **Settings → AI provider** (see [Choosing an AI provider](#choosing-an-ai-provider)) and, if you like, a job source in **Settings → Job search**.

<details>
<summary>Another proxy, or no HTTPS at home</summary>

- **Traefik, nginx or another proxy:** it has to set `X-Forwarded-Proto` and append the client's address to `X-Forwarded-For`. Caddy and Traefik do both by default; with nginx, add `proxy_set_header X-Forwarded-Proto $scheme;` and `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, and raise `client_max_body_size` to `12m` so imports of up to 10 MB get through. Dossier relies on these headers: `X-Forwarded-Proto: https` makes the session cookie `Secure`, and the last address in `X-Forwarded-For` is the client the sign-in rate limit counts. So never expose port 3000 itself to the internet: requests that skip the proxy could set those headers themselves.
- **A home network without a domain:** change the app's `ports` entry in `compose.yml` to `"3000:3000"`, run `docker compose up -d`, and open `http://<the server's address>:3000`. Everything works, but the session cookie can't be marked `Secure`.

</details>

## Environment variables

Dossier is configured with environment variables; everything else is set in the app. Put them in `.env` next to `compose.yml`, then run `docker compose up -d` to apply them (a plain restart keeps the old values). The server doesn't start while a required variable is missing or invalid, and its log says which one and how to fix it.

**Required:**

| Variable | What it's for |
|---|---|
| `POSTGRES_PASSWORD` | The database's password. `compose.yml` builds the app's `DATABASE_URL` from it. |
| `DOSSIER_PASSWORD` | A hash of the password you sign in with, made with `hash-password` (see [step 4](#4-set-up-the-app)); the password itself isn't accepted. It's only read from here, never stored. Changing it signs every session out. |
| `DOSSIER_SECRET` | At least 32 random characters. Signs sessions and encrypts saved API keys; changing it signs everyone out, and API keys have to be entered again. |

**Optional:**

| Variable | Default | What it's for |
|---|---|---|
| `TZ` | `UTC` | The server's time zone, e.g. `Europe/Berlin`. Nightly backups run at 03:00 in it, and dates the server writes (a letter's date, "today") follow it. |
| `DOSSIER_BACKUP_RETENTION_DAYS` | `14` | How many days of nightly backups to keep. |
| `DOSSIER_TELEMETRY` | `on` | `off` stops the usage ping, which sends a random install ID and the version number once on each day Dossier is used (see [Privacy](#privacy)). |
| `DOSSIER_AI_PROVIDER` | none | `local` (Ollama or llama.cpp), `openai` (any OpenAI-compatible API) or `anthropic`. A default for Settings → AI provider; a choice saved there wins. |
| `DOSSIER_AI_URL` | per provider | The AI server's address, e.g. `http://ollama:11434`. |
| `DOSSIER_AI_MODEL` | per provider | The model to use, e.g. `qwen2.5:7b` or `claude-sonnet-5`. |
| `DOSSIER_AI_KEY` | none | The API key for a hosted provider. |
| `DOSSIER_AI_TIMEOUT_SECONDS` | `300` local, `120` hosted | How long one AI request may take. |
| `DOSSIER_JOBS_SOURCE` | off | `jsearch`, `adzuna`, `arbeitsagentur` or `off`. A default for Settings → Job search; a choice saved there wins. |
| `DOSSIER_JSEARCH_KEY` | none | A JSearch key, from OpenWeb Ninja or RapidAPI. |
| `DOSSIER_JSEARCH_HOST` | `openwebninja` | Where that key is from: `openwebninja` or `rapidapi`. |
| `DOSSIER_ADZUNA_APP_ID`, `DOSSIER_ADZUNA_KEY` | none | Adzuna's app ID and key. |
| `DOSSIER_IMAGE` | `ghcr.io/aientech/dossier:latest` | The image to run. Set a version, e.g. `ghcr.io/aientech/dossier:v1.4.1`, to upgrade only when you choose. |
| `DOSSIER_PORT` | `3000` | The port on the server (`127.0.0.1`) that Dossier listens on, for the reverse proxy. |
| `COMPOSE_PROFILES` | none | `ai` runs Ollama as well (see [Local model with Ollama](#local-model-with-ollama)). |

Running the image without the Compose file? Set `DATABASE_URL` (`postgresql://user:password@host:5432/database`) instead of `POSTGRES_PASSWORD`, and mount a volume at `/data`, where nightly backups and zipped PDFs go.

## Choosing an AI provider

Open **Settings → AI provider**, pick one, and press **Test connection**:

- **Local model:** Ollama or llama.cpp on your own hardware. Private and free, but slower; see [below](#local-model-with-ollama) for setup and model sizes.
- **OpenAI-compatible:** OpenAI itself or any server that speaks its API (OpenRouter, vLLM, LM Studio and others). Enter its address, your API key and the model.
- **Anthropic:** Claude models with your own API key.

API keys are stored encrypted with `DOSSIER_SECRET` and never sent back to the browser. **Never invent experience** (on by default) keeps drafts to facts from your profile and flags anything it can't find there.

### Local model with Ollama

With a local model, nothing you write leaves your server. The Compose file can run Ollama next to Dossier. Switch it on, start it, and pull a model:

```bash
echo "COMPOSE_PROFILES=ai" >> .env
docker compose up -d
docker compose exec ollama ollama pull qwen2.5:7b
```

Then, in **Settings → AI provider → Local model**, set the server address to `http://ollama:11434`, pick the model and press **Test connection**. Or set `DOSSIER_AI_PROVIDER=local`, `DOSSIER_AI_URL=http://ollama:11434` and `DOSSIER_AI_MODEL=qwen2.5:7b` in `.env`.

**Which model:** `qwen2.5:7b` is a good start: a 4.7 GB download that needs about 6 GB of memory with Dossier's 16k-token context. On a smaller server, `qwen2.5:3b` (2 GB, about 3 GB of memory) works, with plainer writing. These are suggestions, not yet benchmarked. On a CPU, reading a posting takes a minute or two and a whole new application several minutes, so the local timeout is 5 minutes per request (`DOSSIER_AI_TIMEOUT_SECONDS`); 4 or more cores help, a GPU much more.

**Ollama elsewhere:** on another machine in your network, use `http://<its address>:11434`, and start Ollama there with `OLLAMA_HOST=0.0.0.0` so it listens beyond localhost. For Ollama installed on the same server outside Docker, use `http://host.docker.internal:11434`, which `compose.yml` points at the server; Ollama then has to listen beyond localhost too, so make sure your firewall keeps port 11434 closed to the internet. Inside a container, `localhost` is the container itself, never the server.

## Choosing a job source

Find jobs is off until you pick a source in **Settings → Job search**. LinkedIn and Indeed don't let other apps read their job listings, so Dossier searches one of these instead:

| Source | What it covers | Key and cost |
|---|---|---|
| **JSearch** | Google for Jobs: postings from LinkedIn, Indeed, Glassdoor, Stepstone and company sites, in most countries, with their whole text. | A key from [OpenWeb Ninja](https://www.openwebninja.com/api/jsearch) or [RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch). The free plan has 200 searches a month; each page of results is one. |
| **Adzuna** | Adzuna's own index in 19 countries. It only shares the start of each posting; Dossier fetches the rest from the posting's page. | A free app ID and key from [Adzuna's developer site](https://developer.adzuna.com/signup), about 250 searches a day. |
| **Bundesagentur für Arbeit** | Germany's federal job board, with whole postings. Germany only. | No key, free. It isn't an official API (it's the access the agency's own site uses), so it can change without notice. |

The search starts from your profile's city, country and current role; change the place, radius (10 to 200 km), how recent and Remote only as you like. Every search is kept with what it found until you remove it, under **Past searches**, so going back to one, or reloading, doesn't spend another search.

## Backups and restore

Run these from your Dossier folder (`~/dossier`).

- **Export:** **Settings → Your data → Export** downloads everything (profile, themes, settings, applications with their documents, chat, notes and history) as one JSON file. Your API key is left out unless you tick the box.
- **Import:** importing such a file replaces all data in one step, after saving a backup of what was there to the data directory's `backups` folder.
- **Nightly backups** (on by default) write the same export to `/data/backups` in the app's volume at 03:00 server time, keeping `DOSSIER_BACKUP_RETENTION_DAYS` days of them. Copy them off the server now and then: `docker compose cp app:/data/backups ./backups`.
- **Database dumps:** back up PostgreSQL itself too:

  ```bash
  docker compose exec -T db pg_dump -U dossier -Fc dossier > dossier.dump
  ```

  To restore a dump, stop Dossier, load the dump, and start Dossier again:

  ```bash
  docker compose stop app
  docker compose exec -T db pg_restore --clean --if-exists -U dossier -d dossier < dossier.dump
  docker compose start app
  ```

Keep a copy of `.env` with your backups: saved API keys can't be read without its `DOSSIER_SECRET` (an export with the key included carries it in plain text instead).

## Upgrading

Take a backup first (an export, or a database dump). Then, in your Dossier folder:

```bash
docker compose pull
docker compose up -d
```

`latest` is always the newest release. If you've pinned a version with `DOSSIER_IMAGE`, change it to the new one first. When a release's notes say `compose.yml` changed, fetch it again with the `curl` line from [step 3](#3-set-up-the-database).

The new version updates the database on start. Going back to an older version after that isn't supported: restore the backup you took instead.

From 1.4, Dossier sends a usage ping (see [Privacy](#privacy)). If you'd rather it didn't, set `DOSSIER_TELEMETRY=off` before you upgrade to 1.4 or later.

**From 1.0:** Dossier 1.0 took the password itself in `DOSSIER_PASSWORD`; newer versions only take a hash of it, and don't start until it is one. Make the hash with the newer image (`docker run --rm -it ghcr.io/aientech/dossier hash-password`, typing your current password to keep it), put it in `.env`, then pull and start as above. Every browser is signed out once and signs in again with the same password.

## Troubleshooting

`docker compose logs app` shows the app's log (add `-f` to follow it). After changing `.env`, run `docker compose up -d` again.

- **"Dossier didn't start: applying the database migrations failed."** The error above that line says why. `P1001` means the database isn't reachable: check that the `db` container is running (`docker compose ps`). If a migration failed halfway, the database needs repairing before the next start: restore the dump you took before upgrading, or ask for help with the log.
- **"… is not set" or "DOSSIER_SECRET is too short":** set the variable the log names in `.env`.
- **"DOSSIER_PASSWORD must be a hash of your password":** it's set to the password itself, which Dossier 1.0 took. Make a hash with `docker run --rm -it ghcr.io/aientech/dossier hash-password` and set `DOSSIER_PASSWORD` to it.
- **PDFs fail or time out:** Chromium needs memory; give the app at least 768 MB (`compose.yml` gives it 1 GB). Fonts are bundled with Dossier, so documents look the same everywhere; a custom document language in a script Dossier has no font for may show empty boxes.
- **The AI times out:** local models on a CPU are slow. Try a smaller model, or raise `DOSSIER_AI_TIMEOUT_SECONDS`. **Test connection** in Settings shows whether Dossier reaches the server at all; inside Docker, `localhost` isn't the server.
- **An import fails with "413" or "Request Entity Too Large":** the reverse proxy's upload limit is below 10 MB. Caddy has none by default; with nginx, set `client_max_body_size 12m;`.
- **"That file is over 10 MB":** imports are capped at 10 MB, roughly 500 applications. Raising the cap means changing two settings in the code (see [Import size limit](DEVELOPMENT.md#import-size-limit)).
- **"Too many attempts":** after five wrong passwords in a minute, sign-in pauses for 30 seconds, then longer each time, up to 15 minutes. The count is kept in the database, so restarting doesn't reset it: wait it out.
- **Forgot the password:** make a hash of a new one with `hash-password` (see [step 4](#4-set-up-the-app)) and set it as `DOSSIER_PASSWORD` in `.env`.
- **Is it up?** `/api/health` answers `{"status":"ok"}` when the app and its database are fine, and 503 when the database isn't reachable.

## Privacy

- Everything you enter stays in your PostgreSQL database and data directory.
- With a **local model**, nothing leaves your server. With a **hosted provider**, Dossier sends it what the task needs: the job posting, your profile without contact details (no email, phone, address, date of birth or links), what you add when you create an application, and, when you refine, the drafts and your chat messages, though never a letter's sender or signature. Importing a resume sends its text, contact details included; the import page says so first. The notes you keep on an application are never sent.
- **Usage ping:** on each day you use Dossier, your server sends `telemetry.dossier.aien.me` a random install ID and the version number, once, so the project knows how many installs are in use and how often. The ID is made at random and kept in your database. It isn't derived from anything about you or your server, and exports leave it out. Nothing else is sent: no profile, documents, applications, settings, server address or time of day. The receiver, a Cloudflare Worker, keeps the ID, the day and the version, and deletes them after a year. It doesn't keep the address the ping came from, though Cloudflare sees it on the way, as with any request. Set `DOSSIER_TELEMETRY=off` to stop it. Settings → About shows whether it's on and the ID it sends. To have your install's rows removed, send that ID to `dossier.app@pm.me`: everything kept under it is deleted, and you get a confirmation. Set `DOSSIER_TELEMETRY=off` first, so nothing new arrives afterwards.
- No other tracking or analytics: Dossier loads nothing from other sites (its Content-Security-Policy forbids it, and the ping comes from your server, not your browser), and Next.js telemetry is off in the image.
- **Check for updates** in Settings → About asks GitHub for the latest release, only when you press it, and sends nothing about you or your install.
- **Fetch** on a new application asks the job site for the posting's page from your server, only when you press it. It never requests addresses on your own network.
- **Find jobs** is off until you choose a source. Then it sends the source what you search for (keywords, place, country, radius and filters), from your server, and nothing from your profile: the profile only fills in the form. Each search is kept with what it found, until you remove it from Past searches. For a posting that came with only its start (Adzuna, sometimes the Arbeitsagentur), Dossier asks the posting's page for the rest, as Fetch does.

## Known limitations

- **Desktop only:** made for a laptop or desktop browser, not for phones.
- **Single user:** one password and one profile; there are no accounts.
- **English interface:** documents can be written in other languages, but the app itself is in English.
- **One instance:** run a single copy of the app per database. The nightly backups, the AI job queue and the PDF browser live inside the app's process.

## Performance and sizing

Measured on 28 September 2026 with the production build in a container limited to 2 vCPUs and 1 GB:

- **PDFs:** the base resume renders in about 0.25 s, or 1 s when Chromium has to start first (it closes after five idle minutes). Two render at a time and the rest queue: six requested at once are done in 1.4 s. Dossier used at most about 520 MB, Chromium included, so give the container at least 768 MB.
- **Screens:** with ten times the demo data (90 applications), the dashboard and the applications list answer in 20–90 ms, and every query takes under a millisecond. With 900 applications they take up to about 0.2 s, mostly rendering; the tables are indexed for the queries they get.
- **Interactions** (changing a status, moving a card, switching tabs, opening an editor, typing, picking a theme) respond within 32 ms, and within about 100 ms on a CPU four times slower.

## Security

What protects your data, how to run Dossier safely and how to report a problem: see [SECURITY.md](SECURITY.md).

## Development

Working on Dossier itself: see [DEVELOPMENT.md](DEVELOPMENT.md). For this deployment's AWS/Lightsail operations — SSH, updates, backups, password and secret rotation — see [INFRASTRUCTURE.md](INFRASTRUCTURE.md).

## License

Dossier is free software under the [GNU Affero General Public License v3.0](LICENSE). You may use, change and share it; if you run a changed version for others over a network, you must offer them its source code.
