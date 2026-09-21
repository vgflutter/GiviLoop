import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fixture } from "./helpers.mjs";

function ok(result) {
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}

for (const [provider, url] of [["chatgpt-chat", "https://chatgpt.com/"], ["claude-chat", "https://claude.ai/new"]]) {
  test(`assisted ${provider} flow preserves prompt, provider and Unicode response`, t => {
    const f = fixture(t);
    writeFileSync(path.join(f.repo, "source.txt"), "Repository context: café\n");
    ok(f.cli("ask", ["--question", "Review this source", "--file", "source.txt", "--target-provider", provider]));
    const run = f.latest();
    ok(f.cli("copy", ["--open"]));
    assert.equal(readFileSync(f.clipboard, "utf8"), readFileSync(run.request, "utf8"));
    assert.match(readFileSync(f.clipboard, "utf8"), /Repository context: café/);
    assert.equal(f.osCalls().filter(call => call.action === "open").length, 1);
    assert.ok(f.osCalls().find(call => call.action === "open").args.includes(url));
    const answer = "Review: perché questo ramo fallisce?\n\n```ts\nthrow new Error('è');\n```";
    writeFileSync(f.clipboard, answer);
    ok(f.cli("ingest"));
    const saved = readFileSync(run.response, "utf8");
    assert.ok(saved.includes(`- Provider: ${provider}`));
    assert.ok(saved.includes(answer));
    assert.equal(saved, readFileSync(path.join(f.repo, ".giviloop/inbox/external-review-response.md"), "utf8"));
  });
}

test("copy is local unless --open is present; browser failure preserves the copied prompt", t => {
  const f = fixture(t);
  ok(f.cli("ask", ["--question", "Review"]));
  ok(f.cli("copy"));
  assert.equal(f.osCalls().some(call => call.action === "open"), false);
  const result = f.cli("copy", ["--open"], { GIVILOOP_TEST_OPEN_FAIL: "1" });
  ok(result);
  assert.match(result.stderr, /prompt is copied.*Open https:/);
  assert.equal(readFileSync(f.clipboard, "utf8"), readFileSync(f.latest().request, "utf8"));
});

test("empty clipboard never replaces an existing response", t => {
  const f = fixture(t);
  ok(f.cli("ask", ["--question", "Review"]));
  writeFileSync(f.clipboard, "Original review");
  ok(f.cli("ingest"));
  const before = readFileSync(f.latest().response, "utf8");
  writeFileSync(f.clipboard, " \n\t");
  const result = f.cli("ingest");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Clipboard is empty/);
  assert.equal(readFileSync(f.latest().response, "utf8"), before);
});

test("invalid latest run is rejected before reading clipboard or changing inbox", t => {
  const f = fixture(t);
  ok(f.cli("ask", ["--question", "Review"]));
  const inbox = path.join(f.repo, ".giviloop/inbox/external-review-response.md");
  writeFileSync(inbox, "Previous response");
  writeFileSync(f.clipboard, "New response");
  writeFileSync(path.join(f.repo, ".giviloop/latest-run-id"), "../../outside");
  const result = f.cli("ingest");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid GiviLoop run id/);
  assert.equal(readFileSync(inbox, "utf8"), "Previous response");
  assert.equal(f.osCalls().some(call => call.action === "read"), false);
});

test("explicit run selection keeps a delayed response attached to its original request", t => {
  const f = fixture(t);
  ok(f.cli("ask", ["--question", "First", "--target-provider", "claude-chat"]));
  const first = f.latest();
  ok(f.cli("ask", ["--question", "Second"]));
  const second = f.latest();
  ok(f.cli("copy", ["--run-id", first.id, "--open"]));
  assert.equal(readFileSync(f.clipboard, "utf8"), readFileSync(first.request, "utf8"));
  assert.ok(f.osCalls().find(call => call.action === "open").args.includes("https://claude.ai/new"));
  writeFileSync(f.clipboard, "Response to first");
  ok(f.cli("ingest", ["--run-id", first.id]));
  assert.match(readFileSync(first.response, "utf8"), /Response to first/);
  assert.equal(existsSync(second.response), false);
  assert.equal(f.latest().id, second.id);
});

test("an explicitly requested missing or malformed run cannot fall back to latest", t => {
  const f = fixture(t);
  ok(f.cli("ask", ["--question", "Review"]));
  writeFileSync(f.clipboard, "Untouched");
  for (const id of ["../../outside", "2026-01-01T00-00-00-000Z-12345678"]) {
    for (const command of ["copy", "ingest", "send"]) {
      const result = f.cli(command, ["--run-id", id]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Invalid GiviLoop run id|run not found/);
    }
  }
  assert.deepEqual(f.osCalls(), []);
  assert.equal(readFileSync(f.clipboard, "utf8"), "Untouched");
});

test("copy never substitutes a legacy prompt when a selected run's request is missing", t => {
  const f = fixture(t, { git: true });
  ok(f.cli("prepare", ["--goal", "Older review"]));
  ok(f.cli("ask", ["--question", "Selected review"]));
  const run = f.latest();
  rmSync(run.request);
  const result = f.cli("copy", ["--run-id", run.id]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Request file not found for run/);
  assert.deepEqual(f.osCalls(), []);
});
