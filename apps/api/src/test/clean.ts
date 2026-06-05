// Drop every leftover per-process test database (`bethere_test_*`). The harness drops its own DB
// in an `after` hook, but crashed/killed runs leak them; run `pnpm --filter @bethere/api db:test:clean`
// to sweep. Connects to the maintenance DB (`drp`), so it never touches the dev data itself.
//
// Launched WITHOUT preloading env.ts, so it relies on pg-config for the connection coordinates.

import { dropDatabase, withMaintenanceClient } from "./maintenance-db.js";
import { TEST_DB_PREFIX } from "./pg-config.js";

await withMaintenanceClient(async (client) => {
  const { rows } = await client.query<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE datname LIKE '${TEST_DB_PREFIX}%'`,
  );
  for (const { datname } of rows) {
    await dropDatabase(client, datname);
    console.log(`dropped ${datname}`);
  }
  console.log(`done: ${rows.length} test database(s) removed`);
});
