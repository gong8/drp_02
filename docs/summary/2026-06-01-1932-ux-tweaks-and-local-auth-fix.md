# Dashboard UX tweaks, no-group gating, and the local Clerk-auth fix - 2026-06-01

**Branch:** dev | **PRs:** none opened (committed directly to `dev`) | **Scope:** Post-DRP-25 UX polish on the Meetups dashboard + a real backend fix so local Google (Clerk) sign-in stops 401ing.

## TL;DR
This session was a tight, screenshot-driven iteration loop on the BeThere mobile UX plus one genuine backend bug fix. We (1) replaced the subtle inline "Suggest a meet..." row with a big themed sticky "Suggest a meetup" button, removed the useless stat overlines and the top-right header avatar, and gated meetup creation on group membership; (2) discovered the dashboard's "Couldn't reach the server" / "lets me suggest a meet with no groups" symptoms were actually a **local auth failure** - the app sends a Clerk JWT the local API can't verify (no `CLERK_JWT_KEY`), and `DEV_AUTH_BYPASS` didn't help because a present bearer token blocked the dev stub; (3) fixed that by making `resolveAuth` fall back to the `u_dev` seed user when Clerk verification is impossible locally, while keeping prod behavior intact; and (4) iterated on the bottom tab bar "chin" height to taste. All changes are committed to `dev` (`45feb5e`, `847af0d`, `c215dc4`); working tree is clean. Tracked as Linear **DRP-27** (UX) and **DRP-28** (auth).

## What was done

### 1. Dashboard UX overhaul follow-ups (Linear DRP-27)
- **Big "Suggest a meetup" button.** Removed the inline dashed "Suggest a meet..." row that lived as the first child inside the events list `Card`. Added a `BigButton` local component (brand-pink `ui.brand`, `HardShadow`, 2px ink border, `paddingVertical: 18`, 17px display font) anchored as a **sticky footer** below the `ScrollView`. To make it sticky, the screen body was wrapped in `<View style={{ flex: 1 }}>` with the `ScrollView` (flex) on top and the footer `View` below.
- **Removed stat overlines.** Dropped `overline={`${events.length} this week`}` from the Dashboard `Heading` and `overline={`${groups.length} groups`}` from the GroupsList `Heading`. The user called them "useless."
- **Removed the top-right header avatar.** Deleted `<AccountAvatar />` from the `right=` prop of `Heading` on both Dashboard ("Your meets") and GroupsList ("Your groups"), plus the now-unused `AccountAvatar` import in each. Account is still reachable via the bottom tab.
- **Gated meetup creation on group membership.** Dashboard now also calls `trpc.groups.mine.query()` (via `Promise.all([events.mine, groups.mine])`) and tracks `hasGroups`. When the user is in no groups, the body shows a "No groups yet" card and the footer CTA becomes **"Create a group"** (cross-tab nav: `navigation.getParent()?.navigate("Groups", { screen: "CreateGroup" })`); when they have groups, the CTA is **"Suggest a meetup"** -> `CreateEvent`.
- **First-list-row border fix.** Because the dashed row (which previously provided the top divider) was removed, the first list item's `borderTopWidth` was changed to `i === 0 ? 0 : 1` (the `.map` callback gained the `i` index).
- **CreateEvent defense-in-depth.** Added a guard: if not loading and `groups.length === 0`, render a "You're not in any groups yet. Create or join a group first..." message instead of an empty group picker + "Something went wrong" error.

### 2. The real bug: local Clerk auth 401s everything (Linear DRP-28)
After the gating shipped, the user reported the app showing "Couldn't reach the server" and falling back to "Create a group" even though seed data exists. Root-caused from the API logs in the user's terminal screenshot:
```
[auth] bearer token present but did not verify
[trpc] events.mine UNAUTHORIZED  user=anon
GET /trpc/events.mine,groups.mine?batch=1&input=%7B%7D 401
```
- **Diagnosis.** The user signed in with **Google (Clerk)**, so the mobile client attaches `Authorization: Bearer <clerk-jwt>` on every request. The local `apps/api/.env` has `DATABASE_URL`, `PORT`, `DEV_AUTH_BYPASS` but **no `CLERK_JWT_KEY`**, so `verifyClerkToken` throws `"CLERK_JWT_KEY is not set"`, `resolveAuth` catches it and degrades to `userId: null` -> `UNAUTHORIZED`. Crucially, `DEV_AUTH_BYPASS=1` did **not** rescue it: the old `resolveAuth` only fell through to the `x-user-id` stub when **no** bearer token was present, and the Clerk client always sends one. So the user was wedged. "Working before" = the **"Continue as test user"** button (which sets dev mode -> sends `x-user-id: u_dev`, no bearer), the seed-data path; this session used Google instead.
- **Fix.** Added a `clerkConfigured: boolean` field to `AuthInputs` (set in `createContext` from `!!process.env.CLERK_JWT_KEY`). `resolveAuth` now only attempts verification when `token && inputs.clerkConfigured`; otherwise it falls through to the `devBypass` branch. So locally (key unset + `DEV_AUTH_BYPASS=1`) an attached-but-unverifiable Clerk token is ignored and the request resolves to `u_dev` (the seed user owning all demo data) instead of 401ing. **Prod is unaffected** because App Runner sets `CLERK_JWT_KEY`, so real tokens verify and bad ones still resolve to null. Also made the "bearer token present but did not verify" warning fire only when `clerkConfigured` (we actually attempted verification). Documented the local behavior in `apps/api/.env.example`.
- **Tests.** Updated `apps/api/src/auth/resolve.test.ts`: added `clerkConfigured: true` to the 6 existing cases and added 2 new cases (unconfigured + bypass -> `u_dev`; unconfigured + no bypass -> null). 8/8 pass.
- **Verified live.** With `tsx watch` hot-reloaded, `curl -H "Authorization: Bearer faketoken.abc.def" 'http://localhost:3000/trpc/groups.mine?batch=1&input=%7B%7D'` returned **HTTP 200** with the seed groups (The Boys, Climbing Group, Glitter Natters, Church Group, High School Reunion).

### 3. Bottom tab bar "chin" + button spacing
Several rounds of visual tuning (the user kept it iterative):
- Initial misread: tightened the *footer* padding around the button. The user clarified the real complaint was the **bottom tab bar** having a tall white band below the labels.
- Root cause: `tabBarStyle` had **no explicit height**, so React Navigation centered the (icon-hidden) labels in a tall default content area and stacked the full home-indicator safe-area inset below them.
- Fix in `apps/mobile/App.tsx` `MainTabs`: switched to `useSafeAreaInsets()`, set an explicit compact bar - `height: 40 + bottomGap`, `paddingTop: 8`, `paddingBottom: bottomGap`, `tabBarItemStyle: { justifyContent: "center" }`, and `tabBarIconStyle: { display: "none", height: 0, width: 0 }` to fully collapse the unused icon slot.
- `bottomGap` factor was tuned by request: `0.35*inset` (too small) -> `0.6*inset` -> **`0.75*inset`** final (`Math.max(Math.round(insets.bottom * 0.75), 12)`).
- Also bumped the Dashboard footer `paddingBottom` 8 -> 20 so "Suggest a meetup" isn't jammed against the tab bar.

## Key decisions & rationale
- **Sticky footer button vs. inline/scrolling button.** Chose sticky (footer outside the `ScrollView`, inside a `flex:1` wrapper) so the primary action is always visible - the user explicitly wanted a "massive" obvious button "at the bottom."
- **Default `hasGroups` to `false`, gate CTA on `hasGroups && !error`.** Originally defaulted `true` to avoid a flash, but that meant any fetch error left the "Suggest a meetup" CTA showing and dropped users into a broken create form. Defaulting `false` guarantees we never offer meetup creation until groups are confirmed; loading is covered by the spinner so there's no flash.
- **Fix auth via `clerkConfigured` gate, NOT by weakening prod.** Considered (a) just telling the user to use the test-user button, (b) setting `CLERK_JWT_KEY` locally (rejected - the PEM lives in the Clerk dashboard, not in the repo; and a real Google user has no seed data anyway, so they'd see an empty app), and (c) a blanket "failed token -> dev stub" fallback (rejected - in M2 prod `DEV_AUTH_BYPASS` is also on, so that would map expired/forged tokens to `u_dev`, a security regression). The chosen scoped fix only falls back when verification is *impossible* (`CLERK_JWT_KEY` unset), which is exactly local dev; prod always has the key so its behavior is unchanged. This respects the design doc's intent (`docs/superpowers/specs/2026-06-01-clerk-auth-and-web-target-design.md`, locked decision: bypass only when no token present) while removing the local footgun.
- **Did not "fix" the open-auth posture as a bug.** CLAUDE.md and `docs/tech-debt.md` state the open/unauthenticated API and `DEV_AUTH_BYPASS` are deliberate for M2 - so the fix is scoped to local-dev ergonomics, not auth hardening.
- **Tab bar: explicit height over default.** The default RN tab bar height + label-only layout produces the chin; an explicit `height` + fractional inset padding is the standard remedy and keeps a sane (but trimmed) gap above the home indicator.

## Things learned / discovered
- **`resolveAuth` precedence:** a present bearer token short-circuits the dev-stub fallback. So `DEV_AUTH_BYPASS=1` is only effective when the client sends *no* `Authorization` header (i.e. dev-mode `x-user-id`, not Clerk mode). This is by design per the spec but is an easy local-dev trap.
- **The seed (`apps/api/src/db/schema` seed in `apps/api/src/db/seed.ts`) assigns ALL demo data to `u_dev`** ("You"), member of g_boys/g_climb/g_knit/g_church/g_hs. A freshly-verified real Clerk user has zero groups -> "No groups yet" is *correct* for them. The demo data only appears when authenticated as `u_dev`.
- **Mobile auth wiring:** `apps/mobile/src/lib/auth.ts` keeps a module-level `holder` synced by `useAuthBridge()`; `buildAuthHeaders` sends `x-user-id` in dev mode or `Authorization: Bearer` in Clerk mode. The "Continue as test user" button is gated on `EXPO_PUBLIC_DEV_AUTH === "1"` (`apps/mobile/src/lib/clerk.ts`), which IS set locally (visible exported in the dev terminal).
- **React Navigation tab bar chin:** hiding icons via `tabBarIconStyle: { display: "none" }` alone does NOT collapse the bar; without an explicit `height` the labels float at the top of a tall content box with the safe-area inset stacked below. Need explicit `height` + `paddingBottom` + `tabBarItemStyle: { justifyContent: "center" }`.
- **Cross-tab navigation** from the Meetups stack to a Groups-stack screen: `navigation.getParent()?.navigate("Groups", { screen: "CreateGroup" })` typechecks and works (parent is the Tab navigator).
- **`tsx watch` hot-reloads the API** on save, so a live `curl` is a fast end-to-end verification without restarting `pnpm dev:api`.

## Current state
- All work **committed to `dev`**, working tree clean. Relevant commits this session: `45feb5e` (bigger suggest button), `847af0d` (local auth fix), `c215dc4` (UX scaling minor files - tab bar chin + spacing). Note: the user committed these themselves between turns; commit messages are terse and bundle multiple logical changes.
- No PRs opened this session (routine work on `dev` per branching policy).
- **Verified:** `pnpm typecheck` clean (3 pkgs), `pnpm lint` clean (biome, 70 files), `pnpm --filter @bethere/api test` 8/8 pass, live curl returns 200 with seed data.
- **Linear:** DRP-27 (UX: prominent CTA, drop overlines, gate on membership) set **In Progress** during work; DRP-28 (local Clerk 401 fix) created and marked **Done** with root-cause + fix writeup. DRP-27 may still need a final move to Done (not explicitly confirmed closed).

## Conventions, commands & workflows
- Quality gates before any PR: `pnpm lint`, `pnpm typecheck`, `pnpm test` (all from repo root). `pnpm format` auto-fixes biome + indentation (it reformatted the deliberately loosely-indented JSX after edits).
- No em dashes anywhere (use hyphens) - enforced project-wide.
- Work directly on `dev`; never push to or PR into `main` except the `dev -> main` release PR.
- Track everything in Linear team **DRP_02** (find/create issue -> In Progress -> Done with commit/PR ref).
- Run a single package script with `pnpm --filter @bethere/<pkg> <script>`.

## Known issues / caveats / risks
- **DRP-27 close-out:** confirm the Linear issue is moved to Done (work is shipped but the final status move wasn't verified in-session).
- **Local dev requires either** the "Continue as test user" button OR (now) any sign-in while `CLERK_JWT_KEY` is unset - both resolve to `u_dev`. A real per-user local identity requires putting the Clerk instance PEM in `apps/api/.env`.
- **`clerkConfigured` fallback semantics:** if someone sets `DEV_AUTH_BYPASS=1` in an environment that *also* lacks `CLERK_JWT_KEY` (misconfigured prod), all authed requests would silently become `u_dev`. Acceptable for M2's deliberately-open posture but worth remembering before hardening.
- **Tab bar `bottomGap` is device-relative** (`0.75 * insets.bottom`, min 12). Looks tuned for the iPhone 17 Pro simulator (~34px inset -> ~26px); devices with different insets will scale. Re-check on a non-notch / small-inset device if needed.
- Commits bundle multiple concerns with terse messages - git archaeology later may be harder than the Linear issues suggest.

## Next steps
- Confirm DRP-27 is marked Done in Linear.
- Optional: open the `dev -> main` release PR when this batch of UX + auth fixes is ready to ship (CI runs on PRs into main; CD deploys on push to main).
- Optional polish: revisit the "No groups yet" empty state and the CreateEvent guard copy; consider a real "join a group" flow (currently only "Create a group" is wired - joining is via invites).
- If desired, add `CLERK_JWT_KEY` to local `.env` to test real per-user Google identity end-to-end.

## References
- `apps/mobile/src/screens/Dashboard.tsx` - sticky `BigButton`, `hasGroups` gating, no-overline heading, first-row border fix.
- `apps/mobile/src/screens/GroupsList.tsx` - removed overline + header avatar.
- `apps/mobile/src/screens/CreateEvent.tsx` - no-groups guard.
- `apps/mobile/App.tsx` - `MainTabs` tab bar height/inset/chin tuning (`bottomGap`).
- `apps/api/src/auth/resolve.ts` - `clerkConfigured` gate (the core fix).
- `apps/api/src/auth/resolve.test.ts` - 8 cases incl. unconfigured fallback.
- `apps/api/src/trpc.ts` - `createContext` passes `clerkConfigured`, scoped warning.
- `apps/api/src/auth/clerk.ts` - `verifyClerkToken` (throws if `CLERK_JWT_KEY` unset).
- `apps/api/.env.example` - documents the local `CLERK_JWT_KEY`-unset fallback.
- `apps/api/src/db/seed.ts` - demo data, all owned by `u_dev`.
- `apps/mobile/src/lib/auth.ts`, `apps/mobile/src/lib/clerk.ts`, `apps/mobile/src/screens/SignIn.tsx` - auth holder, dev-bypass flag, sign-in screen.
- `docs/superpowers/specs/2026-06-01-clerk-auth-and-web-target-design.md` - auth design + locked decisions.
- Linear: DRP-27 (UX), DRP-28 (local auth fix).
