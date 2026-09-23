import { existsSync, readFileSync } from "node:fs";
export function assertResumable(statusPath: string, requestHash: string): void {
  if (!existsSync(statusPath)) throw new Error("No paused browser review to resume. Use givi send for a prepared request.");
  const status = JSON.parse(readFileSync(statusPath, "utf8"));
  if (status.outcome !== "needs-attention" || status.submitted !== false) throw new Error("Resume refused: only a review paused before submission is safe to resume. Inspect givi status; completed, failed or uncertain sends are never resent by resume.");
  if (status.requestSha256 !== requestHash) throw new Error("Resume refused: the saved request changed. Prepare a new review.");
}
