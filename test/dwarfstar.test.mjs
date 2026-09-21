import assert from "node:assert/strict";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { distDir } from "./helpers.mjs";

const { probeDwarfStar, sendToDwarfStar } = await import(pathToFileURL(path.join(distDir, "providers/dwarfstar.js")).href);
const modelName = "DeepSeek V4 Flash";
const modelList = () => ({ object: "list", data: ["deepseek-v4-flash", "deepseek-v4-pro"].map(id => ({
  id, object: "model", owned_by: "ds4.c", name: modelName, context_length: 32768,
})) });
const completion = () => ({
  id: "fixture", object: "chat.completion", model: "deepseek-v4-flash",
  choices: [{ index: 0, message: { role: "assistant", content: "Add an initial value of 0 to reduce.\nVerificato: è corretto.\n", reasoning_content: "Private fixture reasoning should not be copied." }, finish_reason: "stop" }],
  usage: { prompt_tokens: 123, completion_tokens: 47, total_tokens: 170 },
});

async function fixture(t, override = () => undefined) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    calls.push({ method: req.method, path: req.url, body });
    if (await override(req, res, body) === true) return;
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/models" && req.method === "GET") res.end(JSON.stringify(modelList()));
    else if (req.url === "/v1/chat/completions" && req.method === "POST") res.end(JSON.stringify(completion()));
    else { res.statusCode = 404; res.end(JSON.stringify({ error: "unknown path" })); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return { calls, baseUrl, send: options => sendToDwarfStar({ model: modelName, prompt: "Review items.reduce((n,x)=>n+x)", baseUrl, ...options }) };
}

test("DwarfStar discovery reports actual loaded name once, never advertises compatibility aliases as separate models", async t => {
  const f = await fixture(t);
  assert.deepEqual(await probeDwarfStar(`${f.baseUrl}/v1`), { provider: "dwarfstar", baseUrl: f.baseUrl, models: [modelName] });
  assert.deepEqual(f.calls, [{ method: "GET", path: "/v1/models", body: undefined }]);
});

test("DwarfStar request uses upstream chat protocol and returns final answer/real usage without reasoning text", async t => {
  const f = await fixture(t);
  const prompt = "Review this code:\nconst n = [1,2].reduce((a,b)=>a+b);\nÈ corretto?";
  const result = await f.send({ prompt, reasoning: "high", maxOutputTokens: 8192, contextTokens: 32768 });
  assert.deepEqual(f.calls[1], { method: "POST", path: "/v1/chat/completions", body: {
    messages: [{ role: "user", content: prompt }], stream: false, max_tokens: 8192, think: true, reasoning_effort: "high",
  } });
  assert.equal(result.model, modelName);
  assert.equal(result.provider, "dwarfstar");
  assert.equal(result.responseText, completion().choices[0].message.content);
  assert.equal(result.inputTokens, 123);
  assert.equal(result.outputTokens, 47);
  assert.equal(result.reasoningTokens, undefined);
  assert.equal(result.finishReason, "stop");
  assert.ok(result.elapsedMs >= 0);
  assert.ok(!JSON.stringify(result).includes("Private fixture reasoning"));
});

test("DwarfStar refuses alias-based or unavailable model selection before sending the prompt", async t => {
  const f = await fixture(t);
  await assert.rejects(f.send({ model: "deepseek-v4-pro" }), error => error.code === "LOCAL_MODEL_MISMATCH");
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, "/v1/models");
});

test("DwarfStar reasoning off, on and omitted retain their distinct native semantics", async t => {
  const f = await fixture(t);
  await f.send({ reasoning: "off" });
  await f.send({ reasoning: "on" });
  await f.send({});
  const bodies = f.calls.filter(call => call.method === "POST").map(call => call.body);
  assert.equal(bodies[0].think, false);
  assert.equal(bodies[1].think, true);
  assert.ok(!("reasoning_effort" in bodies[1]));
  assert.ok(!("think" in bodies[2]));
  assert.ok(!("reasoning_effort" in bodies[2]));
});

test("DwarfStar checks fixed server context capacity and output reserve before generation", async t => {
  const f = await fixture(t);
  await assert.rejects(f.send({ contextTokens: 65536 }), error => error.code === "LOCAL_CONTEXT_EXCEEDED");
  await assert.rejects(f.send({ maxOutputTokens: 32768 }), error => error.code === "LOCAL_CONTEXT_EXCEEDED");
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => call.method === "GET"));
});

test("DwarfStar preserves native tokenizer context refusal as an error without retry or exposing echoed code", async t => {
  const f = await fixture(t, (req, res) => {
    if (req.method !== "POST") return;
    res.statusCode = 400;
    res.end(JSON.stringify({ error: { code: "context_length_exceeded", message: "private source text", n_prompt_tokens: 40000, n_ctx: 32768 } }));
    return true;
  });
  await assert.rejects(f.send({}), error => error.code === "LOCAL_HTTP_ERROR" && !error.message.includes("private source text"));
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});

test("DwarfStar refuses truncated, tool-call and unspecified finish reasons", async t => {
  let finish = "length";
  const f = await fixture(t, (req, res) => {
    if (req.method !== "POST") return;
    const response = completion();
    response.choices[0].finish_reason = finish;
    res.end(JSON.stringify(response));
    return true;
  });
  for (finish of ["length", "tool_calls", null, "error"]) {
    await assert.rejects(f.send({}), error => error.code === "LOCAL_RESPONSE_INCOMPLETE");
  }
  assert.equal(f.calls.filter(call => call.method === "POST").length, 4, "one request per user invocation, no automatic retries");
});

test("DwarfStar rejects thinking-only answers and malformed completion payloads", async t => {
  let response = completion();
  const f = await fixture(t, (req, res) => {
    if (req.method !== "POST") return;
    res.end(JSON.stringify(response));
    return true;
  });
  for (const malformed of [
    { ...completion(), choices: [] },
    { ...completion(), model: undefined },
    { ...completion(), choices: [{ finish_reason: "stop", message: { role: "assistant", content: " ", reasoning_content: "thoughts" } }] },
    { ...completion(), choices: [{ finish_reason: "stop", message: { role: "user", content: "wrong role" } }] },
    { ...completion(), choices: [{ finish_reason: "stop", message: { role: "assistant", content: "answer", tool_calls: [{ id: "call" }] } }] },
    { ...completion(), usage: { prompt_tokens: -1 } },
    { ...completion(), usage: { completion_tokens: "47" } },
  ]) {
    response = malformed;
    await assert.rejects(f.send({}), error => error.code === "LOCAL_RESPONSE_INVALID");
  }
});

test("DwarfStar requires trustworthy native model metadata, rejecting generic OpenAI services", async t => {
  let response;
  const f = await fixture(t, (_req, res) => { res.end(JSON.stringify(response)); return true; });
  for (const malformed of [
    { data: [] }, { data: [{ id: "deepseek-v4-pro" }] },
    { data: [{ name: modelName, owned_by: "other", context_length: 32768 }] },
    { data: [{ name: modelName, owned_by: "ds4.c", context_length: 0 }] },
    { data: [...modelList().data, { name: "DeepSeek V4 Pro", owned_by: "ds4.c", context_length: 32768 }] },
    { data: [modelList().data[0], { ...modelList().data[1], context_length: 8192 }] },
  ]) {
    response = malformed;
    await assert.rejects(f.send({}), error => error.code === "LOCAL_RESPONSE_INVALID");
  }
  assert.ok(f.calls.every(call => call.method === "GET"));
});

test("DwarfStar token accounting does not invent absent usage and accepts separately reported reasoning counts", async t => {
  let response = { ...completion(), usage: undefined };
  const f = await fixture(t, (req, res) => {
    if (req.method !== "POST") return;
    res.end(JSON.stringify(response)); return true;
  });
  const absent = await f.send({});
  assert.equal(absent.inputTokens, undefined);
  assert.equal(absent.outputTokens, undefined);
  response = { ...completion(), usage: { prompt_tokens: 50, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 12 } } };
  const reported = await f.send({});
  assert.equal(reported.reasoningTokens, 12);
  assert.equal(reported.outputTokens, 20);
});

test("DwarfStar generation timeout cancels the only request, without retry", async t => {
  const f = await fixture(t, req => req.method === "POST" ? true : undefined);
  await assert.rejects(f.send({ timeoutMs: 500 }), error => error.code === "LOCAL_TIMEOUT");
  assert.equal(f.calls.filter(call => call.method === "POST").length, 1);
});

test("DwarfStar rejects a completion model ID that differs from discovery", async t => {
  const f = await fixture(t, (req, res) => {
    if (req.method !== "POST") return;
    res.end(JSON.stringify({ ...completion(), model: "unadvertised-model" })); return true;
  });
  await assert.rejects(f.send({}), error => error.code === "LOCAL_MODEL_MISMATCH");
});

test("DwarfStar explicit cancellation is propagated before code is sent", async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.send({ signal: controller.signal }), error => error.code === "LOCAL_CANCELLED");
  assert.equal(f.calls.length, 0);
});

test("DwarfStar rejects remote URLs, embedded credentials and unsupported base paths", async () => {
  for (const baseUrl of ["https://example.com", "http://127.0.0.1.evil.test", "http://user:pass@127.0.0.1", "http://127.0.0.1/custom", "file:///tmp/models"]) {
    await assert.rejects(sendToDwarfStar({ model: modelName, prompt: "private code", baseUrl }), error => error.code === "LOCAL_URL_INVALID");
  }
});

test("DwarfStar does not follow a redirect even to another local server", async t => {
  const target = await fixture(t);
  const f = await fixture(t, (_req, res) => { res.writeHead(302, { Location: `${target.baseUrl}/v1/models` }); res.end(); return true; });
  await assert.rejects(f.send({}), error => error.code === "LOCAL_REDIRECT_REJECTED");
  assert.equal(target.calls.length, 0);
});

test("DwarfStar bounds configuration before contacting a server", async t => {
  const f = await fixture(t);
  for (const options of [{ prompt: "" }, { prompt: "a".repeat(2 * 1024 * 1024 + 1) }, { timeoutMs: 0 }, { maxOutputTokens: 1.5 }, { contextTokens: -1 }, { reasoning: "max" }, { model: "" }]) {
    await assert.rejects(f.send(options), error => error.code === "LOCAL_OPTIONS_INVALID");
  }
  assert.equal(f.calls.length, 0);
});

test("DwarfStar response-size limit prevents unbounded output from reaching the review", async t => {
  const f = await fixture(t, (req, res) => {
    if (req.method !== "POST") return;
    const response = completion();
    response.choices[0].message.content = "x".repeat(8 * 1024 * 1024);
    res.end(JSON.stringify(response)); return true;
  });
  await assert.rejects(f.send({}), error => error.code === "LOCAL_RESPONSE_TOO_LARGE");
});
