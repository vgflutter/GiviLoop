import { parseArgs } from "node:util";
import { TARGET_PROVIDERS } from "./providers/web-config.js";

type Spec = { summary: string; usage: string; values?: string; flags?: string; positional?: string; actions?: string[]; defaultAction?: string };
const delivery = "send model base-url browser-profile mode navigation-timeout-ms verification-wait-ms max-wait-ms response-stable-ms max-output-tokens context-tokens reasoning";
const visibility = "background foreground headless require-model";
const context = "target-provider max-file-size-bytes max-total-package-bytes";
const connection = "provider model base-url browser-profile";

/** The same command catalogue drives validation and command-specific help. */
export const commandSpecs: Record<string, Spec> = {
  setup: { summary: "Save project preferences and show setup instructions.", usage: "setup [--provider NAME] [--non-interactive]", values: connection, flags: "non-interactive check login demo foreground background" },
  review: { summary: "Send Git changes, or selected files, to the saved reviewer.", usage: 'review ["Review goal"] [-f PATH ...]', values: `${delivery} ${context} provider goal question file`, flags: visibility, positional: "goal" },
  opinion: { summary: "Send a question and only explicitly selected files.", usage: 'opinion "Question" [-f PATH ...]', values: `${delivery} ${context} provider question file`, flags: visibility, positional: "question" },
  ask: { summary: "Prepare a question without sending; --send NAME explicitly sends it.", usage: 'ask "Question" [-f PATH ...] [--send NAME]', values: `${delivery} ${context} provider question file`, flags: visibility, positional: "question" },
  prepare: { summary: "Prepare current Git changes without sending.", usage: 'prepare ["Review goal"]', values: `${context} provider goal`, positional: "goal" },
  archive: { summary: "Prepare a source ZIP; --send NAME explicitly sends it. Web uploads need --foreground.", usage: 'archive ["Review goal"] [--send chatgpt-web --foreground]', values: `${delivery} provider target-provider goal max-archive-file-size-bytes max-archive-bytes`, flags: `${visibility} no-untracked`, positional: "goal" },
  send: { summary: "Send an existing request using saved preferences. Defaults to the latest run.", usage: "send [RUN_ID] [--provider NAME]", values: `${delivery} provider target-provider run-id`, flags: visibility, positional: "run-id" },
  answer: { summary: "Print a completed answer without sending or opening Chrome.", usage: "answer [RUN_ID]", values: "run-id", positional: "run-id" },
  status: { summary: "Show run progress and the next action without opening Chrome.", usage: "status [RUN_ID] [--json]", values: "run-id", flags: "json", positional: "run-id" },
  open: { summary: "Open the selected run's browser visibly for login/setup; sends nothing. Close Chrome before resume.", usage: "open [RUN_ID]", values: "run-id", positional: "run-id" },
  resume: { summary: "Continue an unchanged needs-attention run proven unsent; uncertain submissions cannot be resumed.", usage: "resume [RUN_ID] [--foreground]", values: "run-id", flags: "foreground", positional: "run-id" },
  cancel: { summary: "Request cancellation of an active run; cannot retract a submitted prompt.", usage: "cancel [RUN_ID]", values: "run-id", positional: "run-id" },
  copy: { summary: "Copy a prepared request to the clipboard. --open visibly opens the regular browser.", usage: "copy [RUN_ID] [--open]", values: "run-id provider target-provider", flags: "open", positional: "run-id" },
  ingest: { summary: "Save the clipboard answer into a run; then use givi answer.", usage: "ingest [RUN_ID]", values: "run-id provider target-provider", positional: "run-id" },
  report: { summary: "Save a local findings report. --stdout prints without saving; --json returns metadata and Markdown.", usage: "report [RUN_ID] [--stdout | --json]", values: "run-id", flags: "stdout json", positional: "run-id" },
  models: { summary: "List models from the saved local runtime; --provider overrides it.", usage: "models [--provider ollama|dwarfstar|llama-cpp|lmstudio|mlx]", values: "provider base-url" },
  doctor: { summary: "Check the saved local runtime or Chrome installation/profile without opening a browser.", usage: "doctor [--provider NAME]", values: "provider base-url browser-profile" },
  browser: { summary: "login opens Chrome visibly; check tests access without sending. Both reuse saved settings.", usage: "browser login|check [--provider NAME]", values: "provider browser-profile navigation-timeout-ms verification-wait-ms", flags: "background foreground headless", actions: ["login", "check"] },
  demo: { summary: "Try the bundled public example. --offline sends nothing; --finish completes a resumed demo without resending.", usage: "demo [--offline | --finish]", values: connection, flags: "offline finish foreground json" },
  findings: { summary: "List findings by default. add/update require an explicit --run-id. Confirmed/dismissed decisions need files, reason and evidence; no tests are executed.", usage: "findings [list|add|update] [--run-id ID]", values: "run-id id title claim status reason evidence file", flags: "json", actions: ["list", "add", "update"], defaultAction: "list" },
  recheck: { summary: "Prepare fresh context for a finding without sending it.", usage: "recheck FINDING_ID [--run-id ID] [-f PATH ...]", values: "finding-id run-id file", positional: "finding-id" },
  "auto-review": { summary: "Show status by default. enable/disable explicitly change task-end review integration; run sends selected context. acknowledge never resends.", usage: "auto-review [status|enable|disable|run|acknowledge]", values: "task-id checks file run-id client", actions: ["status", "enable", "disable", "run", "acknowledge"], defaultAction: "status" },
};

const aliases: Record<string, string[]> = { login: ["browser", "login"], check: ["browser", "check"] };
const words = (text = "") => text.split(" ").filter(Boolean);

export function commandHelp(name: string): string {
  const alias = Object.hasOwn(aliases, name) ? aliases[name] : undefined;
  const canonical = alias?.[0] ?? name;
  let spec = Object.hasOwn(commandSpecs, canonical) ? commandSpecs[canonical] : undefined;
  if (!spec) throw new Error(`Unknown command: ${name}. Run givi help.`);
  if (name === "login") spec = { ...spec, summary: "Open the saved dedicated Chrome profile visibly for sign-in. Sends nothing; close Chrome before sending.", values: "provider browser-profile", flags: undefined };
  if (name === "check") spec = { ...spec, summary: "Check browser access with saved preferences without sending a prompt. Uses background mode unless configured otherwise." };
  const usage = alias ? `${name} [--provider NAME]` : spec.usage;
  return `Usage: givi ${usage}\n\n${spec.summary}\n\nOptions:\n  --repo PATH  Project directory (default: current directory).\n${words(spec.values).map(key => `  --${key} ${key === "file" ? "PATH (repeatable; -f)" : key === "question" ? "TEXT (-q)" : "VALUE"}`).join("\n")}\n${words(spec.flags).map(key => `  --${key}`).join("\n")}\n  -h, --help\n\nPositional forms also accept their named options. Saved-run commands default to the latest run.\nUse givi help --all for provider names and detailed option meanings.\n`;
}

/** Validate before preferences, filesystem writes, clipboard use or browser launch. */
export function normalizeCliArgs(original: string[]): string[] {
  const expanded = Object.hasOwn(aliases, original[0]) ? [...aliases[original[0]], ...original.slice(1)] : original;
  const [command, ...args] = expanded;
  const spec = Object.hasOwn(commandSpecs, command) ? commandSpecs[command] : undefined;
  if (!spec) throw new Error(`Unknown command: ${command}. Run givi help for available commands.`);
  const options: Record<string, { type: "string" | "boolean"; short?: string; multiple?: boolean }> = {};
  for (const name of ["repo", "repositoryPath", ...words(spec.values)]) options[name] = { type: "string", multiple: true };
  for (const name of words(spec.flags)) options[name] = { type: "boolean", multiple: true };
  if (options.file) options.file.short = "f";
  if (options.question) options.question.short = "q";
  options.help = { type: "boolean", short: "h" };
  const parsed = parseArgs({ args, options, tokens: true, allowPositionals: true });
  if (parsed.values.help) return [command, "--help"];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const token of parsed.tokens) {
    if (token.kind !== "option") continue;
    let name = token.name === "repositoryPath" ? "repo" : token.name;
    if (["review", "opinion", "send"].includes(command) && name === "provider") {
      // Retain the historical --provider *-chat prompt-target spelling.
      name = (TARGET_PROVIDERS as readonly string[]).includes(token.value ?? "") ? "target-provider" : "send";
    }
    if (seen.has(name) && !["file", "evidence"].includes(name)) throw new Error(`Repeated option: --${name}`);
    seen.add(name);
    if (token.value !== undefined && !token.value.trim()) throw new Error(`Missing value for --${name}`);
    normalized.push(token.value === undefined ? `--${name}` : `--${name}=${token.value}`);
  }
  const positions = parsed.positionals;
  if (spec.actions) {
    const action = positions[0] ?? spec.defaultAction;
    if (positions.length > 1 || !action || !spec.actions.includes(action)) throw new Error(`Usage: givi ${spec.usage}`);
    if (command === "browser" && action === "login") {
      for (const key of seen) if (!["repo", "provider", "browser-profile"].includes(key)) throw new Error(`--${key} is not supported by login, which explicitly opens a visible browser.`);
    }
    normalized.unshift(action);
  } else if (positions.length) {
    if (!spec.positional || positions.length !== 1 || seen.has(spec.positional) || !positions[0].trim()) throw new Error(`Usage: givi ${spec.usage}. Supply one value, quoted if it contains spaces.`);
    normalized.push(`--${spec.positional}=${positions[0]}`);
  }
  if (command === "opinion" && !normalized.some(a => a.startsWith("--question="))) throw new Error(`Usage: givi ${spec.usage}`);
  if (seen.has("foreground") && (seen.has("background") || seen.has("headless")) || seen.has("background") && seen.has("headless")) throw new Error("Choose only one of --background, --foreground or --headless.");
  return [command, ...normalized];
}
