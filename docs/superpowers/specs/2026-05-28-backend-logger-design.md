# Backend logger - design

Date: 2026-05-28
Status: approved (brainstorm), pending implementation
Scope: `apps/api` only (mobile and shared untouched)

## Goal

Give the backend a single, owned logger that prints clear, readable messages for
everything that happens at runtime: server boot, HTTP requests, every tRPC
procedure call, and (on demand) DB queries. Output is pretty and colorized in
development and structured JSON in production.

## Approach

Use the Pino instance the app already gets via Fastify, but own its
configuration in one module and route all app logs through it. Pretty output in
dev comes from `pino-pretty`; production emits raw JSON lines to stdout. Every
line carries a `scope` tag (`boot` / `http` / `trpc` / `db`) so output is both
human-readable and greppable. tRPC and HTTP lines share Fastify's per-request
`reqId`, so a procedure call can be correlated to its HTTP request.

This was chosen over a hand-rolled zero-dependency logger because Fastify
already runs on Pino; configuring Pino keeps one logging pipeline instead of two
competing formats.

## Components

### 1. `apps/api/src/logger.ts` (new)

- Exports a singleton `logger: pino.Logger`.
- `level` from `process.env.LOG_LEVEL`, default `info`. Set `debug` to surface
  DB queries.
- Dev (`NODE_ENV !== "production"`): `transport` targets `pino-pretty` with
  `colorize: true`, a short time format, `pid`/`hostname` hidden, and the
  `scope` binding rendered inline (e.g. `[trpc]`).
- Prod (`NODE_ENV === "production"`): no transport; default JSON lines to
  stdout. Safe because the Dockerfile sets `NODE_ENV=production`, so the
  pino-pretty worker is never loaded in the container.

### 2. Server lifecycle - `apps/api/src/index.ts`

- Construct Fastify with our instance and disable its default request logging:
  `Fastify({ loggerInstance: logger, disableRequestLogging: true })`.
  (`loggerInstance` is the Fastify v5 option name for passing a prebuilt logger;
  confirm against v5 docs during implementation.)
- Replace the existing `server.log.info(...)` calls with scoped boot messages:
  "migrations applied", "seeded demo data (<mode>)", and a new
  "API listening on http://...:<port>" emitted after a successful `listen`.
- Fatal boot errors are logged at `error` then `process.exit(1)`.

### 3. HTTP requests - `apps/api/src/index.ts`

- `disableRequestLogging: true` removes Fastify's default two-lines-per-request
  output.
- One `onResponse` hook emits a single line per request via `req.log`:
  method, url, status code, elapsed ms. Example: `POST /trpc/events.create 200 19ms`.

### 4. tRPC procedure calls - `apps/api/src/trpc.ts`

- `createContext({ req })` adds `log: req.log` to the context so middleware logs
  inherit the request's `reqId`.
- A logging middleware wraps every procedure by being attached to the base
  `publicProcedure`. It measures duration and logs `path`, `type`
  (query/mutation), `userId`, `ms`, and outcome:
  - success: `info`, message `"<path> ok"`.
  - expected client errors (`TRPCError` such as `FORBIDDEN`, `NOT_FOUND`,
    `BAD_REQUEST`, `UNAUTHORIZED`): `warn`, message `"<path> <code>"`.
  - everything else: `error`, with the error attached.

### 5. DB queries - `apps/api/src/db/client.ts`

- Pass a Drizzle `Logger` implementation to `drizzle(pool, { schema, logger })`
  that emits the SQL text and params at `debug` level under the `db` scope.
  Quiet by default; visible only with `LOG_LEVEL=debug`. Module-level singleton,
  so these lines have no `reqId`.

## Dependencies

- Add `pino` to `apps/api` dependencies (imported directly).
- Add `pino-pretty` to `apps/api` devDependencies (dev-only transport).

## Configuration / env

- `LOG_LEVEL` (default `info`): standard Pino levels; `debug` turns on DB query
  logging.
- `NODE_ENV`: `production` selects JSON output; anything else selects pretty.

## Sample output

Dev (pretty):

```
14:32:01 INFO  [boot] migrations applied
14:32:01 INFO  [boot] API listening on http://localhost:3000
14:32:08 INFO  [http] POST /trpc/events.create 200 19ms
14:32:08 INFO  [trpc] events.create ok       user=u_dev 12ms
14:32:11 WARN  [trpc] groups.get FORBIDDEN    user=u_x 3ms
14:32:15 DEBUG [db]   insert into "events" ...   (LOG_LEVEL=debug)
```

Prod (JSON, one line):

```
{"level":30,"time":...,"scope":"trpc","reqId":"req-1","path":"events.create","type":"mutation","userId":"u_dev","ms":12,"msg":"events.create ok"}
```

## Out of scope

- Mobile client logging (the chosen scope is backend only).
- Shared package changes (logging is server-internal; no type-chain change).
- Adding a test runner to `apps/api`. The deliverable is runtime output with
  little branching logic, so verification is by running the server, not unit
  tests. A test runner can be added later if desired.

## Verification

- `pnpm dev:api`: observe scoped boot, http, and trpc lines as above.
- `LOG_LEVEL=debug pnpm dev:api`: confirm DB query lines appear.
- `NODE_ENV=production`: confirm output switches to JSON lines.
- `pnpm typecheck` and `pnpm lint` pass.
- Log messages use hyphens, never em dashes (repo convention).
