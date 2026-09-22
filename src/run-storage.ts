import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

export const RUN_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}$/;

// Keep pending reviews: an older request may still be waiting for a provider
// or the user. Retention applies only to completed, inactive runs.
export function pruneCompletedRuns(repositoryPath: string, keep: number): void {
  const root = path.join(repositoryPath, ".giviloop", "runs");
  if (!existsSync(root)) return;
  const completed = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && RUN_ID_PATTERN.test(entry.name))
    .map(entry => entry.name)
    .filter(id => {
      const dir = path.join(root, id);
      if (existsSync(path.join(dir, "review.lock"))) return false;
      // Evidence and recheck lineage must survive the automatic ten-run cleanup.
      // Users can remove these deliberately after exporting their assessments.
      if (existsSync(path.join(dir, "findings.json"))) return false;
      if (!existsSync(path.join(dir, "external-review-response.md"))) return false;
      for (const statusFile of ["browser-status.json", "local-status.json"]) {
        const statusPath = path.join(dir, statusFile);
        if (existsSync(statusPath)) {
          try {
            if (JSON.parse(readFileSync(statusPath, "utf8")).outcome === "running") return false;
          } catch { return false; }
        }
      }
      return true;
    }).sort().reverse();
  for (const id of completed.slice(keep)) rmSync(path.join(root, id), { recursive: true, force: true });
}
