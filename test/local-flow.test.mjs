import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { bridgePath, cliPath, distDir, fixture } from "./helpers.mjs";

const answer = "Review locale: correggere il caso vuoto. È verificabile.\nSeconda riga.";
const modelFor = provider => provider === "dwarfstar" ? "DeepSeek V4 Flash" : "local-test:latest";
const joined = result => result.content.filter(item => item.type === "text").map(item => item.text).join("\n");

async function localServer(t, provider) {
  const calls = [], state = { incomplete: false, gate: undefined, started: undefined };
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ path: request.url, body });
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/tags") return response.end(JSON.stringify({ models: [{ name: modelFor(provider) }] }));
    if (request.url === "/api/show") return response.end(JSON.stringify({ model_info: { "general.architecture": "qwen2", "qwen2.context_length": 32768 }, capabilities: ["completion", "thinking"] }));
    if (request.url === "/v1/models") return response.end(JSON.stringify({ data: [provider === "dwarfstar"
      ? { id: "deepseek-v4-flash", owned_by: "ds4.c", name: modelFor(provider), context_length: 32768 }
      : { id: modelFor(provider), object: "model", owned_by: provider === "llama-cpp" ? "llamacpp" : provider, meta: { n_ctx_train: 32768 } }] }));
    if (request.url === "/props") return response.end(JSON.stringify({ default_generation_settings: { n_ctx: 32768 }, chat_template_caps: { supports_reasoning_effort: true } }));
    if (request.url === "/api/v1/models") return response.end(JSON.stringify({ models: [{ type: "llm", format: "gguf", loaded_instances: [{ id: modelFor(provider), config: { context_length: 32768 } }] }] }));
    if (!["/api/chat", "/v1/chat/completions"].includes(request.url)) { response.statusCode = 404; return response.end("{}"); }
    state.started?.();
    if (state.gate) await state.gate;
    const finish = state.incomplete ? "length" : "stop";
    response.end(JSON.stringify(provider === "ollama" ? {
      model: modelFor(provider), done: true, done_reason: finish,
      message: { role: "assistant", content: answer, thinking: "NOT_THE_FINAL_ANSWER" },
      prompt_eval_count: 42, eval_count: 31,
    } : {
      model: provider === "dwarfstar" ? "deepseek-v4-flash" : modelFor(provider), choices: [{ message: { role: "assistant", content: answer, reasoning_content: "NOT_THE_FINAL_ANSWER" }, finish_reason: finish }],
      usage: { prompt_tokens: 42, completion_tokens: 31 },
    }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return { calls, state, url: `http://127.0.0.1:${server.address().port}` };
}

async function cli(f, command, args, onSpawn) {
  const child = spawn(process.execPath, ["--import", bridgePath, cliPath, command, "--repo", f.repo, ...args], {
    env: { ...f.env, GIVILOOP_TEST_DIST_DIR: distDir }, stdio: ["ignore", "pipe", "pipe"],
  });
  onSpawn?.(child);
  let stdout = "", stderr = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
  try {
    const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    return { code, stdout, stderr };
  } finally { clearTimeout(timeout); }
}

async function connect(t, f) {
  const client = new Client({ name: "giviloop-local-flow", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: ["--import", bridgePath, path.join(distDir, "mcp-server.js")],
    env: { ...f.env, GIVILOOP_TEST_DIST_DIR: distDir }, stderr: "pipe" }));
  return client;
}

for (const provider of ["ollama", "dwarfstar", "llama-cpp", "lmstudio", "mlx"]) {
  test(`${provider}: CLI local ask -> saved final answer/usage -> MCP read, no browser or clipboard`, async t => {
    const f = fixture(t), server = await localServer(t, provider);
    writeFileSync(path.join(f.repo, "code.ts"), "export const source = 'è';\n");
    const args = ["--send", provider, "--model", modelFor(provider), "--base-url", server.url];
    const result = await cli(f, "ask", ["--question", "Review", "--file", "code.ts", ...args]);
    assert.equal(result.code, 0, result.stderr);
    const run = f.latest();
    assert.equal(readFileSync(run.response, "utf8"), answer);
    const usage = JSON.parse(readFileSync(path.join(run.dir, "local-usage.json"), "utf8"));
    assert.equal(usage.provider, provider);
    assert.equal(usage.model, modelFor(provider));
    assert.equal(usage.inputTokens, 42);
    assert.equal(usage.outputTokens, 31);
    assert.equal(usage.responseSha256, createHash("sha256").update(answer).digest("hex"));
    assert.equal(usage.requestSha256, createHash("sha256").update(readFileSync(run.request)).digest("hex"));
    assert.ok(!JSON.stringify(usage).includes("NOT_THE_FINAL_ANSWER"));
    assert.equal(JSON.parse(readFileSync(path.join(run.dir, "local-status.json"), "utf8")).outcome, "completed");
    assert.equal(existsSync(path.join(run.dir, "review.lock")), false);
    assert.deepEqual(f.osCalls(), []);
    const sent = server.calls.filter(call => call.path.endsWith("/chat") || call.path.endsWith("/completions"));
    assert.equal(sent.length, 1);
    assert.match(sent[0].body.messages[0].content, /source = 'è'/);
    const client = await connect(t, f);
    const read = await client.callTool({ name: "givi_read_external_review", arguments: { repositoryPath: f.repo, runId: run.id } });
    assert.match(joined(read), /untrusted external content/);
    assert.ok(joined(read).includes(answer));
    server.state.incomplete = true;
    const failed = await cli(f, "send", ["--run-id", run.id, ...args]);
    assert.notEqual(failed.code, 0);
    assert.match(failed.stderr, /LOCAL_RESPONSE_INCOMPLETE/);
    assert.equal(readFileSync(run.response, "utf8"), answer);
    const failedStatus = JSON.parse(readFileSync(path.join(run.dir, "local-status.json"), "utf8"));
    assert.equal(failedStatus.outcome, "failed");
    assert.equal(failedStatus.errorCode, "LOCAL_RESPONSE_INCOMPLETE");
    assert.equal(existsSync(path.join(run.dir, "review.lock")), false);
  });

  test(`${provider}: MCP discovery/ask/send preserves earlier run and leaves newest inbox unchanged`, async t => {
    const f = fixture(t), server = await localServer(t, provider), client = await connect(t, f);
    const options = { repositoryPath: f.repo, provider, model: modelFor(provider), baseUrl: server.url };
    const models = await client.callTool({ name: "givi_local_models", arguments: { provider, baseUrl: server.url } });
    assert.deepEqual(JSON.parse(joined(models)).models, [modelFor(provider)]);
    const asked = await client.callTool({ name: "givi_ask_local_llm", arguments: { ...options, question: "Review è", reviewResponseMode: "analyze-only",
      ...(["ollama", "dwarfstar", "llama-cpp"].includes(provider) ? { reasoning: "off" } : {}) } });
    assert.notEqual(asked.isError, true, joined(asked));
    assert.match(joined(asked), /Do not edit files/);
    assert.ok(joined(asked).includes(answer));
    const earlier = f.latest();
    const next = f.cli("ask", ["--question", "Another request"]);
    assert.equal(next.status, 0, next.stderr);
    const inbox = path.join(f.repo, ".giviloop/inbox/external-review-response.md");
    writeFileSync(inbox, "Latest independent response");
    const sent = await client.callTool({ name: "givi_send_to_local_llm", arguments: { ...options, runId: earlier.id, reviewResponseMode: "act" } });
    assert.notEqual(sent.isError, true, joined(sent));
    assert.equal(readFileSync(inbox, "utf8"), "Latest independent response");
    assert.equal(readFileSync(earlier.response, "utf8"), answer);
    assert.equal(existsSync(f.latest().response), false);
    const discovered = await cli(f, "models", ["--provider", provider, "--base-url", server.url]);
    assert.equal(discovered.code, 0, discovered.stderr);
    assert.deepEqual(JSON.parse(discovered.stdout).models, [modelFor(provider)]);
  });
}

test("local CLI rejects browser-only flags, missing models, ZIPs and ambiguous local options before any browser", async t => {
  const f = fixture(t, { git: true });
  for (const [command, args, pattern] of [
    ["ask", ["--question", "Review", "--send", "ollama"], /requires --model/],
    ["ask", ["--question", "Review", "--send", "ollama", "--model", "x", "--background"], /browser option/],
    ["ask", ["--question", "Review", "--base-url", "http:\/\/127.0.0.1:1"], /requires --send/],
    ["archive", ["--send", "dwarfstar", "--model", "DeepSeek V4 Flash"], /not ZIP uploads/],
  ]) {
    const result = await cli(f, command, args);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, pattern);
  }
  assert.deepEqual(f.osCalls(), []);
});

test("a local run cannot be sent twice concurrently and releases its lock after completion", async t => {
  const f = fixture(t), server = await localServer(t, "ollama");
  assert.equal(f.cli("ask", ["--question", "Review"]).status, 0);
  const run = f.latest();
  let release;
  server.state.gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const started = new Promise(resolve => { server.state.started = resolve; });
  const args = ["--send", "ollama", "--model", modelFor("ollama"), "--base-url", server.url];
  const first = cli(f, "send", args);
  await started;
  const duplicate = await cli(f, "send", args);
  assert.notEqual(duplicate.code, 0);
  assert.match(duplicate.stderr, /REVIEW_RUN_BUSY/);
  const browserDuplicate = await cli(f, "send", []);
  assert.notEqual(browserDuplicate.code, 0);
  assert.match(browserDuplicate.stderr, /REVIEW_RUN_BUSY/);
  release();
  assert.equal((await first).code, 0);
  assert.equal(server.calls.filter(call => call.path === "/api/chat").length, 1);
  assert.equal(existsSync(path.join(run.dir, "review.lock")), false);
});

test("interrupting local CLI inference cancels the request and releases the run", async t => {
  const f = fixture(t), server = await localServer(t, "ollama");
  let release, child;
  server.state.gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const started = new Promise(resolve => { server.state.started = resolve; });
  const pending = cli(f, "ask", ["--question", "Review", "--send", "ollama", "--model", modelFor("ollama"), "--base-url", server.url], process => { child = process; });
  await started;
  child.kill("SIGINT");
  const result = await pending;
  release();
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /LOCAL_CANCELLED/);
  const run = f.latest();
  assert.equal(existsSync(run.response), false);
  assert.equal(existsSync(path.join(run.dir, "review.lock")), false);
  assert.equal(JSON.parse(readFileSync(path.join(run.dir, "local-status.json"), "utf8")).errorCode, "LOCAL_CANCELLED");
});

test("MCP request cancellation aborts local inference while leaving the MCP server usable", async t => {
  const f = fixture(t), server = await localServer(t, "ollama"), client = await connect(t, f);
  let release;
  server.state.gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const started = new Promise(resolve => { server.state.started = resolve; });
  const controller = new AbortController();
  const pending = client.callTool({ name: "givi_ask_local_llm", arguments: {
    repositoryPath: f.repo, provider: "ollama", model: modelFor("ollama"), baseUrl: server.url, question: "Review",
  } }, undefined, { signal: controller.signal, timeout: 10000 }).then(() => undefined, error => error);
  await started;
  controller.abort();
  assert.ok(await pending);
  const run = f.latest();
  for (let i = 0; i < 50 && existsSync(path.join(run.dir, "review.lock")); i++) await new Promise(resolve => setTimeout(resolve, 20));
  release();
  assert.equal(existsSync(path.join(run.dir, "review.lock")), false);
  assert.equal(existsSync(run.response), false);
  assert.equal(JSON.parse(readFileSync(path.join(run.dir, "local-status.json"), "utf8")).errorCode, "LOCAL_CANCELLED");
  assert.ok((await client.listTools()).tools.some(tool => tool.name === "givi_ask_local_llm"));
});
