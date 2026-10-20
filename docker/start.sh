#!/bin/sh
# The production container's command (E12-3): bring the database up to date,
# load the built-in themes, then serve. If a step fails, the container stops
# with a non-zero exit code, so CapRover and Docker don't switch over to it.
set -eu

cd /app/tools
if ! node node_modules/prisma/build/index.js migrate deploy; then
  echo "Dossier didn't start: applying the database migrations failed (see the error above). See Troubleshooting in the wiki: https://github.com/AienTech/dossier/wiki/Troubleshooting" >&2
  exit 1
fi
if ! node seed.mjs; then
  echo "Dossier didn't start: loading the built-in themes failed (see the error above)." >&2
  exit 1
fi

cd /app
exec node server.js
