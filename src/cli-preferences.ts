import path from "node:path";
import { readPreferences } from "./preferences.js";
import { isWebProvider, targetForWeb } from "./providers/web-config.js";
import { isLocalProvider } from "./providers/local-types.js";

function option(args: string[], name: string) {
  const equal = args.find(a => a.startsWith(name + "="));
  if (equal) return equal.slice(name.length + 1);
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}
/** Saved choices never cause ask/prepare/archive to submit implicitly. */
export function configuredCliArgs(original: string[]): string[] {
  const args = [...original], command = args[0];
  if (!["review", "ask", "prepare", "archive", "send", "browser", "doctor", "models"].includes(command)) return args;
  const repository = path.resolve(option(args, "--repo") ?? option(args, "--repositoryPath") ?? process.cwd());
  // Compound review invokes prepare then send; both must resolve the same root.
  for (const key of ["--repo", "--repositoryPath"]) {
    const at = args.indexOf(key);
    if (at >= 0) args[at + 1] = repository;
    const eq = args.findIndex(a => a.startsWith(key + "="));
    if (eq >= 0) args[eq] = `${key}=${repository}`;
  }
  const p = readPreferences(repository);
  const set = (key: string, value?: string) => { if (value && option(args, key) === undefined) args.push(key, value); };
  if (command === "review" || command === "send") {
    const destination = option(args, "--send") ?? p?.provider ?? "chatgpt-web";
    if (destination === "manual") throw new Error("Manual provider selected. Use givi prepare, copy and ingest; choose --send NAME for automatic review.");
    set("--send", destination);
  }
  if (["browser", "doctor", "models"].includes(command)) {
    if (command === "browser" && p && !isWebProvider(p.provider) && !option(args, "--provider")) throw new Error("The saved provider is not a browser chat. Choose browser --provider NAME explicitly.");
    if (command === "models" && p && !isLocalProvider(p.provider) && !option(args, "--provider")) throw new Error("The saved provider is not local. Choose models --provider ollama|dwarfstar|llama-cpp|lmstudio|mlx.");
    if (p?.provider !== "manual") set("--provider", p?.provider);
  }
  const selected = option(args, "--send") ?? (["browser", "doctor", "models"].includes(command) ? option(args, "--provider") : p?.provider);
  if (p && p.provider === selected) {
    if (option(args, "--send") || ["browser", "doctor", "models"].includes(command)) {
      set("--model", p.model); set("--base-url", p.baseUrl); set("--browser-profile", p.browserProfile);
      if (isWebProvider(selected) && !p.background && !args.some(a => ["--background", "--foreground", "--headless"].includes(a))) args.push("--foreground");
    }
  }
  if (["prepare", "ask", "archive"].includes(command) && !option(args, "--send") && isWebProvider(p?.provider) && !option(args, "--provider")) set("--target-provider", targetForWeb(p.provider));
  return args;
}
