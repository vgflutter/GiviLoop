import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { atomicJson, safePath } from "./review-evidence.js";
import { isWebProvider, type WebProvider } from "./providers/web-config.js";
import { isLocalProvider } from "./providers/local-types.js";

export type Preferences = { schemaVersion: 1; provider: string; background: boolean; model?: string; baseUrl?: string; browserProfile?: string };
export function readPreferences(repository: string): Preferences | undefined {
  const file = safePath(repository, ".giviloop/preferences.json");
  if (!existsSync(file)) return undefined;
  const p = JSON.parse(readFileSync(file, "utf8")) as Preferences;
  if (p.schemaVersion !== 1 || (!isWebProvider(p.provider) && !isLocalProvider(p.provider) && p.provider !== "manual") || typeof p.background !== "boolean") throw new Error("Invalid GiviLoop preferences. Correct or rename .giviloop/preferences.json, then run givi setup.");
  for (const key of ["model", "baseUrl", "browserProfile"] as const) if (p[key] !== undefined && (typeof p[key] !== "string" || !p[key]!.trim())) throw new Error(`Invalid preference: ${key}`);
  if (p.baseUrl && !isLocalProvider(p.provider)) throw new Error("baseUrl requires a local provider.");
  if (p.browserProfile && (!isWebProvider(p.provider) || !path.isAbsolute(p.browserProfile))) throw new Error("browserProfile must be an absolute path for a web provider.");
  if (p.model && !isLocalProvider(p.provider) && p.provider !== "chatgpt-web") throw new Error("Model selection is supported only for local runtimes and ChatGPT.");
  return p;
}
export function savePreferences(repository: string, preferences: Preferences): void {
  mkdirSync(safePath(repository, ".giviloop"), { recursive: true });
  atomicJson(safePath(repository, ".giviloop/preferences.json"), preferences);
}
export function webDefaults(repository: string, provider?: WebProvider) {
  const preferences = readPreferences(repository);
  const selected = provider ?? (isWebProvider(preferences?.provider) ? preferences.provider : undefined) ?? "chatgpt-web";
  return { provider: selected, ...(preferences?.provider === selected ? preferences : {}), background: preferences?.background ?? true } as { provider: WebProvider; background: boolean; model?: string; browserProfile?: string };
}
