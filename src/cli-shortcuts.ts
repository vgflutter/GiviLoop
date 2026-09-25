import { parseArgs } from "node:util";

/** Opinion is an explicit send; ask retains its prepare-only meaning. */
export function opinionArgs(args: string[]): string[] {
  const strings = ["repo", "repositoryPath", "send", "target-provider", "model", "base-url",
    "browser-profile", "mode", "navigation-timeout-ms", "verification-wait-ms", "max-wait-ms",
    "response-stable-ms", "max-file-size-bytes", "max-total-package-bytes", "max-output-tokens",
    "context-tokens", "reasoning"];
  const options: Record<string, { type: "string" | "boolean"; short?: string; multiple?: boolean }> = {};
  for (const name of strings) options[name] = { type: "string" };
  for (const name of ["background", "foreground", "headless", "require-model"]) options[name] = { type: "boolean" };
  options.file = { type: "string", short: "f", multiple: true };
  options.question = { type: "string", short: "q", multiple: true };
  const parsed = parseArgs({ args, options, allowPositionals: true, tokens: true });
  const questions = parsed.values.question as string[] | undefined;
  if (parsed.positionals.length + (questions?.length ?? 0) !== 1) {
    throw new Error('Use one quoted question: givi opinion "Your question" [-f path].');
  }
  const question = parsed.positionals[0] ?? questions![0];
  if (!question.trim()) throw new Error("The opinion question must not be empty.");
  // Canonicalize short/inline forms too: -fpath must attach the same file as
  // -f path, rather than being accepted here and ignored by the shared CLI.
  const normalized = parsed.tokens.flatMap(token => token.kind === "option"
    ? [token.value === undefined ? `--${token.name}` : `--${token.name}=${token.value}`] : []);
  return parsed.positionals.length ? [...normalized, `--question=${question}`] : normalized;
}
