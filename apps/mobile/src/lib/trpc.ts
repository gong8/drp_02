import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@drp/api";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({ url: "http://localhost:3000/trpc" }),
  ],
});

// Type-chain proof: `health` is known and typed as () => Promise<{ ok: true }>.
export type HealthResult = Awaited<ReturnType<typeof trpc.health.query>>;
