import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { distDir, fixture } from './helpers.mjs';
const { automaticReview, automaticSnapshot, configureAutoReview, acknowledgeAutomaticReview, AUTO_REVIEW_INSTRUCTIONS } = await import(pathToFileURL(path.join(distDir, 'auto-review.js')));
const { savePreferences } = await import(pathToFileURL(path.join(distDir, 'preferences.js')));
const { pruneCompletedRuns } = await import(pathToFileURL(path.join(distDir, 'run-storage.js')));
const { recordFinding } = await import(pathToFileURL(path.join(distDir, 'review-evidence.js')));
const { exportReviewReport } = await import(pathToFileURL(path.join(distDir, 'review-report.js')));
const git = (f, ...args) => execFileSync('git', ['-C', f.repo, ...args], { stdio: 'pipe' });
const write = (f, name, data) => { mkdirSync(path.dirname(path.join(f.repo, name)), { recursive: true }); writeFileSync(path.join(f.repo, name), data); };
const args = (f, taskId = 'task-1') => ({ repositoryPath: f.repo, taskId, checks: 'passed', files: ['sum.js'] });

async function runtime(t, handler) {
  const calls = [];
  const server = createServer(async (req, res) => {
    let text = ''; for await (const data of req) text += data;
    const body = text ? JSON.parse(text) : {};
    calls.push({ url: req.url, body });
    const result = req.url === '/api/show' ? { model_info: { 'general.architecture': 'qwen2', 'qwen2.context_length': 32768 }, capabilities: ['completion'] }
      : await handler?.(body) ?? { model: 'test:local', done: true, done_reason: 'stop', message: { role: 'assistant', content: 'sum.js: reduce without initial value throws for [].' }, prompt_eval_count: 400, eval_count: 30 };
    if (!res.destroyed) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(result)); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return { calls, baseUrl: `http://127.0.0.1:${server.address().port}` };
}
async function enabled(t, handler) {
  const f = fixture(t, { git: true });
  const site = await runtime(t, handler);
  write(f, 'sum.js', 'export const sum = xs => xs.reduce((a,b) => a+b);\n');
  savePreferences(f.repo, { schemaVersion: 1, provider: 'ollama', model: 'test:local', baseUrl: site.baseUrl, background: true });
  configureAutoReview(f.repo, 'enable');
  return { ...f, site };
}

test('automatic review is inert without opt-in; setup alone never authorizes it', async t => {
  const f = fixture(t, { git: true });
  savePreferences(f.repo, { schemaVersion: 1, provider: 'claude-web', background: true });
  assert.equal((await automaticReview(args(f))).state, 'disabled');
  assert.equal(existsSync(path.join(f.repo, '.giviloop/runs')), false);
  assert.equal(configureAutoReview(f.repo, 'status').enabled, false);
  assert.equal(existsSync(path.join(f.repo, 'AGENTS.md')), false);
});

test('enable/disable preserve other agent instructions, pin consent and reject malformed/symlink paths', async t => {
  const f = fixture(t, { git: true });
  assert.throws(() => configureAutoReview(f.repo, 'enable'), /Choose an automatic reviewer/);
  savePreferences(f.repo, { schemaVersion: 1, provider: 'claude-web', background: false });
  write(f, 'AGENTS.md', 'Keep these project instructions.\n');
  configureAutoReview(f.repo, 'enable');
  configureAutoReview(f.repo, 'enable');
  const text = readFileSync(path.join(f.repo, 'AGENTS.md'), 'utf8');
  assert.equal(text.split('<!-- giviloop:auto-review:start -->').length, 2);
  assert.ok(text.includes(AUTO_REVIEW_INSTRUCTIONS));
  assert.equal(configureAutoReview(f.repo, 'status').reviewer.background, true);
  savePreferences(f.repo, { schemaVersion: 1, provider: 'chatgpt-web', background: true });
  assert.equal(configureAutoReview(f.repo, 'status').reviewer.provider, 'claude-web');
  configureAutoReview(f.repo, 'disable');
  assert.equal(configureAutoReview(f.repo, 'status').enabled, false);
  assert.match(readFileSync(path.join(f.repo, 'AGENTS.md'), 'utf8'), /Keep these project instructions/);
  assert.doesNotMatch(readFileSync(path.join(f.repo, 'AGENTS.md'), 'utf8'), /givi_auto_review/);
  write(f, 'AGENTS.md', '<!-- giviloop:auto-review:start --> broken');
  assert.throws(() => configureAutoReview(f.repo, 'enable'), /Malformed/);
  assert.equal(configureAutoReview(f.repo, 'status').enabled, false);
  const g = fixture(t, { git: true });
  symlinkSync(f.root, path.join(g.repo, '.giviloop'));
  assert.throws(() => configureAutoReview(g.repo, 'enable'), /Symbolic/);
});

test('failed checks, docs-only and explicit empty scope send nothing and do not consume the task', async t => {
  const f = await enabled(t);
  assert.equal((await automaticReview({ ...args(f), checks: 'failed' })).reason, 'checks-failed');
  write(f, 'README.md', 'new documentation');
  assert.equal((await automaticReview({ ...args(f), files: ['README.md'] })).reason, 'no-eligible-code-changes');
  assert.equal((await automaticReview({ ...args(f), files: [] })).reason, 'no-eligible-code-changes');
  assert.equal(f.site.calls.length, 0);
  assert.equal((await automaticReview(args(f))).state, 'completed');
});

test('local roundtrip verifies an actual bug; persistent task/diff guards suppress retries and review-fix loops', async t => {
  const f = await enabled(t);
  write(f, 'unrelated.js', 'PRIVATE_UNRELATED_BODY');
  const sent = await automaticReview(args(f));
  assert.equal(sent.state, 'completed');
  assert.equal(sent.assessment, 'pending-independent-verification');
  assert.equal(sent.sourceChanged, false);
  assert.equal((await automaticReview(args(f))).reason, 'task-already-reviewed');
  assert.equal((await automaticReview(args(f, 'different-task'))).reason, 'unchanged-snapshot');
  const request = f.site.calls.find(c => c.url === '/api/chat').body.messages[0].content;
  assert.match(request, /xs\.reduce/);
  assert.doesNotMatch(request, /PRIVATE_UNRELATED_BODY/);
  assert.throws(() => [].reduce((a,b) => a+b), TypeError);
  recordFinding({ repositoryPath: f.repo, runId: sent.runId, title: 'Empty array throws', claim: 'sum([]) throws', status: 'confirmed', reason: 'Independent reproduction', evidence: ['assert.throws(() => [].reduce((a,b) => a+b), TypeError) passed'], files: ['sum.js'] });
  assert.equal(exportReviewReport(f.repo, sent.runId).totals.confirmed, 1);
  write(f, 'sum.js', 'export const sum = xs => xs.reduce((a,b) => a+b, 0);\n');
  const afterFix = await automaticReview(args(f));
  assert.equal(afterFix.reason, 'task-already-reviewed');
  assert.equal(afterFix.sourceChanged, true);
  assert.equal(f.site.calls.filter(c => c.url === '/api/chat').length, 1);
  assert.equal((await automaticReview(args(f, 'next-user-task'))).state, 'completed');
  pruneCompletedRuns(f.repo, 0);
  assert.ok(existsSync(f.latest().dir), 'automatic history references survive normal run cleanup');
});

test('snapshot includes staged/unstaged/deleted/new literal filenames, redacts credentials and rejects unsafe or oversized context', async t => {
  const f = fixture(t, { git: true });
  write(f, 'odd [x] è.js', 'export const value = 1;\n');
  write(f, 'deleted.js', 'export const gone = true;\n');
  git(f, 'add', '.'); git(f, 'commit', '-m', 'baseline');
  write(f, 'odd [x] è.js', 'export const value = 2;\n'); git(f, 'add', 'odd [x] è.js');
  write(f, 'odd [x] è.js', 'export const value = 3;\n');
  git(f, 'rm', 'deleted.js');
  write(f, 'new.js', 'const api_key = "sk-abcdefghijklmnopqrstuvxyz";\n');
  write(f, 'credentials.js', 'SECRET_FILE'); write(f, 'dist/bundle.js', 'GENERATED_FILE');
  const result = automaticSnapshot(f.repo);
  assert.deepEqual(result.files, ['deleted.js', 'new.js', 'odd [x] è.js']);
  assert.match(result.context, /value = 3/); assert.match(result.context, /deleted/); assert.match(result.context, /REDACTED/);
  assert.doesNotMatch(result.context, /SECRET_FILE|GENERATED_FILE|sk-abcdefgh/);
  assert.throws(() => automaticSnapshot(f.repo, ['../outside.js']), /inside the repository/);
  symlinkSync(path.join(f.repo, 'new.js'), path.join(f.repo, 'link.js'));
  assert.throws(() => automaticSnapshot(f.repo, ['link.js']), /Symbolic/);
  write(f, 'large.js', 'x'.repeat(60001));
  assert.throws(() => automaticSnapshot(f.repo, ['large.js']), /oversized/);
});

test('suspension survives new tasks, disable/enable and process restart; explicit acknowledgement never resends', async t => {
  const f = await enabled(t, () => ({ model: 'test:local', done: false }));
  const failed = await automaticReview(args(f));
  assert.equal(failed.state, 'failed');
  write(f, 'sum.js', 'export const sum = xs => 0;\n');
  configureAutoReview(f.repo, 'disable'); configureAutoReview(f.repo, 'enable');
  const blocked = f.cli('auto-review', ['run', '--task-id', 'another-task', '--checks', 'passed', '--file', 'sum.js']);
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.equal(JSON.parse(blocked.stdout).state, 'suspended');
  assert.equal(f.site.calls.filter(c => c.url === '/api/chat').length, 1);
  assert.equal(acknowledgeAutomaticReview(f.repo, failed.runId).acknowledged, true);
  assert.equal((await automaticReview(args(f))).reason, 'task-already-reviewed');
  assert.equal(f.site.calls.filter(c => c.url === '/api/chat').length, 1);
  assert.equal((await automaticReview(args(f, 'new-task-after-inspection'))).state, 'failed');
  assert.equal(f.site.calls.filter(c => c.url === '/api/chat').length, 2);
});

test('concurrent invocation sends once and edits during a response mark the result stale', async t => {
  let started, finish;
  const entered = new Promise(resolve => { started = resolve; });
  const wait = new Promise(resolve => { finish = resolve; });
  const f = await enabled(t, async () => { started(); await wait; });
  const first = automaticReview(args(f));
  await entered;
  assert.equal((await automaticReview(args(f, 'concurrent-task'))).state, 'busy');
  write(f, 'sum.js', 'export const sum = xs => xs.reduce((a,b) => a+b, 0);\n');
  finish();
  assert.equal((await first).sourceChanged, true);
  assert.equal(f.site.calls.filter(c => c.url === '/api/chat').length, 1);
});

test('corrupt history, invalid controls and tampered storage fail closed without sending', async t => {
  const f = await enabled(t);
  await assert.rejects(automaticReview({ ...args(f), taskId: '' }), /taskId/);
  await assert.rejects(automaticReview({ ...args(f), checks: 'probably' }), /checks/);
  write(f, '.giviloop/auto-review/history.json', '[{}]');
  await assert.rejects(automaticReview(args(f)), /Invalid automatic-review history/);
  assert.equal(f.site.calls.length, 0);
  assert.notEqual(f.cli('auto-review', ['run', '--task-id', 'x', '--checks', 'passed', '--force']).status, 0);
  assert.notEqual(f.cli('auto-review', ['enable', '--task-id', 'x']).status, 0);
});

test('cancellation preserves the attempt, suspends later tasks and never saves an incomplete answer', async t => {
  let entered, finish;
  const started = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { finish = resolve; });
  const f = await enabled(t, async () => { entered(); await gate; });
  const controller = new AbortController();
  const pending = automaticReview({ ...args(f), signal: controller.signal });
  await started;
  controller.abort();
  const result = await pending;
  finish();
  assert.equal(result.state, 'failed');
  assert.equal(existsSync(f.latest().response), false);
  assert.equal((await automaticReview(args(f, 'next-task'))).state, 'suspended');
  assert.equal(f.site.calls.filter(c => c.url === '/api/chat').length, 1);
  assert.equal(existsSync(path.join(f.repo, '.giviloop/auto-review/review.lock')), false);
});

test('persisted interrupted attempts do not resend even when no worker remains', async t => {
  const f = await enabled(t);
  await automaticReview(args(f));
  const file = path.join(f.latest().dir, 'local-status.json');
  const status = JSON.parse(readFileSync(file));
  status.outcome = 'running';
  writeFileSync(file, JSON.stringify(status));
  const result = await automaticReview(args(f, 'after-worker-crash'));
  assert.equal(result.state, 'suspended');
  assert.equal(result.reviewState, 'interrupted');
  assert.equal(f.site.calls.filter(c => c.url === '/api/chat').length, 1);
});

test('indentation edits are eligible, while large combined context and unborn repositories fail before a send', t => {
  const f = fixture(t, { git: true });
  write(f, 'indent.py', 'def f():\n    return 1\n');
  git(f, 'add', 'indent.py'); git(f, 'commit', '-m', 'python');
  write(f, 'indent.py', 'def f():\n  return 1\n');
  assert.deepEqual(automaticSnapshot(f.repo, ['indent.py']).files, ['indent.py']);
  for (const name of ['a.js', 'b.js', 'c.js']) write(f, name, 'x'.repeat(45000));
  assert.throws(() => automaticSnapshot(f.repo, ['a.js','b.js','c.js']), /120 KB/);
  const g = fixture(t); git(g, 'init');
  assert.throws(() => automaticSnapshot(g.repo), /initial commit/);
});

test('MCP end-of-task tool runs the real local transport and CLI sees the same deduplication history', async t => {
  const f = await enabled(t);
  const client = new Client({ name: 'auto-review-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(distDir, 'mcp-server.js')], env: f.env, stderr: 'pipe' }));
  try {
    const result = await client.callTool({ name: 'givi_auto_review', arguments: args(f) });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const sent = JSON.parse(result.content[0].text);
    assert.equal(sent.state, 'completed');
    const duplicate = f.cli('auto-review', ['run', '--task-id', 'task-1', '--checks', 'passed', '--file', 'sum.js']);
    assert.equal(JSON.parse(duplicate.stdout).reason, 'task-already-reviewed');
    const read = await client.callTool({ name: 'givi_read_external_review', arguments: { repositoryPath: f.repo, runId: sent.runId } });
    assert.match(read.content.map(c => c.text).join('\n'), /reduce without initial/);
    assert.equal(f.site.calls.filter(c => c.url === '/api/chat').length, 1);
  } finally { await client.close(); }
});
