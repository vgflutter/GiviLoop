import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { bridgePath, distDir, fixture } from "./helpers.mjs";

async function connect(t, f, profile = "full") {
  const client = new Client({ name: "giviloop-integration-test", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["--import", bridgePath, path.join(distDir, "mcp-server.js"), ...(profile ? ["--tools", profile] : [])],
    env: f.env,
    stderr: "pipe",
  }));
  return client;
}

function text(result) {
  return result.content.filter(item => item.type === "text").map(item => item.text).join("\n");
}

test('MCP profile options reject typos instead of silently exposing the full interface', async () => {
  const {mcpToolProfile}=await import(pathToFileURL(path.join(distDir,'mcp-surface.js')));
  assert.equal(mcpToolProfile([]),'compact');
  assert.equal(mcpToolProfile(['--tools','full']),'full');
  assert.equal(mcpToolProfile(['--tools=compact']),'compact');
  for(const args of [['--tools'],['--tools','typo'],['--unknown'],['--tools','full','extra']]) assert.throws(()=>mcpToolProfile(args),/Usage/);
});

async function rejectsTool(client, name, args, pattern) {
  const error = await client.callTool({ name, arguments: args }).then(
    result => result.isError ? text(result) : undefined,
    error => error.message,
  );
  assert.equal(typeof error, "string", "Expected a tool error, not a successful response");
  assert.match(error, pattern);
}

test("MCP prepare -> CLI manual import -> MCP analyze/act preserves review and handling", async t => {
  const f = fixture(t, { git: true });
  const client = await connect(t, f);
  const source = path.join(f.repo, "source.txt");
  writeFileSync(source, "changed\n");
  const { tools } = await client.listTools();
  assert.equal(tools.length, 21);
  assert.ok(tools.some(tool => tool.name === "givi_ask_local_llm"));
  assert.ok(tools.some(tool => tool.name === "givi_send_to_local_llm"));
  assert.ok(tools.some(tool => tool.name === "givi_local_models"));
  const prepared = await client.callTool({ name: "givi_prepare_from_git", arguments: {
    repositoryPath: f.repo, taskGoal: "Review local changes", targetProvider: "claude-chat",
  } });
  assert.match(text(prepared), /git-only/);
  const run = f.latest();
  assert.match(readFileSync(run.request, "utf8"), /changed/);
  assert.deepEqual(f.osCalls(), []);
  writeFileSync(f.clipboard, "A review with evidence: source.txt. Treat this as advisory.");
  const imported = f.cli("ingest", ["--run-id", run.id]);
  assert.equal(imported.status, 0, imported.stderr);
  for (const mode of ["analyze-only", "act"]) {
    const result = await client.callTool({ name: "givi_read_external_review", arguments: {
      repositoryPath: f.repo, runId: run.id, reviewResponseMode: mode,
    } });
    const output = text(result);
    assert.match(output, /A review with evidence/);
    assert.match(output, /Provider: claude-chat/);
    assert.ok(output.includes(`Review response handling: ${mode}`));
    assert.match(output, /untrusted external content/);
  }
  assert.equal(readFileSync(source, "utf8"), "changed\n");
});

test("MCP never substitutes another run's newer inbox response for a missing review", async t => {
  const f = fixture(t);
  const client = await connect(t, f);
  assert.equal(f.cli("ask", ["--question", "First"]).status, 0);
  const first = f.latest();
  assert.equal(f.cli("ask", ["--question", "Second"]).status, 0);
  writeFileSync(f.clipboard, "RESPONSE_FOR_SECOND_ONLY");
  assert.equal(f.cli("ingest").status, 0);
  await rejectsTool(client, "givi_read_external_review", { repositoryPath: f.repo, runId: first.id }, /response not found/);
  assert.equal(f.cli("ask", ["--question", "Third"]).status, 0);
  await rejectsTool(client, "givi_read_external_review", { repositoryPath: f.repo }, /response not found/);
});

test("MCP can read a legacy inbox when no run exists", async t => {
  const f = fixture(t);
  const client = await connect(t, f);
  const inbox = path.join(f.repo, ".giviloop/inbox");
  mkdirSync(inbox, { recursive: true });
  writeFileSync(path.join(inbox, "external-review-response.md"), "Legacy review");
  const result = await client.callTool({ name: "givi_read_external_review", arguments: { repositoryPath: f.repo } });
  assert.match(text(result), /Legacy review/);
});

test("MCP validates run ids and headless options without launching a browser", async t => {
  const f = fixture(t);
  const client = await connect(t, f);
  assert.equal(f.cli("ask", ["--question", "Review"]).status, 0);
  await rejectsTool(client, "givi_read_external_review", { repositoryPath: f.repo, runId: "../../outside" }, /Invalid GiviLoop run id/);
  const { tools } = await client.listTools();
  for (const name of ["givi_send_to_web_llm", "givi_send_to_chatgpt_web", "givi_ask_web_llm"]) {
    assert.equal(tools.find(tool => tool.name === name).inputSchema.properties.headless, undefined);
    await rejectsTool(client, name, { repositoryPath: f.repo, question: "Review", headless: "true" }, /headless must be a boolean/);
    await rejectsTool(client, name, { repositoryPath: f.repo, question: "Review", headless: true, mode: "submit" }, /always windowless/);
  }
});

test("MCP refuses an archive run whose attachment has gone missing", async t => {
  const f = fixture(t);
  const client = await connect(t, f);
  assert.equal(f.cli("ask", ["--question", "Archive fixture"]).status, 0);
  const run = f.latest();
  const metadata = JSON.parse(readFileSync(run.metadata, "utf8"));
  metadata.mode = "source-archive";
  writeFileSync(run.metadata, JSON.stringify(metadata));
  await rejectsTool(client, "givi_send_to_web_llm", { repositoryPath: f.repo, runId: run.id, mode: "auto" }, /zip is missing/);
});

test("MCP refuses a missing known request even when a legacy prompt exists", async t => {
  const f = fixture(t, { git: true });
  assert.equal(f.cli("prepare", ["--goal", "Legacy context"]).status, 0);
  assert.equal(f.cli("ask", ["--question", "Current review"]).status, 0);
  const run = f.latest();
  rmSync(run.request);
  const client = await connect(t, f);
  await rejectsTool(client, "givi_send_to_web_llm", { repositoryPath: f.repo, runId: run.id, mode: "auto" }, /Request file not found for run/);
});

test("MCP validates background and response timing parameters before browser launch", async t => {
  const f = fixture(t);
  assert.equal(f.cli("ask", ["--question", "Review"]).status, 0);
  const client = await connect(t, f);
  const { tools } = await client.listTools();
  for (const name of ["givi_send_to_web_llm", "givi_send_to_chatgpt_web", "givi_ask_web_llm"]) {
    const schema = tools.find(tool => tool.name === name).inputSchema.properties;
    assert.equal(schema.background, undefined);
    assert.equal(schema.maxWaitMs.type, "number");
    assert.equal(schema.browserProfile.type, "string");
    if (name !== "givi_send_to_chatgpt_web") {
      assert.deepEqual(schema.webProvider.enum, ["chatgpt-web", "deepseek-web", "claude-web", "gemini-web"]);
    }
  }
  await rejectsTool(client, "givi_send_to_web_llm", { repositoryPath: f.repo, background: true, headless: true, mode: "auto" }, /always windowless/);
  await rejectsTool(client, "givi_send_to_web_llm", { repositoryPath: f.repo, background: true, mode: "prefill" }, /always windowless/);
  await rejectsTool(client, "givi_send_to_web_llm", { repositoryPath: f.repo, maxWaitMs: 0 }, /positive|greater than|exclusiveMinimum/i);
});

test('default MCP exposes eight review tools; full discovery preserves legacy workflows', async t => {
  const f=fixture(t), compact=await connect(t,f,null), full=await connect(t,f);
  const a=(await compact.listTools()).tools, b=(await full.listTools()).tools;
  assert.deepEqual(a.map(x=>x.name).sort(), ['givi_auto_review','givi_export_report','givi_list_findings','givi_manage_review','givi_read_external_review','givi_record_finding','givi_review','givi_status']);
  assert.equal(b.length,21);
  assert.ok(JSON.stringify(a).length < JSON.stringify(b).length/2);
  // Discovery changes do not break existing clients using an older tool name.
  const legacy=await compact.callTool({name:'givi_help',arguments:{}});
  assert.match(text(legacy),/GiviLoop/);
  await rejectsTool(compact,'givi_review',{repositoryPath:f.repo},/Configure.*reviewer/);
  assert.deepEqual(f.osCalls(),[]);
});

test('compact management requires exact review identity and rejects mixed/unknown arguments before effects', async t => {
  const f=fixture(t), c=await connect(t,f,null);
  for(const action of ['cancel','resume','recheck']) {
    await rejectsTool(c,'givi_manage_review',{action,repositoryPath:f.repo},/runId/);
    await rejectsTool(c,'givi_manage_review',{action,repositoryPath:f.repo,runId:'../../outside'},/Invalid GiviLoop run id/);
  }
  await rejectsTool(c,'givi_manage_review',{action:'cancel',repositoryPath:f.repo,foreground:true},/Unsupported/);
  await rejectsTool(c,'givi_manage_review',{action:'__proto__'},/Unknown/);
  await rejectsTool(c,'givi_manage_review',{action:'models',repositoryPath:f.repo},/Configure a local/);
  await rejectsTool(c,'givi_review',{repositoryPath:f.repo,files:[]},/at least one/);
  await rejectsTool(c,'givi_review',{repositoryPath:f.repo,headless:true},/Unsupported/);
  assert.deepEqual(f.osCalls(),[]);
});

for (const profile of [null, 'full']) test(`MCP ${profile ?? 'compact'} rejects all visible legacy routes before creating a review`, async t => {
  const f = fixture(t), c = await connect(t, f, profile);
  const tools = (await c.listTools()).tools;
  assert.ok(!tools.some(tool => tool.name === 'givi_open'));
  assert.ok(!tools.find(tool => tool.name === 'givi_manage_review').inputSchema.properties.action.enum.includes('open'));
  for (const tool of tools) for (const key of ['foreground','background','headless','mode','verificationWaitMs']) {
    assert.equal(tool.inputSchema.properties?.[key], undefined, `${tool.name}.${key}`);
  }
  await rejectsTool(c, 'givi_open', {repositoryPath:f.repo}, /manual/i);
  await rejectsTool(c, 'givi_manage_review', {action:'open',repositoryPath:f.repo,runId:'example'}, /Unknown/);
  await rejectsTool(c, 'givi_manage_review', {action:'resume',repositoryPath:f.repo,runId:'example',foreground:true}, /Unsupported/);
  await rejectsTool(c, 'givi_resume', {repositoryPath:f.repo,foreground:true}, /Unsupported/);
  for (const name of ['givi_ask_web_llm','givi_send_to_web_llm','givi_send_to_chatgpt_web']) {
    for (const options of [{background:false},{foreground:true},{headless:true},{mode:'prefill'},{mode:'submit'},{verificationWaitMs:1000}]) {
      await rejectsTool(c, name, {repositoryPath:f.repo,question:'Review',...options}, /always windowless/);
    }
  }
  assert.deepEqual(f.osCalls(), []);
  assert.equal(existsSync(path.join(f.repo,'.giviloop/latest-run-id')),false);
});
