import "dotenv/config";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify from "fastify";
import { isAuthorizedReset } from "./admin/reset-auth.js";
import { db } from "./db/client.js";
import { migrationsFolder } from "./db/paths.js";
import { reseedDemo, seedDemoIfEmpty } from "./db/seed.js";
import { logger, scoped } from "./logger.js";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";

// Read a positive integer from an env var, falling back to a default when the var is
// unset, empty, non-numeric, or non-positive. Plain `Number(process.env.X ?? d)` is a
// trap: `??` only substitutes for null/undefined, so an empty-string env var (common in
// container/CI setups that export every key) slips through and `Number("")` is 0, which
// e.g. makes a rate-limit max of 0 reject every request. parseInt of "" is NaN, so we
// guard on Number.isFinite and `> 0`.
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// Our own Pino instance (see logger.ts). disableRequestLogging turns off Fastify's default
// two-lines-per-request output; the onResponse hook below emits one clean line instead.
// trustProxy: App Runner terminates TLS and forwards via X-Forwarded-For, so req.ip must
// resolve to the real client (otherwise every request looks like it comes from the proxy
// and rate limiting buckets them all together).
const server = Fastify({
  loggerInstance: logger,
  disableRequestLogging: true,
  trustProxy: true,
});

server.addHook("onResponse", (req, reply, done) => {
  const ms = Math.round(reply.elapsedTime);
  req.log.info(
    { ...scoped("http"), method: req.method, url: req.url, statusCode: reply.statusCode, ms },
    `${req.method} ${req.url} ${reply.statusCode} ${ms}ms`,
  );
  done();
});

// Global rate limit, keyed on the (proxy-resolved) client IP. The API is deliberately
// open (DEV_AUTH_BYPASS, open CORS), so this is the main guard against a single client
// hammering the live App Runner service and burning compute. Tune via env without a
// code change. tRPC batches many procedure calls into one HTTP request, so 100/min is
// generous for real use but stops scripted abuse.
await server.register(rateLimit, {
  global: true,
  max: envInt("RATE_LIMIT_MAX", 100),
  // Same empty-string trap as envInt, but the window is a string ("1 minute"), so treat an
  // empty/whitespace-only value as absent and fall back to the default.
  timeWindow: process.env.RATE_LIMIT_WINDOW?.trim() ? process.env.RATE_LIMIT_WINDOW : "1 minute",
  // App Runner's health check (GET /trpc/health) must never be throttled. Exact-path
  // match only: a batched tRPC call has a different path (e.g. /trpc/health,groups.mine),
  // so this exemption cannot be abused to bypass the limit.
  allowList: (req) => req.url.split("?")[0] === "/trpc/health",
});

await server.register(cors, { origin: true });
await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

// Ops-only: wipe + reinstall the demo seed without a redeploy. Disabled (403) unless
// ADMIN_RESET_TOKEN is set; the secret is checked in constant time. Destructive, so it logs loudly.
// Deliberately a raw route, NOT a tRPC procedure, so it stays out of the mobile client's typed surface.
server.post("/admin/reseed", async (req, reply) => {
  const header = req.headers["x-admin-token"];
  const provided = typeof header === "string" ? header : undefined;
  if (!isAuthorizedReset(provided, process.env.ADMIN_RESET_TOKEN)) {
    return reply.code(403).send({ error: "forbidden" });
  }
  req.log.warn(scoped("admin"), "admin reseed invoked");
  await reseedDemo();
  req.log.warn(scoped("admin"), "admin reseed completed");
  return { ok: true as const };
});

// DANGER, one-shot escape hatch: DB_RESET_ON_BOOT=true drops and recreates the public
// schema before migrating. Needed only when the migration baseline is reset (regenerated
// 0000), which otherwise makes migrate-on-boot fail with "type ... already exists" against
// the old schema and silently roll the deploy back. Default off. Set it for ONE deploy,
// confirm the deploy succeeded, then set it back to false. See docs/runbook-deploy.md.
if (process.env.DB_RESET_ON_BOOT === "true") {
  server.log.warn(
    scoped("boot"),
    "DB_RESET_ON_BOOT=true: dropping and recreating the public schema (DESTRUCTIVE)",
  );
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`GRANT ALL ON SCHEMA public TO CURRENT_USER`);
  await db.execute(sql`GRANT ALL ON SCHEMA public TO public`);
  // Drizzle keeps its migration journal in a separate "drizzle" schema; drop it too, or
  // migrate() below sees the baseline as already applied and never rebuilds the tables.
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  server.log.warn(scoped("boot"), "public + drizzle schemas reset; migrations will rebuild");
}

// Apply schema migrations on boot so a fresh (e.g. RDS) database is ready without a
// separate step. The committed Drizzle migrations live next to this file.
await migrate(db, { migrationsFolder });
server.log.info(scoped("boot"), "migrations applied");

// SEED_ON_BOOT: "reset" (default, local dev) wipes + reseeds a clean demo each boot;
// "if-empty" (live backend) seeds only a fresh DB; "off" skips seeding.
const seedMode = process.env.SEED_ON_BOOT ?? "reset";
if (seedMode === "reset") {
  await reseedDemo();
  server.log.info(scoped("boot"), "seeded demo data (reset)");
} else if (seedMode === "if-empty") {
  await seedDemoIfEmpty();
  server.log.info(scoped("boot"), "seeded demo data (if-empty)");
}

const port = envInt("PORT", 3000);

// Fastify logs its own "Server listening at <addr>" line at info level (one per bound
// address, with no scope). Mute info briefly around listen so only our single scoped line
// shows; errors (>= warn) still surface if the bind fails.
const restoreLevel = server.log.level;
server.log.level = "warn";
try {
  await server.listen({ port, host: "0.0.0.0" });
  server.log.level = restoreLevel;
  server.log.info({ ...scoped("boot"), port }, `API listening on http://localhost:${port}`);
} catch (err) {
  server.log.level = restoreLevel;
  server.log.error({ ...scoped("boot"), err }, "failed to start");
  process.exit(1);
}
