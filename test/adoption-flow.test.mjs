import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, distDir } from './helpers.mjs';
const { recordFinding } = await import(pathToFileURL(path.join(distDir, 'review-evidence.js')));
const { exportReviewReport } = await import(pathToFileURL(path.join(distDir, 'review-report.js')));
const { pruneCompletedRuns } = await import(pathToFileURL(path.join(distDir, 'run-storage.js')));
function reviewed(t) {
  const f = fixture(t);
  writeFileSync(path.join(f.repo, 'code.js'), 'export const number = 1; // PRIVATE_SOURCE_BODY\n');
  assert.equal(f.cli('ask', ['--question', 'PRIVATE_PROMPT', '--file', 'code.js']).status, 0);
  writeFileSync(f.latest().response, 'PRIVATE_RAW_RESPONSE');
  return f;
}
const input = f => ({ repositoryPath: f.repo, runId: f.latest().id, title: 'Wrong number', claim: 'The number must be 2', files: ['code.js'], reason: 'Contract comparison', evidence: ['Independent assertion'], status: 'confirmed' });

test('report exports decisions and provenance without raw prompts/source or network-capable Markdown', t => {
  const f = reviewed(t);
  recordFinding({ ...input(f), title: '<img src="https://invalid.example/x">', evidence: ['![tracking](https://invalid.example/pixel)', 'api_key="sk-abcdefghijklmnopqrstuvxyz"'] });
  const result = f.cli('report', ['--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.totals.confirmed, 1);
  assert.equal(readFileSync(report.reportPath, 'utf8'), report.markdown);
  assert.match(report.markdown, /Request SHA-256: [a-f0-9]{64}/);
  assert.match(report.markdown, /code\.js/);
  assert.match(report.markdown, /REDACTED/);
  assert.doesNotMatch(report.markdown, /PRIVATE_SOURCE_BODY|PRIVATE_PROMPT|PRIVATE_RAW_RESPONSE|<img|!\[tracking\]|sk-abcdefgh/);
  assert.deepEqual(f.osCalls(), []);
});

test('report marks changed evidence unverified and never turns an empty ledger into a clean result', t => {
  const f = reviewed(t);
  const empty = exportReviewReport(f.repo, undefined, false);
  assert.match(empty.markdown, /No findings have been assessed/);
  assert.equal(existsSync(path.join(f.latest().dir, 'double-check.md')), false);
  const savedEmpty = exportReviewReport(f.repo);
  pruneCompletedRuns(f.repo, 0);
  assert.ok(existsSync(savedEmpty.reportPath), 'an explicitly exported report survives run retention');
  recordFinding(input(f));
  writeFileSync(path.join(f.repo, 'code.js'), 'export const number = 2;\n');
  const report = exportReviewReport(f.repo);
  assert.deepEqual(report.totals, { confirmed: 0, dismissed: 0, unverified: 1, stale: 1 });
  assert.match(report.markdown, /previous assessment: confirmed/);
  writeFileSync(f.latest().response, 'changed review');
  assert.match(exportReviewReport(f.repo).markdown, /Request or response changed/);
});

test('report warns when a saved answer survives a failed attempt and rejects busy/symlinked output', t => {
  const f = reviewed(t), run = f.latest();
  writeFileSync(path.join(run.dir, 'browser-status.json'), JSON.stringify({ startedAt: new Date().toISOString(), outcome: 'failed', provider: 'chatgpt-web', submitted: true }));
  assert.match(exportReviewReport(f.repo, undefined, false).markdown, /not recorded as successfully completed/);
  writeFileSync(path.join(run.dir, 'review.lock'), '{}');
  assert.throws(() => exportReviewReport(f.repo), /REVIEW_RUN_BUSY/);
});

test('report refuses a symlink export target and CLI typos without overwriting arbitrary files', t => {
  const f = reviewed(t), target = path.join(f.root, 'outside.md');
  writeFileSync(target, 'KEEP');
  symlinkSync(target, path.join(f.latest().dir, 'double-check.md'));
  assert.throws(() => exportReviewReport(f.repo), /Symbolic/);
  assert.equal(readFileSync(target, 'utf8'), 'KEEP');
  assert.notEqual(f.cli('report', ['--output', 'code.js']).status, 0);
  assert.notEqual(f.cli('report', ['--stdout', '--json']).status, 0);
});

test('corrupted persisted verdicts are rejected instead of exporting misleading zero counts', t => {
  const f = reviewed(t);
  recordFinding(input(f));
  const file = path.join(f.latest().dir, 'findings.json');
  const ledger = JSON.parse(readFileSync(file, 'utf8'));
  ledger.findings[0].history[0].status = 'unexpected-verdict';
  writeFileSync(file, JSON.stringify(ledger));
  assert.throws(() => exportReviewReport(f.repo), /Invalid finding ledger/);
  assert.equal(existsSync(path.join(f.latest().dir, 'double-check.md')), false);
});

test('offline demo completes without an account, labels authored evidence and preserves project state', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.repo, 'private.txt'), 'PRIVATE_DEMO_SOURCE');
  assert.equal(f.cli('setup', ['--provider', 'manual', '--non-interactive']).status, 0);
  const preferences = readFileSync(path.join(f.repo, '.giviloop/preferences.json'), 'utf8');
  const result = f.cli('demo', ['--offline', '--json'], { GIVILOOP_CHROME_PATH: '/does-not-exist' });
  assert.equal(result.status, 0, result.stderr);
  const demo = JSON.parse(result.stdout);
  assert.equal(demo.state, 'completed');
  assert.equal(demo.submitted, false);
  assert.match(demo.verification, /4 regression cases passed/);
  const markdown = readFileSync(demo.reportPath, 'utf8');
  assert.match(markdown, /offline illustration/);
  assert.match(markdown, /not an assessment of the external reviewer/);
  assert.doesNotMatch(markdown, /PRIVATE_DEMO_SOURCE/);
  const request = readFileSync(path.join(path.dirname(demo.responsePath), 'external-review-request.md'), 'utf8');
  assert.doesNotMatch(request, /PRIVATE_DEMO_SOURCE/);
  assert.equal(readFileSync(path.join(f.repo, '.giviloop/preferences.json'), 'utf8'), preferences);
  assert.equal(existsSync(path.join(f.repo, '.giviloop/latest-run-id')), false);
  assert.deepEqual(f.osCalls(), []);
  const finish = f.cli('demo', ['--finish', '--json']);
  assert.equal(finish.status, 0, finish.stderr);
  assert.equal(JSON.parse(finish.stdout).runId, demo.runId);
  assert.equal(JSON.parse(readFileSync(path.join(path.dirname(demo.reportPath), 'findings.json'))).findings.length, 1);
});

test('demo finish never executes a modified verifier or re-sends, and invalid choices create no demo', t => {
  const f = fixture(t);
  for (const flags of [['--offline', '--provider', 'claude-web'], ['--provider', 'manual'], ['--provider', 'ollama'], ['--finish', '--offline'], ['--typo']]) assert.notEqual(f.cli('demo', flags).status, 0);
  assert.equal(existsSync(path.join(f.repo, '.giviloop/demos')), false);
  const result = JSON.parse(f.cli('demo', ['--offline', '--json']).stdout);
  const marker = path.join(f.repo, 'should-not-exist');
  writeFileSync(path.join(result.repositoryPath, 'verify.mjs'), `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'bad');`);
  const finish = f.cli('demo', ['--finish']);
  assert.notEqual(finish.status, 0);
  assert.match(finish.stderr, /changed/);
  assert.equal(existsSync(marker), false);
  writeFileSync(path.join(f.repo, '.giviloop/latest-demo.json'), '{broken');
  const corrupted = f.cli('demo', ['--finish']);
  assert.equal(corrupted.status, 1);
  assert.match(corrupted.stderr, /GiviLoop error:/);
  assert.doesNotMatch(corrupted.stderr, /^\s+at /m, 'CLI catches malformed JSON without leaking an unhandled stack');
});

test('MCP exports the same portable report and keeps a recorded dismissal', async t => {
  const f = reviewed(t);
  recordFinding({ ...input(f), status: 'dismissed' });
  const client = new Client({ name: 'report-test', version: '1' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(distDir, 'mcp-server.js')], env: f.env, stderr: 'pipe' }));
  const response = await client.callTool({ name: 'givi_export_report', arguments: { repositoryPath: f.repo } });
  const report = JSON.parse(response.content.find(item => item.type === 'text').text);
  assert.equal(report.totals.dismissed, 1);
  assert.match(readFileSync(report.reportPath, 'utf8'), /\*\*dismissed\*\*/);
});
