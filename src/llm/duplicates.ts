import { claudeStructured, type ClaudeOpts, type ClaudeRunner, claudeJson } from "./cli.js";
import { DuplicateSchema } from "./schemas.js";

export interface DupCandidate {
  title: string;
  details?: string;
}

export interface ExistingTaskRef {
  id: number;
  title: string;
  status: string;
}

export interface DupMatch {
  candidateIndex: number;
  taskId: number;
  reason: string;
}

const SYSTEM = `You detect when a task a founder is about to add DUPLICATES one already on their board.

Rules:
- For each candidate, find an existing task that means the SAME thing — a reworded or rephrased
  version of the same work counts as a duplicate. A merely related or adjacent task does NOT.
- Use the exact ids from the existing list. Omit candidates that have no duplicate.
- Output ONLY a JSON object: {"matches":[{"candidate_index":number,"task_id":number,"reason":string}]}
  — no prose, no markdown fences.`;

function buildPrompt(candidates: DupCandidate[], existing: ExistingTaskRef[]): string {
  return (
    `${SYSTEM}\n\nCandidates (by index):\n${JSON.stringify(candidates.map((c, i) => ({ index: i, ...c })))}` +
    `\n\nExisting tasks:\n${JSON.stringify(existing)}`
  );
}

/**
 * Ask the Claude CLI which candidate tasks duplicate an existing task. Returns
 * only well-formed matches (valid candidate index + known task id). Short-circuits
 * to [] (no LLM call) when there is nothing to compare.
 */
export async function findDuplicates(
  candidates: DupCandidate[],
  existing: ExistingTaskRef[],
  opts: ClaudeOpts,
  run: ClaudeRunner = claudeJson,
): Promise<DupMatch[]> {
  if (candidates.length === 0 || existing.length === 0) return [];
  const ids = new Set(existing.map((e) => e.id));
  const parsed = await claudeStructured(buildPrompt(candidates, existing), (x) => DuplicateSchema.parse(x), opts, run);

  const out: DupMatch[] = [];
  for (const m of parsed.matches) {
    if (m.candidate_index < 0 || m.candidate_index >= candidates.length) continue;
    if (!ids.has(m.task_id)) continue;
    out.push({ candidateIndex: m.candidate_index, taskId: m.task_id, reason: m.reason });
  }
  return out;
}
