#!/bin/sh
# Trainer Desk auto-deploy. Runs every 5 minutes from cron (see deploy/README.md):
#   1. asks GitHub whether `main` has new commits; if not, stops (takes about a second)
#   2. runs the tests on the new version in a throwaway copy; if they fail, the live app is not touched
#   3. switches the server folder to the new version and restarts the container
#   4. checks the app answers; if it does not within 60 s, goes back to the previous version
# .env and data/ are not in git, so they are never changed. Everything is logged to data/deploy.log.
set -eu

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BRANCH="${BRANCH:-main}"
PORT="${PORT:-8095}"
HEALTH_TRIES="${HEALTH_TRIES:-30}"   # 2 s apart
cd "$APP_DIR"
mkdir -p data
LOG="$APP_DIR/data/deploy.log"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; }

# One run at a time.
exec 9>"$APP_DIR/data/.deploy.lock"
flock -n 9 || exit 0

git fetch --quiet origin "$BRANCH" || { log "could not reach GitHub"; exit 1; }
OLD=$(git rev-parse HEAD)
NEW=$(git rev-parse "origin/$BRANCH")
[ "$OLD" = "$NEW" ] && exit 0
# A version whose tests already failed is not tried again until a newer one arrives.
[ -f data/.deploy-failed ] && [ "$(cat data/.deploy-failed)" = "$NEW" ] && exit 0

log "new version $(git log -1 --format='%h %s' "$NEW") (live: $(git log -1 --format='%h' "$OLD"))"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git archive "$NEW" | tar -x -C "$TMP"
if ! docker run --rm -v "$TMP":/app -w /app node:22-alpine npm test >> "$LOG" 2>&1; then
  echo "$NEW" > data/.deploy-failed
  log "tests FAILED: staying on $(git log -1 --format='%h' "$OLD")"
  exit 1
fi

git reset --hard --quiet "$NEW"
docker compose up -d --force-recreate >> "$LOG" 2>&1

ok=0
for i in $(seq 1 "$HEALTH_TRIES"); do
  if wget -q -O /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null || curl -fs -o /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null; then ok=1; break; fi
  sleep 2
done
if [ "$ok" = 1 ]; then
  rm -f data/.deploy-failed
  log "live: $(git log -1 --format='%h %s')"
else
  echo "$NEW" > data/.deploy-failed
  git reset --hard --quiet "$OLD"
  docker compose up -d --force-recreate >> "$LOG" 2>&1
  log "app did not start: went back to $(git log -1 --format='%h' "$OLD")"
  exit 1
fi
