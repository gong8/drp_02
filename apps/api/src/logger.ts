import pino from "pino";

// One Pino instance for the whole API.
//
// - Dev (NODE_ENV != production): pretty, colorized, one line per event via pino-pretty.
// - Prod (NODE_ENV = production, set by the Dockerfile): raw JSON lines to stdout, ready
//   for CloudWatch. The pino-pretty worker is never loaded there.
//
// Every app log carries a `scope` (see LogScope below) so output reads cleanly and stays
// greppable. LOG_LEVEL (default "info") tunes verbosity; set it to "debug" to see DB query
// lines.
const isProd = process.env.NODE_ENV === "production";

// The closed set of log scopes. This union is the source of truth: every call site builds
// its `scope` through `scoped()`, so adding or misspelling a scope is a compile error.
export type LogScope = "boot" | "http" | "trpc" | "db" | "auth" | "admin";

// One typed funnel for the `scope` field. Use it (spread for extra fields) at every log site.
export const scoped = (scope: LogScope) => ({ scope });

// Facts are baked into each message string, so in dev we hide their structured twins to
// keep lines tidy. `err` is deliberately kept so error stacks still pretty-print.
// `reqId` is the only entry below not produced by app code (pino/Fastify-injected); append
// this list when a new structured log key is added.
const FOLDED_FIELDS =
  "pid,hostname,reqId,scope,path,type,userId,ms,code,method,url,statusCode,params,port";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            messageFormat: "{if scope}[{scope}] {end}{msg}",
            ignore: FOLDED_FIELDS,
          },
        },
      }),
});
