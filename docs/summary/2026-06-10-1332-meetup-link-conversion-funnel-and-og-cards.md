# Meetup-centric share link, web-first conversion funnel, and rich OG cards (DRP-56) - 2026-06-10

**Branch:** `dev` (feature work was on `feat/meetup-link`, merged via `6d2c99d`) | **Linear:** DRP-56 (Done) | **Scope:** Plan + build the "next iteration" from the Luca M4 interview - turn a meetup link dropped in a group chat into a signed-up, responding member, web-first - then fix the live OG unfurl cards.

## TL;DR
Starting from the Luca M4 interview (`docs/drp-context/interviews/m4 interviews/luca interview.md`), this session planned and shipped an entire iteration: a **meetup-centric share link** (`/m/<eventId>`) that previews a meetup publicly *before* sign-in, then one-tap joins the group and lands on the plan, plus the organizer-side share/create-first flow, an in-app-browser escape hatch, a "get the app" nudge, inline group creation, and **rich branded OpenGraph unfurl cards** for both `/m` and `/join` links. It was built in modular commits, verified with `pnpm check` (green across all packages), merged to `dev`, and deployed. Post-deploy we found and fixed three live bugs: the OG functions weren't registering (dynamic `[id]` Vercel functions don't register under this config), a share-sheet input overflowed on web, and the card image used a generic font instead of the app's Archivo/Inter. All three are fixed and confirmed live on `bethere-dev.vercel.app`. Ephemeral guests and notifications were explicitly deferred to the next iteration.

## Context: how we got here
- The work began with a **plan-mode** analysis of the Luca interview. Two interview signals dominated: (1) **web-first onboarding** is a hidden gem (the assessors don't even know a web deployment exists) and (2) the **adoption barrier** - getting the rest of a group chat onto the app. The user steered the scope through several rounds of `AskUserQuestion`:
  - Horizon: build for the **Final Demo (16-17 Jun)**, the dominant deadline (M4 review 12 Jun; docs 19 Jun).
  - Ephemeral plan-only guests: the user initially wanted them, then **deferred them to the next iteration**; this iteration the joiner becomes a **normal group member**.
  - Focus: optimize the **joiner conversion** (the initiator already has the app); the point is converting the group chat.
  - Conversion levers: do **both** the OG unfurl card and in-app-browser handling.
  - Notifications: **out** this cycle.
- The approved plan lives at `/Users/gong/.claude/plans/cheeky-tumbling-cocke.md`.
- Key realization that shaped the design: web-onboarding and the (deferred) ephemeral-guest idea are the **same primitive** - a plan-scoped shareable link. This iteration builds the link/preview/routing rails; the guest model layers on later.

## What was done (in build order, all DRP-56 unless noted)

**Backend (`2e52d24`):** Added three procedures to `apps/api/src/routers/events.ts`:
- `events.previewByToken` - **publicProcedure** (callable signed-out: the link is the invitation), returns only a non-sensitive shell (derived activity via `displayActivity`, group name, phase, startsAt, candidate count); never voter/creator/crowd identity; read-only (does not settle).
- `events.joinByToken` - joins the event's group as a normal member, idempotent (mirrors `groups.joinByCode`).
- `events.shareLink` - member-gated, builds the `/m/<token>` link via new `meetupUrlFor` in `apps/api/src/db/groups.ts` (mirrors `inviteUrlFor`).
- 12 DB-backed tests in `apps/api/src/routers/events-share.test.ts`, including the unauthenticated-preview and no-name-leak cases.

**Client pure helpers (`1ac26a3`):**
- `apps/mobile/src/lib/meetup.ts` - `extractMeetupToken`, `meetupUrl`, pending-meetup stash (survives the web OAuth reload). Reuses now-exported `webOrigin`/`webStore` from `invite.ts`.
- `apps/mobile/src/lib/webview.ts` - `classifyUserAgent`/`detectInAppBrowser` (flags WhatsApp/Instagram/FB/Android-wv/iOS-WKWebView).
- Copy strings in `apps/mobile/src/lib/copy.ts`. 9 unit tests.

**Joiner funnel + routing (`5449de0`):**
- `apps/mobile/src/screens/JoinMeetup.tsx` exports two components: the authed `JoinMeetup` navigator screen (preview -> join -> `reset` to `[Dashboard, EventDetail]`) and `MeetupWelcome`, the **logged-out** landing the auth Gate renders so the preview shows BEFORE sign-in.
- The **Gate pivot** in `apps/mobile/App.tsx`: logged-out is no longer just `<SignIn/>` - if the launch URL is `/m/<token>`, it renders `<MeetupWelcome/>`. Added the `/m/:token` deep link to the linking config and registered `JoinMeetup` in the Meetups stack.
- `apps/mobile/src/lib/usePendingMeetup.ts` - `useMeetupLaunchToken` (synchronous on web for the first paint) + `usePendingMeetupRouting` (capture-across-OAuth-reload, resume = `joinByToken` then route to the plan). Takes precedence over a pending invite code.
- Extracted `apps/mobile/src/lib/useSignInActions.ts` (shared Google-SSO + dev-bypass actions) so SignIn and MeetupWelcome trigger sign-in identically. Extracted `apps/mobile/src/lib/trpcError.ts` (`trpcErrorCode`) to a pure module so screens use it without mocking the network client.

**Share affordance + create-first (`93edaaf`):** A `PlanShareSheet` on `EventDetail` (mirrors `GroupDetail`'s `InviteSheet`) fetching `events.shareLink`; the create wizard now lands on the new plan with `shareOnLand` to auto-open the share sheet ("create the meetup first, then share one link" - Luca).

**In-app-browser escape hatch (`c3ac3ce`):** In `MeetupWelcome`, when `detectInAppBrowser().hostile`, an "open in your browser" card with `window.open` + a copy-link fallback (Google OAuth is blocked in those webviews).

**Get-the-app nudge (`a602f86`):** A dismissible, web-only card after a user responds, gated on `EXPO_PUBLIC_APP_DOWNLOAD_URL` (hidden if unset - there's no public store listing yet). Gating runs before any hook so the native path never touches browser globals.

**Inline create-group (`9e84082`):** A "+ New group" chip in the create-wizard group step opens a BottomSheet that calls `groups.create`, appends + selects the group - no navigation away. Fixes the old dead-end empty state.

**Rich OG cards (`82971ad`, then fixes below):**
- `api/og.ts` - a `@vercel/og` function renders the actual 1200x630 PNG card from `?title=&subtitle=` (plain element-tree objects, **no JSX/React**).
- `api/_lib/og.ts` - shared head-build/strip/fetch helpers (single authoritative meta set; strips any baseline tags before injecting).
- `api/m.ts` + `api/join.ts` - per-meetup and per-group cards (made `groups.previewByCode` **public** so the group function/scrapers resolve a code unauthenticated).
- `apps/mobile/scripts/inject-og.mjs` + `buildCommand` - injects a baseline branded card into `dist/index.html` so every other route also unfurls cleanly; copies the brand TTFs into `dist/fonts`.
- `vercel.json` - rewrites for `/m` and `/join`.

**Merged to `dev`** (`6d2c99d`, no-ff). Note this carried along an **unrelated DRP-57 PostHog docs** commit (`f9e14cc`, `87493e3`) that a parallel session had committed to the same branch - docs-only, harmless.

**Post-deploy fixes (the cards were broken/ugly in real chats):**
- `0974022` then `5a5aa7c` - **the OG functions weren't running.** Diagnosed live: `/api/og` (static) worked but `/api/m/[id]` / `/api/join/[code]` (dynamic-segment) returned the SPA baseline even when hit directly. Root cause: under this project's `framework: null` + custom `outputDirectory` config, Vercel registers **flat** `api/*.ts` files but **not dynamic-segment** ones. Fix: static `api/m.ts` + `api/join.ts` reading the id/code from the **query**, with the rewrites mapping the path param in (`/m/:id -> /api/m?id=:id`). (The interim `0974022` switched from named `export GET` to `export default` + edge, which was also needed, but the dynamic-segment issue was the real blocker.) Documented in `f85eff8`.
- `0fc6f81` - **share-sheet link overflowed under the Copy button on web.** Fix in `apps/mobile/src/ui/Field.tsx`: a `flex:1` input defaults to `min-width:auto` on react-native-web and won't shrink below its (long URL) content, so it overflowed. Added `minWidth: 0` + an 8px `gap` before the right slot.
- `86287d8` - **card image used @vercel/og's default font, not the app's brand faces.** Fix: load Archivo (display) + Inter (body) into the `ImageResponse`. `inject-og.mjs` copies the TTFs from `@expo-google-fonts` into `dist/fonts`; `api/og.ts` fetches them same-origin and renders with them, falling back to the default if a fetch fails. Verified the live card renders in Archivo/Inter.

(The fact-listed commits `4790a89` DRP-58, `0ad1309` DRP-59, `6610854` DRP-60 are **not from this session** - they appeared on `dev` from other work/sessions, interleaved with ours.)

## Key decisions & rationale
- **Joiner becomes a normal group member this iteration; ephemeral plan-only guests deferred.** Keeps the build small (no participant table, no access-gating refactor) while laying the link/preview/routing rails the guest model will reuse. Locked guest-iteration answers for later: Google sign-in, stay-ephemeral, names-shown.
- **`previewByToken` / `previewByCode` are PUBLIC.** A link scraper and a logged-out visitor must resolve them; "holding the token/code is the invitation" is the existing trust model. They leak only a name/count/activity, never voter identities. `joinByToken`/`joinByCode` stay protected.
- **The Gate renders a logged-out preview.** Showing the meetup *before* sign-in (value first) was an explicit interview-driven choice; it required making the logged-out branch conditional rather than always `<SignIn/>`.
- **OG image via `@vercel/og` with plain element-tree objects (no JSX).** Avoids a JSX/React transform + bundler-config in loose `api/*.ts` files. Satori accepts `{type,props}` objects at runtime; we cast to the `ReactElement` type with `as unknown as ConstructorParameters<typeof ImageResponse>[0]` (not `as any`, which `pnpm quality` bans).
- **Static OG functions + query-param rewrites, not dynamic `[id]` files.** Forced by the discovery that dynamic-segment API functions don't register under `framework:null` + custom `outputDirectory`.
- **No `OG_API_URL` env needed.** The functions reach the dev API via the existing `EXPO_PUBLIC_API_URL` runtime fallback (Vercel injects project env vars into functions at runtime, including `EXPO_PUBLIC_`-prefixed ones). `OG_API_URL` remains a documented optional override.
- **Merge straight to `dev` (not a PR).** The user asked to merge directly; `dev` is pushable (only `main` is protected) and pushing `dev` deploys the parallel dev stack - exactly what's needed to validate the OG functions live.

## Things learned / discovered
- **Vercel + `framework: null` + custom `outputDirectory`: only flat `api/*.ts` functions register.** Dynamic-segment files (`api/m/[id].ts`) silently fail to register and the path falls through to the SPA catch-all rewrite. Use static files + map path params to the query in `rewrites` (`{ "source": "/m/:id", "destination": "/api/m?id=:id" }`). Also: use a `export default` handler (a named `export function GET` is a Next.js route-handler convention and does not register here). Static asset paths (`/fonts/*.ttf`, `/index.html`, `/_expo/...`) are served by the filesystem and are NOT shadowed by the `/(.*) -> /index.html` catch-all (rewrites only apply when nothing matches the filesystem).
- **`@vercel/og` runs in plain Node locally** - you can render a card in a throwaway script and assert it returns an `image/png` and write the PNG, which de-risks it without a deploy. It accepts plain `{type,props,style}` element trees (no JSX). Custom fonts load via the `fonts: [{name,data,weight,style}]` option; omitting `fonts` uses a bundled default. Satori needs ttf/otf/woff (NOT woff2); the `@expo-google-fonts` packages ship per-weight `.ttf` (e.g. `@expo-google-fonts/archivo/800ExtraBold/Archivo_800ExtraBold.ttf`).
- **react-native-web flexbox overflow:** a `flex: 1` `TextInput` defaults to `min-width: auto`, so a long value overflows its box (e.g. under a right-aligned button). `minWidth: 0` is the fix; harmless on native.
- **Chat apps cache OG unfurls by URL** for a long time (Discord/iMessage/WhatsApp/Slack). After fixing cards, previously-posted links keep the old card; test with a fresh link, a `?x=1` cache-buster, or opengraph.xyz.
- **The mobile `trpc` manual mock (`src/lib/__mocks__/trpc.ts`) only provides what tests use.** Adding `trpcErrorCode` to `lib/trpc.ts` and importing it in a screen broke `JoinGroup.test.tsx` ("not a function") because the mock lacked it. Fix: keep pure helpers in their own module (`lib/trpcError.ts`) so screens don't depend on the mocked network client.
- **Hooks-before-early-return crash under jest-expo:** a component that calls `useState` (touching `localStorage`/`window`) before a `Platform.OS !== "web"` early return crashed in the test renderer (surfaced as `window.dispatchEvent is not a function`). Fix: gate before any hook and put the stateful body in a child component that only mounts on web.
- **`og:image` URLs are HTML-attribute-escaped** (`&` -> `&amp;`) by design; scrapers decode them back. `URLSearchParams` encodes spaces as `+`, which `searchParams.get` decodes back to a space - both round-trip correctly.
- **Mobile relative imports are extensionless** (Metro/jest), unlike `apps/api` (ESM, needs `.js`). A `from "./invite.js"` in a mobile lib file fails jest resolution.

## Current state
- All DRP-56 work is on `dev` and **deployed** to the dev stack (`bethere-dev.vercel.app` web + `bethere-api-dev` App Runner). `pnpm check` was green across all packages before the merge.
- **Verified live (curl + image inspection):** `/m/<id>` -> "You're invited to bowling - Help pick a time - with Heineken Enjoyers"; `/join/<code>` -> "Join Heineken Enjoyers on BeThere - 2 members"; `/api/og` -> image/png in Archivo/Inter; `/fonts/Archivo_800ExtraBold.ttf` -> `font/ttf`.
- The end-to-end joiner flow (incognito web -> preview -> sign in -> join -> respond) was built and unit-tested but **not** manually click-tested in a browser this session (the funnel logic is covered by `JoinMeetup.test.tsx` and verified structurally).
- **Working tree (uncommitted, not from this session's OG work):** `apps/mobile/src/lib/lock.ts`, `packages/shared/src/logic/lock.ts`, `packages/shared/src/logic/lock.test.ts` are modified - left untouched/unstaged.
- DRP-56 is marked **Done** in Linear with the root-cause/fix recorded in comments.

## Conventions, commands & workflows
- Pre-PR gate: **`pnpm check`** (lint + typecheck + test + quality). `pnpm quality` bans escape hatches (`as any`, `@ts-*`, `biome-ignore`); a typed `as unknown as X` double-cast is allowed. `pnpm format` auto-fixes biome.
- biome lints the repo-root `api/` functions (includes `**`); the functions aren't covered by any package's `tsc`, so validate them with a standalone `npx tsc --noEmit --skipLibCheck --strict --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom --types node api/*.ts api/_lib/og.ts`.
- API DB tests need `pnpm db:up` (Postgres on host port 5433).
- Branching: work on `dev`; only `main` is protected. Pushing `dev` deploys the dev stack; pushing `main` deploys prod (`bethere-beta.vercel.app`). `feat/*` -> PR into `dev` for big features.
- Migrations are hand-authored (drizzle-kit generate is unusable).
- Mobile imports `@bethere/shared` **type-only**; duplicate tiny pure helpers locally (the Metro/jest barrel trap).
- OG deploy ops (documented in `docs/runbook-deploy.md`): optional `OG_API_URL` (per Vercel env) overrides the API base for the unfurl functions; optional `EXPO_PUBLIC_APP_DOWNLOAD_URL` powers the get-app nudge; API `PUBLIC_WEB_URL` makes share links canonical.

## Known issues / caveats / risks
- **OG functions are deploy-only verifiable.** They depend on Vercel function registration + same-origin fetches; can't be fully exercised locally. The static-vs-dynamic registration quirk already bit us once.
- **Card title says "You're invited on BeThere" (not "...to <activity>") for collecting plans with no activity yet** - this is correct behavior, not a bug; it reads slightly oddly next to "Help pick a time".
- **Unrelated DRP-57 PostHog docs and DRP-58/59/60 mobile fixes are interleaved on `dev`** from parallel work - be aware when reading history or cutting a `dev -> main` PR.
- **The full joiner flow hasn't been manually browser-tested** end to end on the deployed site this session.
- `feat/meetup-link` is merged but the **local branch was not deleted**.

## Next steps
- Manually dry-run the incognito web joiner flow on `bethere-dev.vercel.app` before the demo (it's the demo hero).
- When ready, ship `dev -> main` via PR (deploys prod; prod's `EXPO_PUBLIC_API_URL` points the OG functions at the prod API automatically).
- Optionally set `EXPO_PUBLIC_APP_DOWNLOAD_URL` (get-app nudge) and `PUBLIC_WEB_URL` on the services for completeness.
- Next iteration (deferred): **ephemeral plan-only guests** (respond without joining the group - the `event_participants` model designed in the plan) and **notifications** (email first; push needs the dev-build migration off Expo Go).
- Delete the merged local `feat/meetup-link` branch.

## References
- Plan: `/Users/gong/.claude/plans/cheeky-tumbling-cocke.md`
- Interview: `docs/drp-context/interviews/m4 interviews/luca interview.md`
- Runbook (OG + deploy ops, with the static-only-functions gotcha): `docs/runbook-deploy.md`
- Backend: `apps/api/src/routers/events.ts` (previewByToken/joinByToken/shareLink), `apps/api/src/routers/groups.ts` (previewByCode now public), `apps/api/src/db/groups.ts` (meetupUrlFor), `apps/api/src/routers/events-share.test.ts`
- Client: `apps/mobile/App.tsx` (Gate + linking), `apps/mobile/src/screens/JoinMeetup.tsx`, `apps/mobile/src/lib/{meetup,usePendingMeetup,webview,useSignInActions,trpcError}.ts`, `apps/mobile/src/ui/Field.tsx`, `apps/mobile/src/screens/EventDetail.tsx` (PlanShareSheet + get-app nudge), `apps/mobile/src/screens/CreateWizard.tsx` (inline group)
- OG: `api/og.ts`, `api/m.ts`, `api/join.ts`, `api/_lib/og.ts`, `apps/mobile/scripts/inject-og.mjs`, `vercel.json`
- Linear: DRP-56 (this work). Parallel: DRP-57 (PostHog), DRP-58/59/60 (other mobile fixes).
