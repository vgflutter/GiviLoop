import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distDir =
  process.env.GIVILOOP_TEST_DIST_DIR ?? path.join(repoRoot, "dist");
const cliPath = path.join(distDir, "cli.js");

test("prepare omits untracked symlink content outside the repository", () => {
  const repo = createTempGitRepo();
  const outside = path.join(os.tmpdir(), `giviloop-outside-${process.pid}.txt`);

  writeFileSync(outside, "LEAKED_BY_SYMLINK\n", "utf8");
  symlinkSync(outside, path.join(repo, "outside-link.txt"));

  execFileSync(process.execPath, [
    cliPath,
    "prepare",
    "--repo",
    repo,
    "--goal",
    "symlink test",
  ]);

  const reviewPackage = readFileSync(
    path.join(repo, ".giviloop", "outbox", "review-package.md"),
    "utf8",
  );

  assert.equal(reviewPackage.includes("LEAKED_BY_SYMLINK"), false);
  assert.match(reviewPackage, /outside-link\.txt/);
  assert.match(reviewPackage, /symbolic link/);

  rmSync(repo, { recursive: true, force: true });
  rmSync(outside, { force: true });
});

test("ask omits attached symlink content outside the repository", () => {
  const repo = createTempGitRepo();
  const outside = path.join(os.tmpdir(), `giviloop-ask-outside-${process.pid}.txt`);

  writeFileSync(outside, "ASK_LEAKED_BY_SYMLINK\n", "utf8");
  symlinkSync(outside, path.join(repo, "attached-link.txt"));

  execFileSync(process.execPath, [
    cliPath,
    "ask",
    "--repo",
    repo,
    "--file",
    "attached-link.txt",
    "--question",
    "Review this file.",
  ]);

  const request = readFileSync(
    path.join(repo, ".giviloop", "outbox", "external-review-request.md"),
    "utf8",
  );

  assert.equal(request.includes("ASK_LEAKED_BY_SYMLINK"), false);
  assert.match(request, /attached-link\.txt/);
  assert.match(request, /symbolic link/);

  rmSync(repo, { recursive: true, force: true });
  rmSync(outside, { force: true });
});

test("copy rejects a malformed latest run id before touching the clipboard", () => {
  const repo = createTempGitRepo();

  execFileSync(process.execPath, [
    cliPath,
    "prepare",
    "--repo",
    repo,
    "--goal",
    "run id test",
  ]);
  writeFileSync(
    path.join(repo, ".giviloop", "latest-run-id"),
    "../../outside\n",
    "utf8",
  );

  const result = spawnSync(process.execPath, [cliPath, "copy", "--repo", repo], {
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid GiviLoop run id/);

  rmSync(repo, { recursive: true, force: true });
});

test("prepare enforces the total package content budget", () => {
  const repo = createTempGitRepo();

  writeFileSync(path.join(repo, "a.txt"), "aaaa\n", "utf8");
  writeFileSync(path.join(repo, "b.txt"), "bbbb\n", "utf8");

  execFileSync(process.execPath, [
    cliPath,
    "prepare",
    "--repo",
    repo,
    "--goal",
    "budget test",
    "--max-total-package-bytes",
    "5",
  ]);

  const reviewPackage = readFileSync(
    path.join(repo, ".giviloop", "outbox", "review-package.md"),
    "utf8",
  );

  assert.match(reviewPackage, /package content budget exhausted/);

  rmSync(repo, { recursive: true, force: true });
});

test("prepare redacts common token and secret shapes", () => {
  const repo = createTempGitRepo();

  writeFileSync(
    path.join(repo, "secrets.txt"),
    [
      '{"apiKey": "plain-json-secret"}',
      "Authorization: Bearer bearer-secret-value",
      "AWS_ACCESS_KEY_ID=AKIA1234567890ABCDEF",
      "GITHUB_TOKEN=ghp_1234567890abcdefghijklmnop",
      "OPENAI_API_KEY=sk-1234567890abcdefghijklmnop",
    ].join("\n"),
    "utf8",
  );

  execFileSync(process.execPath, [
    cliPath,
    "prepare",
    "--repo",
    repo,
    "--goal",
    "redaction test",
  ]);

  const reviewPackage = readFileSync(
    path.join(repo, ".giviloop", "outbox", "review-package.md"),
    "utf8",
  );

  assert.equal(reviewPackage.includes("plain-json-secret"), false);
  assert.equal(reviewPackage.includes("bearer-secret-value"), false);
  assert.equal(reviewPackage.includes("AKIA1234567890ABCDEF"), false);
  assert.equal(reviewPackage.includes("ghp_1234567890abcdefghijklmnop"), false);
  assert.equal(reviewPackage.includes("sk-1234567890abcdefghijklmnop"), false);
  assert.match(reviewPackage, /\[REDACTED\]/);

  rmSync(repo, { recursive: true, force: true });
});

test("send refuses repositories outside GIVILOOP_ALLOWED_REPOSITORIES", () => {
  const repo = createTempGitRepo();

  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "ask",
      "--repo",
      repo,
      "--question",
      "Review this repository.",
      "--send",
      "chatgpt-web",
      "--mode",
      "prefill",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIVILOOP_ALLOWED_REPOSITORIES: repoRoot,
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Repository is not allowed for external transfer/);

  rmSync(repo, { recursive: true, force: true });
});

test("prepare can generate a Claude manual-review prompt", () => {
  const repo = createTempGitRepo();

  execFileSync(process.execPath, [
    cliPath,
    "prepare",
    "--repo",
    repo,
    "--goal",
    "claude prompt test",
    "--target-provider",
    "claude-chat",
  ]);

  const claudePromptPath = path.join(
    repo,
    ".giviloop",
    "outbox",
    "claude-prompt.md",
  );
  const requestPath = path.join(
    repo,
    ".giviloop",
    "outbox",
    "external-review-request.md",
  );
  const metadataPath = path.join(
    repo,
    ".giviloop",
    "runs",
    readFileSync(path.join(repo, ".giviloop", "latest-run-id"), "utf8").trim(),
    "metadata.json",
  );

  assert.equal(existsSync(claudePromptPath), true);
  assert.match(readFileSync(claudePromptPath, "utf8"), /You are Claude/);
  assert.match(readFileSync(requestPath, "utf8"), /You are Claude/);
  assert.equal(
    JSON.parse(readFileSync(metadataPath, "utf8")).targetProvider,
    "claude-chat",
  );

  rmSync(repo, { recursive: true, force: true });
});

function createTempGitRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), "giviloop-test-"));

  execFileSync("git", ["init"], { cwd: repo, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: repo,
  });
  execFileSync("git", ["config", "user.name", "Test User"], { cwd: repo });

  writeFileSync(path.join(repo, "tracked.txt"), "tracked\n", "utf8");
  execFileSync("git", ["add", "tracked.txt"], { cwd: repo });
  execFileSync("git", ["commit", "-m", "init"], {
    cwd: repo,
    stdio: "ignore",
  });

  return repo;
}
