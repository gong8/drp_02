import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { verifyClerkToken } from "./auth/clerk.js";
import { resolveAuth } from "./auth/resolve.js";
import { upsertUser } from "./db/users.js";

function headerString(v: string | string[] | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function createContext({ req }: CreateFastifyContextOptions) {
  // Server-authoritative identity. A verified Clerk bearer token wins; otherwise, when
  // DEV_AUTH_BYPASS is set, fall back to the spoofable x-user-id stub (default u_dev).
  // userId is nullable here - protectedProcedure does the rejecting.
  const devBypass = process.env.DEV_AUTH_BYPASS === "1" || process.env.DEV_AUTH_BYPASS === "true";

  const { userId, claims } = await resolveAuth(
    {
      authHeader: headerString(req.headers.authorization),
      userIdHeader: headerString(req.headers["x-user-id"]),
      devBypass,
    },
    verifyClerkToken,
  );

  // First-seen real users get a row so groups/RSVPs can reference them.
  if (claims) await upsertUser({ id: claims.sub, name: claims.name, email: claims.email });

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
  const who = ctx.userId ?? "anon";
  const base = { scope: "trpc", path, type, userId: who, ms };
  const tail = `user=${who} ${ms}ms`;

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

// Rejects unauthenticated callers and narrows ctx.userId to a non-null string for the
// procedure body.
const requireAuth = t.middleware(({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { userId: ctx.userId } });
});
export const protectedProcedure = publicProcedure.use(requireAuth);
