import { performance } from "node:perf_hooks";
import { LocalInferenceError, localBaseUrl, localJson, localSignal } from "./local-http.js";
import type { LocalProviderInfo, LocalReviewOptions, LocalReviewResult } from "./local-types.js";

const DEFAULT_URL = "http://127.0.0.1:11434";
type Json = Record<string, unknown>;
function record(value: unknown): value is Json { return value !== null && typeof value === "object" && !Array.isArray(value); }
function cloudMetadata(value: Json): boolean {
  return [value.remote_host, value.remote_model].some(field => typeof field === "string" && field.trim().length > 0);
}
function localModelMetadata(value: Json): boolean {
  return !cloudMetadata(value) && record(value.model_info) && typeof value.model_info["general.architecture"] === "string";
}
function integer(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", `${name} must be an integer from ${min} to ${max}.`);
  return result;
}
function tokenCount(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new LocalInferenceError("LOCAL_RESPONSE_INVALID", "Ollama returned an invalid token count.");
  }
  return value;
}
function modelName(value: string): string { return value.split("/").at(-1)!.includes(":") ? value : `${value}:latest`; }

export async function probeOllama(baseUrl?: string): Promise<LocalProviderInfo> {
  const base = localBaseUrl(baseUrl, DEFAULT_URL);
  const deadline = localSignal(10_000);
  try {
    const tags = await localJson<Json>(base, "api/tags", { signal: deadline.signal });
    if (!Array.isArray(tags.models)) throw new LocalInferenceError("LOCAL_RESPONSE_INVALID", "Ollama /api/tags did not return a model list.");
    const candidates = tags.models.filter(record).filter(item => !cloudMetadata(item) && typeof item.name === "string" && !/cloud(?:$|:)/i.test(item.name));
    if (candidates.length > 128) throw new LocalInferenceError("LOCAL_MODEL_LIST_TOO_LARGE", "The local server returned more than 128 models. Select a model explicitly instead.");
    const models: string[] = [];
    for (const item of candidates) {
      const shown = await localJson<Json>(base, "api/show", { body: { model: item.name }, signal: deadline.signal });
      if (localModelMetadata(shown)) models.push(item.name as string);
    }
    return { provider: "ollama", baseUrl: base.href.replace(/\/$/, ""), models };
  } finally { deadline.dispose(); }
}

export async function sendToOllama(options: LocalReviewOptions): Promise<LocalReviewResult> {
  const started = performance.now();
  const base = localBaseUrl(options.baseUrl, DEFAULT_URL);
  if (typeof options.model !== "string" || !options.model.trim() || options.model.length > 256 || /\s/.test(options.model)) {
    throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", "Select an installed Ollama model name, for example qwen2.5-coder:3b.");
  }
  if (/cloud(?:$|:)/i.test(options.model)) throw new LocalInferenceError("LOCAL_CLOUD_MODEL_REJECTED", "Choose downloaded model weights. Ollama cloud models are not accepted by the local provider.");
  if (typeof options.prompt !== "string" || !options.prompt.trim()) throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", "The review prompt must not be empty.");
  const timeoutMs = integer(options.timeoutMs, 300_000, 1, 3_600_000, "timeoutMs");
  const maxOutputTokens = integer(options.maxOutputTokens, 2048, 1, 32_768, "maxOutputTokens");
  const contextTokens = integer(options.contextTokens, 16_384, 1024, 262_144, "contextTokens");
  if (options.reasoning !== undefined && !["off", "on", "low", "medium", "high"].includes(options.reasoning)) {
    throw new LocalInferenceError("LOCAL_OPTIONS_INVALID", "reasoning must be off, on, low, medium or high.");
  }
  // UTF-8 bytes are a conservative token budget: reject rather than silently dropping source code.
  if (Buffer.byteLength(options.prompt, "utf8") + maxOutputTokens + 512 > contextTokens) {
    throw new LocalInferenceError("LOCAL_CONTEXT_EXCEEDED", "The prompt and output reserve exceed the conservative context budget. Select fewer files or increase contextTokens within your model's limit.");
  }
  const deadline = localSignal(timeoutMs, options.signal);
  try {
    // Check before transmitting source text. Cloud aliases are detectable even when their name has no -cloud suffix.
    const shown = await localJson<Json>(base, "api/show", { body: { model: options.model }, signal: deadline.signal });
    if (cloudMetadata(shown)) throw new LocalInferenceError("LOCAL_CLOUD_MODEL_REJECTED", "This Ollama model forwards to a remote host. Download a local model and run Ollama with OLLAMA_NO_CLOUD=1.");
    if (!localModelMetadata(shown)) throw new LocalInferenceError("LOCAL_MODEL_UNVERIFIED", "Ollama did not report local model architecture metadata. Update Ollama and select downloaded weights before sending code.");
    const architecture = (shown.model_info as Json)["general.architecture"] as string;
    const modelContext = (shown.model_info as Json)[`${architecture}.context_length`];
    if (typeof modelContext === "number" && contextTokens > modelContext) {
      throw new LocalInferenceError("LOCAL_CONTEXT_EXCEEDED", `The requested context (${contextTokens}) exceeds the model limit (${modelContext}). Reduce contextTokens and review fewer files.`);
    }
    if (options.reasoning && options.reasoning !== "off" && (!Array.isArray(shown.capabilities) || !shown.capabilities.includes("thinking"))) {
      throw new LocalInferenceError("LOCAL_REASONING_UNSUPPORTED", "This Ollama model does not advertise thinking support. Choose a thinking model or set reasoning to off.");
    }
    const levelsOnly = architecture === "gptoss" || architecture === "gpt-oss";
    if (levelsOnly && options.reasoning === "off") {
      throw new LocalInferenceError("LOCAL_REASONING_UNSUPPORTED", "GPT-OSS cannot disable thinking. Select low, medium or high, or choose a model with switchable thinking.");
    }
    const think = options.reasoning === "off" ? false : options.reasoning === "on" ? (levelsOnly ? "medium" : true) : options.reasoning;
    const result = await localJson<Json>(base, "api/chat", {
      signal: deadline.signal,
      body: {
        model: options.model, messages: [{ role: "user", content: options.prompt }], stream: false,
        truncate: false, shift: false,
        // Preserve model-owned sampling defaults. In particular, forcing greedy
        // decoding on Qwen3 thinking models can create endless repetitions.
        options: { num_ctx: contextTokens, num_predict: maxOutputTokens },
        ...(think === undefined ? {} : { think }),
      },
    });
    if (cloudMetadata(result)) throw new LocalInferenceError("LOCAL_CLOUD_MODEL_REJECTED", "The server reported remote inference despite its preflight metadata. Stop this server and use OLLAMA_NO_CLOUD=1.");
    if (typeof result.model !== "string" || modelName(result.model) !== modelName(options.model)) {
      throw new LocalInferenceError("LOCAL_MODEL_MISMATCH", "Ollama returned a different model than requested. No response was saved.");
    }
    if (result.done !== true || result.done_reason !== "stop") {
      throw new LocalInferenceError("LOCAL_RESPONSE_INCOMPLETE", "Ollama did not finish normally. Increase the output/context budget or timeout; partial answers are not saved.");
    }
    const message = result.message;
    if (!record(message) || message.role !== "assistant" || typeof message.content !== "string" || !message.content.trim() ||
        (message.tool_calls !== undefined && (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0))) {
      throw new LocalInferenceError("LOCAL_RESPONSE_INVALID", "Ollama did not return a complete assistant answer. Thinking-only or tool-call responses cannot be used as a review.");
    }
    return {
      provider: "ollama", model: result.model, responseText: message.content.trim(),
      elapsedMs: Math.round(performance.now() - started), inputTokens: tokenCount(result.prompt_eval_count), outputTokens: tokenCount(result.eval_count), finishReason: result.done_reason,
    };
  } finally { deadline.dispose(); }
}
