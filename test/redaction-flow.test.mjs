import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { distDir, fixture } from "./helpers.mjs";

const code = "const token = randomUUID();\nif (record.token === token) release();\nconst config = { token: options.token };\n";
function sources(f) {
  writeFileSync(path.join(f.repo, "lock.ts"), code);
  writeFileSync(path.join(f.repo, "settings.yaml"), "password: yaml-secret-to-remove\ntoken: yaml-token-to-remove\n");
}
function verify(f) {
  const prompt = readFileSync(f.latest().request, "utf8");
  assert.ok(prompt.includes(code.trim()), "Review must retain the actual source expressions and comparisons");
  assert.equal(prompt.includes("yaml-secret-to-remove"), false);
  assert.equal(prompt.includes("yaml-token-to-remove"), false);
  assert.match(prompt, /\[REDACTED\]/);
  assert.equal(readFileSync(path.join(f.repo, "lock.ts"), "utf8"), code);
}

test("CLI ask preserves source semantics while redacting unquoted configuration values", t => {
  const f = fixture(t); sources(f);
  const result = f.cli("ask", ["--question", "Review locking", "--file", "lock.ts", "--file", "settings.yaml"]);
  assert.equal(result.status, 0, result.stderr);
  verify(f);
});

test("MCP preparation applies the same source-aware redaction as CLI", async t => {
  const f = fixture(t, { git: true }); sources(f);
  const client = new Client({ name: "giviloop-redaction-flow", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(distDir, "mcp-server.js")], env: f.env, stderr: "pipe" }));
  const result = await client.callTool({ name: "givi_prepare_from_git", arguments: { repositoryPath: f.repo, taskGoal: "Review locking" } });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  verify(f);
});
