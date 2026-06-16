#!/usr/bin/env bash
# `pnpm demo` - view the app on a physical phone via Expo Go, against the LIVE deployed API.
#
# This is `pnpm phone`'s sibling: it shows the same Expo QR, but instead of standing up a
# local Postgres + API and pointing the bundle at this machine's LAN IP, it points the bundle
# straight at the deployed App Runner backend (real prod data, real seeds). So there is no
# docker, no local API, and no LAN-IP-for-the-API detection here - Expo still serves the JS
# bundle over your LAN for the QR, so the phone must be on the same Wi-Fi as this machine
# (or pass `--tunnel`, which is forwarded to expo, to demo from anywhere).
#
# Auth comes from apps/mobile/.env (gitignored), exactly like the CD-built APK: the real Clerk
# publishable key enables Google sign-in, and EXPO_PUBLIC_DEV_AUTH=1 shows the "Continue as
# test user" bypass (the live API runs with DEV_AUTH_BYPASS=1, so the bypass works too).
#
# Defaults to the PRODUCTION App Runner. To demo the parallel dev stack instead:
#   API_URL=https://wumksaeb3j.us-east-1.awsapprunner.com pnpm demo
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The deployed backend. Override with API_URL=... pnpm demo (e.g. the dev App Runner above).
API_URL="${API_URL:-https://96mgvmgcbj.us-east-1.awsapprunner.com}"

echo "Demo target: $API_URL    (live deployed API - the phone must be on this machine's Wi-Fi for the bundle)"

# Confirm the live API is actually reachable before we hand a QR to anyone. /trpc/health is the
# App Runner health route; a 200 with {"ok":true} means we're good. Warn-but-continue so a transient
# probe failure (captive portal, brief cold start) doesn't block the demo.
if ! curl -fsS -m 15 "$API_URL/trpc/health" | grep -q '"ok":true'; then
  echo "WARNING: could not confirm $API_URL/trpc/health is up. Continuing anyway - the app may fail to load data." >&2
else
  echo "Health check OK: $API_URL/trpc/health responded {\"ok\":true}"
fi

# The mobile bundle reads EXPO_PUBLIC_API_URL at build time; set it only for Expo. The Clerk
# key and dev-auth flag come from apps/mobile/.env, which Expo loads automatically. Extra args
# (e.g. --tunnel) are forwarded to expo. Use `exec` - there is no local API to clean up.
cd apps/mobile
exec env EXPO_PUBLIC_API_URL="$API_URL" pnpm exec expo start "$@"
