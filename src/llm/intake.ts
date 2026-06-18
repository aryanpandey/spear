import { claudeStructured, type ClaudeOpts, type ClaudeRunner, claudeJson } from "./cli.js";
import { IntakeSchema } from "./schemas.js";

export interface TaskSeed {
  title: string;
  details: string;
}

const URL_RE = /https?:\/\/\S+/i;

const SYSTEM = `You turn a founder's capture into a list of distinct, actionable task seeds for a task tracker.

Rules:
- Work out the set of tasks the capture calls for. The capture may be (a) an explicit list — split it into one seed per item; (b) a single thing — one seed; or (c) unstructured content (notes, a doc, a fetched page) plus an instruction — DERIVE the tasks the instruction asks for from that content. The content need NOT already be structured as tasks.
- Consider ALL of the capture together — typed text, any attached image, and any fetched page — and follow the instruction in the typed text (e.g. "create implementation tasks from this doc", "add the testing phases").
- Each seed: a short imperative "title" and one or two sentences of "details" giving the breakdown step enough context.
- Do NOT plan, prioritize, or break into stages — that happens later. Just produce the task list.
- Output ONLY a JSON object: {"seeds":[{"title":string,"details":string}]} — no prose, no markdown fences.`;

function buildPrompt(prompt: string, imagePath?: string): string {
  let s = SYSTEM + "\n\n";
  if (imagePath) s += `An image is attached at ${imagePath}. Read it and use its contents.\n`;
  if (URL_RE.test(prompt)) s += `If the capture contains a URL, fetch that page (use WebFetch, or the Notion fetch tool for a Notion link). Then, using BOTH the page's full contents AND the instruction in the capture, derive the tasks to create — the page need not already be a task list.\n`;
  s += `Capture:\n${prompt || "(no text — use the image)"}`;
  return s;
}

/**
 * Extract 1..N task seeds from a prompt and optional image. When an image is
 * attached the runner is told it may use the Read tool to open it. Falls back to
 * a single seed built from the prompt if the model returns none.
 */
export async function extractTaskSeeds(
  prompt: string,
  imagePath: string | undefined,
  opts: ClaudeOpts,
  run: ClaudeRunner = claudeJson,
): Promise<TaskSeed[]> {
  const callOpts: ClaudeOpts = { ...opts };
  const tools: string[] = [];
  if (imagePath) tools.push("Read");
  if (URL_RE.test(prompt)) tools.push("WebFetch", "mcp__claude_ai_Notion__notion-fetch");
  if (tools.length) callOpts.allowedTools = tools;
  const parsed = await claudeStructured(buildPrompt(prompt, imagePath), (x) => IntakeSchema.parse(x), callOpts, run);
  if (!parsed.seeds.length) return [{ title: prompt.trim() || "Untitled task", details: prompt.trim() }];
  return parsed.seeds;
}
