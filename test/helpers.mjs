import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const distDir = process.env.GIVILOOP_TEST_DIST_DIR ?? path.join(repoRoot, "dist");
export const cliPath = path.join(distDir, "cli.js");
export const bridgePath = new URL("./fixtures/os-bridge.mjs", import.meta.url).href;

export function fixture(t, { git = false } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "giviloop-flow-"));
  const repo = path.join(root, "repo with spaces è");
  mkdirSync(repo);
  // Windows may retain a transient file handle briefly after a child exits.
  // Bound retries; a profile still owned by a process must still fail cleanup.
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const clipboard = path.join(root, "clipboard.txt");
  const calls = path.join(root, "os-calls.jsonl");
  writeFileSync(clipboard, "");
  writeFileSync(calls, "");
  const env = {
    ...process.env,
    GIVILOOP_TEST_CLIPBOARD: clipboard,
    GIVILOOP_TEST_OS_CALLS: calls,
    GIVILOOP_ALLOWED_REPOSITORIES: repo,
  };
  if (git) {
    execFileSync("git", ["init", repo], { stdio: "ignore" });
    execFileSync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", repo, "config", "user.name", "GiviLoop test"]);
    writeFileSync(path.join(repo, "source.txt"), "original\n");
    execFileSync("git", ["-C", repo, "add", "source.txt"]);
    execFileSync("git", ["-C", repo, "commit", "-m", "fixture"], { stdio: "ignore" });
  }
  return {
    root, repo, clipboard, calls, env,
    cli(command, args = [], extraEnv = {}) {
      return spawnSync(process.execPath, ["--import", bridgePath, cliPath, command, "--repo", repo, ...args], {
        encoding: "utf8", timeout: 15000, env: { ...env, ...extraEnv },
      });
    },
    latest() {
      const id = readFileSync(path.join(repo, ".giviloop/latest-run-id"), "utf8").trim();
      const dir = path.join(repo, ".giviloop/runs", id);
      return {
        id, dir,
        request: path.join(dir, "external-review-request.md"),
        response: path.join(dir, "external-review-response.md"),
        metadata: path.join(dir, "metadata.json"),
      };
    },
    osCalls() {
      return readFileSync(calls, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line));
    },
  };
}
