# Custom backend logger (Pino + pino-pretty) - 2026-05-28

**Branch:** `dev` | **Commits:** `ef3cab7`, `f325135` | **Linear:** DRP-21 (Done) | **Scope:** Add one owned logger to `apps/api` that prints clean, scoped messages for boot, HTTP, every tRPC call, and DB queries; pretty in dev, JSON in prod.

## TL;DR
The task was "implement a custom logger across the backend and everything that prints good messages for everything." After a brainstorming pass and a short approved spec, we added a single Pino instance (`apps/api/src/logger.ts`) wired through the Fastify/tRPC/Drizzle backend, with a per-event `scope` tag (boot/http/trpc/db). Output is pretty + colorized in dev (via `pino-pretty`) and raw JSON in prod (gated on `NODE_ENV`). Scope was deliberately limited to the backend (mobile and shared untouched). It is committed to `dev` in two commits and verified by actually running the API and observing output; `pnpm lint`, `typecheck`, and `test` all pass.

## What was done
- **Brainstormed and wrote a spec** (`docs/superpowers/specs/2026-05-28-backend-logger-design.md`). Explored the codebase, asked four scope questions (see decisions), produced a design, got approval, then implemented.
- **Added dependencies** to `apps/api/package.json`: `pino` `^10.3.1` (regular dep, imported directly) and `pino-pretty` `^13.1.3` (devDep, dev-only transport). Installed via `pnpm --filter @bethere/api add pino` and `pnpm --filter @bethere/api add -D pino-pretty`.
- **Created `apps/api/src/logger.ts`** - a singleton Pino instance:
  - `level` from `LOG_LEVEL` env (default `info`; `debug` surfaces DB query lines).
  - Dev (`NODE_ENV !== "production"`): `transport` targets `pino-pretty` with `colorize: true`, `translateTime: "SYS:HH:MM:ss"`, `messageFormat: "{if scope}[{scope}] {end}{msg}"`, and an `ignore` list (`FOLDED_FIELDS`).
  - Prod (`NODE_ENV === "production"`): no transport -> default JSON lines to stdout.
  - `FOLDED_FIELDS = "pid,hostname,reqId,scope,path,type,userId,ms,code,method,url,statusCode,params,port"` - these structured fields are baked into the message string for dev readability, so they are hidden from pino-pretty's appended object to keep lines tidy. `err` is intentionally NOT in the list so error stacks still pretty-print.
- **Wired `apps/api/src/index.ts`**:
  - `Fastify({ loggerInstance: logger, disableRequestLogging: true })` - pass our Pino instance (Fastify v5 option name) and turn off Fastify's default two-lines-per-request logging.
  - Added an `onResponse` hook that emits one clean HTTP line via `req.log`: `${method} ${url} ${statusCode} ${ms}ms` (ms = `Math.round(reply.elapsedTime)`), with scope `http`.
  - Scoped the existing boot logs: `{ scope: "boot" }` on "migrations applied" and the seed messages.
  - Converted the `listen()` call to `try/await/catch`, logging `[boot] API listening on http://localhost:<port>` on success and `[boot] failed to start` (with `err`) then `process.exit(1)` on failure.
  - **Follow-up (commit `f325135`)**: muted the server logger to `warn` around `listen()` to suppress Fastify's own unscoped "Server listening at <addr>" lines (it logs one per bound address; `0.0.0.0` produced two). Restores the prior level immediately after; errors (>= warn) still surface.
- **Added tRPC logging middleware (`apps/api/src/trpc.ts`)**:
  - `createContext` now returns `{ userId, log: req.log }` so middleware logs inherit Fastify's per-request `reqId` (correlates tRPC and HTTP lines).
  - A `loggingMiddleware` attached to the base `publicProcedure` logs every procedure: `{ scope: "trpc", path, type, userId, ms }`. Success -> `info` (`<path> ok`); expected client errors (a `Set` of TRPCError codes: BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, TIMEOUT, TOO_MANY_REQUESTS, PARSE_ERROR) -> `warn`; anything else -> `error` with the `err` attached.
- **Added a Drizzle query logger (`apps/api/src/db/client.ts`)**:
  - `import type { Logger as DrizzleLogger } from "drizzle-orm"` (the `Logger` interface lives in the root `drizzle-orm` entry, NOT the `drizzle-orm/node-postgres` subpath - this matters).
  - A child logger `logger.child({ scope: "db" })` and a `queryLogger: DrizzleLogger` with `logQuery(query, params) { dbLog.debug({ params }, query); }`, passed as `drizzle(pool, { schema, logger: queryLogger })`. SQL is emitted at `debug`, so it is silent unless `LOG_LEVEL=debug`.
- **Linear**: created issue **DRP-21** ("Custom backend logger (Pino + pino-pretty)") in team DRP_02, moved it to In Progress before work, commented progress, then marked it Done with commit references.

## Key decisions & rationale
Four scope questions were asked up front (via the AskUserQuestion tool). The user's answers:

| Question | Chosen | Why it matters |
|---|---|---|
| How wide is "and everything"? | **Backend only (`apps/api`)** | Mobile/shared untouched. Keeps scope tight per CLAUDE.md ("build only what's asked"). |
| How to build it? | **Configure Pino + pino-pretty** (NOT the recommended zero-dep custom module) | Fastify already runs on Pino; configuring it keeps ONE logging pipeline instead of two competing formats. The agent had recommended a hand-rolled zero-dep module, but the user preferred leaning on the existing, idiomatic stack. |
| Output format? | **Pretty in dev, JSON in prod** (env-gated) | JSON is clean for App Runner / CloudWatch; pretty is readable locally. |
| What to instrument? | **All four**: server lifecycle, HTTP requests, tRPC procedure calls, DB queries | "Good messages for everything." |

Other decisions:
- **Gate pretty-vs-JSON on `NODE_ENV`** rather than a bespoke `LOG_FORMAT` var. Verified the Dockerfile sets `ENV NODE_ENV=production` (line 24), so prod reliably gets JSON and never loads the pino-pretty worker. (YAGNI: no extra env var.)
- **Bake facts into the message string AND pass them as structured fields**, then hide the duplicated fields in dev via pino-pretty `ignore`. This yields compact, readable dev lines (`[trpc] events.create ok  user=u_dev 12ms`) while preserving full structured fields for prod JSON search. `err` is excluded from `ignore` so stacks still render in dev.
- **Reuse `req.log` in tRPC context** instead of a fresh child logger, so tRPC and HTTP lines share `reqId` and can be correlated.
- **Suppress Fastify's "Server listening" line by briefly muting the logger level**, not by `listenTextResolver`. Investigated the Fastify source (`node_modules/fastify/lib/server.js` -> `logServerAddress`): it does `this.log.info(listenTextResolver(address))` in a loop over all bound addresses, with no option to disable. `listenTextResolver` can only change the text (still logs N lines, no scope). Muting to `warn` around `listen()` is the surgical way to drop those specific info lines while keeping our single scoped line and still surfacing bind errors.
- **Skipped adding a test runner to `apps/api`.** It has none today (only `packages/shared` via vitest and `apps/mobile` via jest have `test` scripts). The deliverable is runtime output with little branching logic, so verification was done by running the server. Offered to add a test if wanted; user did not request it.
- **Committed straight to `dev`** (no feature branch). Per CLAUDE.md, routine/incremental work goes directly to `dev`; only "massive features" get a `feat/*` branch + PR. A logger is incremental infra.
- **Process note**: the agent ran the brainstorming skill (design -> approval -> spec -> approval) but, given the user's "go!" and the small, well-specified scope, treated the spec as the plan and implemented directly rather than invoking the writing-plans skill / a separate plan doc.

## Things learned / discovered
- **Fastify v5 logger API**: pass a prebuilt Pino instance via **`loggerInstance`**, NOT `logger`. In v5 the `logger` option no longer accepts an instance (v4 -> v5 breaking change). Confirmed via context7 (`/llmstxt/fastify_dev_llms_txt`, Migration-Guide-V5). Installed Fastify is `5.8.5`.
- **Fastify's listening log is unavoidable via options**: `logServerAddress` loops over `getAddresses(...)` and calls `this.log.info(...)` per address; `0.0.0.0` resolves to multiple (we saw `127.0.0.1` and a `192.0.0.2` TEST-NET-ish interface address on this Mac). Only level-muting or a custom destination stream can drop them.
- **`reply.elapsedTime`** exists in Fastify v5 and gives ms since the request was received (used in the `onResponse` hook).
- **Drizzle `Logger` interface** is exported from the root `drizzle-orm` package (`node_modules/drizzle-orm/logger.d.ts`, re-exported via `index.d.ts`'s `export * from "./logger.js"`), with signature `logQuery(query: string, params: unknown[]): void`. It is NOT exported from `drizzle-orm/node-postgres` - importing it from the subpath would fail. The first edit made this mistake and was corrected.
- **pino-pretty `messageFormat` conditional** `{if scope}[{scope}] {end}{msg}` works in pino-pretty `13.x` and correctly omits the bracket when `scope` is absent (verified: Fastify's own listening line, which has no scope, rendered without `[undefined]`).
- **pino-pretty `ignore` + baked message** pattern: a field referenced in `messageFormat` can still be listed in `ignore` (suppressed from the appended object but available to the template). Forgetting to add a field to `ignore` causes it to print on an indented second line - this happened with `port` on the boot line and was fixed by adding `port` to `FOLDED_FIELDS`.
- **pnpm + orphaned processes**: `pnpm --filter @bethere/api start &` spawns pnpm -> tsx -> node; `kill`-ing the pnpm wrapper PID orphans the node child, which keeps the port bound. A later test run on the same port failed with the server logging `[boot] failed to start` (EADDRINUSE after migrate). Fix: find the real listener with `lsof -nP -iTCP:<port> -sTCP:LISTEN -t` and kill that PID too. Used alternate ports (3100-3103) for all test runs to avoid touching the user's dev server on :3000.
- **`tsx watch` auto-reload**: the user's `pnpm dev:api` (on :3000) reloaded onto the new logger code as files were edited (its PID changed across checks: 60566 -> 65178 -> 83421). Expected behavior; the running dev server was never touched directly.
- **Local dev DB**: Docker Postgres container `drp_02-postgres-1` on host port **5433** -> container 5432 (user `drp`, db `drp`). `apps/api/.env` (gitignored, present) supplies `DATABASE_URL=postgres://drp:drp@localhost:5433/drp`; `index.ts` loads it via `import "dotenv/config"`. `dotenv` does not override already-set env vars, so `PORT=...`/`SEED_ON_BOOT=...` passed inline win.
- **`SEED_ON_BOOT`** modes: `reset` (default, local dev) wipes + reseeds each boot; `if-empty` (live/Docker) seeds only a fresh DB; `off` skips. Test runs used `SEED_ON_BOOT=off` to avoid wiping the shared local DB.

## Current state
- **Committed to `dev`**, not yet PR'd to `main`:
  - `ef3cab7 feat(api): structured logger across boot, http, tRPC, and DB` (7 files, +313/-10).
  - `f325135 fix(api): suppress Fastify's duplicate "Server listening" log lines` (1 file, +7).
- **Linear DRP-21** is **Done**, assigned to Leixin Gong, with progress + follow-up comments referencing both commits. URL: https://linear.app/drp-02/issue/DRP-21/custom-backend-logger-pino-pino-pretty
- **Verified by running the API** on alternate ports (3100-3103) with `SEED_ON_BOOT=off`:
  - Dev pretty (ANSI stripped for capture): `[boot] migrations applied`, `[boot] API listening on http://localhost:<port>`, `[trpc] health ok  user=u_dev 0ms`, `[http] GET /trpc/health 200 7ms`, and `[trpc] groups.get FORBIDDEN  user=u_stranger 4ms` (WARN) with the HTTP line showing `403`.
  - `LOG_LEVEL=debug` showed `[db]` SQL lines (CREATE SCHEMA, the `__drizzle_migrations` select, begin/commit, etc.).
  - `NODE_ENV=production` emitted JSON lines; the `trpc` and `http` records for one request shared `"reqId":"req-1"`.
  - After the follow-up commit, the "Server listening at" lines are gone (`grep -c` returned 0) and only the single scoped boot line remains.
- **Gates green**: `pnpm lint` (biome, 38 files, no fixes), `pnpm typecheck` (all 3 packages), `pnpm test` (shared 9 tests, mobile 1 test) all pass.
- **Working tree**: one untracked, pre-existing file left alone: `docs/summary/2026-05-28-1705-live-backend-deploy-and-standalone-apk.md` (NOT created this session). This summary file adds a second untracked file.
- **CLAUDE.md** was updated/committed by the user mid-session (commit `c843547`, before this work landed) - notably it now states the Linear team is **DRP_02**, requires `pnpm lint` before PRs, and reiterates "No em dashes anywhere".

## Conventions, commands & workflows
- **Logging usage going forward**:
  - Always log with a `scope`: `boot` / `http` / `trpc` / `db` (or add new ones consistently).
  - For readable dev lines, bake key facts into the message string AND pass them as structured fields; if you add a NEW structured field that you don't want duplicated in dev output, add its key to `FOLDED_FIELDS` in `apps/api/src/logger.ts`. Never add `err` to that list (stacks must render).
  - `LOG_LEVEL=debug` turns on DB query logging; default is `info`.
  - Import the shared instance: `import { logger } from "./logger.js"` (or `"../logger.js"`). Inside tRPC procedures, prefer `ctx.log` (carries `reqId`).
- **Commands**: `pnpm dev:api` (API on :3000), `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm db:up`/`db:down`. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` before any PR. Use `pnpm` only (never npm/yarn).
- **Branching**: work directly on `dev` for routine changes; `feat/*` -> PR into `dev` only for massive features; ship via PR `dev` -> `main` (the only branch allowed to merge to `main`). CI runs on PRs into `main`; CD (backend deploy + Android build) runs on push to `main`.
- **Issue tracking**: track all work in Linear team **DRP_02** via the Linear MCP - create/find the issue and move to In Progress before starting, comment progress, mark Done with commit/PR refs when finished.
- **No em dashes anywhere** (code, docs, comments) - use hyphens. (Repo also runs `pnpm quality` = `node scripts/quality-check.mjs`.)
- **Testing a server locally without disturbing the dev server**: use an alternate `PORT` and `SEED_ON_BOOT=off`; after killing, also kill the real listener found via `lsof -nP -iTCP:<port> -sTCP:LISTEN -t`.

## Known issues / caveats / risks
- **No automated tests for the logger.** `apps/api` has no test runner; the logger (format, middleware, Drizzle logger) is only verified by manual run-and-observe. Regressions in log format or the warn/error classification would not be caught by CI.
- **Level-muting around `listen()` is a small hack.** It briefly sets `server.log.level = "warn"` and restores it. If anything else logged at info concurrently during the (very short) listen window it would be suppressed - not a concern at boot, but worth knowing. If a future Fastify upgrade changes how/when the listening line is logged, revisit.
- **`pino-pretty` is a devDependency but is present in the prod image.** The Dockerfile's `pnpm install` runs before `ENV NODE_ENV=production`, so devDeps (incl. tsx and pino-pretty) are installed in the container. This is harmless because the transport is gated on `NODE_ENV` and never loaded in prod, but it means the prod image is larger than strictly necessary.
- **DB query logging at debug can be verbose** (every statement, including migrate's internal queries). It is off by default (`info`), so only an issue if someone sets `LOG_LEVEL=debug` in a noisy environment.
- **`FOLDED_FIELDS` is a manually maintained denylist.** Add new structured field keys to it or they will print on indented extra lines in dev (the `port` bug). pino-pretty has no "ignore all extra keys" option in this setup.

## Next steps
- (Optional) Add a `test` script + vitest to `apps/api` and a small test for the tRPC logging middleware's outcome classification (info/warn/error) and the message format, so CI guards it.
- (Optional) When ready to ship, open a PR `dev` -> `main`; CD will deploy the backend to App Runner. The new logger means prod logs become structured JSON in CloudWatch - confirm they parse as expected there.
- (Optional) Consider extracting tiny `scope` helper child loggers (e.g. `logger.child({ scope: "boot" })`) if boot logging grows, to avoid repeating `{ scope: "boot" }` inline.
- Consider whether the mobile client wants a lightweight logger later (explicitly out of scope this session).

## References
- **Spec**: `docs/superpowers/specs/2026-05-28-backend-logger-design.md`
- **Code**:
  - `apps/api/src/logger.ts` (new - the Pino instance + pretty/JSON config)
  - `apps/api/src/index.ts` (Fastify `loggerInstance`, `disableRequestLogging`, `onResponse` HTTP hook, scoped boot logs, listen-line suppression)
  - `apps/api/src/trpc.ts` (context `log`, `loggingMiddleware`, `EXPECTED_ERRORS` set)
  - `apps/api/src/db/client.ts` (Drizzle `queryLogger`)
  - `apps/api/package.json` (pino dep, pino-pretty devDep)
- **Commits**: `ef3cab7`, `f325135` (on `dev`).
- **Linear**: DRP-21 - https://linear.app/drp-02/issue/DRP-21/custom-backend-logger-pino-pino-pretty
- **Project guidance**: `CLAUDE.md` (stack, branching, Linear, conventions), `CONTRIBUTING.md` (full branching model), `apps/api/Dockerfile` (sets `NODE_ENV=production`, `SEED_ON_BOOT=if-empty`), `docker-compose.yml` (local Postgres on 5433).
- **External**: Fastify v5 logging - context7 `/llmstxt/fastify_dev_llms_txt` (Migration-Guide-V5, `loggerInstance`); Fastify source `node_modules/fastify/lib/server.js` (`logServerAddress`).
