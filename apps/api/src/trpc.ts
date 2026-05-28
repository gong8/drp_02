import { initTRPC } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

export function createContext({ req }: CreateFastifyContextOptions) {
  // Server-authoritative identity. Dev reads an optional header; default to a single
  // dev user. Real auth replaces this - clients can never spoof who they are here.
  const raw = req.headers["x-user-id"];
  const userId = typeof raw === "string" ? raw : "u_dev";
  // req.log is Fastify's per-request child logger; reusing it ties tRPC log lines to the
  // same reqId as their HTTP request.
  return { userId, log: req.log };
}

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

// TRPCError codes that mean "the client did something we expect to reject" rather than a
// server fault - logged at warn, without a stack.
const EXPECTED_ERRORS = new Set([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "TIMEOUT",
  "TOO_MANY_REQUESTS",
  "PARSE_ERROR",
]);

// Log every procedure: path, type, caller, duration, and outcome. One line each.
const loggingMiddleware = t.middleware(async ({ path, type, ctx, next }) => {
  const start = Date.now();
  const result = await next();
  const ms = Date.now() - start;
  const base = { scope: "trpc", path, type, userId: ctx.userId, ms };
  const tail = `user=${ctx.userId} ${ms}ms`;

  if (result.ok) {
    ctx.log.info(base, `${path} ok  ${tail}`);
  } else {
    const code = result.error.code;
    if (EXPECTED_ERRORS.has(code)) {
      ctx.log.warn({ ...base, code }, `${path} ${code}  ${tail}`);
    } else {
      ctx.log.error({ ...base, code, err: result.error }, `${path} failed (${code})  ${tail}`);
    }
  }
  return result;
});

export const router = t.router;
export const publicProcedure = t.procedure.use(loggingMiddleware);
