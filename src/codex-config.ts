import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { safePath } from "./review-evidence.js";
import { atomicWrite } from "./providers/browser-runtime.js";

const START = "# giviloop:auto-review:start";
const END = "# giviloop:auto-review:end";
export const CODEX_AUTO_TOOLS = ["givi_auto_review", "givi_read_external_review", "givi_record_finding", "givi_list_findings", "givi_export_report", "givi_status"] as const;

export function codexAutoConfig(): string {
  return [START, "[mcp_servers.giviloop]", `command = ${JSON.stringify(process.execPath)}`,
    `args = [${JSON.stringify(fileURLToPath(new URL("mcp-server.js", import.meta.url)))}]`,
    "tool_timeout_sec = 240", 'default_tools_approval_mode = "prompt"',
    ...CODEX_AUTO_TOOLS.flatMap(tool => [`[mcp_servers.giviloop.tools.${tool}]`, 'approval_mode = "approve"']), END].join("\n");
}

/** Conservative managed section: never rewrite or guess an existing server policy. */
export function configureCodexClient(repository: string, enabled: boolean) {
  const file = safePath(repository, ".codex/config.toml");
  const previous = existsSync(file) ? readFileSync(file, "utf8") : "";
  const start = previous.indexOf(START), end = previous.indexOf(END);
  if ((start < 0) !== (end < 0) || end < start || start >= 0 && (previous.indexOf(START, start + 1) >= 0 || previous.indexOf(END, end + 1) >= 0)) throw new Error("Malformed GiviLoop section in .codex/config.toml; inspect its markers before changing the client integration.");
  const outside = start < 0 ? previous : previous.slice(0, start) + previous.slice(end + END.length);
  if (enabled && /giviloop/i.test(outside)) throw new Error("An existing GiviLoop Codex configuration is not managed by this installer. Merge .giviloop/codex-auto-review.toml manually; existing permissions were not overwritten.");
  const next = start < 0 ? previous + (enabled ? `${previous && !previous.endsWith("\n") ? "\n" : ""}\n${codexAutoConfig()}\n` : "")
    : previous.slice(0, start) + (enabled ? codexAutoConfig() : "") + previous.slice(end + END.length);
  if (next !== previous) {
    mkdirSync(safePath(repository, ".codex"), { recursive: true });
    atomicWrite(file, next);
  }
  return file;
}
