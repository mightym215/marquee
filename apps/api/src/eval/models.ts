/**
 * The model backends the comparison can run against.
 *
 * Anything that speaks the OpenAI chat-completions API works here, so a local
 * Ollama or vLLM server hosting Salesforce's xLAM action models is a one-line
 * entry next to Claude.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { MessagesClient } from "../agent.js";
import { createOpenAICompatClient } from "../providers/openaiCompat.js";

export interface ModelBackend {
  /** Short name used on the command line and in the report. */
  key: string;
  label: string;
  provider: "anthropic" | "openai-compat";
  /** The model id sent to the API. */
  model: string;
  /** openai-compat only: where the server lives, including /v1. */
  baseUrl?: string;
  /** USD per million tokens. Local models are free, so 0 is honest. */
  price: { input: number; output: number };
  /** Printed in the report so a reader knows what hardware produced the numbers. */
  note?: string;
}

export const BACKENDS: Record<string, ModelBackend> = {
  claude: {
    key: "claude",
    // Same rule as the local backend: the report names the model that ran, not
    // a hardcoded marketing name that drifts from the id underneath it.
    label: process.env.ANTHROPIC_LABEL ?? process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
    provider: "anthropic",
    model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5",
    price: { input: 3, output: 15 },
    note: process.env.ANTHROPIC_NOTE ?? "hosted frontier model",
  },
  xlam: {
    key: "xlam",
    // The label goes in the report's column header, so it must name the model
    // that actually ran. Falls back to the model id rather than a hardcoded
    // size, which would silently mislabel a different checkpoint.
    label: process.env.XLAM_LABEL ?? process.env.XLAM_MODEL ?? "xLAM-2-3b-fc-r",
    provider: "openai-compat",
    model: process.env.XLAM_MODEL ?? "xlam-2-3b-fc-r",
    baseUrl: process.env.XLAM_BASE_URL ?? "http://localhost:11434/v1",
    price: { input: 0, output: 0 },
    note: process.env.XLAM_NOTE ?? "Salesforce open action model, run locally",
  },
  xlam1b: {
    key: "xlam1b",
    label: process.env.XLAM_1B_LABEL ?? process.env.XLAM_1B_MODEL ?? "xLAM-2-1b-fc-r",
    provider: "openai-compat",
    model: process.env.XLAM_1B_MODEL ?? "xlam-2-1b-fc-r",
    baseUrl: process.env.XLAM_BASE_URL ?? "http://localhost:11434/v1",
    price: { input: 0, output: 0 },
    note: "Salesforce open action model, 1B, run locally",
  },
};

export function resolveBackend(key: string): ModelBackend {
  const backend = BACKENDS[key];
  if (!backend) {
    throw new Error(`Unknown model "${key}". Available: ${Object.keys(BACKENDS).join(", ")}`);
  }
  return backend;
}

/** Builds the client the agent talks to, and tells you why if it can't. */
export function createClient(backend: ModelBackend): MessagesClient {
  if (backend.provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error(`${backend.label} needs ANTHROPIC_API_KEY.`);
    return new Anthropic({ apiKey });
  }
  if (!backend.baseUrl) throw new Error(`${backend.label} needs a baseUrl.`);
  return createOpenAICompatClient({
    baseUrl: backend.baseUrl,
    apiKey: process.env.OPENAI_COMPAT_API_KEY ?? "local",
    timeoutMs: Number(process.env.EVAL_TIMEOUT_MS ?? 300_000),
  });
}
