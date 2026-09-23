import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { atomicWrite } from "./browser-runtime.js";
import { isLocalProvider, LOCAL_PROVIDERS, type LocalProvider, type LocalProviderInfo, type LocalReasoning, type LocalReviewResult } from "./local-types.js";
import { acquireRunLock } from "../run-lock.js";
import { runControl } from "../run-control.js";
import { LocalInferenceError } from "./local-http.js";

export type { LocalProvider } from "./local-types.js";
export type LocalRunOptions = {
  provider: LocalProvider;
  model: string;
  requestPath: string;
  responsePath: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  contextTokens?: number;
  reasoning?: LocalReasoning;
  attachmentPaths?: string[];
  signal?: AbortSignal;
};

export function readLocalProvider(value: string): LocalProvider {
  if (isLocalProvider(value)) return value;
  throw new Error(`Invalid local provider: ${value}. Use ${LOCAL_PROVIDERS.join(", ")}.`);
}

export function readLocalReasoning(value?: string): LocalReasoning | undefined {
  if (value === undefined) return undefined;
  if (["off", "on", "low", "medium", "high"].includes(value)) return value as LocalReasoning;
  throw new Error("Invalid reasoning value. Use off, on, low, medium, or high; supported values depend on the model/runtime.");
}

export async function probeLocalProvider(provider: LocalProvider, baseUrl?: string): Promise<LocalProviderInfo> {
  if (provider === "ollama") return (await import("./ollama.js")).probeOllama(baseUrl);
  if (provider === "dwarfstar") return (await import("./dwarfstar.js")).probeDwarfStar(baseUrl);
  return (await import("./openai-local.js")).probeOpenAILocal(provider, baseUrl);
}

export async function sendLocalReview(options: LocalRunOptions): Promise<LocalReviewResult & { responsePath: string }> {
  if (!options.model.trim()) throw new Error("Local inference requires an explicit --model / model. List installed models with givi models --provider " + options.provider + ".");
  if (options.attachmentPaths?.length) {
    throw new Error("Local inference accepts text context, not ZIP uploads. Use givi ask --file or givi prepare, then send the prepared text review.");
  }
  if (!existsSync(options.requestPath)) throw new Error(`Request file not found: ${options.requestPath}`);
  const prompt = readFileSync(options.requestPath, "utf8");
  if (!prompt.trim()) throw new Error(`Request file is empty: ${options.requestPath}`);
  const directory = path.dirname(options.responsePath);
  mkdirSync(directory, { recursive: true });
  const release = acquireRunLock(directory, options.provider);
  const control = runControl(directory, options.signal);
  const status = {
    provider: options.provider, requestedModel: options.model, startedAt: new Date().toISOString(),
    endedAt: undefined as string | undefined, outcome: "running", errorCode: undefined as string | undefined,
    requestSha256: createHash("sha256").update(prompt).digest("hex"),
    ownerPid: process.pid, controlToken: control.token,
  };
  const statusPath = path.join(directory, "local-status.json");
  try {
    atomicWrite(statusPath, JSON.stringify(status, null, 2) + "\n");
    const args = { prompt, model: options.model, baseUrl: options.baseUrl, timeoutMs: options.timeoutMs,
      maxOutputTokens: options.maxOutputTokens, contextTokens: options.contextTokens,
      reasoning: options.reasoning, signal: control.signal };
    const result = options.provider === "ollama"
      ? await (await import("./ollama.js")).sendToOllama(args)
      : options.provider === "dwarfstar"
        ? await (await import("./dwarfstar.js")).sendToDwarfStar(args)
        : await (await import("./openai-local.js")).sendToOpenAILocal(options.provider, args);
    if (!result.responseText.trim()) throw new Error("Local provider returned an empty final answer.");
    const { responseText, ...usage } = result;
    // Preserve a prior successful response if inference fails or is truncated.
    atomicWrite(path.join(directory, "local-usage.json"), JSON.stringify({ ...usage,
      requestSha256: status.requestSha256, responseSha256: createHash("sha256").update(responseText).digest("hex"),
    }, null, 2) + "\n");
    atomicWrite(options.responsePath, responseText);
    status.outcome = "completed";
    status.endedAt = new Date().toISOString();
    atomicWrite(statusPath, JSON.stringify(status, null, 2) + "\n");
    return { ...result, responsePath: options.responsePath };
  } catch (error) {
    status.outcome = "failed";
    status.endedAt = new Date().toISOString();
    // Record the stable class/code only; runtime error bodies may contain input.
    status.errorCode = error instanceof LocalInferenceError ? error.code : "LOCAL_OPERATION_FAILED";
    try { atomicWrite(statusPath, JSON.stringify(status, null, 2) + "\n"); } catch { /* Preserve original error. */ }
    throw error;
  } finally {
    control.dispose();
    release();
  }
}
