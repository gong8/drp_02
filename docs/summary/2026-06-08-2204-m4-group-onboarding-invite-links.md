# M4 Group Onboarding: invite links + join codes + first-run - 2026-06-08

**Branch:** `dev` (8 DRP-50 commits, unpushed at session end) | **Linear:** DRP-50 (Done) | **Scope:** Let a real person actually join a group via a shareable link + short join code, replacing the seeded-demo-user picker; plus first-run polish (editable name, zero-group onboarding) and create-to-share.

## TL;DR
M3 was finished; this session built M4's biggest gap: onboarding. Before this, the only way to "add" someone to a group was a picker of pre-seeded demo users, so a friend who installed BeThere could never get in. We designed (via a multi-agent UX workshop) and shipped a WhatsApp/Partiful-style **shareable link + short typeable join code** per group, on top of the existing Google sign-in, web-first. Backend (codes, migration, `inviteByGroup`/`previewByCode`/`joinByCode`/`users.me`/`updateProfile`) and mobile (invite sheet, `JoinGroup` funnel, "Join with a code", two-path onboarding card, editable name, deep-link + pending-invite resume) are implemented, tested (shared 7 files, api 395, mobile 191 - all green), committed to `dev`, and hardened by a multi-lens adversarial review (10 low-severity findings, all fixed or consciously accepted). DRP-50 is marked Done in Linear. **Nothing is deployed yet - `dev` is ahead of `origin/dev` and unpushed.**

## What was done

### Brainstorming + design (no code)
- Used the `superpowers:brainstorming` flow. Explored how Tricount, Splitwise, WhatsApp, and Partiful do invites. Chose the **link + short join code** model (WhatsApp/Partiful), rejecting email invites (friction/infra) and Tricount placeholder-claim (too many moving parts).
- User clarified the deployment reality mid-conversation: **web-first** (Expo web on Vercel is the live surface), wants it to "actually work," and written for easy native extension. This made the join **code** the surface-agnostic primitive and the `/join/<code>` path the future native universal-link.
- User chose full scope ("all of it"): join bridge + first-run polish + create-during-onboard.
- A background **design workflow** (`m4-invite-ux-design`, 5 agents: audit -> 3 proposals -> synthesize) produced an on-brand UI spec grounded in the real `ui/` kit. Key spec rulings: render the code with `AppText variant="screenTitle" mono` (NO new mono font), copy feedback is a label swap (NO Toast - the kit has none), `Band` only for the join-success welcome, Join button = `affirmative` (green) / Invite/Share/Create/Find = `primary` (pink), member names never shown on preview/invite.

### Backend (apps/api + packages/shared)
- `packages/shared/src/logic/invite.ts` (new): `INVITE_ALPHABET` (no-confusable, excludes 0/1/I/L/O/U), `INVITE_CODE_LENGTH=8`, `normalizeInviteCode`, `formatInviteCode`. Schemas added in `schemas.ts`: `JoinByCodeInput`, `DisplayName`, `UpdateProfileInput`.
- `apps/api/src/db/schema.ts`: `groups.inviteCode` (`text notNull unique`).
- `apps/api/src/db/groups.ts`: `freshInviteCode()` (crypto.randomInt over the alphabet, uniqueness re-roll) and `inviteUrlFor()` (builds `${PUBLIC_WEB_URL}/join/<code>` or returns null).
- Migration `0010_group_invite_code.sql` + `_journal.json` entry (hand-authored, no snapshot): add column nullable, backfill existing rows via `substr(translate(md5(id), '0123456789abcdef','ABCDEFGH23456789'),1,8)`, then `SET NOT NULL` + `ADD CONSTRAINT groups_invite_code_unique UNIQUE`.
- `seed.ts` and `test/harness.ts` `makeGroup` updated to supply a code on every group insert (the column is NOT NULL).
- Procedures (`routers/groups.ts`): `create` mints a code; `inviteByGroup` (member-gated, returns `{code, url}`); `previewByCode` (authed but NOT member-gated - holding the code is the invite; returns `{groupId, name, memberCount}`, never member names); `joinByCode` (idempotent, returns `{groupId, name, alreadyMember}`).
- `routers/users.ts` (new): `me` (returns the caller's avatar card) + `updateProfile({name})`; mounted in `router.ts`.
- Tests: `groups.test.ts` extended (create mints code, inviteByGroup, previewByCode, joinByCode incl. normalization/idempotency/NOT_FOUND/BAD_REQUEST/auth); `users.test.ts` (new).

### Mobile (apps/mobile)
- `src/lib/invite.ts` (new): `CODE_LENGTH`, `formatCode`, `normalizeCode` (also extracts a code from a pasted `/join/` URL, caps at length), `joinUrl` (webOrigin chain), `extractInviteCode`, and a `pendingInvite` stash (localStorage on web, in-memory on native). **These mirror the shared helpers but are re-implemented locally - see "Things learned".**
- `src/lib/share.ts` (new): `copyToClipboard` (expo-clipboard, added as a dep) + `shareInvite` (Web Share API on web, native share sheet on native, always degrades to copy).
- `src/lib/copy.ts`: all M4 strings + helpers (`memberCountLabel`, `joinPrompt`, `welcomeToGroup`, `inviteShareText`).
- `App.tsx`: `linking` config (`join/:code` -> Groups>JoinGroup), `navigationRef`, and a `Gate` capture/resume of `pendingInvite` so an invite opened while signed out completes after sign-in.
- `screens/JoinGroup.tsx` (new): the join funnel - idle (enter code) -> checking -> confirm (name + member count) -> joining -> success (navigation.reset into GroupDetail) / error (notFound vs network).
- `screens/GroupDetail.tsx`: replaced the seeded picker with an **Invite to group** BottomSheet (big code + copyable link + Share); lazily fetches `inviteByGroup` on sheet open; auto-opens after create (`justCreated`) and shows a one-time welcome `Band` after join (`justJoined`); has an error+retry state for the invite fetch.
- `screens/GroupsList.tsx`: a "Join with a code" sheet + a two-path zero-group onboarding card (Create a group / Join with a code), suppressing the trailing buttons when empty.
- `screens/CreateGroup.tsx`: `navigation.replace` into the new group with `justCreated` (lands on the shareable invite) instead of `goBack`.
- `screens/Account.tsx`: editable display name driven by `users.me`, saved server-first then mirrored to Clerk (`user.update({firstName})`).
- Tests: `Groups.test.tsx` updated for the new behavior (invite sheet, onboarding card, join-by-code, create-to-share); `JoinGroup.test.tsx` (new).

### Adversarial review + fixes (commit 8487af9)
- Background review workflow (`m4-invite-review`, 5 lenses -> verify) surfaced 11 candidates, confirmed 10, **all low severity**. Fixes applied:
  - `App.tsx` resume: dropped the redundant `getInitialURL` fallback (capture already stashes in every navigator-not-mounted case; linking owns the authed-URL case -> no double-navigation), clear pending only after the navigate lands, bail the readiness poll on teardown, corrected the stale "in-memory stash" comment.
  - `Account.tsx`: drive the name from `users.me` (makes `users.me` load-bearing, fixes the dev-user round-trip); write server-first then Clerk (avoids divergence on partial failure).
  - `GroupDetail` invite sheet: distinguish fetch-failure from loading (error line + Try again, instead of the misleading "code on its way").
  - `JoinGroup`: renamed the error union `notFound|network` (was inverted); dropped the unreachable dash from the code-entry placeholder.
  - `joinByCode`: softened the over-stated FK-invariant comment (dev-bypass caveat).
  - Consciously **accepted**: backfilled legacy codes are lower-entropy/deterministic (md5-derived) - bounded to pre-M4 rows, and demo groups get re-minted with crypto codes on every reseed anyway.

### Deploy wiring (commit e1dff38)
- `cd.yml`: bake `EXPO_PUBLIC_WEB_URL=https://bethere-beta.vercel.app` into the prod APK (native has no `window.location`).
- Deliberately did NOT set `EXPO_PUBLIC_WEB_URL` on Vercel web: the client falls back to `window.location.origin`, so dev web emits `bethere-dev` links and prod web emits `bethere-beta` links automatically; a fixed env there would cross the wires.
- Documented the optional API `PUBLIC_WEB_URL` (per App Runner service) in both `.env.example`s and `docs/runbook-deploy.md`, with the `aws apprunner update-service` command and the prod web domain.

### Process
- Created Linear DRP-50, moved In Progress -> Done with a full result comment.
- Verified end-to-end: `pnpm lint`/`typecheck` clean; full test suite green; booted the API on a fresh local DB (migrations + seed produce 5 unique 8-char codes); live HTTP `previewByCode` (lowercased/dashed code -> "The Boys, 6 members") and idempotent `joinByCode` against the running dev server.

## Key decisions & rationale
- **Link + short code (not email, not placeholder-claim):** lowest friction for a friend-group app; the code survives a flaky link and works on any surface; matches how the demographic shares (drop a link in the group chat). Email needs infra + known addresses; Tricount-style slots add merge/claim complexity.
- **Web-first, code as the primitive:** the live surface is Expo web on Vercel; a web invite is just a URL you open. The `/join/<code>` path is path-based so it upgrades to a native universal link later with zero backend change.
- **`previewByCode` is authed but NOT member-gated:** holding the code IS the invitation, so a non-member must be able to preview the group (name + count only) before joining. `inviteByGroup` (which exposes the code to share) IS member-gated.
- **No formal owner/admin role for M4:** any member can share the code (WhatsApp default), avoiding a roles migration. Codes have no expiry/revocation yet (deferred).
- **8-char codes from a no-confusable alphabet via crypto.randomInt:** ~39 bits, unguessable in practice given the global IP rate limit; no 0/1/I/L/O/U so codes survive being read aloud/retyped.
- **Migration backfill via md5(id):** deterministic + unique per id, dependency-free SQL (no pgcrypto), safe for legacy/prod rows; new rows always get crypto codes. Accepted the lower entropy of backfilled codes as bounded to pre-M4 rows.
- **Lazy invite fetch on sheet open (not in `load`):** matches the codebase's `openAdd` pattern, keeps `load` calling only `groups.get` (so existing load tests are unaffected and a group open never pays for an invite query).
- **Account name driven by `users.me`, server-first save:** the server name is the roster source of truth; writing it first then mirroring to Clerk avoids divergence; using `users.me` makes the new procedure load-bearing and fixes the dev-user edit round-trip.
- **`window.location.origin` for the web invite link (not a Vercel env var):** auto-adapts per environment; a hardcoded value would make one environment emit the other's links.

## Things learned / discovered
- **Mobile CANNOT value-import the `@bethere/shared` barrel.** Its `src/index.ts` re-exports with explicit `.js` ESM extensions that neither Metro nor jest-expo resolve against the `.ts` source. A runtime import surfaces in jest as `Cannot find module './logic/candidates.js' from '.../packages/shared/src/index.ts'` (and breaks the Metro bundle). This bit this session: `lib/invite.ts` initially `import { ... } from "@bethere/shared"` and broke `Groups.test`/`App.test`. **Fix/pattern:** import shared TYPE-ONLY and duplicate tiny pure helpers locally - precedent is `apps/mobile/src/lib/lock.ts`, which has a comment explaining exactly this. Now also `lib/invite.ts`. Saved as memory `mobile-shared-value-import-trap.md`.
- **The dev-bypass on the mobile client is always `u_dev`** (`signInDev` hardcodes it). So two browsers/sessions on web are the same user - you cannot simulate a *new* joiner via the dev button. A true cross-user join test needs two real Google accounts (or the deployed stack).
- **API deploy workflows only build/push the Docker image to ECR;** App Runner auto-deploys on the tag and injects env vars from the *service config* (AWS console), not from the workflow. So `PUBLIC_WEB_URL` is a service-level env var, not a repo change.
- **`groups.get` returns `{id,name,members[]}` (no memberCount); `groups.mine` returns memberCount.** `previewByCode` had to compute its own count.
- **Migrations are hand-authored here** (SQL file + `_journal.json` entry; snapshots stop at 0004 and `migrate()` only reads the journal + SQL). `drizzle-kit generate` is interactive and unusable.
- **Workflow script gotcha:** the literal string `"Math.random"` in a Workflow prompt tripped the script's determinism validator (it scans for `Math.random`/`Date.now`/`new Date`). Reworded to "a cryptographic RNG" to launch.
- **A concurrent workstream (DRP-51)** committed `docs/m4/` marketing/eval artifacts to `dev` during this session (commits `b9a7202`, and `350001c chore: remove m4 docs from lint`). Those are NOT part of DRP-50; the `docs/m4/*.html` files had biome lint errors, which is why a later commit removed them from lint scope.
- **A mistake to be aware of:** during verification I ran `docker compose down -v`, which wiped the local dev DB volume out from under a running dev API (PID was bound to :3000). Recovered by booting the API on PORT=3001 to re-run migrate + seed against the fresh DB (local data is ephemeral demo data, `SEED_ON_BOOT=reset`, so nothing real was lost).

## Current state
- All DRP-50 work is committed to `dev` and the working tree is clean. `dev` is **8 commits ahead of `origin/dev` and NOT pushed** -> nothing is deployed.
- Verified: backend (395 api tests on real Postgres + live HTTP calls), mobile (191 render tests), shared (7 files), lint + typecheck clean on all source. Booted the full API stack on a fresh DB successfully.
- NOT verified (needs a real browser + Google OAuth, could not run in-sandbox): the end-to-end "tap a `/join/<code>` link while signed out -> sign in -> land in the group" path (the `App.tsx` Gate capture/resume + the SPA rewrite + linking). The pieces are in place; this is the one thing to click through.
- Linear DRP-50 = Done with a result comment listing the commits.

## Conventions, commands & workflows
- Run before any PR: `pnpm lint`, `pnpm typecheck`, `pnpm test` (api tests need `pnpm db:up`).
- Local dev: `pnpm db:up && pnpm dev:api` (API :3000, seeds codes) + `pnpm web` (Expo web, dev-bypass button = `u_dev`).
- Branching: work on `dev`; PR `dev -> main` to ship. Pushing `dev` triggers `Deploy API (dev)` (App Runner `:dev`) + the Vercel dev web build; pushing `main` triggers prod API + prod web + the APK build.
- Mobile imports `@bethere/shared` TYPE-ONLY; duplicate pure helpers locally (see the trap above).
- Invite-link origin resolution (in `lib/invite.ts joinUrl`): server `PUBLIC_WEB_URL` -> build `EXPO_PUBLIC_WEB_URL` -> `window.location.origin` (web) -> `https://bethere.app` placeholder.

## Known issues / caveats / risks
- **Unpushed:** the whole feature is local-only until `dev` is pushed. Pushing also carries the interleaved DRP-51 docs commit.
- **Dev API migration on deploy:** pushing `dev` runs migration 0010 on the dev RDS on boot. Watch the `Deploy API (dev)` run settle - App Runner silently rolls back on a boot/migration crash (the workflow warns; see `docs/runbook-deploy.md`).
- **Clerk name claim:** if Google sign-in's JWT lacks a name claim, rosters show "Member" until the user edits via Account. The Account editor is the fix.
- **Universal links not set up:** tapping a web link opens the *web* app, not the native app (needs Apple `associated-domains` + Android `assetlinks.json`). Fine for web-first.
- **No automated coverage of the deep-link capture/resume** (`App.tsx` Gate) - the trickiest code. Reviewer flagged it; verify manually.
- **Codes have no expiry/revocation** and any member can share; acceptable for M4.
- **Local native (`pnpm phone`) without `EXPO_PUBLIC_WEB_URL`** builds invite links against the `https://bethere.app` placeholder (you wouldn't share from local dev, and the code still works).

## Next steps
1. **Push `dev`** -> deploys the dev API (migration 0010 on dev RDS) + dev web (`bethere-dev.vercel.app`). Watch the API deploy settle.
2. **Click the two-account test** on `bethere-dev.vercel.app`: account A creates a group + shares the link; account B (different Google, different browser) opens it, signs in, confirms, joins; A sees B in the roster.
3. **Ship to prod:** PR `dev -> main` once verified -> prod API + prod web (`bethere-beta`) + APK (baked with `bethere-beta`).
4. (Optional) set `PUBLIC_WEB_URL` on both App Runner services for server-canonical native links (runbook has the command).
5. (Later) universal-links setup if you want web links to open the native app.

## References
- Plan: `/Users/gong/.claude/plans/we-finished-milestone-3-tranquil-quasar.md`
- Backend: `apps/api/src/routers/groups.ts`, `apps/api/src/routers/users.ts`, `apps/api/src/db/groups.ts`, `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0010_group_invite_code.sql`, `packages/shared/src/logic/invite.ts`, `packages/shared/src/schemas.ts`.
- Mobile: `apps/mobile/App.tsx`, `apps/mobile/src/lib/invite.ts`, `apps/mobile/src/lib/share.ts`, `apps/mobile/src/screens/JoinGroup.tsx`, `GroupDetail.tsx`, `GroupsList.tsx`, `CreateGroup.tsx`, `Account.tsx`, `src/lib/copy.ts`.
- Deploy: `.github/workflows/cd.yml`, `deploy-api.yml`, `deploy-api-dev.yml`, `vercel.json`, `docs/runbook-deploy.md` ("Invite-link origin" section).
- Linear: DRP-50 (https://linear.app/drp-02/issue/DRP-50). Memory: `mobile-shared-value-import-trap.md`.
- Constraint reminder: `apps/mobile/src/lib/lock.ts` (the original "duplicate, don't value-import shared" precedent).
- Commits: 1e9e3b9, d9173ac, 1ea2c75 (backend), c83d93b, babbd3c (mobile), 8487af9 (review fixes), e1dff38 (deploy wiring).
