import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { distDir } from "./helpers.mjs";

const { sendToOpenAILocal, probeOpenAILocal } = await import(pathToFileURL(path.join(distDir, "providers/openai-local.js")));
const providers = ["llama-cpp", "lmstudio", "mlx"];
const model = "local-review";
const options = { model, prompt: "Review sum([]): items.reduce((total, value) => total + value)." };
const models = { object: "list", data: [{ id: model, object: "model", owned_by: "llamacpp", meta: { n_ctx_train: 32768 } }] };
const props = { default_generation_settings: { n_ctx: 16384 }, chat_template_caps: { supports_reasoning_effort: true } };
const native = { models: [{ type: "llm", key: "publisher/model", format: "gguf", loaded_instances: [{ id: model, config: { context_length: 16384 } }] }] };
const answer = { model, choices: [{ finish_reason: "stop", message: { role: "assistant", content: "Add the initial value 0.", reasoning: "private MLX thinking", reasoning_content: "private llama thinking" } }], usage: { prompt_tokens: 12, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 18 } } };

async function fixture(t, override = () => undefined) {
  const calls = [];
  const instance = createServer(async (req, res) => {
    let raw = "";
    for await (const bytes of req) raw += bytes;
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ path: req.url, body });
    const replacement = await override(req.url, body, res);
    if (res.writableEnded || res.destroyed) return;
    const data = replacement ?? ({ "/v1/models": models, "/props": props, "/api/v1/models": native, "/v1/chat/completions": answer })[req.url];
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve => instance.listen(0, "127.0.0.1", resolve));
  t.after(() => { instance.closeAllConnections(); return new Promise(resolve => instance.close(resolve)); });
  return { baseUrl: `http://127.0.0.1:${instance.address().port}`, calls };
}

for (const provider of providers) test(`${provider}: discovered exact model completes with bounded output and separate thinking`, async t => {
  const site = await fixture(t);
  const listed = await probeOpenAILocal(provider, site.baseUrl + "/v1");
  assert.deepEqual(listed.models, [model]);
  const result = await sendToOpenAILocal(provider, { ...options, baseUrl: site.baseUrl + "/v1" });
  assert.equal(result.provider, provider);
  assert.equal(result.model, model);
  assert.equal(result.responseText, answer.choices[0].message.content);
  assert.equal(result.inputTokens, 12);
  assert.equal(result.outputTokens, 30);
  assert.equal(result.reasoningTokens, 18);
  assert.equal(JSON.stringify(result).includes("private"), false);
  const sent = site.calls.find(call => call.path === "/v1/chat/completions").body;
  assert.equal(sent.stream, false);
  assert.equal(sent.max_tokens, 4096);
  assert.equal(sent.model, model);
  assert.equal(sent.messages[0].content, options.prompt);
  assert.equal("temperature" in sent, false);
  assert.equal("context_length" in sent, false);
  assert.equal("reasoning_effort" in sent, false);
});

test("llama.cpp reasoning controls require advertised template capability", async t => {
  const site = await fixture(t);
  await sendToOpenAILocal("llama-cpp", { ...options, baseUrl: site.baseUrl, reasoning: "off" });
  assert.equal(site.calls.at(-1).body.reasoning_effort, "none");
  assert.equal(site.calls.at(-1).body.reasoning_format, "deepseek");
  await sendToOpenAILocal("llama-cpp", { ...options, baseUrl: site.baseUrl, reasoning: "on" });
  assert.equal(site.calls.at(-1).body.reasoning_effort, "medium");
  const unsupported = await fixture(t, route => route === "/props" ? { ...props, chat_template_caps: { supports_reasoning_effort: false } } : undefined);
  await assert.rejects(sendToOpenAILocal("llama-cpp", { ...options, baseUrl: unsupported.baseUrl, reasoning: "off" }), /LOCAL_REASONING_UNSUPPORTED/);
  assert.equal(unsupported.calls.some(call => call.path === "/v1/chat/completions"), false);
});

for (const provider of ["lmstudio", "mlx"]) test(`${provider}: unsupported reasoning fails without silently ignoring the option`, async t => {
  const site = await fixture(t);
  for (const reasoning of ["off", "on", "high"]) await assert.rejects(sendToOpenAILocal(provider, { ...options, reasoning, baseUrl: site.baseUrl }), /LOCAL_REASONING_UNSUPPORTED/);
  assert.equal(site.calls.length, 0);
});

test("LM Studio excludes unloaded/JIT models, embeddings and unknown context instances", async t => {
  const site = await fixture(t, route => route === "/api/v1/models" ? { models: [{ ...native.models[0], loaded_instances: [] }, { ...native.models[0], type: "embedding" }] } : undefined);
  assert.deepEqual((await probeOpenAILocal("lmstudio", site.baseUrl)).models, []);
  await assert.rejects(sendToOpenAILocal("lmstudio", { ...options, baseUrl: site.baseUrl }), /LOCAL_MODEL_UNVERIFIED/);
  assert.equal(site.calls.some(call => call.path === "/v1/chat/completions"), false);
  const missing = await fixture(t, route => route === "/api/v1/models" ? { models: [{ ...native.models[0], loaded_instances: [{ id: model, config: {} }] }] } : undefined);
  await assert.rejects(probeOpenAILocal("lmstudio", missing.baseUrl), /LOCAL_RESPONSE_INVALID/);
});

test("llama.cpp refuses router mode and unverified active context", async t => {
  const router = await fixture(t, route => route === "/v1/models" ? { ...models, data: [...models.data, { ...models.data[0], id: "second-model" }] } : undefined);
  await assert.rejects(sendToOpenAILocal("llama-cpp", { ...options, baseUrl: router.baseUrl }), /LOCAL_MODEL_UNVERIFIED/);
  const noContext = await fixture(t, route => route === "/props" ? {} : undefined);
  await assert.rejects(sendToOpenAILocal("llama-cpp", { ...options, baseUrl: noContext.baseUrl }), /LOCAL_CONTEXT_UNVERIFIED/);
});

for (const provider of providers) test(`${provider}: unknown exact IDs and excessive context are rejected before chat`, async t => {
  const site = await fixture(t);
  await assert.rejects(sendToOpenAILocal(provider, { ...options, model: "uninstalled-model", baseUrl: site.baseUrl }), /LOCAL_MODEL_UNVERIFIED/);
  await assert.rejects(sendToOpenAILocal(provider, { ...options, prompt: "é".repeat(9000), baseUrl: site.baseUrl }), /LOCAL_CONTEXT_EXCEEDED/);
  if (provider !== "mlx") await assert.rejects(sendToOpenAILocal(provider, { ...options, contextTokens: 32768, baseUrl: site.baseUrl }), /LOCAL_CONTEXT_EXCEEDED/);
  assert.equal(site.calls.some(call => call.path === "/v1/chat/completions"), false);
});

test("MLX context is a client budget and does not send fictitious server configuration", async t => {
  const site = await fixture(t);
  await sendToOpenAILocal("mlx", { ...options, contextTokens: 32768, baseUrl: site.baseUrl });
  assert.deepEqual(Object.keys(site.calls.at(-1).body).sort(), ["max_tokens", "messages", "model", "stream"]);
});

test("OpenAI-compatible responses must finish with matching model and a final text answer", async t => {
  const baseChoice = answer.choices[0];
  for (const [label, patch, code] of [
    ["different model", { model: "other" }, "LOCAL_MODEL_MISMATCH"],
    ["length", { choices: [{ ...baseChoice, finish_reason: "length" }] }, "LOCAL_RESPONSE_INCOMPLETE"],
    ["truncated", { truncated: true }, "LOCAL_RESPONSE_INCOMPLETE"],
    ["empty", { choices: [{ ...baseChoice, message: { role: "assistant", content: null, reasoning: "thinking" } }] }, "LOCAL_RESPONSE_INVALID"],
    ["tool call", { choices: [{ ...baseChoice, message: { ...baseChoice.message, tool_calls: [{}] } }] }, "LOCAL_RESPONSE_INVALID"],
    ["raw thinking", { choices: [{ ...baseChoice, message: { ...baseChoice.message, content: "<think>internal</think>final" } }] }, "LOCAL_REASONING_UNSEPARATED"],
    ["negative usage", { usage: { completion_tokens: -1 } }, "LOCAL_RESPONSE_INVALID"],
  ]) await t.test(label, async child => {
    const site = await fixture(child, route => route === "/v1/chat/completions" ? { ...answer, ...patch } : undefined);
    await assert.rejects(sendToOpenAILocal("mlx", { ...options, baseUrl: site.baseUrl }), new RegExp(code));
    assert.equal(site.calls.filter(call => call.path === "/v1/chat/completions").length, 1);
  });
});

test("new engine adapters retain loopback, redirect, cancellation and deadline guarantees", async t => {
  const site = await fixture(t);
  await assert.rejects(sendToOpenAILocal("mlx", { ...options, baseUrl: "https://remote.invalid" }), /LOCAL_URL_INVALID/);
  await assert.rejects(sendToOpenAILocal("mlx", { ...options, baseUrl: site.baseUrl + "/other" }), /LOCAL_URL_INVALID/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(sendToOpenAILocal("mlx", { ...options, baseUrl: site.baseUrl, signal: controller.signal }), /LOCAL_CANCELLED/);
  assert.equal(site.calls.length, 0);
  const redirect = await fixture(t, (_route, _body, res) => { res.writeHead(307, { Location: site.baseUrl }); res.end(); });
  await assert.rejects(sendToOpenAILocal("mlx", { ...options, baseUrl: redirect.baseUrl }), /LOCAL_REDIRECT_REJECTED/);
  assert.equal(site.calls.length, 0);
  const slow = await fixture(t, (route, _body, res) => {
    if (route !== "/v1/chat/completions") return undefined;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"partial":');
    return new Promise(resolve => res.once("close", resolve));
  });
  await assert.rejects(sendToOpenAILocal("mlx", { ...options, baseUrl: slow.baseUrl, timeoutMs: 80 }), /LOCAL_TIMEOUT/);
});
