import type { AppRouter } from "@bethere/api";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { buildAuthHeaders, holder } from "./auth";

// Canonical client-side aliases for tRPC procedure inputs/outputs. Use these instead of
// re-deriving rows with Awaited<ReturnType<typeof trpc.X.query>>; types follow the router.
export type RouterOutputs = inferRouterOutputs<AppRouter>;
export type RouterInputs = inferRouterInputs<AppRouter>;

// EXPO_PUBLIC_* vars are inlined by Metro at build time. Set EXPO_PUBLIC_API_URL to the
// deployed backend; falls back to the local dev server.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

export const trpc = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${API_URL}/trpc`,
      headers: () => buildAuthHeaders(holder),
    }),
  ],
});
