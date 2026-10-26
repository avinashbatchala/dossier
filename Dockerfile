# syntax=docker/dockerfile:1

# Debian rather than Alpine: PDFs are printed by Playwright's own Chromium,
# which isn't built for musl (decided in E5-5, #46).
FROM node:24-trixie-slim AS base
WORKDIR /app
# Swap the image's bundled Yarn 1 for the version pinned in package.json (packageManager).
RUN corepack enable
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Where Playwright keeps Chromium: in the image, not in a user's home or a volume.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Development image: dependencies are baked in, source is bind-mounted by compose.yml.
FROM base AS dev
RUN chown node:node /app
USER node
COPY --chown=node:node package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable && mkdir .next
# Chromium for PDFs, matching the installed playwright-core, with the system
# libraries and fonts it needs (installing those takes root). Only the
# headless shell: printing needs nothing more.
USER root
RUN node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
  && rm -rf /var/lib/apt/lists/*
USER node
EXPOSE 3000
# The seed is idempotent: built-in themes, an empty profile and default settings.
CMD ["sh", "-c", "yarn prisma generate && yarn prisma migrate deploy && yarn prisma db seed && yarn dev"]

# ── Production (E12-1) ───────────────────────────────────────────────────────
# Dependencies, then the build, then a runtime with only what running needs:
# the standalone server, Chromium for PDFs, and Prisma's CLI for migrations.
# Builds without any secrets: the environment is read when the server starts.

FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
RUN yarn install --immutable

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
# V8 sizes its heap from the machine's RAM, which on a 2 GB instance stops the
# type check around 1 GB. The build machines keep swap for it (see
# INFRASTRUCTURE.md); this lets Node use it rather than die.
ENV NODE_OPTIONS="--max-old-space-size=2048"
COPY . .
RUN yarn prisma generate && yarn build
# Prisma's CLI for `migrate deploy`, at the version in yarn.lock, with the
# same resolutions as package.json; not the rest of the dev dependencies.
RUN mkdir /tools && node -e ' \
  const version = (name) => require(`/app/node_modules/${name}/package.json`).version; \
  const resolutions = require("/app/package.json").resolutions ?? {}; \
  require("node:fs").writeFileSync("/tools/package.json", JSON.stringify({ \
    private: true, \
    dependencies: { prisma: version("prisma"), dotenv: version("dotenv") }, \
    overrides: Object.fromEntries(Object.entries(resolutions).map(([from, to]) => [from.split("@npm:")[0], to])), \
  }));' \
  && cd /tools && npm install --omit=dev --no-audit --no-fund \
  && cp -r /app/prisma7.config.ts /app/prisma /tools/
# The seed as one JavaScript file, so it runs without tsx (E12-3). Bundled
# CommonJS packages (pg) need a real require.
RUN node_modules/.bin/esbuild prisma/seed.ts --bundle --platform=node --format=esm --target=node24 \
  --external:pg-native --outfile=/tools/seed.mjs \
  --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);'
# `hash-password`, which makes the hash for DOSSIER_PASSWORD, as one file too.
RUN node_modules/.bin/esbuild scripts/hash-password.ts --bundle --platform=node --format=esm --target=node24 \
  --outfile=/tools/hash-password.mjs --banner:js='#!/usr/bin/env node' \
  && chmod 755 /tools/hash-password.mjs

FROM base AS production
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DOSSIER_DATA_DIR=/data
# Chromium for PDFs with its system libraries and fonts, matching the app's
# playwright-core, as in the dev image. Its CLI is only mounted for this.
RUN --mount=type=bind,from=deps,source=/app/node_modules/playwright-core,target=/tmp/playwright-core \
  node /tmp/playwright-core/cli.js install --with-deps --only-shell chromium \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /tools ./tools
# On the PATH, so `docker run --rm -it ghcr.io/aientech/dossier hash-password` works.
RUN ln -s /app/tools/hash-password.mjs /usr/local/bin/hash-password
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Backups and export zips (mount a volume here); the server's own cache.
RUN mkdir -p /data .next/cache && chown node:node /data .next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
COPY docker/start.sh ./start.sh
# Migrations, the seed, then the server (E12-3).
CMD ["./start.sh"]
