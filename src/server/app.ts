import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Store } from "../db/store.js";
import type { SpearConfig } from "../config/index.js";
import { saveConfig } from "../config/index.js";
import { intakeTasks, extractSeedsForIntake, createTasksFromSeeds, mimeExt, type IntakeParams } from "./intake.js";
import { checkSeedsForDuplicates } from "./duplicateCheck.js";
import type { TaskSeed } from "../llm/intake.js";
import { coerceTheme, THEMES } from "../util/theme.js";
import { addTask, advanceTask, completeTask, removeTask, setTaskDue, setTaskPriority, setTaskStatus, setTaskTitle, setTaskDescription } from "../service.js";
import { attachmentsDir } from "../paths.js";
import { breakdownForAdd } from "../breakdown/index.js";
import { PRIORITIES, TASK_STATUSES, TASK_TYPES, type Priority, type TaskStatus, type TaskType } from "../types.js";
import { GOAL_STATUSES, type GoalStatus } from "../types.js";
import { boardDto, todayDto, taskDetailDto } from "./dto.js";
import { goalsPageDto, scorecardDto } from "./goalsDto.js";
import { desktopManifest, releaseDir } from "./desktop.js";
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
  // 32 MB body limit so a pasted screenshot (base64-encoded in the JSON body)
  // isn't rejected with 413; Fastify defaults to only 1 MB.
  const app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024 });
  const hub = createSseHub();
  const replanner = new Replanner(store, hub, cfg);

  // ---- read API ----
  app.get("/api/board", async () => boardDto(store));
  app.get("/api/today", async () => todayDto(store));
  app.get("/api/executors", async () => store.listExecutors());

  // ---- desktop app downloads ----
  app.get("/api/desktop/manifest", async () => await desktopManifest());
  app.get<{ Params: { file: string } }>("/download/:file", async (req, reply) => {
    const name = path.basename(req.params.file); // prevent path traversal
    const full = path.join(releaseDir(), name);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      reply.code(404);
      return { error: "not found" };
    }
    reply.header("Content-Disposition", `attachment; filename="${name}"`);
    reply.type("application/octet-stream");
    return reply.send(fs.createReadStream(full));
  });

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
    let broken;
    try {
      broken = await breakdownForAdd({
        title: body.title,
        description: body.description,
        forcedType,
        model: cfg.models.breakdown,
        effort: cfg.effort.breakdown,
        due: body.due ?? null,
        explicitPriority,
      });
    } catch (err) {
      reply.code(502);
      return { error: `breakdown failed: ${err instanceof Error ? err.message : String(err)}` };
    }
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

  // ---- multimodal / multi-task intake (image + text → 1..N tasks) ----
  app.post("/api/tasks/intake", async (req, reply) => {
    const body = (req.body ?? {}) as {
      prompt?: string;
      intent?: string;
      priority?: string;
      image?: { mime?: string; dataB64?: string };
    };
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const hasImage = !!body.image?.dataB64;
    if (!prompt && !hasImage) {
      reply.code(400);
      return { error: "prompt or image required" };
    }
    const explicitPriority = body.priority ? (body.priority as Priority) : undefined;
    if (explicitPriority && !PRIORITIES.includes(explicitPriority)) {
      reply.code(400);
      return { error: "invalid priority" };
    }
    const intent = body.intent === "task" || body.intent === "feature" ? body.intent : undefined;

    let imagePath: string | undefined;
    if (hasImage) {
      imagePath = path.join(os.tmpdir(), `spear-intake-${randomUUID()}.${mimeExt(body.image!.mime)}`);
      fs.writeFileSync(imagePath, Buffer.from(body.image!.dataB64!, "base64"));
    }
    try {
      const { taskIds } = await intakeTasks(store, cfg, { prompt, imagePath, intent, priority: explicitPriority });
      if (taskIds.length === 0) {
        reply.code(502);
        return { error: "no tasks could be created" };
      }
      replanner.requestReplan("adhoc");
      return { count: taskIds.length, taskIds };
    } catch (err) {
      reply.code(502);
      return { error: `intake failed: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (imagePath) {
        try {
          fs.unlinkSync(imagePath);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  });

  // ---- intake step 1: extract seeds + check for duplicates (no creation) ----
  app.post("/api/tasks/intake/check", async (req, reply) => {
    const body = (req.body ?? {}) as { prompt?: string; image?: { mime?: string; dataB64?: string } };
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    const hasImage = !!body.image?.dataB64;
    if (!prompt && !hasImage) {
      reply.code(400);
      return { error: "prompt or image required" };
    }
    let imagePath: string | undefined;
    if (hasImage) {
      imagePath = path.join(os.tmpdir(), `spear-intake-${randomUUID()}.${mimeExt(body.image!.mime)}`);
      fs.writeFileSync(imagePath, Buffer.from(body.image!.dataB64!, "base64"));
    }
    try {
      const params: IntakeParams = { prompt, imagePath };
      const seeds = await extractSeedsForIntake(cfg, params);
      const duplicates = await checkSeedsForDuplicates(store, cfg, seeds);
      return { seeds, duplicates };
    } catch (err) {
      reply.code(502);
      return { error: `intake check failed: ${err instanceof Error ? err.message : String(err)}` };
    } finally {
      if (imagePath) {
        try {
          fs.unlinkSync(imagePath);
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  });

  // ---- intake step 2: create tasks from already-extracted seeds ----
  app.post("/api/tasks/intake/create", async (req, reply) => {
    const body = (req.body ?? {}) as { seeds?: TaskSeed[]; intent?: string; priority?: string };
    const seeds = Array.isArray(body.seeds)
      ? body.seeds
          .filter((s) => s && typeof s.title === "string")
          .map((s) => ({ title: s.title, details: typeof s.details === "string" ? s.details : "" }))
      : [];
    if (seeds.length === 0) {
      reply.code(400);
      return { error: "seeds required" };
    }
    const explicitPriority = body.priority ? (body.priority as Priority) : undefined;
    if (explicitPriority && !PRIORITIES.includes(explicitPriority)) {
      reply.code(400);
      return { error: "invalid priority" };
    }
    const intent = body.intent === "task" || body.intent === "feature" ? body.intent : undefined;
    try {
      const { taskIds } = await createTasksFromSeeds(store, cfg, seeds, { intent, priority: explicitPriority });
      if (taskIds.length === 0) {
        reply.code(502);
        return { error: "no tasks could be created" };
      }
      replanner.requestReplan("adhoc");
      return { count: taskIds.length, taskIds };
    } catch (err) {
      reply.code(502);
      return { error: `intake create failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  });

  // ---- config (lane count + theme) ----
  app.get("/api/config", async () => ({ maxLanes: cfg.maxLanes, theme: cfg.theme }));

  app.post("/api/config/theme", async (req, reply) => {
    const body = (req.body ?? {}) as { theme?: string };
    if (!THEMES.includes(body.theme as never)) {
      reply.code(400);
      return { error: "invalid theme" };
    }
    cfg.theme = coerceTheme(body.theme);
    saveConfig(cfg);
    return { theme: cfg.theme };
  });

  app.post("/api/config/lanes", async (req, reply) => {
    const body = (req.body ?? {}) as { lanes?: number };
    const n = Number(body.lanes);
    if (!Number.isInteger(n) || n < 1 || n > 8) {
      reply.code(400);
      return { error: "lanes must be an integer 1–8" };
    }
    cfg.maxLanes = n; // mutate the object the Replanner holds, so the next plan uses it
    saveConfig(cfg); // persist for next boot
    replanner.requestReplanThenRedate(); // reorder into the new lane count, then re-date
    return { maxLanes: n };
  });

  // ---- re-decide completion dates on the current lanes (no re-plan) ----
  app.post("/api/plan/replan-dates", async () => {
    replanner.requestRedate();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/advance", async (req) => {
    const { task, completed } = advanceTask(store, Number(req.params.id));
    hub.broadcast({ type: "update", source: "refresh" }); // progress only — no re-plan
    return { task, completed };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/done", async (req) => {
    const task = completeTask(store, Number(req.params.id));
    hub.broadcast({ type: "update", source: "refresh" }); // marking done — no re-plan
    return { task };
  });

  app.post<{ Params: { id: string }; Body: { status?: string } }>("/api/tasks/:id/status", async (req, reply) => {
    const status = req.body?.status as TaskStatus;
    if (!TASK_STATUSES.includes(status)) {
      reply.code(400);
      return { error: "invalid status" };
    }
    const task = setTaskStatus(store, Number(req.params.id), status);
    hub.broadcast({ type: "update", source: "refresh" }); // status change — no re-plan
    return { task };
  });

  app.post<{ Params: { id: string }; Body: { priority?: string } }>("/api/tasks/:id/priority", async (req, reply) => {
    const id = Number(req.params.id);
    if (!store.getTask(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    const priority = req.body?.priority as Priority;
    if (!PRIORITIES.includes(priority)) {
      reply.code(400);
      return { error: "invalid priority" };
    }
    const task = setTaskPriority(store, id, priority);
    hub.broadcast({ type: "update", source: "refresh" }); // priority change — no re-plan
    return { task };
  });

  app.post<{ Params: { id: string }; Body: { title?: string } }>("/api/tasks/:id/title", async (req, reply) => {
    const id = Number(req.params.id);
    if (!store.getTask(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    const title = typeof req.body?.title === "string" ? req.body.title : "";
    if (!title.trim()) {
      reply.code(400);
      return { error: "title required" };
    }
    const task = setTaskTitle(store, id, title);
    hub.broadcast({ type: "update", source: "refresh" }); // rename — no re-plan
    return { task };
  });

  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (req, reply) => {
    const dto = taskDetailDto(store, Number(req.params.id));
    if (!dto) {
      reply.code(404);
      return { error: "not found" };
    }
    return dto;
  });

  app.post<{ Params: { id: string }; Body: { description?: string } }>("/api/tasks/:id/description", async (req, reply) => {
    const id = Number(req.params.id);
    if (!store.getTask(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    const task = setTaskDescription(store, id, typeof req.body?.description === "string" ? req.body.description : "");
    hub.broadcast({ type: "update", source: "refresh" }); // notes — no re-plan
    return { task };
  });

  // ---- attachments ----
  app.post<{ Params: { id: string }; Body: { image?: { mime?: string; dataB64?: string }; name?: string } }>(
    "/api/tasks/:id/attachments",
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!store.getTask(id)) {
        reply.code(404);
        return { error: "not found" };
      }
      const img = req.body?.image;
      if (!img?.dataB64) {
        reply.code(400);
        return { error: "image required" };
      }
      const dir = attachmentsDir();
      fs.mkdirSync(dir, { recursive: true });
      const filename = `${randomUUID()}.${mimeExt(img.mime)}`;
      fs.writeFileSync(path.join(dir, filename), Buffer.from(img.dataB64, "base64"));
      const attachment = store.addAttachment({
        task_id: id,
        filename,
        original_name: typeof req.body?.name === "string" ? req.body.name : null,
        mime: img.mime ?? "image/png",
      });
      hub.broadcast({ type: "update", source: "refresh" });
      return { attachment };
    },
  );

  const ATTACH_MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  app.get<{ Params: { filename: string } }>("/api/attachments/:filename", async (req, reply) => {
    const name = path.basename(req.params.filename); // prevent traversal
    const full = path.join(attachmentsDir(), name);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      reply.code(404);
      return { error: "not found" };
    }
    reply.type(ATTACH_MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream");
    return reply.send(fs.createReadStream(full));
  });

  app.delete<{ Params: { id: string } }>("/api/attachments/:id", async (req, reply) => {
    const att = store.getAttachment(Number(req.params.id));
    if (!att) {
      reply.code(404);
      return { error: "not found" };
    }
    try {
      fs.unlinkSync(path.join(attachmentsDir(), att.filename));
    } catch {
      /* file may already be gone */
    }
    store.deleteAttachment(att.id);
    hub.broadcast({ type: "update", source: "refresh" });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { due?: string | null } }>("/api/tasks/:id/due", async (req, reply) => {
    const id = Number(req.params.id);
    if (!store.getTask(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    try {
      // Empty/null body clears the deadline.
      const task = setTaskDue(store, id, req.body?.due ?? "clear");
      hub.broadcast({ type: "update", source: "refresh" }); // reschedule — no re-plan
      return { task };
    } catch (err) {
      reply.code(400);
      return { error: err instanceof Error ? err.message : "invalid deadline" };
    }
  });

  app.delete<{ Params: { id: string } }>("/api/tasks/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!store.getTask(id)) {
      reply.code(404);
      return { error: "not found" };
    }
    for (const a of store.listAttachments(id)) {
      try {
        fs.unlinkSync(path.join(attachmentsDir(), a.filename));
      } catch {
        /* best-effort */
      }
    }
    removeTask(store, id);
    hub.broadcast({ type: "update", source: "refresh" }); // deletion — no re-plan
    return { ok: true };
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
  store.syncSingleGenericStageNames(); // keep lone generic stage names equal to their task title
  await server.app.listen({ port, host: "127.0.0.1" });
  void server.replanner.refreshSuggestedDue(); // backfill suggestions for any undated tasks
  return server;
}
