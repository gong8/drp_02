# `pnpm phone` script + the Imperial-WPA macOS CLAT saga - 2026-06-02

**Branch:** dev | **PRs:** none opened this session (work committed directly to `dev`) | **Scope:** add a `pnpm phone` script to view the Expo app on a physical iPhone against the local dev DB; then a very long debugging session on why Expo Go could not connect on Imperial College Wi-Fi, root-caused to macOS going IPv6-only/CLAT.

## TL;DR
The user wanted a `pnpm phone` script that launches Expo + the API so they can open the app on their physical iPhone via Expo Go, using the local docker Postgres. The script was straightforward; the hard part was that Expo Go would not connect to the Mac at all. After a long investigation we found the Mac was getting a bogus `192.0.0.2/32` address. We initially (wrongly) blamed a stack of VPN clients (NordVPN/Proton/Surfshark/Tailscale) and spent a lot of effort removing them - that was a dead end. The true root cause: **on Imperial's network macOS requests DHCP option 108 ("IPv6-only preferred"), goes IPv6-only, and synthesizes the CLAT (464XLAT) fake IPv4 `192.0.0.2`; Linux peers (Lukas) don't request option 108 so they get a real `172.26.x.x` IPv4 and Expo "just works."** Fix: set Wi-Fi -> Configure IPv6 = "Link-local only" + reconnect, which forces macOS to take the real IPv4 lease. After that `pnpm phone` works normally. The script was finally stripped back to ~35 lines and made cross-platform (macOS + Linux) so Lukas can use it too.

## What was done
- **Added `scripts/phone.sh` + `"phone": "bash scripts/phone.sh"`** to root `package.json` (commit `baedd44` "chore: pnpm phone", refined later in `e4cfa58` "chore: fix phone script"). The script:
  - detects the machine's real LAN IPv4 on the default interface,
  - runs `docker compose up -d` to ensure the local dev Postgres (host port 5433) is up,
  - starts the API in the background (loads `apps/api/.env` -> local DB) and Expo in the foreground (so the QR renders), with a trap to stop the API on exit,
  - sets `EXPO_PUBLIC_API_URL=http://<LAN_IP>:3000` for the Expo process so the app on the phone reaches the Mac (not `localhost`, which on the phone means the phone).
- **Iterated through many failed networking workarounds** (all later removed) while the real cause was unknown: IPv6-literal host, mDNS `.local` host, MTU 1280, `--no-dev --minify`, and gzip via a `metro.config.js` + `compression` dep. These were reverted once the root cause was found.
- **Root-caused and fixed the connectivity problem** (see Key decisions). Final fix is a macOS Wi-Fi setting, not code.
- **Stripped `scripts/phone.sh` back to a minimal, cross-platform version** (macOS via `route`/`ifconfig`, Linux via `ip route`/`ip addr`), skipping the CLAT fake `192.0.0.2/32`, with a helpful error pointing at the IPv6 fix. Working tree at session end shows `M scripts/phone.sh` (the cross-platform edit, not yet committed at the time of this summary).
- Note: commit `9f2d59b` "fix: change web db to dev instead of prod" is adjacent in history; the `web` script in `package.json` is now `bash scripts/web.sh` (changed during the session by the user/linter, unrelated to phone work).

## Key decisions & rationale
- **Run API in background + Expo in foreground (not `concurrently`).** The first version used `concurrently`, but multiplexing strips the TTY so Expo never renders the interactive QR code. Foreground Expo keeps the TTY; the API is backgrounded with a `[api]`-prefixed log via `sed -u` and killed by an EXIT/INT/TERM trap.
- **Detect the LAN IP dynamically and skip the CLAT fake.** `ipconfig getifaddr en0` returns nothing for non-DHCP-tracked addresses, so we fall back to parsing `ifconfig`/`ip addr`. We explicitly skip any IPv4 with netmask `0xffffffff` (`/32`) because that is the macOS CLAT address `192.0.0.2`, which is host-local and unreachable by the phone.
- **Abandoned the VPN-removal theory.** We removed NordVPN (incl. its Threat Protection system extension), Proton VPN, Surfshark, Tailscale and their configs. This did NOT fix the `192.0.0.2` address - proving the VPNs were not the cause. (System extensions cannot be deleted from the terminal under SIP; they require System Settings -> Login Items & Extensions, or Recovery + `systemextensionsctl reset`.)
- **Abandoned the IPv6-direct + bundle-shrinking approach.** We got IPv6 direct *partially* working (Safari on the phone could reach the Mac's global IPv6; Expo Go fetched the manifest) but the 7.6 MB JS bundle transfer timed out. We tried `.local`/MTU/minify/gzip. Once Lukas's diagnostic proved the network hands out real IPv4, we ripped all of this out in favor of the real fix. Rationale: the IPv6 path was a workaround for a missing IPv4 lease; fixing the lease makes everything trivially simple and matches the known-good Linux setup.
- **Final fix = make macOS take the IPv4 lease** via Wi-Fi -> Details -> TCP/IP -> Configure IPv6 = "Link-local only", then Forget/rejoin to reset the cached option-108 state. Chosen because it is one client-side setting, requires no infra changes, and reproduces exactly what Lukas's Linux already does.
- **Keep the script minimal and cross-platform.** The user explicitly demanded stripping the accumulated workarounds. Final script branches on `uname` (Darwin vs Linux) only for IP detection; everything else is shared.

## Things learned / discovered
- **The smoking-gun address: `192.0.0.2/32`, router `192.0.0.1`, no DHCP lease (`ipconfig getpacket en0` empty), and an `inet6 ... clat46` address.** This is macOS's **464XLAT / CLAT** behavior. `192.0.0.0/29` is reserved by RFC 7335 for the IPv4 service-continuity (CLAT) prefix; the address only exists inside the Mac and is never on the wire, so no other device can reach it.
- **Why macOS goes IPv6-only on Imperial-WPA:** macOS 12+ requests **DHCP option 108 (RFC 8925, "IPv6-only preferred")**. Imperial's "IPv6-mostly" network honors it (it also advertises a NAT64 PREF64 in the RA), so macOS aborts the IPv4 handshake and runs IPv6-only with CLAT. CLAT activation requires BOTH option 108 AND a global IPv6/PREF64; removing the global IPv6 (Configure IPv6 = Link-local only) breaks the condition and macOS falls back to normal IPv4 DHCP.
- **Why Lukas's Linux works:** Linux does not request option 108, so the same DHCP server hands it a normal `172.26.97.169/16` (gateway `172.26.0.1`) plus IPv6 in the same `/64` (`2a0c:5bc0:40:2e26::/64`). Its phone connects to `172.26.x:8081` with zero drama. The networks are otherwise identical.
- **Turning IPv6 fully "Off" did NOT restore IPv4** (the user tried it; internet died entirely). Hypothesis: the cached option-108 / V6ONLY_WAIT state suppressed IPv4 and "Off" doesn't reset it. The reliable reset is "Link-local only" + Forget This Network + rejoin (fresh 802.1X + DHCP).
- **Imperial-WPA enforces client isolation on IPv6.** The Mac's IPv6 Neighbor Discovery cache showed the iPhone's addresses as `incomplete`/`expired` (NS/NA dropped between clients), while the gateway resolved fine. The local Wi-Fi link itself is healthy (0% loss, -63 dBm, ~7 ms, 1448-byte packets pass - no MTU black hole). So the earlier "442 ms jitter" reading was the internet-via-NAT64 path, not the local path.
- **The dev JS bundle is 7.6 MB, served UNCOMPRESSED by Metro** (builds in ~5 s, serves locally in ~3-50 ms). Metro does not gzip by default; iOS (NSURLSession) and Android (OkHttp) bundle loaders send `Accept-Encoding: gzip` and decompress transparently, so a `compression` middleware in `metro.config.js` (`config.server.enhanceMiddleware`) would cut it ~5x. We implemented this then removed it as a workaround - **worth remembering if a future slow-link situation arises** (it keeps Fast Refresh and is zero-risk).
- **iOS has no `adb reverse` / reverse-USB equivalent.** `iproxy`/usbmux only forward host->device, and Expo Go has no USB transport on iOS. USB is a dead end for Expo Go on iPhone.
- **A Release build embeds the JS bundle** (`npx expo run:ios --device --configuration Release`) so the app runs with no Metro/network at runtime - the real escape hatch if the network ever can't carry the bundle. Needs Xcode + a free Apple ID (Personal Team cert expires after 7 days).
- **macOS `ipconfig getifaddr <iface>` only returns DHCP-tracked addresses;** parse `ifconfig`/`ip addr` for the general case.
- **Expo CLI host facts:** `REACT_NATIVE_PACKAGER_HOSTNAME` controls only the *advertised* URL (QR/exp://), not the Metro bind; Expo's `--lan` mode already binds Metro to `::` (Node listens dual-stack), and macOS defaults `net.inet6.ip6.v6only=0`. A raw IPv6 in `REACT_NATIVE_PACKAGER_HOSTNAME` crashes Expo's debug middleware with "Invalid URL" unless bracketed `[..]`, and even then bundle-URL rewriting can drop the brackets - which is why `.local` was attempted.

## Current state
- `scripts/phone.sh` exists and is **cross-platform (macOS + Linux), ~35 lines**, IPv4-only (skips CLAT). At summary time it is modified-but-uncommitted in the working tree (`M scripts/phone.sh`); earlier simpler versions were committed in `baedd44` and `e4cfa58`.
- Root `package.json` has `"phone": "bash scripts/phone.sh"`.
- `apps/api/src/index.ts` listen line is back to the original `host: "0.0.0.0"` (the temporary `process.env.HOST ?? ...` change was reverted).
- `apps/mobile/metro.config.js` was created (gzip) then deleted; the `compression` devDependency was added then removed. `apps/mobile/package.json` should be back to its prior dependency set - worth a quick `git diff` to confirm no stray `compression` entry remains.
- **Verified working:** after setting Configure IPv6 = "Link-local only" + rejoin, the Mac got a real `172.26.x` IPv4 and the user confirmed "IT WORKS NOW" - the app loaded on the physical iPhone via Expo Go against the local DB.
- **Not yet done:** committing the cross-platform `scripts/phone.sh`; optionally documenting the IPv6 fix in `CLAUDE.md` (offered, not yet accepted/done).

## Conventions, commands & workflows
- **View the app on a physical phone:** `pnpm phone` (macOS or Linux). Phone + computer must be on the same Wi-Fi. Override detection with `LAN_IP=172.26.x.y pnpm phone`.
- **macOS on Imperial-WPA prerequisite:** if `ifconfig en0 | grep "inet "` shows `192.0.0.2` (CLAT) instead of a `172.26.x`, set System Settings -> Wi-Fi -> Imperial-WPA -> Details -> TCP/IP -> **Configure IPv6 = Link-local only**, then **Forget This Network** and rejoin. Then `pnpm phone`.
- **Branching:** work continues directly on `dev` per `CLAUDE.md` (no feature branch for routine work).
- **Local DB:** `pnpm db:up` / `pnpm db:down` (docker compose, host port 5433); the API seeds on boot (`SEED_ON_BOOT` defaults to `reset` locally). `apps/api/.env` already has `DATABASE_URL=postgres://drp:drp@localhost:5433/drp`, `PORT=3000`, `DEV_AUTH_BYPASS=1`. `apps/mobile/.env` has `EXPO_PUBLIC_DEV_AUTH=1` (the "Continue as test user" -> `u_dev` button).
- **Pre-PR gates (unchanged):** `pnpm lint`, `pnpm typecheck`, `pnpm test`.

## Known issues / caveats / risks
- `scripts/phone.sh` uses `sed -u` (line-buffered). GNU sed (Linux) supports it; it worked on the user's macOS in this session, but BSD sed historically uses `-l` - if a future macOS errors on `-u`, swap the prefixing approach.
- The macOS IPv6 fix is per-network and can revert if the network is forgotten/re-added or settings reset. It is a client-side override of Imperial's intended "IPv6-mostly" design; if Imperial ever stops leasing IPv4 to legacy clients, no client toggle will manufacture one (but today Linux clients prove IPv4 is still served).
- Confirm `apps/mobile/package.json` and the pnpm lockfile no longer reference `compression` (added then removed this session).
- The cross-platform `scripts/phone.sh` change is uncommitted; commit it so Lukas gets it.
- Imperial-WPA client isolation means IPv6-direct device-to-device is unreliable; do not rely on it. IPv4 is the supported path.

## Next steps
1. Commit the cross-platform `scripts/phone.sh` to `dev` (e.g. "chore: make pnpm phone cross-platform").
2. `git diff apps/mobile/package.json pnpm-lock.yaml` to ensure the temporary `compression` dep is fully gone; revert if any residue.
3. (Optional, offered) Add a short note to `CLAUDE.md` about the macOS CLAT / "Configure IPv6 = Link-local only" fix so the next person doesn't lose an afternoon.
4. Consider an `expo-dev-client` dev build long-term (already flagged in `CLAUDE.md`) - it removes the Expo Go SDK-pinning constraint and, if built in Release, removes the runtime Metro dependency entirely.

## References
- `scripts/phone.sh` - the launcher (cross-platform, IPv4, local DB).
- `package.json` (root) - `"phone"` script entry.
- `apps/api/.env`, `apps/mobile/.env` - local dev env (gitignored).
- `apps/api/src/index.ts` - API listen (`host: "0.0.0.0"`, `PORT`/`SEED_ON_BOOT`).
- `apps/mobile/src/lib/trpc.ts` - reads `EXPO_PUBLIC_API_URL` (default `http://localhost:3000`).
- `docker-compose.yml` - Postgres on host port 5433 (`drp/drp/drp`).
- `CLAUDE.md` - project conventions (Expo SDK 54 pin, branching, DB notes).
- Key external facts: RFC 8925 (DHCP option 108, IPv6-only preferred), RFC 7335 (192.0.0.0/29 CLAT prefix), RFC 6724 (address selection). macOS fix: System Settings -> Wi-Fi -> Details -> TCP/IP -> Configure IPv6 = Link-local only.
