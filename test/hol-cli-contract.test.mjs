import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { bridgePath, cliPath, fixture } from './helpers.mjs';

// Executes the six CLI operations proposed by HOL #3112. HOL's native
// fixtures separately inspect command text and deliberately execute nothing.
test('HOL CLI boundary: six real operations retain explicit review identity', async t => {
  const f = fixture(t, { git: true });
  let submissions = 0;
  const server = createServer(async (req, res) => {
    for await (const chunk of req) { /* consume the request */ }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/show') res.end(JSON.stringify({ capabilities: ['completion'], model_info: { 'general.architecture': 'qwen2', 'qwen2.context_length': 32768 } }));
    else {
      submissions++;
      res.end(JSON.stringify({ model: 'test:local', done: true, done_reason: 'stop', message: { role: 'assistant', content: 'Check empty input in sum.js.' } }));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const cli = async (...args) => {
    const { stdout } = await promisify(execFile)(process.execPath,
      ['--import', bridgePath, cliPath, ...args, '--repo', f.repo],
      { env: f.env, timeout: 20000 }).catch(error => { throw new Error(`${error.message}\n${error.stdout}`, { cause: error }); });
    return JSON.parse(stdout);
  };
  writeFileSync(path.join(f.repo, 'sum.js'), 'export const sum = xs => xs.reduce((a,b) => a+b);\n');
  await cli('setup', '--provider', 'ollama', '--model', 'test:local', '--base-url', `http://127.0.0.1:${server.address().port}`, '--non-interactive');
  assert.equal((await cli('auto-review', 'enable')).enabled, true);
  const first = await cli('auto-review', 'run', '--task-id', 'hol-first', '--checks', 'passed', '--file', 'sum.js');
  assert.equal(first.state, 'completed');
  const finding = await cli('findings', 'add', '--run-id', first.runId, '--title', 'Empty input', '--claim', 'Check reduce initial value', '--file', 'sum.js');
  writeFileSync(path.join(f.repo, 'sum.js'), 'export const sum = xs => xs.reduce((a,b) => a+b, 0);\n');
  const second = await cli('auto-review', 'run', '--task-id', 'hol-second', '--checks', 'passed', '--file', 'sum.js');
  assert.equal(second.state, 'completed');
  assert.notEqual(first.runId, second.runId);
  await assert.rejects(cli('findings', 'update', '--id', finding.findingId, '--status', 'unverified'), /explicit runId/);
  await assert.rejects(cli('findings', 'update', '--run-id', second.runId, '--id', finding.findingId, '--status', 'unverified'), /not found in selected run/);
  const updated = await cli('findings', 'update', '--run-id', first.runId, '--id', finding.findingId, '--status', 'unverified', '--reason', 'Still checking the first review');
  assert.equal(updated.runId, first.runId);
  assert.equal((await cli('findings', 'list', '--run-id', second.runId, '--json')).findings.length, 0);
  await cli('auto-review', 'acknowledge', '--run-id', first.runId);
  assert.equal((await cli('auto-review', 'disable')).enabled, false);
  assert.equal(submissions, 2, 'acknowledgement and findings must never resubmit');
  assert.deepEqual(f.osCalls(), [], 'this contract check must not open a browser');
});
