import { initTRPC } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";

export function createContext({ req }: CreateFastifyContextOptions) {
  // Server-authoritative identity. Dev reads an optional header; default to a single
  // dev user. Real auth replaces this — clients can never spoof who they are here.
  const raw = req.headers["x-user-id"];
  const userId = typeof raw === "string" ? raw : "u_dev";
  return { userId };
}

type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
