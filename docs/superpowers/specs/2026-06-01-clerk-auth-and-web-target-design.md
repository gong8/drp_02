# Clerk auth + web target - design

- Date: 2026-06-01
- Status: approved, pending implementation plan
- Area: `apps/mobile`, `apps/api`, CD (`.github/workflows/cd.yml`), deploy config

## Summary

Add real authentication (Clerk, Google OAuth) and a browser-hostable web build to
BeThere, while keeping the codebase almost entirely in sync between native and web.

Two outcomes:

1. **One Expo app, two targets.** `apps/mobile` keeps a single set of screens and
   renders them on iOS/Android (native) and in the browser (react-native-web). The
   web build is a static SPA hosted on Vercel. No `apps/web` folder, no duplicated
   screens.
2. **Clerk auth with a dev bypass.** Sign-in is Clerk + Google OAuth on every target.
   The API verifies Clerk session tokens (networkless), falling back to the existing
   `x-user-id` dev stub when `DEV_AUTH_BYPASS` is set. The sideloaded CD APK also ships
   a flag-gated "Continue as test user" button that signs you in as the seed user
   `u_dev` for reliable demo/grading.

## Locked decisions

| Decision | Choice |
| --- | --- |
| Web structure | One Expo app with the web target enabled; deploy `expo export -p web` output to Vercel. No separate `apps/web`. |
| Auth provider | Clerk via `@clerk/clerk-expo` (supports native + web target through `useSSO`). |
| Social login | Google OAuth (`strategy: 'oauth_google'`). |
| Identity model | The Clerk user id is the app user id. On first verified request, upsert a `users` row from the token claims. New users start empty. |
| Backend enforcement | Verify Clerk bearer token -> `userId = claims.sub`. When `DEV_AUTH_BYPASS` is set and no token is present, fall back to the `x-user-id` stub (default `u_dev`). Otherwise `UNAUTHORIZED`. |
| APK sign-in | Both: real Google OAuth wired AND a flag-gated dev-bypass button that signs in as seed user `u_dev`. |

## Architecture

```
apps/mobile  (single codebase, native + web)
  App.tsx               native shell (existing tab navigator)
  App.web.tsx           web shell: same navigator inside a centered max-width column
  src/screens/*         UNCHANGED, shared on every target
  src/screens/SignIn.*  Clerk Google button (+ dev-bypass button when flag set)
  src/lib/clerk.ts      ClerkProvider config + native token cache (expo-secure-store)
  src/lib/auth.ts       module-level token/identity holder + AuthBridge component
  src/lib/trpc.ts       httpBatchLink headers() reads the holder (screens untouched)

apps/api
  src/trpc.ts           context: verify Clerk JWT -> userId; DEV_AUTH_BYPASS -> x-user-id
  src/auth/clerk.ts     verifyToken wrapper (@clerk/backend, networkless via CLERK_JWT_KEY)
  src/db/schema.ts      users gains a nullable `email` column
  (user upsert)         on first verified request, upsert users(id=sub, name, email, color)

deploy
  web  -> expo export -p web -> static dist/ -> Vercel (SPA rewrite to index.html)
  apk  -> CD bakes EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY + EXPO_PUBLIC_DEV_AUTH=1
  api  -> CLERK_JWT_KEY, CLERK_SECRET_KEY, DEV_AUTH_BYPASS env on App Runner
  clerk-> enable Google connection; allowed origins/redirects (web URL, localhost,
          native scheme); add name + email to session-token claims
```

## Client design (`apps/mobile`)

Runs natively and on web from one codebase. Only the entry shell and the auth wiring
are platform-aware; screens are untouched.

### Dependencies and config

- Auth: `@clerk/clerk-expo`, `expo-web-browser`, `expo-auth-session`, `expo-secure-store`.
- Web: `react-native-web`, `react-dom`, `@expo/metro-runtime`.
- `app.json`: add `"web"` to `platforms`; add a `"scheme"` (e.g. `bethere`) for the
  native OAuth redirect deep-link.
- Env (inlined by Metro at build time):
  - `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` - required on every build.
  - `EXPO_PUBLIC_API_URL` - already used.
  - `EXPO_PUBLIC_DEV_AUTH` - when `1`, the dev-bypass button is shown.

### Auth gate

- Root wraps the app in `<ClerkProvider publishableKey tokenCache>`.
  - `tokenCache`: `expo-secure-store` on native; omit on web (Clerk uses its own storage).
- `<SignedOut>` renders the `SignIn` screen; `<SignedIn>` renders the existing tab
  navigator. Signed-out users never reach the navigator.

### SignIn screen

- Sage-themed, matches `theme.ts`.
- "Continue with Google": `useSSO().startSSOFlow({ strategy: 'oauth_google', redirectUrl })`.
  - Web: redirect defaults to current path.
  - Native: `redirectUrl = AuthSession.makeRedirectUri({ scheme: 'bethere' })`.
  - Standard `WebBrowser.maybeCompleteAuthSession()` + Android warm-up.
- "Continue as test user" (only when `EXPO_PUBLIC_DEV_AUTH === '1'`): does NOT call
  Clerk. Sets the identity holder to dev mode (`userId = 'u_dev'`) and marks the app
  signed-in locally. From then on tRPC sends `x-user-id: u_dev` instead of a Bearer
  token. (Implementation note: the gate must treat dev-bypass as "signed in" even
  though Clerk's `<SignedIn>` is false - the navigator render is driven by an app-level
  `isAuthed = clerkSignedIn || devBypassActive`.)

### tRPC stays invisible to screens

- `src/lib/auth.ts` holds a module-level `{ mode: 'clerk' | 'dev' | null, getToken? }`.
- `<AuthBridge>` (rendered inside `ClerkProvider`) calls `useAuth()` and registers
  `getToken` into the holder; the dev-bypass button sets `mode: 'dev'`.
- `src/lib/trpc.ts` `httpBatchLink` gains:
  ```ts
  headers: async () => {
    if (holder.mode === 'dev') return { 'x-user-id': 'u_dev' };
    const token = holder.getToken ? await holder.getToken() : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
  ```
- Screens keep calling `trpc.events.mine.query()` unchanged.

### Web shell and sign-out

- `App.web.tsx` constrains content to a centered ~480px app-shell column so desktop
  looks intentional rather than a stretched phone. Same navigator/screens underneath.
- Sign-out: a small "Account" control (shows name/email + Sign out) added as a header
  button so the existing two tabs are untouched. Clerk path calls `useAuth().signOut()`;
  dev path clears the holder.

## Backend design (`apps/api`)

### Token verification + dev fallback

- New dep: `@clerk/backend`.
- `src/auth/clerk.ts`: thin wrapper around `verifyToken(token, { jwtKey: CLERK_JWT_KEY,
  authorizedParties })`, networkless (no per-request round-trip).
- `src/trpc.ts` context resolution order:
  1. `Authorization: Bearer <token>` present -> verify -> `userId = claims.sub`.
  2. else if `DEV_AUTH_BYPASS` set -> existing `x-user-id` stub (default `u_dev`).
  3. else -> `UNAUTHORIZED`.

### First-sign-in user upsert

- On a verified token, upsert a `users` row: `id = claims.sub`, `name` and `email` from
  the session-token claims, a generated `avatarColor`.
- To get `name`/`email` networklessly, add them to Clerk's session-token claims via a
  JWT template (documented Clerk dashboard step). Dev-bypass path skips upsert (`u_dev`
  already seeded).

### Schema

- `users` gains a nullable `email` column. New `avatarColor` generated from a small
  palette when absent. Migration via `db:generate` / `db:migrate`.

### Env

- `CLERK_JWT_KEY` (PEM public key for networkless verify), `CLERK_SECRET_KEY` (for the
  Clerk client if needed), `DEV_AUTH_BYPASS`.

## CD / deploy

### APK (`.github/workflows/cd.yml`)

- Add build env alongside `EXPO_PUBLIC_API_URL`:
  - `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (from a GitHub secret).
  - `EXPO_PUBLIC_DEV_AUTH: "1"` so the sideloaded APK shows the test-user button.
- `expo prebuild` picks up the new `scheme` from `app.json`, so the native OAuth
  redirect deep-link is registered. No EAS required - the existing prebuild + Gradle
  `assembleRelease` already produces a real native binary that includes Clerk's native
  modules.

### Web -> Vercel

- Build: `expo export -p web` -> static `dist/`.
- Vercel: framework preset "Other", output dir `dist`, SPA rewrite all routes to
  `index.html`.
- Build-time env: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_API_URL` (the App
  Runner URL). `EXPO_PUBLIC_DEV_AUTH` is NOT set on web (Google only).

### Live API (App Runner)

- Add `CLERK_JWT_KEY`, `CLERK_SECRET_KEY`, and `DEV_AUTH_BYPASS=1`.
- `DEV_AUTH_BYPASS` on the live API is what makes the APK's test-user button work
  against prod. This is consistent with the existing "API is intentionally open through
  M2" posture (`docs/tech-debt.md`); revisit when hardening the backend.

### Clerk dashboard

- Enable the Google social connection.
- Allowed origins / redirect URLs: localhost (dev), the Vercel web URL, and the native
  scheme (`bethere://`).
- Add `name` and `email` to the session-token claims (for the networkless upsert).

## Data flow (one request)

```
screen -> trpc.<proc>.query()
       -> httpBatchLink headers():
            dev mode  -> x-user-id: u_dev
            clerk     -> Authorization: Bearer <session token>
       -> API context:
            Bearer present -> verifyToken -> userId = sub -> upsert user
            else + DEV_AUTH_BYPASS -> x-user-id stub
            else -> UNAUTHORIZED
       -> procedure runs as that user
```

## Testing

- Existing API tests run with `DEV_AUTH_BYPASS=1` -> unchanged behavior.
- New API tests:
  - no token + no bypass -> `UNAUTHORIZED`.
  - mocked `verifyToken` returns a sub -> context `userId` is that sub, and the user is
    upserted.
- Client: keep it light (no Clerk E2E). Optionally a unit test that the tRPC header
  function returns `x-user-id` in dev mode and `Authorization` in clerk mode.
- Run `pnpm lint`, `pnpm typecheck`, `pnpm test` before any PR.

## Out of scope (YAGNI)

- No roles/permissions, no profile editing, no OAuth providers beyond Google.
- No account linking beyond the first-sign-in upsert (a real Google login does not adopt
  seeded `u_dev` data; to demo rich seeded data, re-seed a group to include your Clerk id
  or use the dev-bypass button).
- No backend hardening beyond token verification; the API stays open via `DEV_AUTH_BYPASS`
  through M2 by design.
- No `apps/web` folder; no shared-package extraction (screens already shared in place).

## Risks / watch-items

- Native Custom Tab OAuth redirect can vary by device; the dev-bypass button is the
  reliable demo path, so this is low-risk for grading.
- `DEV_AUTH_BYPASS=1` on prod means the live API trusts `x-user-id` (spoofable). Accepted
  through M2; remove when hardening.
- react-native-web fidelity: screens use only RN primitives, so risk is low, but the
  desktop layout needs the max-width shell to look right.
- Clerk session-token claim customization must be configured in the dashboard or the
  upsert has no name/email (falls back to id-only).

## Rollout order (for the plan)

1. Backend: `@clerk/backend`, verify + dev fallback, `email` column + upsert, tests.
2. Client auth: ClerkProvider, AuthBridge, tRPC header injection, SignIn screen (Google
   + flag-gated dev button), sign-out.
3. Web target: enable web platform, `App.web.tsx` shell, local `expo export -p web` check.
4. Deploy wiring: CD APK envs + `scheme`, Vercel project, App Runner envs, Clerk dashboard.
5. Verify: web hosted sign-in (Google), APK dev-bypass as `u_dev`, end-to-end RSVP flow.
