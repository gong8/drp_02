# PostHog integration - design spec

Date: 2026-06-09
Status: approved, ready for implementation plan

## Goal

Instrument BeThere with a focused PostHog integration that produces the
**Family-D product-outcome telemetry** defined in `docs/m4/quantitative-evaluation.md`
(section 3.4), which is currently a `[TEAM TO FILL - log on staging / live]` gap. The
headline metric is **plan clear rate** (cleared / (cleared + fizzled)), the direct
app-measured answer to the survey's "53.5% report >= 30% of hangouts never happen".

This is deliberately **not** a "full PostHog" integration. Explicitly out of scope:
session replay, feature flags, A/B testing, surveys, and client autocapture. The user
base is too small for A/B significance, and replay/autocapture conflict with the
product's core anonymity stance.

## Decisions (settled during brainstorming)

- **Identity model:** pseudonymous `distinct_id` = the internal `userId` (Clerk id /
  `u_dev`). Opaque, never PII, never surfaced in-app. Enables per-user funnels and
  rates (e.g. RSVP completion). In-app anonymity ("no voter names ever shown") is a
  separate UI invariant and is untouched - PostHog is a private backend.
- **Host:** PostHog Cloud **EU** (`https://eu.i.posthog.com`). GDPR-friendly data
  residency for a UK course project; zero ops; free tier.
- **Client scope:** **web-first, cross-platform**. `posthog-js` on web
  (`react-native-web`, the priority target), `posthog-react-native` on iOS/Android,
  behind one wrapper. Autocapture and session replay OFF on both.
- **Server is the metric backbone.** All Family-D metrics fall out of server events,
  so they are captured for every user (including web) regardless of the client layer.

## Architecture

Two layers, one shared event vocabulary.

### Layer 1 - Server capture (`apps/api`), the source of truth

- Dependency: `posthog-node`.
- New module `apps/api/src/analytics.ts` exporting `capture(distinctId, event, props)`
  and `shutdown()` around a lazily-initialized singleton client.
- **Env-gated, no-op when unconfigured.** Reads `POSTHOG_KEY` and `POSTHOG_HOST`
  (default `https://eu.i.posthog.com`). When `POSTHOG_KEY` is absent (local dev, CI,
  tests), `capture` is a pure no-op: no client constructed, no network, no flushing.
  This keeps the existing DB-backed tRPC tests hermetic.
- `distinct_id = ctx.userId` (the pseudonymous decision).
- **Defensive.** Capture is fire-and-forget and must never throw into the request
  path; an analytics failure cannot break a tRPC call (wrap in try/catch, log at warn).
- Flush via `fastify.onClose` -> `shutdown()`. App Runner is long-running, so graceful
  flush is reliable (no serverless-per-invocation flush needed).

### Layer 2 - Cross-platform client (`apps/mobile`), web-first

- Dependencies: `posthog-js` (web), `posthog-react-native` (native).
- New wrapper `apps/mobile/src/lib/analytics.ts` exposing ONE uniform API -
  `identify(userId)`, `capture(event, props)`, `screen(name)` - that branches on
  `Platform.OS`:
  - web -> `posthog-js`
  - iOS / Android -> `posthog-react-native`
- **Autocapture and session replay OFF on both.** Critical for `posthog-js`, which
  enables both by default: set `autocapture: false` and `disable_session_recording: true`.
- Env `EXPO_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_HOST`. No key -> no-op on every
  platform.
- Screen views tracked manually via React Navigation `onStateChange` (not autocapture).
- `identify(userId)` called after auth resolves, so web + native + server events stitch
  into one pseudonymous person.

## Event taxonomy

Server events (Layer 1) are the metric backbone and map 1:1 onto the Family-D table.
All fire at single-source choke points already present in `apps/api/src/routers/events.ts`.

| Event | Choke point (events.ts) | Key properties | Family-D metric |
|---|---|---|---|
| `plan_created` | `create` (~514) | groupId, lockTimes, lockActivity, opensMoment, timeCandidateCount, activityCandidateCount, contingent, isRedo | Anonymous-creation share |
| `moment_opened` | `openMoment` (~266), only when it returns `true` (won the transition race) | planId, viaAutoLock vs manual | Time-to-lock (paired with `plan_created` ts) |
| `plan_cleared` | `settlePhase` (~250) | planId, contingent | **Plan clear rate** |
| `plan_fizzled` | `settlePhase` (~250) + `fizzle` (~173) | planId, contingent | Fizzle rate |
| `rsvp_submitted` | `respond` (~998) | planId, kind (yes / no / conditional), isChange | RSVP completion rate + conditional-RSVP usage |
| `candidate_voted` | `toggleReaction` (~610) | planId, kind (time / activity), added vs removed | Votes per collecting plan |
| `candidate_added` | `addCandidate` (~665) | planId, kind | momentum |

Derived in PostHog, not stored separately: **time-to-lock** (median of
`moment_opened.ts - plan_created.ts`) and **votes per collecting plan** (count of
`candidate_voted` per planId).

Client events (Layer 2) approximate the Family A/B "send a plan" task metrics:

- screen views (every navigation, manual)
- `plan_create_started`, wizard-step-completed, `plan_create_submitted`
  (T1 send-a-plan success funnel + time-on-task)

## Privacy guardrails (anonymity is core)

- `distinct_id` is the opaque internal `userId` only. **Never** include email, display
  name, or any candidate-voter linkage in event properties.
- In-app anonymity ("no voter names shown to other members") is a UI invariant and is
  unchanged; PostHog is a private analytics backend, not an in-app surface.
- EU host. No session replay, no autocapture.
- Add a short events->metrics mapping note for the M4 writeup so a grader can trace
  each Family-D figure back to its event.

## Config and deployment

- API env in **both** App Runner stacks (prod `bethere-api` + dev `bethere-api-dev`):
  `POSTHOG_KEY`, `POSTHOG_HOST`. Absent in CI / test / local -> no-op.
- Mobile env via Expo: `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST`.
- Document the new env vars in `docs/runbook-deploy.md` and the `.env` example files.

## Testing

- Unit-test `analytics.ts` (server): no-op behaviour when `POSTHOG_KEY` is absent;
  `capture` forwards `distinct_id` / event / props to an injected fake client when set.
- Assert the choke points call `capture` with the expected event name and properties
  using a spy / injected fake (e.g. in `events-*.test.ts` or a dedicated test).
- Existing DB-backed tRPC tests stay network-free (no key in the test env).
- Client wrapper: unit-test that it no-ops without a key and routes to the right SDK
  shape per `Platform.OS`.

## Out of scope

Session replay, feature flags, A/B testing, surveys, client autocapture. Group
onboarding (DRP-50) events can be added later if a funnel is needed; not in this pass.
