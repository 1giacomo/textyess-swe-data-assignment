import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { registerRoutes } from "./routes.js";
import { pool } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3003);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

await registerRoutes(app);

// In prod, dist/server/index.js sits beside dist/client/. In dev (tsx watch),
// dist/client may not exist yet — Vite serves the page on :5173 instead.
const clientDist = resolve(here, "../client");
if (existsSync(clientDist)) {
  await app.register(fastifyStatic, { root: clientDist, prefix: "/" });
}

const close = async () => {
  app.log.info("shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`dashboard listening on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
