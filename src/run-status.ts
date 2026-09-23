import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { atomicJson, safePath } from "./review-evidence.js";
import { RUN_ID_PATTERN } from "./run-storage.js";
import { assertResumable } from "./resume-guard.js";
import { isWebProvider, assertWebTarget } from "./providers/web-config.js";
import { sendToWebChat, type ChatGptModelSelection } from "./providers/chatgpt-web.js";
import { openLoginBrowser } from "./browser-commands.js";
import { browserSessions } from "./providers/browser-sessions.js";
import { profileOwnerPid } from "./providers/browser-runtime.js";

function resolveRun(repository: string, runId?: string) {
  const latest = safePath(repository, ".giviloop/latest-run-id");
  if (!runId && !existsSync(latest)) return undefined;
  const id = runId ?? readFileSync(latest, "utf8").trim();
  if (!RUN_ID_PATTERN.test(id)) throw new Error("Invalid GiviLoop run id.");
  const directory = safePath(repository, `.giviloop/runs/${id}`);
  if (!existsSync(directory)) throw new Error("GiviLoop run not found.");
  const file = (name: string) => safePath(repository, `.giviloop/runs/${id}/${name}`);
  const records = ["browser-status.json", "local-status.json"].filter(n => existsSync(file(n))).map(name => {
    const status = JSON.parse(readFileSync(file(name), "utf8"));
    if (!Number.isFinite(Date.parse(status.startedAt))) throw new Error("Invalid run status timestamp; inspect saved status before proceeding.");
    return { name, status };
  }).sort((a, b) => Date.parse(b.status.startedAt) - Date.parse(a.status.startedAt));
  if (records.length > 1 && records[0].status.startedAt === records[1].status.startedAt) throw new Error("Ambiguous run status. Inspect the saved status files.");
  return { id, directory, file, current: records[0] };
}
export function runStatus(repository: string, runId?: string) {
  const run = resolveRun(repository, runId);
  if (!run) return { state: "no-review", nextStep: "Use givi review to start, or givi ask to prepare without sending." };
  const status = run.current?.status;
  const responseExists = existsSync(run.file("external-review-response.md"));
  const locked = existsSync(run.file("review.lock"));
  let active = false;
  if (locked) {
    try { const pid = JSON.parse(readFileSync(run.file("review.lock"), "utf8")).pid; if (Number.isSafeInteger(pid) && pid > 0) { process.kill(pid, 0); active = true; } }
    catch (error) { active = (error as NodeJS.ErrnoException).code === "EPERM"; }
  }
  const requestPath = run.file("external-review-request.md");
  const requestChanged = status?.requestSha256 && existsSync(requestPath) ? createHash("sha256").update(readFileSync(requestPath)).digest("hex") !== status.requestSha256 : false;
  const state = status?.outcome === "running" && !active ? "interrupted" : status?.outcome ?? (responseExists ? "response-saved" : "prepared");
  const resumable = state === "needs-attention" && status?.submitted === false && !locked && !requestChanged;
  return { runId: run.id, state, phase: status?.phase, provider: status?.provider, submitted: status?.submitted ?? "not recorded", responseAvailable: responseExists, responsePath: responseExists ? run.file("external-review-response.md") : undefined, profile: status?.profile, locked, active, requestChanged: Boolean(requestChanged), resumable, cancellable: active && status?.outcome === "running" && typeof status?.controlToken === "string", errorCode: status?.errorCode,
    nextStep: requestChanged ? "The saved request changed; prepare a new review."
      : state === "needs-attention" ? "Run givi open to finish login/setup, quit that Chrome, then givi resume. Uploads require givi resume --foreground."
      : state === "running" ? "Review running. Use givi cancel to request cancellation."
      : state === "interrupted" || locked && !active ? "Worker stopped. Inspect saved status and the stale review.lock before removing it; do not blindly resend."
      : state === "completed" || state === "response-saved" ? "Read the saved response and independently verify findings."
      : status?.submitted === true || status?.submitted === "unknown" ? "The request may already be on the website. Inspect it before making another request; resume will not resend."
      : "Use givi send for a prepared request. Inspect errors before retrying." };
}
export function cancelRun(repository: string, id?: string) {
  const report = runStatus(repository, id);
  if (!report.cancellable) throw new Error("No active cancellable worker for this run. No process was signalled.");
  const run = resolveRun(repository, report.runId)!;
  atomicJson(run.file("review-control.json"), { action: "cancel", token: run.current.status.controlToken, at: new Date().toISOString() });
  return { runId: run.id, cancellationRequested: true, nextStep: "Check givi status for the final result. Cancellation does not retract an already submitted prompt." };
}
export async function openRun(repository: string, id?: string) {
  const run = resolveRun(repository, id);
  if (!run?.current || !isWebProvider(run.current.status.provider)) throw new Error("No browser review selected. Use givi browser login --provider NAME.");
  if (existsSync(run.file("review.lock"))) throw new Error("Review is busy. Cancel it and wait for completion before opening its profile.");
  await browserSessions.closeIdle(run.current.status.profile);
  if (profileOwnerPid(run.current.status.profile)) throw new Error("The dedicated browser is still open. Ask your MCP agent to call givi_release_browser_sessions, or wait for its 60-second idle close, before opening it.");
  const profile = await openLoginBrowser(run.current.status.profile, run.current.status.provider);
  return { runId: run.id, profile, nextStep: "Complete login/setup in Chrome, quit that Chrome normally, then givi resume. This command sends no prompt." };
}
export async function resumeRun(repository: string, id?: string, foreground = false, signal?: AbortSignal) {
  const run = resolveRun(repository, id);
  if (!run?.current || run.current.name !== "browser-status.json") throw new Error("No paused browser review to resume.");
  if (existsSync(run.file("review.lock"))) throw new Error("Review is busy; wait for its writer to stop before resuming.");
  const status = run.current.status;
  const requestPath = run.file("external-review-request.md");
  assertResumable(run.file("browser-status.json"), createHash("sha256").update(readFileSync(requestPath)).digest("hex"));
  if (!isWebProvider(status.provider)) throw new Error("Invalid saved provider.");
  const metadata = JSON.parse(readFileSync(run.file("metadata.json"), "utf8"));
  assertWebTarget(metadata.targetProvider, status.provider);
  const attachmentPaths: string[] = [];
  if (metadata.mode === "source-archive") {
    const archive = run.file("source-context.zip");
    if (typeof metadata.archive?.sha256 !== "string" || createHash("sha256").update(readFileSync(archive)).digest("hex") !== metadata.archive.sha256) throw new Error("Archive changed or checksum missing. Prepare a new review.");
    attachmentPaths.push(archive);
  }
  return sendToWebChat({ repositoryPath: repository, webProvider: status.provider, requestPath, responsePath: run.file("external-review-response.md"), mode: "auto", background: !foreground, userDataDir: status.profile, model: status.model, modelSelection: status.modelSelection as ChatGptModelSelection | undefined, attachmentPaths, signal, resumeOnly: true });
}
