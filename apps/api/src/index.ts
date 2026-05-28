import "dotenv/config";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import Fastify from "fastify";
import { reseedDemo } from "./db/seed.js";
import { appRouter } from "./router.js";
import { createContext } from "./trpc.js";

const server = Fastify({ logger: true });

await server.register(cors, { origin: true });
await server.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

await reseedDemo(); // fresh, replayable demo moment on every boot
server.log.info("seeded demo moment");

const port = Number(process.env.PORT ?? 3000);

server.listen({ port, host: "0.0.0.0" }).catch((err) => {
  server.log.error(err);
  process.exit(1);
});
