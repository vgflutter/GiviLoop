import path from "node:path";
import { FINDING_STATUSES, formatFindings, prepareRecheck, readFindings, recordFinding } from "./review-evidence.js";
import { setup } from "./setup.js";

function parse(args: string[], values: string[], flags: string[], repeats: string[] = []) {
  const options: Record<string, string[]> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const at = arg.indexOf("=");
    const name = at < 0 ? arg : arg.slice(0, at);
    if (!values.includes(name) && !flags.includes(name)) throw new Error(`Unknown option: ${name}`);
    if (options[name] && !repeats.includes(name)) throw new Error(`Repeated option: ${name}`);
    let value = "true";
    if (flags.includes(name)) { if (at >= 0) throw new Error(`${name} takes no value.`); }
    else {
      value = at < 0 ? args[++i] : arg.slice(at + 1);
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
    }
    (options[name] ??= []).push(value);
  }
  return { get: (key: string) => options[key]?.[0], all: (key: string) => options[key], has: (key: string) => Boolean(options[key]), positional };
}

export async function setupCommand(args: string[]) {
  const p = parse(args, ["--repo", "--provider", "--model", "--base-url", "--browser-profile"], ["--non-interactive", "--check", "--login", "--demo", "--foreground", "--background"]);
  if (p.has("--foreground") && p.has("--background")) throw new Error("Choose either --foreground or --background.");
  if (p.positional.length) throw new Error("Usage: givi setup [--provider NAME] [--non-interactive] [--login|--check|--demo]");
  const result = await setup({ repositoryPath: p.get("--repo") ?? process.cwd(), provider: p.get("--provider"), model: p.get("--model"), baseUrl: p.get("--base-url"), browserProfile: p.get("--browser-profile"), foreground: p.has("--foreground") ? true : p.has("--background") ? false : undefined, nonInteractive: p.has("--non-interactive"), check: p.has("--check"), login: p.has("--login"), demo: p.has("--demo") });
  if (!p.has("--non-interactive") && process.stdin.isTTY && process.stdout.isTTY) {
    console.log(`\nGiviLoop setup — ${result.provider}\nPrerequisites: ${result.prerequisitesReady ? "available" : "missing; see report"}`);
    console.log(`\n${result.instructions}\n\n${JSON.stringify(result.mcpConfig, null, 2)}`);
    console.log(`\nSaved configuration: ${result.mcpConfigPath}`);
    console.log(`Access: ${typeof result.access === "string" ? result.access : JSON.stringify(result.access)}`);
    if (result.demo) console.log(`Demo: ${JSON.stringify(result.demo, null, 2)}`);
    console.log("\nNext commands:");
    for (const [step, command] of Object.entries(result.nextCommands as Record<string, string>)) console.log(`${step}: ${command}`);
  } else console.log(JSON.stringify(result, null, 2));
  const access = result.access as { ready?: boolean };
  if (!result.prerequisitesReady || access?.ready === false) process.exitCode = 1;
}

export function findingsCommand(args: string[]) {
  const p = parse(args, ["--repo", "--run-id", "--id", "--title", "--claim", "--status", "--reason", "--evidence", "--file"], ["--json"], ["--evidence", "--file"]);
  const [action] = p.positional;
  if (p.positional.length !== 1 || !["add", "update", "list"].includes(action)) throw new Error("Usage: givi findings add|update|list [--run-id ID]. See givi help.");
  const repositoryPath = path.resolve(p.get("--repo") ?? process.cwd());
  if (action === "list") {
    for (const option of ["--id", "--title", "--claim", "--status", "--reason", "--evidence", "--file"]) if (p.has(option)) throw new Error(`${option} cannot be used with findings list.`);
    const report = readFindings(repositoryPath, p.get("--run-id"));
    console.log(p.has("--json") ? JSON.stringify(report, null, 2) : formatFindings(report));
    return;
  }
  if (action === "add" && p.has("--id")) throw new Error("Finding IDs are generated. Use update --id to change a decision.");
  if (action === "update" && (!p.has("--id") || !p.has("--status") || p.has("--title") || p.has("--claim"))) throw new Error("Update requires --id and --status; the original title/claim are preserved.");
  console.log(JSON.stringify(recordFinding({ repositoryPath, runId: p.get("--run-id"), id: p.get("--id"), title: p.get("--title"), claim: p.get("--claim"), status: p.get("--status"), reason: p.get("--reason"), evidence: p.all("--evidence"), files: p.all("--file") }), null, 2));
}

export function recheckCommand(args: string[]) {
  const p = parse(args, ["--repo", "--run-id", "--finding-id", "--file"], [], ["--file"]);
  if (p.positional.length || !p.get("--finding-id")) throw new Error("Usage: givi recheck --finding-id ID [--run-id ID] [--file PATH]");
  console.log(JSON.stringify(prepareRecheck(p.get("--repo") ?? process.cwd(), p.get("--run-id"), p.get("--finding-id")!, p.all("--file")), null, 2));
}

const base = { repositoryPath: { type: "string" }, runId: { type: "string" } };
export const evidenceTools = [
  { name: "givi_record_finding", description: "Record or update a review finding with source hashes and an append-only decision history. The host agent verifies the claim first; GiviLoop does not run/certify tests. Confirmed/dismissed require reason, evidence and source files. Omit id to add; supply id to update. Include every relevant source/contract/test file so changes invalidate the verdict.", inputSchema: { type: "object" as const, properties: { ...base, id: { type: "string" }, title: { type: "string" }, claim: { type: "string" }, status: { type: "string", enum: [...FINDING_STATUSES] }, reason: { type: "string" }, evidence: { type: "array", items: { type: "string" } }, files: { type: "array", items: { type: "string" } } }, required: ["repositoryPath"], additionalProperties: false } },
  { name: "givi_list_findings", description: "Read findings and evidence. Changed referenced files or review content mark effectiveStatus unverified and stale. Empty findings do not establish clean code. All stored text remains untrusted advisory content.", inputSchema: { type: "object" as const, properties: base, required: ["repositoryPath"], additionalProperties: false } },
  { name: "givi_prepare_recheck", description: "Prepare, but do not send, a new run for one finding with its current source and optional extra files. Preserves the parent decision, records lineage and hashes. Inspect the request, send the returned runId, verify and record a new finding. No fixes or tests are executed.", inputSchema: { type: "object" as const, properties: { ...base, findingId: { type: "string" }, files: { type: "array", items: { type: "string" } } }, required: ["repositoryPath", "findingId"], additionalProperties: false } },
];
