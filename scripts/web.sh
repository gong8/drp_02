#!/usr/bin/env bash
# `pnpm web` - run the API + Expo web so you can open the app in a browser.
#
# - Uses the LOCAL dev database: apps/api/.env already points DATABASE_URL at the docker
#   Postgres on localhost:5433, and this script makes sure that container is up first.
# - The browser runs on this same Mac, so "localhost" resolves to the API here - no need to
#   detect a LAN address like scripts/phone.sh does for a physical phone.
#
# This deliberately does NOT point at the deployed App Runner API (which talks to the prod
# db). Use a deployed build for that.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_URL="http://localhost:3000"
echo "API: $API_URL  (local dev db on localhost:5433)"
echo

# Make sure the local dev database is running before the API boots + seeds against it.
docker compose up -d
echo

# Run the API in the background (logs prefixed with [api]) and Expo web in the foreground.
cleanup() {
  pkill -f "tsx watch src/index.ts" 2>/dev/null || true
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

( pnpm --filter @bethere/api dev 2>&1 | sed -u 's/^/[api] /' ) &
API_PID=$!

# Let the API claim port 3000 before Metro starts.
sleep 2

# The mobile bundle reads EXPO_PUBLIC_API_URL at build time; set it only for Expo.
# EXPO_PUBLIC_DEV_AUTH=1 keeps the dev auth bypass on, matching the API's DEV_AUTH_BYPASS=1.
# Not `exec` - we want the cleanup trap to fire and stop the API when Expo exits.
cd apps/mobile
EXPO_PUBLIC_API_URL="$API_URL" EXPO_PUBLIC_DEV_AUTH=1 pnpm exec expo start --web
