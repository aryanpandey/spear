import { claudeStructured, type ClaudeOpts, type ClaudeRunner, claudeJson } from "./cli.js";
import { IntakeSchema } from "./schemas.js";

export interface TaskSeed {
  title: string;
  details: string;
}

const SYSTEM = `You turn a founder's raw capture into a list of distinct, actionable task seeds for a task tracker.

Rules:
- Identify each SEPARATE actionable task. If the input (text and/or image) describes one thing, return one seed; if it lists several, return one seed per item.
- Each seed: a short imperative "title" and one or two sentences of "details" giving the breakdown step enough context.
- Do NOT plan, prioritize, or break into stages — that happens later. Just split and summarize.
- Output ONLY a JSON object: {"seeds":[{"title":string,"details":string}]} — no prose, no markdown fences.`;

function buildPrompt(prompt: string, imagePath?: string): string {
  let s = SYSTEM + "\n\n";
  if (imagePath) s += `An image is attached at ${imagePath}. Read it and use its contents.\n`;
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
  if (imagePath) callOpts.allowedTools = ["Read"];
  const parsed = await claudeStructured(buildPrompt(prompt, imagePath), (x) => IntakeSchema.parse(x), callOpts, run);
  if (!parsed.seeds.length) return [{ title: prompt.trim() || "Untitled task", details: prompt.trim() }];
  return parsed.seeds;
}
