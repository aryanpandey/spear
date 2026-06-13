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
import { GOAL_STATUSES, type GoalStatus } from "../types.js";
import { boardDto, todayDto } from "./dto.js";
import { goalsPageDto, scorecardDto } from "./goalsDto.js";
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

  // ---- goals API (weekly goals tab; independent of the planner) ----
  const goalsChanged = () => hub.broadcast({ type: "update", source: "goals" });
  const num = (v: unknown): number | undefined => {
    if (v == null || v === "") return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };

  app.get("/api/goals", async () => goalsPageDto(store));

  app.post("/api/goals", async (req, reply) => {
    const body = (req.body ?? {}) as { title?: string; notes?: string };
    if (!body.title || typeof body.title !== "string" || !body.title.trim()) {
      reply.code(400);
      return { error: "title required" };
    }
    const goal = store.createGoal({ title: body.title.trim(), notes: body.notes });
    goalsChanged();
    return { goal };
  });

  app.patch<{ Params: { id: string } }>("/api/goals/:id", async (req, reply) => {
    const body = (req.body ?? {}) as { title?: string; notes?: string; status?: string };
    const patch: { title?: string; notes?: string; status?: GoalStatus } = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (typeof body.notes === "string") patch.notes = body.notes;
    if (body.status != null) {
      if (!GOAL_STATUSES.includes(body.status as GoalStatus)) {
        reply.code(400);
        return { error: "invalid status" };
      }
      patch.status = body.status as GoalStatus;
    }
    const goal = store.updateGoal(Number(req.params.id), patch);
    if (!goal) {
      reply.code(404);
      return { error: "not found" };
    }
    goalsChanged();
    return { goal };
  });

  app.post<{ Params: { id: string } }>("/api/goals/:id/toggle", async (req, reply) => {
    const current = store.getGoal(Number(req.params.id));
    if (!current) {
      reply.code(404);
      return { error: "not found" };
    }
    const goal = store.updateGoal(current.id, { status: current.status === "done" ? "active" : "done" });
    goalsChanged();
    return { goal };
  });

  app.delete<{ Params: { id: string } }>("/api/goals/:id", async (req) => {
    store.deleteGoal(Number(req.params.id));
    goalsChanged();
    return { ok: true };
  });

  // ---- scorecards ----
  app.post("/api/scorecards", async (req) => {
    const body = (req.body ?? {}) as { title?: string; week_of?: string; bonus_reward?: string };
    const card = store.createScorecard({
      title: body.title?.trim() || "Weekly Focus",
      week_of: body.week_of ?? null,
      bonus_reward: body.bonus_reward ?? "",
      is_current: true,
    });
    goalsChanged();
    return { scorecard: scorecardDto(store, card.id) };
  });

  app.get<{ Params: { id: string } }>("/api/scorecards/:id", async (req, reply) => {
    const dto = scorecardDto(store, Number(req.params.id));
    if (!dto) {
      reply.code(404);
      return { error: "not found" };
    }
    return dto;
  });

  app.patch<{ Params: { id: string } }>("/api/scorecards/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!store.getScorecard(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    const body = (req.body ?? {}) as {
      title?: string;
      week_of?: string | null;
      bonus_reward?: string;
      current?: boolean;
    };
    const patch: { title?: string; week_of?: string | null; bonus_reward?: string } = {};
    if (typeof body.title === "string") patch.title = body.title;
    if (body.week_of !== undefined) patch.week_of = body.week_of;
    if (typeof body.bonus_reward === "string") patch.bonus_reward = body.bonus_reward;
    if (Object.keys(patch).length) store.updateScorecard(id, patch);
    if (body.current) store.setCurrentScorecard(id);
    goalsChanged();
    return { scorecard: scorecardDto(store, id) };
  });

  app.delete<{ Params: { id: string } }>("/api/scorecards/:id", async (req) => {
    store.deleteScorecard(Number(req.params.id));
    goalsChanged();
    return { ok: true };
  });

  // ---- scorecard metrics ----
  app.post<{ Params: { id: string } }>("/api/scorecards/:id/metrics", async (req, reply) => {
    const scorecardId = Number(req.params.id);
    if (!store.getScorecard(scorecardId)) {
      reply.code(404);
      return { error: "scorecard not found" };
    }
    const body = (req.body ?? {}) as { name?: string; progress?: number; goal?: number; weight?: number };
    const metric = store.addMetric({
      scorecard_id: scorecardId,
      name: (body.name ?? "New row").trim() || "New row",
      progress: num(body.progress) ?? 0,
      goal: num(body.goal) ?? 0,
      weight: num(body.weight) ?? 0,
    });
    goalsChanged();
    return { metric };
  });

  app.patch<{ Params: { id: string } }>("/api/metrics/:id", async (req, reply) => {
    const body = (req.body ?? {}) as { name?: string; progress?: number; goal?: number; weight?: number };
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string") patch.name = body.name;
    if (num(body.progress) !== undefined) patch.progress = num(body.progress);
    if (num(body.goal) !== undefined) patch.goal = num(body.goal);
    if (num(body.weight) !== undefined) patch.weight = num(body.weight);
    const metric = store.updateMetric(Number(req.params.id), patch);
    if (!metric) {
      reply.code(404);
      return { error: "not found" };
    }
    goalsChanged();
    return { metric };
  });

  app.delete<{ Params: { id: string } }>("/api/metrics/:id", async (req) => {
    store.deleteMetric(Number(req.params.id));
    goalsChanged();
    return { ok: true };
  });

  // ---- scorecard bonus tasks ----
  app.post<{ Params: { id: string } }>("/api/scorecards/:id/bonuses", async (req, reply) => {
    const scorecardId = Number(req.params.id);
    if (!store.getScorecard(scorecardId)) {
      reply.code(404);
      return { error: "scorecard not found" };
    }
    const body = (req.body ?? {}) as { task?: string; reward?: string };
    const bonus = store.addBonus({
      scorecard_id: scorecardId,
      task: (body.task ?? "New bonus").trim() || "New bonus",
      reward: body.reward ?? "",
    });
    goalsChanged();
    return { bonus };
  });

  app.patch<{ Params: { id: string } }>("/api/bonuses/:id", async (req, reply) => {
    const body = (req.body ?? {}) as { task?: string; reward?: string; done?: boolean };
    const patch: Record<string, unknown> = {};
    if (typeof body.task === "string") patch.task = body.task;
    if (typeof body.reward === "string") patch.reward = body.reward;
    if (typeof body.done === "boolean") patch.done = body.done;
    const bonus = store.updateBonus(Number(req.params.id), patch);
    if (!bonus) {
      reply.code(404);
      return { error: "not found" };
    }
    goalsChanged();
    return { bonus };
  });

  app.delete<{ Params: { id: string } }>("/api/bonuses/:id", async (req) => {
    store.deleteBonus(Number(req.params.id));
    goalsChanged();
    return { ok: true };
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
