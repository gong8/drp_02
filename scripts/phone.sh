#!/usr/bin/env bash
# `pnpm phone` - view the app on a physical iPhone via Expo Go, against the local dev DB.
# The phone and this Mac must be on the same Wi-Fi. Needs a real LAN IPv4 (Imperial-WPA
# hands one out - e.g. 172.26.x - as long as the Mac actually takes the lease; see below).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Real LAN IPv4 of the default interface. Skip the CLAT fake (192.0.0.2/32, netmask /32),
# which only exists inside this Mac and is not reachable by the phone.
IFACE="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
IFACE="${IFACE:-en0}"
LAN_IP="${LAN_IP:-$(ifconfig "$IFACE" 2>/dev/null | awk '/inet /{if ($4 != "0xffffffff") {print $2; exit}}')}"

if [ -z "$LAN_IP" ]; then
  echo "No real LAN IPv4 on $IFACE - the Mac only has the CLAT fake (192.0.0.2)." >&2
  echo "Fix: System Settings > Wi-Fi > (network) Details > TCP/IP >" >&2
  echo "     set 'Configure IPv6' to 'Link-local only', then reconnect Wi-Fi." >&2
  echo "That makes macOS take the IPv4 lease instead of going IPv6-only." >&2
  exit 1
fi

echo "Mac IP: $LAN_IP    API: http://$LAN_IP:3000    (phone must be on the same Wi-Fi)"
docker compose up -d

# Run the API in the background (local .env -> local db), Expo in the foreground so it keeps
# the terminal and renders the QR. The trap stops the API when you quit Expo.
trap 'pkill -f "tsx watch src/index.ts" 2>/dev/null || true; [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null || true' EXIT INT TERM
( pnpm --filter @bethere/api dev 2>&1 | sed -u 's/^/[api] /' ) &
API_PID=$!
sleep 2

cd apps/mobile
EXPO_PUBLIC_API_URL="http://$LAN_IP:3000" pnpm exec expo start
