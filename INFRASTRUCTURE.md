# Infrastructure Runbook

How this Dossier deployment is hosted on AWS, and how to operate it: SSH access, logs, updates, password and secret rotation, backups, restore, and teardown.

> **This repository is public.** The live static IP, hostname, passwords, hashes, and secrets are intentionally **not** stored here. Keep them in your password manager and retrieve the non-secret infrastructure values from AWS with the commands below.

## Deployment at a glance

| Item | Value |
|---|---|
| Cloud | AWS Lightsail |
| Region / AZ | `us-east-1` / `us-east-1a` |
| Instance | `dossier` |
| Plan | `small_3_0` — 2 vCPU, 2 GB RAM, 60 GB SSD, 3 TB transfer |
| OS | Ubuntu 24.04 LTS |
| Static IP | Lightsail static IP named `dossier-ip` (actual address intentionally omitted) |
| Hostname | `dossier.<STATIC_IP>.sslip.io` |
| App image | `dossier:deepseek-fix` — local build from this fork at `v1.7.0-deepseek.1` (upstream `v1.7.0` plus the DeepSeek thinking fix) |
| Rollback image | `dossier:deepseek-fix-20261019` |
| Build source | `/home/ubuntu/dossier-src` (this fork at `v1.7.0-deepseek.1`) |
| Runtime | Docker Compose project `dossier` |
| App directory | `/home/ubuntu/dossier` |
| Compose file | `/home/ubuntu/dossier/compose.yml` |
| Environment | `/home/ubuntu/dossier/.env`, mode `600` |
| Database | PostgreSQL 18 container, volume `dossier_pgdata` |
| App data | Volume `dossier_data`, mounted at `/data` in the app |
| Swap | 4 GB `/swapfile`, mainly to make image builds safe on the 2 GB plan |
| Reverse proxy | Caddy 2, systemd service, Let's Encrypt TLS |
| Public ports | `22`, `80`, `443` only |
| App port | `127.0.0.1:3000` — intentionally not public |
| SSH | `ubuntu@<STATIC_IP>` with `~/.ssh/dossier-deploy.pem` |
| Time zone | `UTC`; nightly backups run at 03:00 UTC |
| Telemetry | Disabled (`DOSSIER_TELEMETRY=off`) |
| AI provider | DeepSeek via the OpenAI-compatible provider, `https://api.deepseek.com`, model `deepseek-flash` |
| Approximate AWS cost | **$12/month** + optional snapshots; DeepSeek usage is billed separately |

## Architecture

```text
Internet
   |
   |  80 / 443
   v
Caddy (host, systemd)
   |
   |  127.0.0.1:3000
   v
dossier-app-1  (Next.js standalone server, Chromium for PDFs)
   |
   |  db:5432
   v
dossier-db-1   (PostgreSQL 18)
```

Persistent Docker volumes:

- `dossier_pgdata` — PostgreSQL data
- `dossier_data` — Dossier's `/data` directory: nightly backups, temporary PDF zips

Caddy terminates TLS and redirects plain HTTP to HTTPS. The app container is published only on loopback, so port `3000` must never be exposed publicly.

Run exactly **one** app instance. Background jobs, nightly backups, the AI job queue, and the PDF Chromium browser all live inside the app process. Do not add replicas to this Compose stack.

---

## Set up your local shell

Run these in the shell where you will operate the server. They retrieve the live values from AWS; they do not store secrets.

```bash
export AWS_REGION=us-east-1
export DOSSIER_INSTANCE=dossier
export DOSSIER_STATIC_IP=dossier-ip
export DOSSIER_SSH_KEY="$HOME/.ssh/dossier-deploy.pem"

export DOSSIER_IP="$(aws lightsail get-instance \
  --region "$AWS_REGION" \
  --instance-name "$DOSSIER_INSTANCE" \
  --query 'instance.publicIpAddress' \
  --output text)"

export DOSSIER_HOST="dossier.${DOSSIER_IP}.sslip.io"
export DOSSIER_SSH="ubuntu@${DOSSIER_IP}"

printf 'IP:   %s\nHost: %s\n' "$DOSSIER_IP" "$DOSSIER_HOST"
```

If the AWS CLI session has expired:

```bash
aws login
# or, for an SSO profile:
aws sso login --profile <profile>
aws sts get-caller-identity
```

Do not paste AWS credentials or private keys into chat, tickets, or the repository.

## Quick reference

Run `cd /home/ubuntu/dossier` on the server first.

| Task | Command |
|---|---|
| SSH | `ssh -i "$DOSSIER_SSH_KEY" "$DOSSIER_SSH"` |
| Status | `sudo docker compose ps` |
| App logs | `sudo docker compose logs -f --tail=100 app` |
| Health | `curl -fsS "https://${DOSSIER_HOST}/api/health"` |
| Update | See [Updating Dossier](#updating-dossier); the app uses a locally built image, so do not rely on `docker compose pull` |
| Restart app | `sudo docker compose restart app` |
| Apply `.env` changes | `sudo docker compose up -d` |
| Database dump | `sudo docker compose exec -T db pg_dump -U dossier -Fc dossier > ~/dossier-$(date +%F).dump` |
| Caddy reload | `sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy` |
| Reboot | `sudo reboot` |

Password rotation and other procedures are detailed below.

---

## SSH access

```bash
chmod 600 "$DOSSIER_SSH_KEY"
ssh -i "$DOSSIER_SSH_KEY" "$DOSSIER_SSH"
```

You land as the `ubuntu` user in `/home/ubuntu`.

The `ubuntu` user was added to the `docker` group, but this runbook uses `sudo docker` so it works in every shell, including immediately after provisioning.

### If the SSH key is lost

1. Open the AWS Lightsail console.
2. Select the `dossier` instance.
3. Choose **Connect → Connect using SSH**. This opens a browser terminal as `ubuntu`.
4. Add a new public key:

   ```bash
   mkdir -p ~/.ssh
   chmod 700 ~/.ssh
   echo 'ssh-ed25519 AAAA... your-new-public-key' >> ~/.ssh/authorized_keys
   chmod 600 ~/.ssh/authorized_keys
   ```

5. Test the new key before removing the old one.

The Lightsail key-pair resource is only used to seed `~/.ssh/authorized_keys`. SSH access ultimately depends on the keys in that file, not on the Lightsail key-pair resource.

### Rotate the SSH key

On your Mac:

```bash
ssh-keygen -t ed25519 -f "$HOME/.ssh/dossier-deploy-new" -C "dossier deploy"
```

Copy the public key to the server using the old key:

```bash
cat "$HOME/.ssh/dossier-deploy-new.pub" | \
  ssh -i "$HOME/.ssh/dossier-deploy.pem" "$DOSSIER_SSH" \
  'cat >> ~/.ssh/authorized_keys'
```

Test the new key:

```bash
ssh -i "$HOME/.ssh/dossier-deploy-new.pem" "$DOSSIER_SSH"
```

Only after that works, edit `~/.ssh/authorized_keys` on the server and remove the old key. Do not delete the old local key until the new one is confirmed.

---

## Service layout and commands

| Path | Purpose |
|---|---|
| `/home/ubuntu/dossier` | Running Compose project: `compose.yml`, `.env` |
| `/home/ubuntu/dossier-src` | This fork's source at the deployed release tag, used to rebuild the image |
| `/etc/caddy/Caddyfile` | Reverse proxy and TLS configuration |
| Docker volume `dossier_pgdata` | PostgreSQL data |
| Docker volume `dossier_data` | App `/data`: nightly backups and temporary PDF zips |

```bash
cd /home/ubuntu/dossier
```

### Status

```bash
sudo docker compose ps
sudo systemctl is-active docker caddy
```

### Logs

```bash
# App (migrations, seed, Next.js)
sudo docker compose logs -f --tail=100 app

# Database
sudo docker compose logs -f --tail=100 db

# Caddy / TLS
sudo journalctl -u caddy -f
```

### Start, stop, restart

```bash
sudo docker compose stop          # stop app and db
sudo docker compose start         # start them again
sudo docker compose restart app   # restart only the app

# Recreate containers after changing .env
sudo docker compose up -d
```

`restart` does **not** reload changed environment variables. Use `up -d` after editing `.env`.

### Health checks

From your Mac:

```bash
curl -fsS "https://${DOSSIER_HOST}/api/health"
```

Expected:

```json
{"status":"ok","version":"1.5.x","db":"ok"}
```

From the server:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

`503` means the app is running but PostgreSQL is unreachable. A `502` from Caddy usually means Caddy is up but the app container is down.

### Boot behavior

Docker and Caddy are enabled at boot. The app and database have `restart: unless-stopped`, so a reboot normally brings Dossier back automatically.

```bash
sudo reboot
```

After reconnecting, wait a moment and check the health endpoint.

### Disk and memory

```bash
free -h
df -h /
sudo docker system df
```

Do not prune volumes unless you intend to delete data. Never run `docker compose down -v` on this host unless you are deliberately destroying the database and `/data`.

---

## Updating Dossier

This deployment runs a **locally built image**, `dossier:deepseek-fix`, from this fork's `v1.7.0-deepseek.1` tag: upstream `v1.7.0` plus the DeepSeek thinking fix. `docker compose pull` cannot update that image; rebuild it instead. Treat every update as a small production change.

### 1. Back up first

```bash
cd /home/ubuntu/dossier

# Full database dump
sudo docker compose exec -T db pg_dump -U dossier -Fc dossier \
  > "$HOME/dossier-$(date +%F).dump"

# Back up environment/secrets
cp .env "$HOME/dossier.env.backup.$(date +%F)"
chmod 600 "$HOME"/dossier-*.dump "$HOME"/dossier.env.backup.* 2>/dev/null || true
```

Optionally take a Lightsail instance snapshot from the console or with `aws lightsail create-instance-snapshot`.

### 2. Update the source and rebuild

The build source is `/home/ubuntu/dossier-src`, a checkout of this fork with the DeepSeek fix committed. The fork merges each upstream release and tags the result, so no patch is applied on the server.

```bash
cd /home/ubuntu/dossier-src

git status --short        # should be empty
git fetch origin --tags
git checkout v1.7.0-deepseek.1   # the fork tag you want

sudo docker build --target production -t dossier:deepseek-fix .
```

Before replacing the running image, keep the previous one for rollback:

```bash
# The old image is already tagged dossier:deepseek-fix-<date>; tag the new one too.
sudo docker tag dossier:deepseek-fix "dossier:deepseek-fix-$(date +%F | tr -d -)"
```

Then recreate the stack:

```bash
cd /home/ubuntu/dossier
sudo docker compose up -d
```

Do **not** run `docker compose pull` for the app while `DOSSIER_IMAGE=dossier:deepseek-fix`; that image only exists locally. To update only PostgreSQL, use `sudo docker compose pull db`.

The app runs `prisma migrate deploy` and the seed at startup. Watch it:

```bash
sudo docker compose logs -f --tail=100 app
```

The build takes several minutes on the 2 GB instance. The 4 GB swap file is there to keep it from running out of memory; it is not a substitute for a larger instance under real load.

### 3. Verify

```bash
curl -fsS "https://${DOSSIER_HOST}/api/health"
curl -sS -o /dev/null -w '%{http_code}\n' "https://${DOSSIER_HOST}/login"
```

Also sign in and press **Test connection** in **Settings → AI provider**.

### The DeepSeek thinking patch

DeepSeek's V4 models enable thinking by default, and the reasoning tokens count towards `max_tokens`. Dossier's default budget of 4,096 was therefore exhausted before the answer was written, producing:

> The model's answer was cut off before it was finished.

The patch in `src/lib/ai/providers/openai-compatible.ts`:

- detects `api.deepseek.com`
- sends `thinking: { "type": "disabled" }`
- raises the DeepSeek output budget to 8,192 tokens

The same change is committed in this fork's `src/lib/ai/providers/openai-compatible.ts`, with a regression test in `src/lib/ai/providers.test.ts`. Upstream does not have it, so keep it when merging a new release.

When merging an upstream release, resolve conflicts in that file by keeping the DeepSeek detection, the `thinking` body field and the larger token budget, then run `docker/bin/yarn test src/lib/ai/providers.test.ts` in the Docker dev environment.

### 4. If the release changes `compose.yml`

Release notes occasionally add environment variables, volumes, or services. Compare before replacing:

```bash
cd /home/ubuntu/dossier

curl -fsSL -o compose.yml.new \
  https://raw.githubusercontent.com/avinashbatchala/dossier/v1.7.0-deepseek.1/compose.production.yml

diff -u compose.yml compose.yml.new
```

`v1.7.0` adds optional Gmail and Calendar settings (`DOSSIER_GOOGLE_CLIENT_ID`, `DOSSIER_GOOGLE_CLIENT_SECRET`, `DOSSIER_PUBLIC_URL`). They default to empty, so existing deployments keep working; enter the Google client in **Settings → Google**, or add the values to `.env`, when enabling that integration.

If the diff is correct:

```bash
mv compose.yml.new compose.yml
sudo docker compose up -d
```

Your `.env` is not overwritten.

### Switching back to the upstream image

The upstream image does not include the DeepSeek patch, so the cut-off error will return unless the provider is changed.

```dotenv
DOSSIER_IMAGE=ghcr.io/aientech/dossier:v1.7.0
```

```bash
cd /home/ubuntu/dossier
sudo docker compose pull
sudo docker compose up -d
```

### Building this fork or pushing to ECR

The local build is the simplest path on this instance. If you prefer a registry:

1. Build and push an image to ECR, or build on a machine with more memory than the 2 GB instance.
2. Set the image in `.env`:

   ```dotenv
   DOSSIER_IMAGE=<account>.dkr.ecr.us-east-1.amazonaws.com/dossier:<tag>
   ```

3. Pull and recreate:

   ```bash
   sudo docker compose pull
   sudo docker compose up -d
   ```

If ECR is private, authenticate Docker on the instance first with a short-lived ECR token:

```bash
aws ecr get-login-password --region us-east-1 | \
  ssh -i "$DOSSIER_SSH_KEY" "$DOSSIER_SSH" \
  "sudo docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com"
```

The image stays cached locally after it is pulled.

### Rollback

The current image is tagged twice:

- `dossier:deepseek-fix` — the image in use
- `dossier:deepseek-fix-20261019` — the same image, kept for rollback
- `dossier:deepseek-fix-20261018` — the previous upstream v1.5.0 build

If the app fails after an update:

1. Stop the app.
2. Restore the database dump if migrations ran.
3. Point `DOSSIER_IMAGE` at the previous image.
4. Recreate the stack.

```bash
sudo docker compose stop app

sudo docker compose exec -T db pg_restore --clean --if-exists \
  -U dossier -d dossier < "$HOME/dossier-YYYY-MM-DD.dump"

# edit DOSSIER_IMAGE to dossier:deepseek-fix-20261019 (or 20261018 for the previous release)
sudo docker compose up -d
```

Do not repeatedly restart a container whose migration failed. Read the log, restore the backup, then retry.

---

## Rotating the login password

Dossier has one user and no username: the login page asks only for a password. `DOSSIER_PASSWORD` stores an argon2id **hash**, never the plaintext password.

### 1. Generate a new hash

On the server:

```bash
sudo docker run --rm -it ghcr.io/aientech/dossier hash-password
```

Type the new password twice. The command prints one line:

```text
argon2id:m=19456,t=2,p=1:<salt>:<hash>
```

Alternatively, from a machine with Docker:

```bash
docker run --rm -it ghcr.io/aientech/dossier hash-password
```

On Apple Silicon, if needed:

```bash
docker run --platform linux/amd64 --rm -it ghcr.io/aientech/dossier hash-password
```

Do not use a one-liner that puts the plaintext password in shell history. Prefer the interactive prompt.

### 2. Replace the hash in `.env`

```bash
cd /home/ubuntu/dossier
nano .env
```

Replace the entire `DOSSIER_PASSWORD=` line with the new hash, then save. Keep the file at mode `600`:

```bash
chmod 600 .env
```

### 3. Recreate the app

```bash
sudo docker compose up -d
```

### 4. Verify

```bash
sudo docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
curl -sS -o /dev/null -w '%{http_code}\n' "https://${DOSSIER_HOST}/login"
```

Then sign in with the new password.

### Effects of rotating the login password

- All existing browser sessions are signed out.
- Saved AI and job-source API keys are **not** invalidated; they are encrypted with `DOSSIER_SECRET`, not the password.
- The old password stops working immediately after the app recreates.
- If the hash is malformed, the server refuses to start and logs which variable to fix.

---

## Rotating secrets

### `DOSSIER_SECRET`

`DOSSIER_SECRET` signs session tokens and derives the key that encrypts saved API keys.

Generate a new value:

```bash
openssl rand -hex 32
```

Update `.env`:

```dotenv
DOSSIER_SECRET=<the new value>
```

Recreate:

```bash
cd /home/ubuntu/dossier
sudo docker compose up -d
```

Effects:

- Every existing session is signed out.
- Saved AI and job-source API keys can no longer be decrypted and must be entered again in **Settings**.
- Data in PostgreSQL and `/data` is not affected.
- Keep a copy of `DOSSIER_SECRET` with your backups. Without it, saved API keys cannot be recovered.

### PostgreSQL password

Rotating `POSTGRES_PASSWORD` in `.env` alone is **not enough**. The official PostgreSQL image only uses that variable when initializing a new data directory. On an existing volume, you must change the database user's password too.

Generate a new password (hex avoids quoting problems):

```bash
NEW_DB_PASSWORD="$(openssl rand -hex 24)"
echo "$NEW_DB_PASSWORD"
```

Change it in PostgreSQL:

```bash
cd /home/ubuntu/dossier
sudo docker compose exec -T db psql -U dossier -d dossier \
  -c "ALTER USER dossier WITH PASSWORD '$NEW_DB_PASSWORD';"
```

Immediately update `.env`:

```dotenv
POSTGRES_PASSWORD=<the same new value>
```

Recreate the stack:

```bash
sudo docker compose up -d
```

Verify:

```bash
curl -fsS http://127.0.0.1:3000/api/health
```

The app may briefly lose database connections between the `ALTER USER` and the container recreation, so do this during a quiet period.

If you set `POSTGRES_PASSWORD` to a value containing shell-special characters, use a hex value instead. The Compose file builds the app's `DATABASE_URL` from this variable.

### DeepSeek / AI API key

The provider, server URL, and model are saved in **Settings → AI provider**. The key is encrypted with `DOSSIER_SECRET`.

To rotate:

1. Sign in.
2. Open **Settings → AI provider**.
3. Paste the new DeepSeek key into **API key**.
4. Press **Test connection**.

If `DOSSIER_SECRET` was also rotated, re-enter the key after that change.

Saved Settings take precedence over `DOSSIER_AI_*` environment values. On this deployment the provider, URL, and model are already saved in Settings, so manage the key in the Settings UI. To switch back to environment-based AI configuration, you would have to clear the saved provider rows (`provider`, `baseUrl`, `model`, `apiKeyEnc`) from the `Setting` table, or use a fresh database.

---

## Backups

There are three separate things to back up.

### 1. PostgreSQL

```bash
cd /home/ubuntu/dossier
sudo docker compose exec -T db pg_dump -U dossier -Fc dossier \
  > "$HOME/dossier-$(date +%F).dump"
```

Keep dumps off the instance. For example, copy them to your Mac:

```bash
scp -i "$DOSSIER_SSH_KEY" \
  "$DOSSIER_SSH:$HOME/dossier-$(date +%F).dump" ./
```

### 2. Dossier's own nightly backups

With **Nightly backups** enabled, the app writes an export to `/data/backups` at 03:00 in the container's time zone (`UTC` here) and deletes backups older than `DOSSIER_BACKUP_RETENTION_DAYS` (14 by default).

Copy them off the instance:

```bash
sudo docker compose cp app:/data/backups "./dossier-backups-$(date +%F)"
```

### 3. Secrets and configuration

Back up `.env`, which contains:

- `POSTGRES_PASSWORD`
- `DOSSIER_SECRET`
- `DOSSIER_PASSWORD` (the login hash)
- the AI provider defaults

```bash
cp /home/ubuntu/dossier/.env "$HOME/dossier.env.backup.$(date +%F)"
chmod 600 "$HOME/dossier.env.backup."*
```

Store the backup securely. Without `DOSSIER_SECRET`, saved API keys cannot be decrypted.

### Lightsail snapshots

Automatic snapshots are currently **not enabled**. Enable them in the Lightsail console or with the AWS CLI:

```bash
aws lightsail enable-add-on \
  --region us-east-1 \
  --resource-name dossier \
  --add-on-request '{"addOnType":"AutoSnapshot","autoSnapshotAddOnRequest":{"snapshotTimeOfDay":"03:00"}}'
```

Snapshots cost about `$0.05/GB-month`; for the 60 GB plan that is roughly **$3/month**. A snapshot backs up the whole instance, but an off-instance database dump is still the easiest restore path.

### Restore PostgreSQL

Stop the app so it cannot write while restoring:

```bash
cd /home/ubuntu/dossier
sudo docker compose stop app

sudo docker compose exec -T db pg_restore --clean --if-exists \
  -U dossier -d dossier < "$HOME/dossier-YYYY-MM-DD.dump"

sudo docker compose start app
curl -fsS http://127.0.0.1:3000/api/health
```

### Restore the whole instance

1. Create a new Lightsail instance from the snapshot, or rebuild from scratch.
2. Attach a static IP and open ports `22`, `80`, `443`.
3. Install Docker and Caddy.
4. Restore `/home/ubuntu/dossier/.env` from your secure backup.
5. Copy `compose.production.yml` to `/home/ubuntu/dossier/compose.yml`.
6. Start only the database, restore the latest dump, then start the app.
7. Reconfigure Caddy and DNS.
8. Verify `/api/health` and sign in.

---

## Troubleshooting

### The app is unreachable

From the server:

```bash
cd /home/ubuntu/dossier
sudo docker compose ps
curl -fsS http://127.0.0.1:3000/api/health
sudo ss -ltnp | grep -E ':80|:443|:3000'
```

From your Mac:

```bash
nc -vz "$DOSSIER_IP" 443
curl -vI "https://${DOSSIER_HOST}/login"
dig +short "$DOSSIER_HOST"
```

- `dig` does not return the static IP: DNS or the `sslip.io` hostname is wrong.
- `nc` times out: the Lightsail firewall or UFW is blocking the port.
- Caddy returns `502`: Caddy is up, the app is down.
- `/api/health` returns `503`: the app is up, PostgreSQL is down.
- `https://<IP>` fails TLS: use the hostname. The certificate is issued for the hostname.
- `http://<IP>:3000` times out: port 3000 is intentionally private.

### Caddy / TLS

```bash
sudo systemctl status caddy
sudo journalctl -u caddy -n 100 --no-pager
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Current Caddyfile:

```caddyfile
dossier.<STATIC_IP>.sslip.io {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}

http://<STATIC_IP> {
    redir https://dossier.<STATIC_IP>.sslip.io{uri} permanent
}
```

The certificate renews automatically. If you move to a real domain, add its DNS `A` record first, replace the hostname in the Caddyfile, then reload Caddy.

### `sslip.io` is blocked on your network

Use a real domain from Route 53 instead. Add an `A` record pointing at the static IP, update the Caddyfile, and reload Caddy. Let's Encrypt will issue a certificate for the new hostname.

### Forgot the password

Rotate `DOSSIER_PASSWORD` using the steps above. There is no password-reset email flow.

### Locked out by sign-in rate limiting

After repeated failures, the app backoffs in PostgreSQL. Clear the counters only while developing or after you are sure the attempts were yours:

```bash
cd /home/ubuntu/dossier
sudo docker compose exec -T db psql -U dossier -d dossier \
  -c 'DELETE FROM "LoginThrottle";'
```

### Disk or memory pressure

```bash
free -h
df -h /
sudo docker system df
```

The app is limited to 1 GB of memory by `compose.yml`, which is intentional because Chromium prints PDFs. Do not remove that limit on the 2 GB plan without checking available memory.

---

## Security checklist

- SSH key is mode `600`; the private key is never committed or shared.
- `/home/ubuntu/dossier/.env` is mode `600`.
- Only ports `22`, `80`, and `443` are open in both the Lightsail firewall and UFW.
- The app port is bound to `127.0.0.1:3000`, not `0.0.0.0`.
- TLS is terminated by Caddy with a valid Let's Encrypt certificate.
- `DOSSIER_TELEMETRY=off`.
- No secrets are committed to this public repository.
- Use the AWS SSO administrator role only for setup. For routine operations, prefer a scoped IAM role.
- Keep Ubuntu packages patched:

  ```bash
  sudo apt update
  sudo apt upgrade -y
  ```

  Reboot when the kernel or core packages require it. Docker and Caddy start automatically.
- Keep off-instance backups, not only the nightly copies on the same disk.

---

## Cost

Current baseline:

- Lightsail `small_3_0`: **$12/month**
- Static IP: included while attached
- 3 TB transfer: included
- TLS via Let's Encrypt: free
- No load balancer, NAT gateway, RDS, or ECS charges
- DeepSeek API: separate, usage-based (usually cents per application)

Optional:

- Lightsail automatic snapshots: roughly **$3/month** for the 60 GB plan
- A real domain: registration plus Route 53 hosted zone (about `$0.50/month` if not already in use)

To stop the AWS charges, delete the instance. A stopped Lightsail instance is not a reliable way to avoid ongoing storage charges.

---

## Teardown

> Destructive. This deletes the running app and its database. Take an export and a database dump first.

```bash
# 1. Delete the instance
aws lightsail delete-instance \
  --region us-east-1 \
  --instance-name dossier

# 2. Release the static IP
aws lightsail release-static-ip \
  --region us-east-1 \
  --static-ip-name dossier-ip

# 3. Optional: delete the Lightsail key-pair resource
aws lightsail delete-key-pair \
  --region us-east-1 \
  --key-pair-name dossier-deploy
```

If you created snapshots, list and delete them separately:

```bash
aws lightsail get-instance-snapshots --region us-east-1
aws lightsail delete-instance-snapshot \
  --region us-east-1 \
  --instance-snapshot-name <snapshot-name>
```

Removing the Lightsail key-pair resource does not remove keys already inside the instance's `~/.ssh/authorized_keys`.

---

## Rebuild from scratch

This is the condensed disaster-recovery path.

1. Create a Lightsail key pair and download the private key.
2. Create an Ubuntu 24.04 `small_3_0` instance named `dossier` in `us-east-1a`.
3. Allocate and attach a static IP named `dossier-ip`.
4. Open ports `22`, `80`, and `443`.
5. SSH in and install Docker:

   ```bash
   sudo apt-get update
   sudo apt-get install -y ca-certificates curl gnupg
   sudo install -m 0755 -d /etc/apt/keyrings
   curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
     | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
   sudo chmod a+r /etc/apt/keyrings/docker.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
     https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
     | sudo tee /etc/apt/sources.list.d/docker.list
   sudo apt-get update
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
     docker-buildx-plugin docker-compose-plugin
   sudo usermod -aG docker ubuntu
   ```

6. Install Caddy from its official repository:

   ```bash
   sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
   curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
     | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
   curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
     | sudo tee /etc/apt/sources.list.d/caddy-stable.list
   sudo apt-get update
   sudo apt-get install -y caddy
   sudo systemctl enable --now caddy
   ```
7. Add a 4 GB swap file for image builds:

   ```bash
   sudo fallocate -l 4G /swapfile
   sudo chmod 600 /swapfile
   sudo mkswap /swapfile
   sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

8. Create `/home/ubuntu/dossier`, copy `compose.production.yml` there as `compose.yml`, and create `.env` with the required secrets, including:

   ```dotenv
   DOSSIER_IMAGE=dossier:deepseek-fix
   ```

9. Build the patched image:

   ```bash
   git clone --depth 1 --branch v1.7.0-deepseek.1 \
     https://github.com/avinashbatchala/dossier.git /home/ubuntu/dossier-src
   cd /home/ubuntu/dossier-src
   # The DeepSeek fix is already committed on this tag.
   sudo docker build --target production -t dossier:deepseek-fix .
   ```

10. Start the stack:

    ```bash
    cd /home/ubuntu/dossier
    sudo docker compose up -d
    ```

11. Write `/etc/caddy/Caddyfile`, validate, and restart Caddy.
12. Enable UFW rules for `22`, `80`, and `443`.
13. Verify `/api/health`, sign in, and enter the DeepSeek key in Settings.
