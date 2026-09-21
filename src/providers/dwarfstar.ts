import type { LocalProviderInfo, LocalReviewOptions, LocalReviewResult } from "./local-types.js";
import { LocalInferenceError, localBaseUrl, localJson, localSignal } from "./local-http.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:8000";
const MAX_PROMPT_BYTES = 2 * 1024 * 1024;

type LoadedModel = { name: string; contextTokens: number; ids: Set<string> };
type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function invalidResponse(message: string): never {
  throw new LocalInferenceError("LOCAL_RESPONSE_INVALID", `DwarfStar: ${message}`);
}

function endpoint(value?: string): URL {
  const base = localBaseUrl(value, DEFAULT_BASE_URL);
  // Accept the OpenAI-style /v1 base URL as well as the server root.
  if (base.pathname === "/v1" || base.pathname === "/v1/") base.pathname = "/";
  if (base.pathname !== "/") {
    throw new LocalInferenceError("LOCAL_URL_INVALID", "DwarfStar base URL must end at the server root or /v1.");
  }
  return base;
}

async function loadedModels(base: URL, signal: AbortSignal): Promise<LoadedModel[]> {
  const response = await localJson<unknown>(base, "/v1/models", { signal, maxBytes: 256 * 1024 });
  if (!object(response) || !Array.isArray(response.data) || response.data.length === 0) {
    invalidResponse("/v1/models did not report a loaded model.");
  }
  const models = new Map<string, LoadedModel>();
  for (const entry of response.data) {
    // DwarfStar advertises several compatibility IDs for the SAME loaded model.
    // Only `name` comes from ds4_engine_model_name(); treating `id` as the
    // actual model would wrongly claim a Flash-to-Pro switch.
    if (!object(entry) || entry.owned_by !== "ds4.c" ||
        typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 256 ||
        typeof entry.name !== "string" || !entry.name.trim() || entry.name.length > 256 ||
        !positiveInteger(entry.context_length)) {
      invalidResponse("/v1/models lacks DwarfStar model identity or context metadata. Update ds4-server.");
    }
    const existing = models.get(entry.name);
    if (existing && existing.contextTokens !== entry.context_length) {
      invalidResponse("/v1/models returned inconsistent context capacities for the loaded model.");
    }
    const ids = existing?.ids ?? new Set<string>();
    ids.add(entry.id);
    models.set(entry.name, { name: entry.name, contextTokens: entry.context_length, ids });
  }
  // Upstream loads one GGUF per server process. Multiple physical model names
  // indicate a different/misconfigured service; never guess which will run.
  if (models.size !== 1) invalidResponse("the server must expose exactly one loaded model name.");
  return [...models.values()];
}

export async function probeDwarfStar(baseUrl?: string): Promise<LocalProviderInfo> {
  const base = endpoint(baseUrl);
  const deadline = localSignal(10_000);
  try {
    const models = await loadedModels(base, deadline.signal);
    return { provider: "dwarfstar", baseUrl: base.href.replace(/\/$/, ""), models: models.map(model => model.name) };
  } finally {
    deadline.dispose();
  }
}

function integerOption(value: number | undefined, fallback: number, maximum: number, name: string): number {
  const result = value ?? fallback;
  if (!positiveInteger(result) || result > maximum) {
    throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", `${name} must be an integer from 1 to ${maximum}.`);
  }
  return result;
}

function tokenCount(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidResponse(`invalid ${name} token usage.`);
  }
  return value;
}

export async function sendToDwarfStar(options: LocalReviewOptions): Promise<LocalReviewResult> {
  if (typeof options.prompt !== "string" || !options.prompt.trim() || Buffer.byteLength(options.prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", "DwarfStar requires a nonempty prompt of at most 2 MiB.");
  }
  if (typeof options.model !== "string" || !options.model.trim() || options.model.length > 256) {
    throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", "Choose the exact loaded model name reported by DwarfStar discovery.");
  }
  const maxTokens = integerOption(options.maxOutputTokens, 4096, 131072, "maxOutputTokens");
  const timeoutMs = integerOption(options.timeoutMs, 600_000, 3_600_000, "timeoutMs");
  const contextTokens = options.contextTokens === undefined ? undefined :
    integerOption(options.contextTokens, 1, 1_048_576, "contextTokens");
  if (options.reasoning !== undefined && !["off", "on", "low", "medium", "high"].includes(options.reasoning)) {
    throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", "reasoning must be off, on, low, medium, or high.");
  }
  const base = endpoint(options.baseUrl);
  const deadline = localSignal(timeoutMs, options.signal);
  const started = performance.now();
  try {
    const [loaded] = await loadedModels(base, deadline.signal);
    if (loaded.name !== options.model) {
      throw new LocalInferenceError("LOCAL_MODEL_MISMATCH",
        `DwarfStar has ${JSON.stringify(loaded.name)} loaded. Select that exact name, or restart ds4-server with another GGUF. Compatibility aliases do not switch models.`);
    }
    if (contextTokens !== undefined && loaded.contextTokens < contextTokens) {
      throw new LocalInferenceError("LOCAL_CONTEXT_EXCEEDED",
        `DwarfStar has ${loaded.contextTokens} context tokens; ${contextTokens} were requested. Restart ds4-server with a sufficient --ctx value.`);
    }
    if (maxTokens >= loaded.contextTokens) {
      throw new LocalInferenceError("LOCAL_CONTEXT_EXCEEDED", "DwarfStar output budget must be smaller than the server context capacity.");
    }
    const body: JsonObject = {
      messages: [{ role: "user", content: options.prompt }],
      stream: false,
      max_tokens: maxTokens,
    };
    // Omit `model`: upstream otherwise echoes arbitrary request IDs. The GGUF
    // selected at server startup is the only model that this server can run.
    if (options.reasoning !== undefined) {
      body.think = options.reasoning !== "off";
      if (["low", "medium", "high"].includes(options.reasoning)) body.reasoning_effort = options.reasoning;
    }
    const response = await localJson<unknown>(base, "/v1/chat/completions", {
      method: "POST", body, signal: deadline.signal, maxBytes: 8 * 1024 * 1024,
    });
    if (!object(response) || !Array.isArray(response.choices) || response.choices.length !== 1) {
      invalidResponse("expected exactly one completed chat response.");
    }
    const choice = response.choices[0];
    if (!object(choice)) invalidResponse("missing response choice.");
    if (choice.finish_reason !== "stop") {
      throw new LocalInferenceError("LOCAL_RESPONSE_INCOMPLETE",
        `DwarfStar did not finish a review (finish_reason=${JSON.stringify(choice.finish_reason ?? null)}). Increase the output/context budget if it reached the token limit; no partial review was accepted.`);
    }
    if (!object(choice.message) || choice.message.role !== "assistant" ||
        typeof choice.message.content !== "string" || !choice.message.content.trim()) {
      invalidResponse("the completed response contains no assistant answer.");
    }
    if (choice.message.tool_calls !== undefined &&
        (!Array.isArray(choice.message.tool_calls) || choice.message.tool_calls.length > 0)) {
      invalidResponse("unexpected tool calls in a text review.");
    }
    if (typeof response.model !== "string" || !response.model.trim()) {
      invalidResponse("missing server model ID in the completion.");
    }
    if (!loaded.ids.has(response.model)) {
      throw new LocalInferenceError("LOCAL_MODEL_MISMATCH", "DwarfStar returned a model ID absent from its preflight metadata. No response was accepted.");
    }
    if (response.usage !== undefined && !object(response.usage)) invalidResponse("malformed token usage.");
    const usage = object(response.usage) ? response.usage : {};
    const details = usage.completion_tokens_details;
    if (details !== undefined && !object(details)) invalidResponse("malformed completion token details.");
    return {
      provider: "dwarfstar",
      responseText: choice.message.content,
      model: loaded.name,
      elapsedMs: Math.round(performance.now() - started),
      inputTokens: tokenCount(usage.prompt_tokens, "input"),
      outputTokens: tokenCount(usage.completion_tokens, "output"),
      reasoningTokens: object(details) ? tokenCount(details.reasoning_tokens, "reasoning") : undefined,
      finishReason: "stop",
    };
  } finally {
    deadline.dispose();
  }
}
