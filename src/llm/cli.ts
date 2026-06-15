import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const execFileP = promisify(execFile);

/**
 * Pull the model's JSON out of a `claude -p --output-format json` result string.
 * Tolerates ``` fences and surrounding prose. Throws if no JSON is present.
 */
export function extractJson<T = unknown>(text: string): T {
  let s = String(text).trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/m.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.search(/[[{]/);
  if (start > 0) s = s.slice(start);
  const end = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (end >= 0 && end < s.length - 1) s = s.slice(0, end + 1);
  return JSON.parse(s) as T;
}

let cachedPath: string | null | undefined; // undefined = unresolved, null = not found

/**
 * Locate the `claude` CLI. GUI apps launched from Finder don't inherit the
 * shell PATH, so we check known install locations, then fall back to asking a
 * login shell. `override` (config.claudeCliPath) wins.
 */
export function resolveClaudePath(override?: string): string | null {
  if (override && fs.existsSync(override)) return override;
  if (cachedPath !== undefined) return cachedPath;

  const home = os.homedir();
  const candidates = [
    path.join(home, ".local/bin/claude"),
    path.join(home, ".claude/local/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    "/usr/bin/claude",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return (cachedPath = c);
  }
  // Last resort: a login shell knows the user's real PATH.
  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const out = execFileSync(shell, ["-lic", "command -v claude"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (out && fs.existsSync(out)) return (cachedPath = out);
  } catch {
    /* no login-shell claude */
  }
  return (cachedPath = null);
}

export function claudeAvailable(override?: string): boolean {
  return resolveClaudePath(override) != null;
}

export interface ClaudeOpts {
  model?: string;
  cliPath?: string;
  timeoutMs?: number;
}

/** The injectable shape the LLM modules depend on (so tests can fake the CLI). */
export type ClaudeRunner = (prompt: string, opts?: ClaudeOpts) => Promise<unknown>;

/**
 * Run a one-shot headless prompt through the Claude Code CLI and return the
 * model's JSON output. Uses the user's existing Claude Code auth — no API key.
 * Throws if the CLI is missing, errors, or doesn't return JSON.
 */
export const claudeJson: ClaudeRunner = async (prompt, opts = {}) => {
  const bin = resolveClaudePath(opts.cliPath);
  if (!bin) {
    throw new Error("claude CLI not found — install Claude Code or set config `claudeCliPath`");
  }
  const args = ["-p", prompt, "--output-format", "json"];
  if (opts.model) args.push("--model", opts.model);

  const { stdout } = await execFileP(bin, args, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 180_000,
  });
  const envelope = JSON.parse(stdout) as { is_error?: boolean; subtype?: string; result?: string };
  if (envelope.is_error || envelope.subtype !== "success" || typeof envelope.result !== "string") {
    throw new Error(`claude CLI error (${envelope.subtype ?? "unknown"})`);
  }
  return extractJson(envelope.result);
};

/**
 * Run a prompt and validate the JSON against `parse` (a zod schema's `.parse`).
 * Retries once with a correction nudge before giving up.
 */
export async function claudeStructured<T>(
  prompt: string,
  parse: (x: unknown) => T,
  opts: ClaudeOpts,
  run: ClaudeRunner = claudeJson,
): Promise<T> {
  try {
    return parse(await run(prompt, opts));
  } catch {
    const retry =
      prompt +
      "\n\nYour previous response was not valid JSON for the required shape. " +
      "Respond with ONLY the JSON value, no prose and no markdown fences.";
    return parse(await run(retry, opts));
  }
}
