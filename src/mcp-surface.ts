import { CODEX_AUTO_TOOLS } from "./codex-config.js";

export const DEFAULT_MCP_TOOLS = [...CODEX_AUTO_TOOLS, "givi_review", "givi_manage_review"] as const;

export function mcpToolProfile(args: string[]): "compact" | "full" {
  if (!args.length) return "compact";
  const value = args.length === 2 && args[0] === "--tools" ? args[1]
    : args.length === 1 && args[0].startsWith("--tools=") ? args[0].slice(8) : undefined;
  if (value !== "compact" && value !== "full") throw new Error("Usage: givi-mcp [--tools compact|full]");
  return value;
}

export const compactReviewTool = {
  name: "givi_review",
  description: "On user request, review Git changes or selected files with the repository's saved web/local reviewer. Web reviews are always windowless; attention pauses for manual CLI recovery. Sends once and returns the answer for independent verification; never applies fixes. Use question for the task contract. With runId, send only that prepared request. For automatic task completion use givi_auto_review, never this tool as its fallback. Configure the reviewer with givi setup first.",
  inputSchema: { type: "object" as const, properties: {
    repositoryPath: { type: "string" },
    question: { type: "string", description: "Concise review goal and relevant input/behavior contracts." },
    files: { type: "array", minItems: 1, items: { type: "string" }, description: "Selected source/tests/contracts. Omit to review Git changes." },
    runId: { type: "string", description: "Existing prepared request; cannot be combined with question or files." },
  }, required: ["repositoryPath"], additionalProperties: false },
};

export const compactManageTool = {
  name: "givi_manage_review",
  description: "Manage an existing review: cancel or resume an unsubmitted paused request without a browser window; never blindly resend. recheck prepares a new request for a finding without sending. models lists the saved local reviewer's models. release-browser closes only idle owned browsers. Run-specific actions require the exact runId. Login, verification and ZIP uploads require the user to run manual CLI commands. These actions are not automatically approved by the installer.",
  inputSchema: { type: "object" as const, properties: {
    action: { type: "string", enum: ["cancel", "resume", "recheck", "models", "release-browser"] },
    repositoryPath: { type: "string", description: "Required except for release-browser." },
    runId: { type: "string", description: "Required for cancel, resume and recheck." },
    findingId: { type: "string", description: "Required for recheck." },
    files: { type: "array", items: { type: "string" }, description: "Extra source/contract files for recheck only." },
  }, required: ["action"], additionalProperties: false },
};
