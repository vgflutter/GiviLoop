import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { distDir } from "./helpers.mjs";

const { sendToOllama, probeOllama } = await import(pathToFileURL(path.join(distDir, "providers/ollama.js")));
const { localBaseUrl, localJson } = await import(pathToFileURL(path.join(distDir, "providers/local-http.js")));
const show = { model_info: { "general.architecture": "qwen2", "qwen2.context_length": 32768 }, capabilities: ["completion", "thinking"] };
const complete = { model: "review:small", done: true, done_reason: "stop", message: { role: "assistant", content: "Use an initial value of 0.", thinking: "This must not become the review." }, prompt_eval_count: 21, eval_count: 34 };

async function server(t, handler) {
  const calls = [];
  const instance = createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    const body = data ? JSON.parse(data) : undefined;
    calls.push({ path: req.url, body });
    try {
      const value = await handler(req.url, body, res);
      if (!res.writableEnded && !res.destroyed && value !== undefined) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(value));
      }
    } catch { res.destroy(); }
  });
  await new Promise(resolve => instance.listen(0, "127.0.0.1", resolve));
  t.after(() => { instance.closeAllConnections(); return new Promise(resolve => instance.close(resolve)); });
  return { baseUrl: `http://127.0.0.1:${instance.address().port}`, calls };
}
const options = { model: "review:small", prompt: "Review total = items.reduce((sum, item) => sum + item.price).", reasoning: "on" };

test("Ollama final review excludes thinking and preserves actual model/token metrics", async t => {
  const site = await server(t, route => route === "/api/show" ? show : complete);
  const result = await sendToOllama({ ...options, baseUrl: site.baseUrl });
  assert.equal(result.responseText, complete.message.content);
  assert.equal(result.model, options.model);
  assert.equal(result.inputTokens, 21);
  assert.equal(result.outputTokens, 34);
  assert.equal(result.reasoningTokens, undefined, "Ollama does not expose a separate thinking token count");
  assert.equal(result.finishReason, "stop");
  assert.equal(site.calls.length, 2);
  const request = site.calls[1].body;
  assert.equal(request.messages[0].content, options.prompt);
  assert.equal(request.think, true);
  assert.equal(request.stream, false);
  assert.equal(request.truncate, false);
  assert.equal(request.shift, false);
  assert.equal(request.options.num_predict, 2048);
  assert.equal("temperature" in request.options, false, "preserve model sampling defaults, especially for thinking models");
});

test("Ollama refuses cloud aliases before sending any prompt", async t => {
  const site = await server(t, () => ({ ...show, remote_host: "https://ollama.com", remote_model: "cloud-model" }));
  await assert.rejects(sendToOllama({ ...options, model: "my-private-alias", baseUrl: site.baseUrl }), /LOCAL_CLOUD_MODEL_REJECTED/);
  assert.deepEqual(site.calls.map(c => c.path), ["/api/show"]);
  assert.equal(JSON.stringify(site.calls).includes(options.prompt), false);
});

test("Ollama requires local weight metadata before submitting code", async t => {
  const site = await server(t, () => ({ capabilities: ["completion"] }));
  await assert.rejects(sendToOllama({ ...options, baseUrl: site.baseUrl }), /LOCAL_MODEL_UNVERIFIED/);
  assert.equal(site.calls.length, 1);
});

test("Ollama discovery hides cloud tags and cloud aliases", async t => {
  const site = await server(t, (route, body) => route === "/api/tags"
    ? { models: [{ name: "review:small" }, { name: "big:cloud" }, { name: "alias:latest" }] }
    : body.model === "alias:latest" ? { remote_model: "remote", remote_host: "https://ollama.com" } : show);
  assert.deepEqual((await probeOllama(site.baseUrl)).models, ["review:small"]);
  assert.equal(site.calls.filter(c => c.path === "/api/show").length, 2);
});

test("Ollama refuses incomplete, truncated, empty, unexpected-model and tool-call replies", async t => {
  for (const [label, response, code] of [
    ["partial", { ...complete, done: false }, "LOCAL_RESPONSE_INCOMPLETE"],
    ["length", { ...complete, done_reason: "length" }, "LOCAL_RESPONSE_INCOMPLETE"],
    ["missing finish", { ...complete, done_reason: undefined }, "LOCAL_RESPONSE_INCOMPLETE"],
    ["thinking only", { ...complete, message: { role: "assistant", content: "", thinking: "still thinking" } }, "LOCAL_RESPONSE_INVALID"],
    ["different model", { ...complete, model: "another:large" }, "LOCAL_MODEL_MISMATCH"],
    ["tool call", { ...complete, message: { ...complete.message, tool_calls: [{}] } }, "LOCAL_RESPONSE_INVALID"],
    ["malformed usage", { ...complete, eval_count: -1 }, "LOCAL_RESPONSE_INVALID"],
    ["late remote", { ...complete, remote_host: "https://remote.invalid" }, "LOCAL_CLOUD_MODEL_REJECTED"],
  ]) await t.test(label, async child => {
    const site = await server(child, route => route === "/api/show" ? show : response);
    await assert.rejects(sendToOllama({ ...options, baseUrl: site.baseUrl }), new RegExp(code));
    assert.equal(site.calls.filter(call => call.path === "/api/chat").length, 1, "never resubmit automatically");
  });
});

test("Ollama context and reasoning incompatibilities fail before inference", async t => {
  const site = await server(t, () => ({ ...show, capabilities: ["completion"] }));
  await assert.rejects(sendToOllama({ ...options, baseUrl: site.baseUrl }), /LOCAL_REASONING_UNSUPPORTED/);
  await assert.rejects(sendToOllama({ ...options, reasoning: "off", contextTokens: 65536, baseUrl: site.baseUrl }), /LOCAL_CONTEXT_EXCEEDED/);
  assert.equal(site.calls.some(call => call.path === "/api/chat"), false);
});

test("GPT-OSS thinking cannot be silently disabled and on selects a supported level", async t => {
  const site = await server(t, route => route === "/api/show"
    ? { ...show, model_info: { "general.architecture": "gptoss", "gptoss.context_length": 131072 } } : complete);
  await assert.rejects(sendToOllama({ ...options, reasoning: "off", baseUrl: site.baseUrl }), /LOCAL_REASONING_UNSUPPORTED/);
  assert.equal(site.calls.length, 1);
  await sendToOllama({ ...options, baseUrl: site.baseUrl });
  assert.equal(site.calls.at(-1).body.think, "medium");
});

test("Ollama rejects invalid options and unsafe endpoints without making a request", async t => {
  const site = await server(t, () => show);
  for (const overrides of [
    { model: "large:cloud" }, { model: "" }, { prompt: "" }, { maxOutputTokens: -1 }, { timeoutMs: Infinity },
    { contextTokens: 100 }, { prompt: "é".repeat(9000) }, { reasoning: "sometimes" },
    { baseUrl: "https://remote.invalid" }, { baseUrl: "http://127.0.0.1:11434?token=secret" },
    { baseUrl: "http://user:secret@127.0.0.1:11434" }, { baseUrl: "http://localhost.remote.invalid" },
  ]) await assert.rejects(sendToOllama({ ...options, baseUrl: site.baseUrl, ...overrides }), /LOCAL_(OPTIONS_INVALID|CLOUD_MODEL_REJECTED|CONTEXT_EXCEEDED|URL_INVALID)/);
  assert.equal(site.calls.length, 0);
  assert.equal(localBaseUrl("http://localhost:11434", site.baseUrl).hostname, "127.0.0.1");
});

test("local HTTP rejects redirects instead of forwarding prompts to the redirect target", async t => {
  const target = await server(t, () => complete);
  const source = await server(t, (_route, _body, res) => { res.writeHead(307, { Location: target.baseUrl }); res.end(); });
  await assert.rejects(sendToOllama({ ...options, baseUrl: source.baseUrl }), /LOCAL_REDIRECT_REJECTED/);
  assert.equal(target.calls.length, 0);
});

test("local HTTP deadline covers a stalled response body and honors cancellation", async t => {
  const site = await server(t, (_route, _body, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.write('{"partial":'); });
  const started = Date.now();
  await assert.rejects(sendToOllama({ ...options, baseUrl: site.baseUrl, timeoutMs: 80 }), /LOCAL_TIMEOUT/);
  assert.ok(Date.now() - started < 1500);
  const controller = new AbortController();
  controller.abort();
  const before = site.calls.length;
  await assert.rejects(sendToOllama({ ...options, baseUrl: site.baseUrl, signal: controller.signal }), /LOCAL_CANCELLED/);
  assert.equal(site.calls.length, before);
});

test("local HTTP enforces response size and does not expose server error bodies", async t => {
  const large = await server(t, () => ({ content: "x".repeat(4096) }));
  await assert.rejects(localJson(new URL(large.baseUrl), "/api/show", { maxBytes: 1024 }), /LOCAL_RESPONSE_TOO_LARGE/);
  const error = await server(t, (_route, _body, res) => { res.statusCode = 400; return { error: "secret source echoed by the server" }; });
  await assert.rejects(sendToOllama({ ...options, baseUrl: error.baseUrl }), e => /LOCAL_HTTP_ERROR/.test(e.message) && !e.message.includes("secret source"));
  await assert.rejects(localJson(new URL(large.baseUrl), "https://remote.invalid/"), /LOCAL_URL_INVALID/);
});
