import type { AppRouter } from "@bethere/api";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

// EXPO_PUBLIC_* vars are inlined by Metro at build time. Set EXPO_PUBLIC_API_URL to the
// deployed backend (e.g. the App Runner https URL); falls back to the local dev server.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export const trpc = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: `${API_URL}/trpc` })],
});

// Type-chain proof: `health` is known and typed as () => Promise<{ ok: true }>.
export type HealthResult = Awaited<ReturnType<typeof trpc.health.query>>;
