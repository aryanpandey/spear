import Anthropic from "@anthropic-ai/sdk";

/** Returns an Anthropic client, or null when ANTHROPIC_API_KEY is unset. */
export function getAnthropic(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}

export function hasApiKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
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
