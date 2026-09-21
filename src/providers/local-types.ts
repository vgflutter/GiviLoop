export type LocalReasoning = "off" | "on" | "low" | "medium" | "high";
export const LOCAL_PROVIDERS = ["ollama", "dwarfstar", "llama-cpp", "lmstudio", "mlx"] as const;
export type LocalProvider = typeof LOCAL_PROVIDERS[number];
export function isLocalProvider(value: unknown): value is LocalProvider {
  return typeof value === "string" && (LOCAL_PROVIDERS as readonly string[]).includes(value);
}

export type LocalReviewOptions = {
  prompt: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
  contextTokens?: number;
  reasoning?: LocalReasoning;
  signal?: AbortSignal;
};

export type LocalReviewResult = {
  responseText: string;
  model: string;
  provider: LocalProvider;
  elapsedMs: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  finishReason: string;
};

export type LocalProviderInfo = {
  provider: LocalProvider;
  baseUrl: string;
  models: string[];
};
