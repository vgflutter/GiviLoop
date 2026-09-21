// Opt-in checks against actual providers. Sends synthetic code only.
// node scripts/live-e2e.mjs --web | --local
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const mode = process.argv[2];
assert.ok(['--web', '--local'].includes(mode), 'Choose --web (authenticated ChatGPT) or --local (four configured local runtimes).');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.giviloop/diagnostics/readme-refresh');
mkdirSync(output, { recursive: true });
const repo = mkdtempSync(path.join(os.tmpdir(), 'giviloop-live-e2e-'));
const client = new Client({ name: 'giviloop-live-e2e', version: '1.0.0' }, { capabilities: {} });
const hash = value => createHash('sha256').update(value).digest('hex');
const call = async (name, args) => {
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 360000 });
  assert.notEqual(result.isError, true, JSON.stringify(result)); return result;
};
const latest = () => {
  const runId = readFileSync(path.join(repo, '.giviloop/latest-run-id'), 'utf8').trim();
  return { runId, dir: path.join(repo, '.giviloop/runs', runId) };
};
const results = [];
try {
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/mcp-server.js')], env: { ...process.env, GIVILOOP_ALLOWED_REPOSITORIES: repo }, stderr: 'pipe' }));
  if (mode === '--web') {
    const original = 'export function takeLast<T>(items: T[], count: number): T[] {\n  if (count < 0) throw new RangeError("count");\n  if (count === 0) return [];\n  return items.slice(-count);\n}\n';
    const changed = original.replace('  if (count === 0) return [];\n', '');
    writeFileSync(path.join(repo, 'tail.ts'), original);
    for (const args of [['init'], ['add', 'tail.ts'], ['-c', 'user.name=GiviLoop fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Synthetic baseline']]) execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    writeFileSync(path.join(repo, 'tail.ts'), changed);
    const before = hash(changed);
    await call('givi_prepare_from_git', { repositoryPath: repo, taskGoal: 'Review the changes for a concrete regression. Contract: a nonnegative count returns up to the last count items; zero returns an empty array. Negative counts throw. Suggest a minimal fix and regression cases. Keep the response concise.' });
    const run = latest();
    const started = Date.now();
    await call('givi_send_to_web_llm', { repositoryPath: repo, runId: run.runId, webProvider: 'chatgpt-web', mode: 'auto', background: true, maxWaitMs: 120000, reviewResponseMode: 'analyze-only' });
    const response = readFileSync(path.join(run.dir, 'external-review-response.md'), 'utf8');
    const status = JSON.parse(readFileSync(path.join(run.dir, 'browser-status.json'), 'utf8'));
    const read = await call('givi_read_external_review', { repositoryPath: repo, runId: run.runId, reviewResponseMode: 'analyze-only' });
    assert.ok(read.content.some(item => item.type === 'text' && item.text.includes(response)));
    assert.equal(status.outcome, 'completed'); assert.equal(status.submitted, true);
    assert.equal(hash(readFileSync(path.join(repo, 'tail.ts'))), before);
    assert.match(response, /slice|count/);
    // Independent cases for the documented regression; never execute model output.
    const buggy = (items, count) => { if (count < 0) throw new RangeError('count'); return items.slice(-count); };
    const fixed = (items, count) => { if (count < 0) throw new RangeError('count'); if (count === 0) return []; return items.slice(-count); };
    assert.deepEqual(buggy([1, 2, 3], 0), [1, 2, 3]);
    for (const [items, count, expected] of [[[1,2,3],0,[]],[[1,2,3],1,[3]],[[1,2,3],2,[2,3]],[[1,2,3],3,[1,2,3]],[[1,2,3],8,[1,2,3]],[[],0,[]]]) assert.deepEqual(fixed(items,count),expected);
    assert.throws(() => fixed([1], -1), RangeError);
    results.push({ path: 'MCP prepare Git diff -> web send -> MCP read', runId: run.runId, durationMs: Date.now() - started, sourceUnchanged: true, verificationRequired: status.verificationRequired, independentCases: 7, webTokens: null });
    writeFileSync(path.join(output, 'mcp-web-response.md'), response);
  } else {
    copyFileSync(path.join(root, 'examples/double-check/sum.ts'), path.join(repo, 'sum.ts'));
    const before = hash(readFileSync(path.join(repo, 'sum.ts')));
    const engines = [
      { provider: 'ollama', model: 'qwen3:4b', reasoning: 'on' },
      { provider: 'llama-cpp', model: 'giviloop-qwen3-4b' },
      { provider: 'lmstudio', model: 'giviloop-qwen3-4b' },
      { provider: 'mlx', model: 'mlx-community/Qwen3-4B-4bit' },
    ];
    for (const engine of engines) {
      await call('givi_local_models', { provider: engine.provider });
      const started = Date.now();
      await call('givi_ask_local_llm', { repositoryPath: repo, ...engine, question: 'Check the stated contract. Find a concrete bug, the smallest fix and regression tests. Keep the final answer under 120 words.', attachedFiles: ['sum.ts'], contextTokens: 16384, maxOutputTokens: 8192, maxWaitMs: 300000, reviewResponseMode: 'analyze-only' });
      const run = latest(), response = readFileSync(path.join(run.dir, 'external-review-response.md'), 'utf8');
      const read = await call('givi_read_external_review', { repositoryPath: repo, runId: run.runId, reviewResponseMode: 'analyze-only' });
      assert.ok(read.content.some(item => item.type === 'text' && item.text.includes(response)));
      assert.equal(hash(readFileSync(path.join(repo, 'sum.ts'))), before);
      const usage = JSON.parse(readFileSync(path.join(run.dir, 'local-usage.json'), 'utf8'));
      const result = { ...engine, runId: run.runId, durationMs: Date.now() - started, sourceUnchanged: true, usage };
      results.push(result);
      writeFileSync(path.join(output, engine.provider + '-response.md'), response);
      console.log(JSON.stringify(result));
    }
  }
  writeFileSync(path.join(output, mode.slice(2) + '-e2e.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify({ completed: true, mode, count: results.length }));
} finally { await client.close(); rmSync(repo, { recursive: true, force: true }); }
