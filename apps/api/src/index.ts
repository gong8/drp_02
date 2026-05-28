import "dotenv/config";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import Fastify from "fastify";
import { db } from "./db/client.js";
import { reseedDemo, seedDemoIfEmpty } from "./db/seed.js";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";

const server = Fastify({ logger: true });

await server.register(cors, { origin: true });
await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

// Apply schema migrations on boot so a fresh (e.g. RDS) database is ready without a
// separate step. The committed Drizzle migrations live next to this file.
await migrate(db, {
  migrationsFolder: join(dirname(fileURLToPath(import.meta.url)), "db/migrations"),
});
server.log.info("migrations applied");

// SEED_ON_BOOT: "reset" (default, local dev) wipes + reseeds a clean demo each boot;
// "if-empty" (live backend) seeds only a fresh DB; "off" skips seeding.
const seedMode = process.env.SEED_ON_BOOT ?? "reset";
if (seedMode === "reset") {
  await reseedDemo();
  server.log.info("seeded demo data (reset)");
} else if (seedMode === "if-empty") {
  await seedDemoIfEmpty();
  server.log.info("seeded demo data (if-empty)");
}

const port = Number(process.env.PORT ?? 3000);

server.listen({ port, host: "0.0.0.0" }).catch((err) => {
  server.log.error(err);
  process.exit(1);
});
