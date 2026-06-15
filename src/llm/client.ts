import Anthropic from "@anthropic-ai/sdk";
import { loadConfig } from "../config/index.js";

/**
 * Resolve the Anthropic API key. The environment wins (handy for CLI / CI),
 * then the spear config file (`~/.spear/config.json` -> `anthropicApiKey`) so the
 * packaged desktop app — which never inherits your shell environment — can still
 * reach Claude. Empty strings count as "no key".
 */
export function resolveApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY || loadConfig().anthropicApiKey || undefined;
}

/** Returns an Anthropic client, or null when no API key is configured. */
export function getAnthropic(): Anthropic | null {
  const apiKey = resolveApiKey();
  if (!apiKey) return null;
  return new Anthropic({ apiKey });
}

export function hasApiKey(): boolean {
  return Boolean(resolveApiKey());
}

/**
 * The minimal slice of the SDK the LLM modules call. Declaring it lets tests
 * inject a fake without standing up a real client.
 */
export interface ParseClient {
  messages: {
    parse(args: Record<string, unknown>): Promise<{ parsed_output: unknown }>;
  };
}
