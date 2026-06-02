#!/usr/bin/env bash
# `pnpm phone` - run the API + Expo so you can open the app on a physical iPhone (Expo Go).
#
# - Uses the LOCAL dev database: apps/api/.env already points DATABASE_URL at the docker
#   Postgres on localhost:5433, and this script makes sure that container is up first.
# - Exposes the API at the Mac's LAN IP (not localhost) so the phone's app can reach tRPC.
#   On the phone, "localhost" means the phone itself, so EXPO_PUBLIC_API_URL must be the Mac.
#
# Requirement: the iPhone and this Mac must be on the SAME Wi-Fi network. If your network
# blocks device-to-device traffic (some corporate/guest Wi-Fi), Expo Go won't connect - use a
# normal home/personal hotspot network instead.
#
# Override the detected IP if needed: `LAN_IP=192.168.1.42 pnpm phone`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Detect the LAN IP of the active default interface (macOS). Override via LAN_IP env var.
if [ -z "${LAN_IP:-}" ]; then
  IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  IFACE="${IFACE:-en0}"
  # ipconfig getifaddr only reports DHCP-tracked addresses; fall back to parsing ifconfig
  # for statically/tether-assigned addresses (returns nothing for down interfaces).
  LAN_IP="$(ipconfig getifaddr "$IFACE" 2>/dev/null || true)"
  if [ -z "$LAN_IP" ]; then
    LAN_IP="$(ifconfig "$IFACE" 2>/dev/null | awk '/inet /{print $2; exit}' || true)"
  fi
fi
if [ -z "${LAN_IP:-}" ]; then
  echo "Could not detect a LAN IP. Connect to Wi-Fi, or pass it: LAN_IP=192.168.x.y pnpm phone" >&2
  exit 1
fi

API_URL="http://$LAN_IP:3000"
echo "LAN IP: $LAN_IP  (your iPhone must be on the same Wi-Fi)"
echo "API:    $API_URL  (local dev db on localhost:5433)"
echo

# Make sure the local dev database is running before the API boots + seeds against it.
docker compose up -d
echo

# Expo MUST run in the foreground so it keeps the terminal (TTY) and renders the interactive
# QR code + dev menu - piping it through a multiplexer (concurrently) suppresses the QR. So we
# run the API in the background (logs prefixed with [api]) and Expo in the foreground.
cleanup() {
  pkill -f "tsx watch src/index.ts" 2>/dev/null || true
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

( pnpm --filter @bethere/api dev 2>&1 | sed -u 's/^/[api] /' ) &
API_PID=$!

# Let the API claim port 3000 before Metro starts so the boot logs don't clobber the QR.
sleep 2

# The mobile bundle reads EXPO_PUBLIC_API_URL at build time; set it only for Expo.
# Not `exec` - we want the cleanup trap to fire and stop the API when Expo exits.
cd apps/mobile
EXPO_PUBLIC_API_URL="$API_URL" pnpm exec expo start
