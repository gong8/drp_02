import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Single anchor for the committed Drizzle migrations directory. It sits next to this
// file (db/migrations is a sibling of db/paths.ts), so the path is computed relative to
// this fixed module location and never breaks when a caller (index.ts, the test harness)
// moves to a different depth.
export const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "migrations");
