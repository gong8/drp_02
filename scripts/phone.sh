#!/usr/bin/env bash
# `pnpm phone` - run the API + Expo so you can open the app on a physical iPhone (Expo Go).
#
# - Uses the LOCAL dev database: apps/api/.env already points DATABASE_URL at the docker
#   Postgres on localhost:5433, and this script makes sure that container is up first.
# - Exposes the API at the Mac's address (not localhost) so the phone's app can reach tRPC.
#   On the phone, "localhost" means the phone itself, so EXPO_PUBLIC_API_URL must be the Mac.
#
# Picks IPv4 when the Mac has a real LAN IPv4. On IPv6-only networks (e.g. Imperial eduroam /
# Imperial-WPA, which run NAT64 + CLAT so the Mac only gets a fake 192.0.0.2/32 IPv4) it falls
# back to the Mac's GLOBAL IPv6 address - the phone shares the same IPv6 /64 and reaches it
# directly. Requirement either way: phone + Mac on the SAME Wi-Fi.
#
# Override the detected address if needed: `LAN_IP=192.168.1.42 pnpm phone` (v4 or v6).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
IFACE="${IFACE:-en0}"
HOST_BIND="0.0.0.0"   # API listen host; switched to "::" for IPv6

# IPv6 must be BRACKETED everywhere it goes into a URL/hostname - Expo's debug middleware
# does `new URL("http://" + host + ":" + port)`, which throws on a bare IPv6 address.
if [ -n "${LAN_IP:-}" ]; then
  case "$LAN_IP" in *:*) HOST_BIND="::"; API_HOST="[$LAN_IP]"; METRO_HOST="[$LAN_IP]";; *) API_HOST="$LAN_IP"; METRO_HOST="$LAN_IP";; esac
else
  # Prefer a real LAN IPv4 (skip CLAT's fake 192.0.0.2/32, netmask 0xffffffff).
  LAN_IP="$(ifconfig "$IFACE" 2>/dev/null | awk '/inet /{if ($4 != "0xffffffff") {print $2; exit}}' || true)"
  if [ -n "$LAN_IP" ]; then
    API_HOST="$LAN_IP"; METRO_HOST="$LAN_IP"
  else
    # No real IPv4 -> IPv6-only network. Use the stable global IPv6 (autoconf secured,
    # not the temporary/privacy one, not link-local fe80, not the clat46 address).
    LAN_IP="$(ifconfig "$IFACE" 2>/dev/null | awk '/inet6 / && /autoconf/ && /secured/ && !/temporary/{print $2; exit}' | sed 's/%.*//' || true)"
    if [ -z "$LAN_IP" ]; then
      echo "No usable LAN IPv4 or global IPv6 on $IFACE. Connect to Wi-Fi, or pass LAN_IP=... pnpm phone" >&2
      exit 1
    fi
    HOST_BIND="::"; API_HOST="[$LAN_IP]"; METRO_HOST="[$LAN_IP]"
    echo "No real IPv4 (network is IPv6-only / CLAT) - using IPv6."
  fi
fi

API_URL="http://$API_HOST:3000"
echo "Mac address: $LAN_IP  (your iPhone must be on the same Wi-Fi)"
echo "API:         $API_URL  (local dev db on localhost:5433)"
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

( HOST="$HOST_BIND" pnpm --filter @bethere/api dev 2>&1 | sed -u 's/^/[api] /' ) &
API_PID=$!

# Let the API claim port 3000 before Metro starts so the boot logs don't clobber the QR.
sleep 2

# The mobile bundle reads EXPO_PUBLIC_API_URL at build time; set it only for Expo.
# REACT_NATIVE_PACKAGER_HOSTNAME makes Metro advertise the QR at our chosen address (the
# global IPv6 on IPv6-only networks) instead of the unreachable CLAT 192.0.0.2.
# Not `exec` - we want the cleanup trap to fire and stop the API when Expo exits.
cd apps/mobile
EXPO_PUBLIC_API_URL="$API_URL" REACT_NATIVE_PACKAGER_HOSTNAME="$METRO_HOST" pnpm exec expo start
