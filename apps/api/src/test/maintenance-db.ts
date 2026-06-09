// Shared maintenance-DB primitives: connect to the `drp` maintenance server and run the
// terminate-then-drop sweep. Used by the harness (drops its own per-process DB) and by clean.ts
// (sweeps every leftover `bethere_test_*`), so the destructive DROP routine lives in exactly one
// place. Connects via maintenanceUrl from pg-config (single source of the connection coordinates).

import { Client } from "pg";
import { maintenanceUrl } from "./pg-config.js";

// Open a maintenance client, run `fn`, and always end the connection.
export async function withMaintenanceClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: maintenanceUrl, ssl: false });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Terminate any open backends on `name`, then drop the database. Safe to call when it does not
// exist (IF EXISTS). The terminate step unblocks the DROP when test pools are still attached.
export async function dropDatabase(client: Client, name: string): Promise<void> {
  await client.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [name],
  );
  await client.query(`DROP DATABASE IF EXISTS "${name}"`);
}
