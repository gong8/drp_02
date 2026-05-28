import { readFileSync } from "node:fs";
import type { Logger as DrizzleLogger } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import { logger } from "../logger.js";
import * as schema from "./schema.js";

const connectionString = process.env.DATABASE_URL;

// Local docker-compose Postgres speaks plaintext; RDS (and most managed Postgres) require TLS.
const isLocal = !connectionString || /@(localhost|127\.0\.0\.1)/.test(connectionString);

// Prefer verifying against AWS's RDS CA bundle (DATABASE_CA_PATH, set in the container).
// Only fall back to unverified TLS if no CA is available - acceptable solely because the
// App Runner -> RDS hop is inside a private VPC, never the public internet.
// DATABASE_SSL ("disable" | "require" | "verify") overrides the localhost heuristic.
const caPath = process.env.DATABASE_CA_PATH;
function resolveSsl(): PoolConfig["ssl"] {
  const mode = process.env.DATABASE_SSL;
  if (mode === "disable" || (mode == null && isLocal)) return false;
  if (mode !== "require" && caPath) {
    return { ca: readFileSync(caPath, "utf8"), rejectUnauthorized: true };
  }
  return { rejectUnauthorized: false };
}

const pool = new Pool({ connectionString, ssl: resolveSsl() });

// Emit each SQL statement at debug level. Quiet unless LOG_LEVEL=debug, so it never
// drowns normal output. No reqId here - the pool is a module-level singleton.
const dbLog = logger.child({ scope: "db" });
const queryLogger: DrizzleLogger = {
  logQuery(query, params) {
    dbLog.debug({ params }, query);
  },
};

export const db = drizzle(pool, { schema, logger: queryLogger });
