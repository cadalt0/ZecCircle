#!/usr/bin/env bash
# Builds the Docker image locally and releases it to a Heroku app as a worker dyno.
#
#   bash scripts/heroku-deploy.sh <heroku-app-name>
#
# One-time setup on Heroku first:
#   heroku create <app>                       (or use an existing app)
#   heroku stack:set container -a <app>
#   heroku config:set -a <app> \
#     TELEGRAM_BOT_TOKEN=... ANTHROPIC_API_KEY=... BITREFILL_MODE=mock \
#     DATABASE_URL='postgres://...neon.tech/...?sslmode=require' \
#     ZCASH_MODE=testnet ZCASH_SETTLEMENT_ADDRESS=utest1... NODE_ENV=production
#   (copy any other settings you changed from your local .env)
#
# Afterwards run exactly ONE worker:  heroku ps:scale worker=1 -a <app>
# (two copies would fight over Telegram updates). Logs: heroku logs --tail -a <app>
set -euo pipefail

APP="${1:?usage: bash scripts/heroku-deploy.sh <heroku-app-name>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVTOOL="$ROOT/../tools/bin/zcash-devtool"

[[ -x "$DEVTOOL" ]] || { echo "Missing $DEVTOOL. Run scripts/zcash-setup.sh first." >&2; exit 1; }
command -v heroku >/dev/null || { echo "Install the Heroku CLI first: https://devcenter.heroku.com/articles/heroku-cli" >&2; exit 1; }

mkdir -p "$ROOT/bin"
cp "$DEVTOOL" "$ROOT/bin/zcash-devtool"

cd "$ROOT"
heroku container:login
heroku container:push worker -a "$APP"
heroku container:release worker -a "$APP"
echo
echo "Released. Scale it with:  heroku ps:scale worker=1 -a $APP"
