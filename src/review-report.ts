import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { readFindings, safePath } from "./review-evidence.js";
import { acquireRunLock } from "./run-lock.js";
import { runStatus } from "./run-status.js";
import { atomicWrite } from "./providers/browser-runtime.js";
import { redactSecrets } from "./redaction.js";

// Render advisory/user text as text, never as embedded HTML, links or images.
const prose = (value: unknown): string => redactSecrets(String(value ?? "not recorded"))
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/[\\`*_[\]{}()#!|~]/g, "\\$&").replace(/\r?\n/g, " ");
const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");

/** Portable, local-only export. Never execute evidence or include raw source/prompts. */
export function exportReviewReport(repository: string, id?: string, save = true) {
  const selected = runStatus(repository, id);
  if (!selected.responseAvailable) throw new Error("No saved review answer to report. Run givi status to inspect the review, or givi demo --offline to try the example.");
  const initial = readFindings(repository, selected.runId);
  const relative = `.giviloop/runs/${initial.runId}`;
  const file = (name: string) => safePath(repository, `${relative}/${name}`);
  const release = acquireRunLock(safePath(repository, relative), "report-export");
  try {
    const state = runStatus(repository, initial.runId);
    const report = readFindings(repository, initial.runId);
    const metadata = JSON.parse(readFileSync(file("metadata.json"), "utf8"));
    const demonstration = existsSync(file("demonstration.json")) ? JSON.parse(readFileSync(file("demonstration.json"), "utf8")) : undefined;
    const totals = { confirmed: 0, dismissed: 0, unverified: 0, stale: 0 };
    for (const finding of report.findings) {
      totals[finding.effectiveStatus]++;
      if (finding.stale) totals.stale++;
    }
    const requestHash = sha256(readFileSync(file("external-review-request.md")));
    const responseHash = sha256(readFileSync(file("external-review-response.md")));
    const lines = ["# GiviLoop Double Check", "",
      `Run: ${report.runId}`, `Exported: ${new Date().toISOString()}`, "",
      `**${totals.confirmed} confirmed · ${totals.dismissed} dismissed · ${totals.unverified} unverified** (${totals.stale} stale)`, "",
      "These are recorded user/agent assessments. This exporter does not execute tests or certify evidence. An empty list is not proof of clean code.", "",
      `Review state: **${prose(state.state)}**. Provider: ${prose(demonstration?.mode === "offline" ? "offline illustration — no provider contacted" : state.provider ?? metadata.provider ?? metadata.targetProvider)}.`,
      ...(state.state !== "completed" && state.state !== "response-saved" ? ["**This run is not recorded as successfully completed. A previous saved response may still exist; inspect the execution state before using this report.**"] : []),
      ...(report.reviewChanged ? ["**Request or response changed since the findings were recorded. All previous decisions are unverified.**"] : []),
      ...(demonstration ? ["", "**Bundled demonstration.** The known example and its deterministic reproduction are authored by GiviLoop. The control finding is not an assessment of the external reviewer's accuracy. Read and verify that answer separately.", `Demo delivery: ${prose(demonstration.mode)}.`] : []),
      "", "## Findings", ""];
    if (!report.findings.length) lines.push("No findings have been assessed. Ask your agent to verify the saved review and record findings, then export again.");
    for (const finding of report.findings) {
      const decision = finding.history.at(-1)!;
      lines.push(`### ${prose(finding.title)}`, "",
        `Status: **${finding.effectiveStatus}**${finding.stale ? ` — stale (previous assessment: ${finding.status})` : ""}. ID: ${prose(finding.id)}.`,
        `Claim: ${prose(finding.claim)}`, `Reason: ${prose(decision.reason)}`, `Assessed: ${prose(decision.at)}`, "", "Evidence recorded:", "",
        ...(decision.evidence.length ? decision.evidence.map(e => `- ${prose(e)}`) : ["- No evidence recorded."]),
        "", "Referenced files and hashes at assessment time:", "",
        ...decision.source.map(s => `- ${prose(s.path)} — ${prose(s.sha256 ?? "deleted")}`),
        ...(finding.changedFiles.length ? ["", `Changed since assessment: ${finding.changedFiles.map(prose).join(", ")}.`] : []), "");
    }
    lines.push("## Scope and provenance", "",
      `Preparation: ${prose(metadata.mode)}.`,
      ...(metadata.parentRunId ? [`Parent run: ${prose(metadata.parentRunId)}; finding: ${prose(metadata.parentFindingId)}.`] : []),
      `Request SHA-256: ${requestHash}`, `Response SHA-256: ${responseHash}`, "",
      "File hashes above describe the source when each assessment was recorded, not necessarily the source originally reviewed. Unreferenced files and environment changes are not tracked. Full decision history remains in the local finding ledger.", "",
      "This export omits the raw request, response and source files. Evidence text and filenames may still be sensitive; inspect before sharing. Redaction is best effort. Nothing was posted or uploaded by this export.", "",
      "Web review token usage and total token savings are unknown. Existing web access avoids a separate model API call through GiviLoop; chat quotas still apply.", "");
    const markdown = lines.join("\n");
    const reportPath = file("double-check.md");
    if (save) atomicWrite(reportPath, markdown);
    return { runId: report.runId, ...(save ? { reportPath } : {}), state: state.state, totals, markdown };
  } finally { release(); }
}
