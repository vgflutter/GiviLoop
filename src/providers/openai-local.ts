import { LocalInferenceError, localBaseUrl, localJson, localSignal } from "./local-http.js";
import type { LocalProviderInfo, LocalReviewOptions, LocalReviewResult } from "./local-types.js";

export type OpenAILocalProvider = "llama-cpp" | "lmstudio" | "mlx";
type Json = Record<string, unknown>;
type Model = { id: string; capacity?: number; reasoningEffort?: boolean };
const DEFAULTS: Record<OpenAILocalProvider, string> = {
  "llama-cpp": "http://127.0.0.1:8080", lmstudio: "http://127.0.0.1:1234", mlx: "http://127.0.0.1:8081",
};
const object = (value: unknown): value is Json => value !== null && typeof value === "object" && !Array.isArray(value);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function invalid(message: string): never { throw new LocalInferenceError("LOCAL_RESPONSE_INVALID", message); }
function endpoint(provider: OpenAILocalProvider, value?: string): URL {
  if (!Object.hasOwn(DEFAULTS, provider)) throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", "Choose llama-cpp, lmstudio or mlx.");
  const base = localBaseUrl(value, DEFAULTS[provider]);
  if (base.pathname === "/v1/") base.pathname = "/";
  if (base.pathname !== "/") throw new LocalInferenceError("LOCAL_URL_INVALID", "The local API base URL must end at the server root or /v1.");
  return base;
}
function integer(value: number | undefined, fallback: number, max: number, label: string): number {
  const result = value ?? fallback;
  if (!positive(result) || result > max) throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", `${label} must be an integer from 1 to ${max}.`);
  return result;
}
function count(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid("The local server returned invalid token usage.");
  return value;
}

async function discover(provider: OpenAILocalProvider, base: URL, signal: AbortSignal): Promise<Model[]> {
  const listing = await localJson<Json>(base, "/v1/models", { signal, maxBytes: 1024 * 1024 });
  if (!Array.isArray(listing.data) || listing.data.length > 512) invalid("The local server did not return a bounded model list.");
  const entries = listing.data;
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!object(entry) || entry.object !== "model" || typeof entry.id !== "string" || !entry.id.trim() || entry.id.length > 1024 || /[\r\n\0]/.test(entry.id)) {
      invalid("The local model list contains an invalid model ID.");
    }
    if (entry.remote_host || entry.remote_model) throw new LocalInferenceError("LOCAL_CLOUD_MODEL_REJECTED", "The selected local server advertises a remotely hosted model.");
    ids.add(entry.id);
  }
  if (provider === "mlx") {
    // Upstream lists cached repositories or an existing --model directory.
    // It does not expose model context or thinking capability metadata.
    return [...ids].filter(id => id !== "default_model" && !id.includes("://")).map(id => ({ id }));
  }
  if (provider === "llama-cpp") {
    if (entries.length !== 1) throw new LocalInferenceError("LOCAL_MODEL_UNVERIFIED", "Use a single-model llama-server. Router mode does not provide unambiguous active context metadata.");
    const entry = entries[0] as Json;
    if (entry.owned_by !== "llamacpp" || !object(entry.meta) || !positive(entry.meta.n_ctx_train)) {
      throw new LocalInferenceError("LOCAL_MODEL_UNVERIFIED", "llama.cpp did not expose loaded GGUF metadata. Wait for loading to complete or update llama-server.");
    }
    const properties = await localJson<Json>(base, "/props", { signal, maxBytes: 2 * 1024 * 1024 });
    if (!object(properties.default_generation_settings) || !positive(properties.default_generation_settings.n_ctx)) {
      throw new LocalInferenceError("LOCAL_CONTEXT_UNVERIFIED", "llama.cpp /props did not report an active context capacity.");
    }
    const caps = properties.chat_template_caps;
    return [{ id: entry.id as string, capacity: properties.default_generation_settings.n_ctx,
      reasoningEffort: object(caps) && caps.supports_reasoning_effort === true }];
  }
  const native = await localJson<Json>(base, "/api/v1/models", { signal, maxBytes: 2 * 1024 * 1024 });
  if (!Array.isArray(native.models) || native.models.length > 512) invalid("LM Studio's native model metadata is unavailable. Use a version supporting /api/v1/models.");
  const loaded = new Map<string, Model>();
  for (const entry of native.models) {
    if (!object(entry) || entry.type !== "llm" || !["gguf", "mlx"].includes(String(entry.format)) || !Array.isArray(entry.loaded_instances)) continue;
    if (entry.remote_host || entry.remote_model) throw new LocalInferenceError("LOCAL_CLOUD_MODEL_REJECTED", "LM Studio advertised a remote model. Disable remote model routing before local inference.");
    for (const instance of entry.loaded_instances) {
      if (!object(instance) || typeof instance.id !== "string" || !ids.has(instance.id)) continue;
      if (!object(instance.config) || !positive(instance.config.context_length)) invalid("LM Studio did not report the loaded instance's context length.");
      const existing = loaded.get(instance.id);
      if (existing && existing.capacity !== instance.config.context_length) invalid("LM Studio reported inconsistent instance context lengths.");
      loaded.set(instance.id, { id: instance.id, capacity: instance.config.context_length });
    }
  }
  return [...loaded.values()];
}

export async function probeOpenAILocal(provider: OpenAILocalProvider, baseUrl?: string): Promise<LocalProviderInfo> {
  const base = endpoint(provider, baseUrl);
  const deadline = localSignal(10_000);
  try {
    const models = await discover(provider, base, deadline.signal);
    return { provider, baseUrl: base.href.replace(/\/$/, ""), models: models.map(model => model.id) };
  } finally { deadline.dispose(); }
}

export async function sendToOpenAILocal(provider: OpenAILocalProvider, options: LocalReviewOptions): Promise<LocalReviewResult> {
  const started = performance.now();
  const base = endpoint(provider, options.baseUrl);
  if (typeof options.model !== "string" || !options.model.trim() || options.model.length > 1024 || /[\r\n\0]/.test(options.model)) {
    throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", "Select the exact model ID reported by local model discovery.");
  }
  if (typeof options.prompt !== "string" || !options.prompt.trim() || Buffer.byteLength(options.prompt) > 2 * 1024 * 1024) {
    throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", "The local review requires nonempty text of at most 2 MiB.");
  }
  const maxTokens = integer(options.maxOutputTokens, 4096, 131072, "maxOutputTokens");
  const timeoutMs = integer(options.timeoutMs, 300000, 3600000, "timeoutMs");
  const requestedContext = options.contextTokens === undefined ? undefined : integer(options.contextTokens, 16384, 1048576, "contextTokens");
  if (options.reasoning !== undefined && !["off", "on", "low", "medium", "high"].includes(options.reasoning)) {
    throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", "reasoning must be off, on, low, medium or high.");
  }
  if (provider !== "llama-cpp" && options.reasoning !== undefined) {
    throw new LocalInferenceError("LOCAL_REASONING_UNSUPPORTED", `${provider} does not expose verified per-request thinking control through this adapter. Configure the model in the runtime and omit reasoning.`);
  }
  const deadline = localSignal(timeoutMs, options.signal);
  try {
    const models = await discover(provider, base, deadline.signal);
    const model = models.find(item => item.id === options.model);
    if (!model) throw new LocalInferenceError("LOCAL_MODEL_UNVERIFIED", "The exact model ID is absent from verified local discovery. Load it in the runtime, then list models again. GiviLoop never loads or downloads an alternative model.");
    if (requestedContext !== undefined && model.capacity !== undefined && requestedContext > model.capacity) {
      throw new LocalInferenceError("LOCAL_CONTEXT_EXCEEDED", `Requested ${requestedContext} context tokens, but the runtime reports ${model.capacity}. Reload the model with sufficient capacity.`);
    }
    const budget = requestedContext ?? model.capacity ?? 16384;
    if (Buffer.byteLength(options.prompt) + maxTokens + 512 > budget) {
      throw new LocalInferenceError("LOCAL_CONTEXT_EXCEEDED", "Prompt UTF-8 bytes, output reserve and 512 template tokens exceed the conservative context budget. Select less source or increase the verified runtime capacity/client budget.");
    }
    const body: Json = { model: model.id, messages: [{ role: "user", content: options.prompt }], max_tokens: maxTokens, stream: false };
    if (provider === "llama-cpp") {
      body.reasoning_format = "deepseek";
      if (options.reasoning !== undefined) {
        if (!model.reasoningEffort) throw new LocalInferenceError("LOCAL_REASONING_UNSUPPORTED", "This llama.cpp chat template does not advertise reasoning-effort control. Configure the server's thinking setting and omit reasoning.");
        body.reasoning_effort = options.reasoning === "off" ? "none" : options.reasoning === "on" ? "medium" : options.reasoning;
      }
    }
    const response = await localJson<Json>(base, "/v1/chat/completions", { body, signal: deadline.signal, maxBytes: 8 * 1024 * 1024 });
    if (response.model !== model.id) throw new LocalInferenceError("LOCAL_MODEL_MISMATCH", "The completion reported a different model ID than requested. No response was accepted.");
    if (!Array.isArray(response.choices) || response.choices.length !== 1 || !object(response.choices[0])) invalid("Expected exactly one local chat completion.");
    const choice = response.choices[0];
    if (choice.finish_reason !== "stop" || response.truncated === true) {
      throw new LocalInferenceError("LOCAL_RESPONSE_INCOMPLETE", "The local model did not finish normally. Increase the output/context budget or timeout; no partial answer was accepted.");
    }
    const message = choice.message;
    if (!object(message) || message.role !== "assistant" || typeof message.content !== "string" || !message.content.trim() ||
        (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)) || message.function_call !== undefined) {
      invalid("The local completion lacks a final text answer, or requested unsupported tool calls.");
    }
    // Do not accidentally save raw thinking when a runtime/template fails to split it.
    if (/^\s*(?:<think>|<analysis>|<\|channel\|>analysis)/i.test(message.content)) {
      throw new LocalInferenceError("LOCAL_REASONING_UNSEPARATED", "The runtime returned thinking inside the answer. Configure its reasoning parser to return thinking separately before saving reviews.");
    }
    if (response.usage !== undefined && !object(response.usage)) invalid("The local completion returned malformed usage metadata.");
    const usage = object(response.usage) ? response.usage : {};
    if (usage.completion_tokens_details !== undefined && !object(usage.completion_tokens_details)) invalid("The local completion returned malformed reasoning usage metadata.");
    const details = object(usage.completion_tokens_details) ? usage.completion_tokens_details : {};
    return { provider, model: model.id, responseText: message.content.trim(), elapsedMs: Math.round(performance.now() - started),
      inputTokens: count(usage.prompt_tokens), outputTokens: count(usage.completion_tokens), reasoningTokens: count(details.reasoning_tokens), finishReason: "stop" };
  } finally { deadline.dispose(); }
}
