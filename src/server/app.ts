import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import { addTask, advanceTask, completeTask, setTaskStatus } from "../service.js";
import { breakdownForAdd } from "../breakdown/index.js";
import { PRIORITIES, TASK_STATUSES, TASK_TYPES, type Priority, type TaskStatus, type TaskType } from "../types.js";
import { boardDto, todayDto } from "./dto.js";
import { buildTimeOpts } from "../planner/timefit.js";
import { createSseHub } from "./sse.js";
import { Replanner } from "./replan.js";

export function webDir(): string {
  if (process.env.SPEAR_WEB_DIR) return process.env.SPEAR_WEB_DIR;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
}

export interface SpearServer {
  app: FastifyInstance;
  replanner: Replanner;
  close(): Promise<void>;
}

export function buildServer(store: Store, cfg: SpearConfig): SpearServer {
  const app = Fastify({ logger: false });
  const hub = createSseHub();
  const replanner = new Replanner(store, hub, cfg);

  // ---- read API ----
  app.get("/api/board", async () => boardDto(store));
  app.get<{ Querystring: { hours?: string } }>("/api/today", async (req) => {
    const hours = req.query.hours != null ? Number(req.query.hours) : undefined;
    return todayDto(store, buildTimeOpts(cfg.effortMinutes, cfg.workdayEnd, hours));
  });
  app.get("/api/executors", async () => store.listExecutors());

  // ---- live updates (SSE) ----
  app.get("/events", (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.write("retry: 3000\n\n");
    hub.add(reply.raw);
    req.raw.on("close", () => hub.remove(reply.raw));
  });

  // ---- replan handoff (called by the CLI after a mutation) ----
  app.post("/internal/replan", async () => {
    replanner.requestReplan("adhoc");
    return { ok: true };
  });

  // ---- refresh-only broadcast (plan already persisted; don't re-plan) ----
  app.post("/internal/refresh", async () => {
    hub.broadcast({ type: "update", source: "refresh" });
    return { ok: true };
  });

  // ---- write API (so the dashboard can mutate too) ----
  app.post("/api/tasks", async (req, reply) => {
    const body = (req.body ?? {}) as {
      title?: string;
      description?: string;
      priority?: string;
      type?: string;
      due?: string;
      blockedBy?: number[];
      useLlm?: boolean;
    };
    if (!body.title || typeof body.title !== "string") {
      reply.code(400);
      return { error: "title required" };
    }
    const explicitPriority = body.priority ? (body.priority as Priority) : undefined;
    if (explicitPriority && !PRIORITIES.includes(explicitPriority)) {
      reply.code(400);
      return { error: "invalid priority" };
    }
    const forcedType = body.type ? (body.type as TaskType) : undefined;
    if (forcedType && !TASK_TYPES.includes(forcedType)) {
      reply.code(400);
      return { error: "invalid type" };
    }
    const broken = await breakdownForAdd({
      title: body.title,
      description: body.description,
      forcedType,
      useLlm: body.useLlm !== false,
      model: cfg.models.breakdown,
      effort: cfg.effort.breakdown,
      due: body.due ?? null,
      explicitPriority,
    });
    const { task } = addTask(store, {
      title: broken.title,
      description: body.description,
      type: broken.type,
      priority: broken.priority,
      due: body.due ?? null,
      blockedBy: body.blockedBy ?? [],
      stages: broken.stages,
      source: "web",
    });
    replanner.requestReplan("adhoc");
    return { task };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/advance", async (req) => {
    const { task, completed } = advanceTask(store, Number(req.params.id));
    replanner.requestReplan("adhoc");
    return { task, completed };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/done", async (req) => {
    const task = completeTask(store, Number(req.params.id));
    replanner.requestReplan("adhoc");
    return { task };
  });

  app.post<{ Params: { id: string }; Body: { status?: string } }>("/api/tasks/:id/status", async (req, reply) => {
    const status = req.body?.status as TaskStatus;
    if (!TASK_STATUSES.includes(status)) {
      reply.code(400);
      return { error: "invalid status" };
    }
    const task = setTaskStatus(store, Number(req.params.id), status);
    replanner.requestReplan("adhoc");
    return { task };
  });

  // ---- static SPA ----
  const dir = webDir();
  const hasBuild = fs.existsSync(path.join(dir, "index.html"));
  if (hasBuild) {
    app.register(fastifyStatic, { root: dir, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api") || req.url.startsWith("/events")) {
        reply.code(404).send({ error: "not found" });
      } else {
        reply.type("text/html").sendFile("index.html");
      }
    });
  } else {
    app.get("/", async (_req, reply) => {
      reply
        .type("text/html")
        .send(
          `<pre style="background:#0a0e0a;color:#00ff41;padding:24px;font-family:monospace">spear: web UI not built.\nRun: npm run build:web\n(API is live at /api/board and /api/today)</pre>`,
        );
    });
  }

  return {
    app,
    replanner,
    async close() {
      replanner.dispose();
      hub.close();
      await app.close();
    },
  };
}

export async function startServer(store: Store, cfg: SpearConfig, port: number): Promise<SpearServer> {
  const server = buildServer(store, cfg);
  await server.app.listen({ port, host: "127.0.0.1" });
  return server;
}
