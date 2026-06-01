#!/usr/bin/env bash
# Free the local dev server ports when an orphaned process is squatting on one.
# Covers the API (3000) and Metro/Expo (8081, with common fallbacks). Postgres (5433)
# is a docker container, so use `pnpm db:down` for that, not this script.
#
# Killing the listener alone is not enough: `tsx watch` supervises the API and respawns a
# fresh child on 3000, so we kill the watcher (and Expo) by name first, then sweep the ports.
set -u

pkill -9 -f "tsx watch src/index.ts" 2>/dev/null || true   # API dev watcher
pkill -9 -f "tsx src/index.ts" 2>/dev/null || true         # API (non-watch) if started directly
pkill -9 -f "expo start" 2>/dev/null || true               # Expo / Metro dev server

freed=0
for port in 3000 8081 8082 19000 19001 19002; do
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
    echo "freed :$port ($pids)"
    freed=1
  fi
done

[ "$freed" -eq 0 ] && echo "dev ports already clear (3000, 8081)."
echo "done."
exit 0
