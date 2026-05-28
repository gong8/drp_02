import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify from "fastify";
import { db } from "./db/client.js";
import { reseedDemo, seedDemoIfEmpty } from "./db/seed.js";
import { logger } from "./logger.js";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";

// Our own Pino instance (see logger.ts). disableRequestLogging turns off Fastify's default
// two-lines-per-request output; the onResponse hook below emits one clean line instead.
const server = Fastify({ loggerInstance: logger, disableRequestLogging: true });

server.addHook("onResponse", (req, reply, done) => {
  const ms = Math.round(reply.elapsedTime);
  req.log.info(
    { scope: "http", method: req.method, url: req.url, statusCode: reply.statusCode, ms },
    `${req.method} ${req.url} ${reply.statusCode} ${ms}ms`,
  );
  done();
});

await server.register(cors, { origin: true });
await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

// DANGER, one-shot escape hatch: DB_RESET_ON_BOOT=true drops and recreates the public
// schema before migrating. Needed only when the migration baseline is reset (regenerated
// 0000), which otherwise makes migrate-on-boot fail with "type ... already exists" against
// the old schema and silently roll the deploy back. Default off. Set it for ONE deploy,
// confirm the deploy succeeded, then set it back to false. See docs/runbook-deploy.md.
if (process.env.DB_RESET_ON_BOOT === "true") {
  server.log.warn(
    { scope: "boot" },
    "DB_RESET_ON_BOOT=true: dropping and recreating the public schema (DESTRUCTIVE)",
  );
  await db.execute(sql`DROP SCHEMA public CASCADE`);
  await db.execute(sql`CREATE SCHEMA public`);
  await db.execute(sql`GRANT ALL ON SCHEMA public TO CURRENT_USER`);
  await db.execute(sql`GRANT ALL ON SCHEMA public TO public`);
  // Drizzle keeps its migration journal in a separate "drizzle" schema; drop it too, or
  // migrate() below sees the baseline as already applied and never rebuilds the tables.
  await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
  server.log.warn({ scope: "boot" }, "public + drizzle schemas reset; migrations will rebuild");
}

// Apply schema migrations on boot so a fresh (e.g. RDS) database is ready without a
// separate step. The committed Drizzle migrations live next to this file.
await migrate(db, {
  migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "db/migrations"),
});
server.log.info({ scope: "boot" }, "migrations applied");

// SEED_ON_BOOT: "reset" (default, local dev) wipes + reseeds a clean demo each boot;
// "if-empty" (live backend) seeds only a fresh DB; "off" skips seeding.
const seedMode = process.env.SEED_ON_BOOT ?? "reset";
if (seedMode === "reset") {
  await reseedDemo();
  server.log.info({ scope: "boot" }, "seeded demo data (reset)");
} else if (seedMode === "if-empty") {
  await seedDemoIfEmpty();
  server.log.info({ scope: "boot" }, "seeded demo data (if-empty)");
}

const port = Number(process.env.PORT ?? 3000);

// Fastify logs its own "Server listening at <addr>" line at info level (one per bound
// address, with no scope). Mute info briefly around listen so only our single scoped line
// shows; errors (>= warn) still surface if the bind fails.
const restoreLevel = server.log.level;
server.log.level = "warn";
try {
  await server.listen({ port, host: "0.0.0.0" });
  server.log.level = restoreLevel;
  server.log.info({ scope: "boot", port }, `API listening on http://localhost:${port}`);
} catch (err) {
  server.log.level = restoreLevel;
  server.log.error({ scope: "boot", err }, "failed to start");
  process.exit(1);
}
