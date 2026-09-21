import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fixture } from "./helpers.mjs";

test("retention preserves pending and active reviews while pruning old completed ones", t => {
  const f = fixture(t, { git: true });
  const runs = path.join(f.repo, ".giviloop/runs");
  function run(index, { completed = true, active = false } = {}) {
    const id = `2026-01-01T00-00-00-${String(index).padStart(3, "0")}Z-${index.toString(16).padStart(8, "0")}`;
    const dir = path.join(runs, id);
    mkdirSync(dir, { recursive: true });
    if (completed) writeFileSync(path.join(dir, "external-review-response.md"), "Saved review");
    if (active) writeFileSync(path.join(dir, "browser-status.json"), JSON.stringify({ outcome: "running" }));
    return dir;
  }
  const pending = run(1, { completed: false });
  const active = run(2, { active: true });
  const localActive = run(0);
  writeFileSync(path.join(localActive, "local-status.json"), JSON.stringify({ outcome: "running" }));
  const locked = run(99);
  writeFileSync(path.join(locked, "review.lock"), JSON.stringify({ pid: process.pid }));
  const completed = Array.from({ length: 12 }, (_, index) => run(index + 3));
  const result = f.cli("prepare", ["--goal", "New review"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(pending), true);
  assert.equal(existsSync(active), true);
  assert.equal(existsSync(localActive), true);
  assert.equal(existsSync(locked), true);
  assert.equal(existsSync(completed[0]), false);
  assert.equal(existsSync(completed[1]), false);
  assert.equal(completed.slice(2).filter(dir => existsSync(dir)).length, 10);
});

test("doctor inspects an isolated profile without clipboard or browser operations", t => {
  const f = fixture(t);
  const profile = path.join(f.root, "dedicated chrome");
  mkdirSync(path.join(profile, "Default"), { recursive: true });
  writeFileSync(path.join(profile, "Default/Preferences"), JSON.stringify({ profile: { exit_type: "Crashed" } }));
  const executable = path.join(f.root, "chrome-stub");
  writeFileSync(executable, "fixture");
  const result = f.cli("doctor", ["--browser-profile", profile], { GIVILOOP_CHROME_PATH: executable });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.previousExit, "Crashed");
  assert.equal(report.profileBusy, false);
  assert.equal(report.profile, profile);
  assert.deepEqual(f.osCalls(), []);
  assert.equal(JSON.parse(readFileSync(path.join(profile, "Default/Preferences"), "utf8")).profile.exit_type, "Crashed");
});

test("unknown commands fail and help remains available without creating a run", t => {
  const f = fixture(t);
  const invalid = f.cli("sned");
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Unknown command/);
  const help = f.cli("ask", ["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--background/);
  assert.equal(existsSync(path.join(f.repo, ".giviloop")), false);
});
