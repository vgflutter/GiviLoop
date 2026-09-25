import { normalizeCliArgs } from "./cli-interface.js";

/** Retained for callers of the original shortcut normalizer. */
export function opinionArgs(args: string[]): string[] {
  return normalizeCliArgs(["opinion", ...args]).slice(1);
}
