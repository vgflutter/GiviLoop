import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, symlinkSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, distDir, bridgePath } from './helpers.mjs';
const { recordFinding, readFindings, prepareRecheck } = await import(pathToFileURL(path.join(distDir, 'review-evidence.js')).href);
const { pruneCompletedRuns } = await import(pathToFileURL(path.join(distDir, 'run-storage.js')).href);

function reviewed(t) {
  const f = fixture(t);
  writeFileSync(path.join(f.repo, 'code.js'), 'export const value = 1;\n');
  assert.equal(f.cli('ask', ['--question', 'Check value', '--file', 'code.js', '--target-provider', 'claude-chat']).status, 0);
  const run = f.latest();
  writeFileSync(run.response, 'Claim: the value is wrong. Check the contract.');
  return { ...f, run, input: { repositoryPath: f.repo, runId: run.id, title: 'Wrong value', claim: 'Value should be 2', files: ['code.js'] } };
}

test('finding writes require an explicit run even when latest points to another completed review', t => {
  const f = reviewed(t);
  const first = recordFinding(f.input);
  assert.equal(f.cli('ask', ['--question', 'Another review', '--file', 'code.js']).status, 0);
  const second = f.latest();
  writeFileSync(second.response, 'Another answer, with independent findings.');
  const other = recordFinding({ ...f.input, runId: second.id });
  const before = [f.run, second].map(run => readFileSync(path.join(run.dir, 'findings.json'), 'utf8'));
  for (const args of [
    ['add', '--title', 'Late finding from first review', '--claim', 'Must not attach to latest'],
    ['update', '--id', other.findingId, '--status', 'unverified'],
  ]) {
    const result = f.cli('findings', args);
    assert.equal(result.status, 1, 'An omitted run ID must not select the latest ledger for writes');
    assert.match(result.stderr, /explicit runId.*--run-id/i);
  }
  assert.throws(() => recordFinding({ repositoryPath: f.repo, runId: second.id, id: first.findingId, status: 'unverified' }), /not found in selected run/);
  assert.deepEqual([f.run, second].map(run => readFileSync(path.join(run.dir, 'findings.json'), 'utf8')), before);
  const result = f.cli('findings', ['update', '--run-id', f.run.id, '--id', first.findingId, '--status', 'dismissed', '--reason', 'Contract requires 1', '--evidence', 'Inspected code.js: value is 1']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).runId, f.run.id);
  assert.equal(readFindings(f.repo, f.run.id).findings[0].history.length, 2);
  assert.equal(readFileSync(path.join(second.dir, 'findings.json'), 'utf8'), before[1]);
  assert.equal(f.latest().id, second.id);
});

test('the run/finding pair isolates updates even if two ledgers contain the same finding ID', t => {
  const f = reviewed(t), first = recordFinding(f.input);
  assert.equal(f.cli('ask', ['--question', 'Second review', '--file', 'code.js']).status, 0);
  const second = f.latest();
  writeFileSync(second.response, 'Second review response');
  recordFinding({ ...f.input, runId: second.id });
  // Deliberately simulate equal locally-scoped IDs; do not rely on randomness
  // to protect review identity. Each ledger keeps its own request/response hash.
  const ledgerPath = path.join(second.dir, 'findings.json');
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  ledger.findings[0].id = first.findingId;
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  const before = readFileSync(ledgerPath, 'utf8');
  for (const runId of [undefined, null, '', ' ', '../../bad', 42]) {
    assert.throws(() => recordFinding({ repositoryPath: f.repo, runId, id: first.findingId, status: 'unverified' }), /explicit runId/);
  }
  recordFinding({ repositoryPath: f.repo, runId: f.run.id, id: first.findingId, status: 'unverified', reason: 'Still assessing the first response' });
  assert.equal(readFindings(f.repo, f.run.id).findings[0].history.length, 2);
  assert.equal(readFileSync(ledgerPath, 'utf8'), before);
  recordFinding({ repositoryPath: f.repo, runId: second.id, id: first.findingId, status: 'unverified', reason: 'Assessing only the second response' });
  assert.equal(readFindings(f.repo, second.id).findings[0].history.at(-1).reason, 'Assessing only the second response');
  assert.equal(readFindings(f.repo, f.run.id).findings[0].history.at(-1).reason, 'Still assessing the first response');
});

test('MCP schema and runtime reject implicit finding writes and preserve the explicitly selected older review', async t => {
  const f = reviewed(t), first = recordFinding(f.input);
  assert.equal(f.cli('ask', ['--question', 'Second review', '--file', 'code.js']).status, 0);
  const second = f.latest(); writeFileSync(second.response, 'Second response');
  const other = recordFinding({ ...f.input, runId: second.id });
  const client = new Client({ name: 'run-scope-test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(distDir, 'mcp-server.js')], env: f.env, stderr: 'pipe' }));
  t.after(() => client.close());
  const tool = (await client.listTools()).tools.find(tool => tool.name === 'givi_record_finding');
  assert.ok(tool.inputSchema.required.includes('runId'));
  const before = [f.run, second].map(run => readFileSync(path.join(run.dir, 'findings.json'), 'utf8'));
  for (const arguments_ of [
    { repositoryPath: f.repo, title: 'From an older review', claim: 'Do not choose latest' },
    { repositoryPath: f.repo, id: other.findingId, status: 'unverified' },
  ]) await assert.rejects(client.callTool({ name: 'givi_record_finding', arguments: arguments_ }), /explicit runId|runId.*required/);
  await assert.rejects(client.callTool({ name: 'givi_record_finding', arguments: { repositoryPath: f.repo, runId: second.id, id: first.findingId, status: 'unverified' } }), /not found in selected run/);
  assert.deepEqual([f.run, second].map(run => readFileSync(path.join(run.dir, 'findings.json'), 'utf8')), before);
  await client.callTool({ name: 'givi_record_finding', arguments: { repositoryPath: f.repo, runId: f.run.id, id: first.findingId, status: 'dismissed', reason: 'Contract requires 1', evidence: ['code.js exports 1'] } });
  assert.equal(readFindings(f.repo, f.run.id).findings[0].status, 'dismissed');
  assert.equal(readFileSync(path.join(second.dir, 'findings.json'), 'utf8'), before[1]);
  assert.equal(f.latest().id, second.id);
});

test('CLI records decisions, preserves history, detects edits and never modifies source', t => {
  const f = reviewed(t);
  const added = f.cli('findings', ['add', '--run-id', f.run.id, '--title', 'Wrong value', '--claim', 'Value should be 2', '--file', 'code.js']);
  assert.equal(added.status, 0, added.stderr);
  const id = JSON.parse(added.stdout).findingId;
  const updated = f.cli('findings', ['update', '--run-id', f.run.id, '--id', id, '--status', 'dismissed', '--reason', 'Contract requires 1', '--evidence', 'Contract and assertion both specify 1']);
  assert.equal(updated.status, 0, updated.stderr);
  let report = JSON.parse(f.cli('findings', ['list', '--json']).stdout);
  assert.equal(report.findings[0].history.length, 2);
  assert.equal(report.findings[0].effectiveStatus, 'dismissed');
  assert.equal(report.findings[0].stale, false);
  writeFileSync(path.join(f.repo, 'code.js'), 'export const value = 2;\n');
  report = JSON.parse(f.cli('findings', ['list', '--json']).stdout);
  assert.equal(report.findings[0].effectiveStatus, 'unverified');
  assert.equal(report.findings[0].status, 'dismissed');
  assert.deepEqual(report.findings[0].changedFiles, ['code.js']);
  assert.match(f.cli('findings', ['list']).stdout, /stale; previous: dismissed/);
  assert.equal(readFileSync(path.join(f.repo, 'code.js'), 'utf8'), 'export const value = 2;\n');
});

test('confirmed and dismissed require explicit evidence, reason and file references', t => {
  const f = reviewed(t);
  for (const status of ['confirmed', 'dismissed']) {
    for (const partial of [{}, { reason: 'Reason' }, { reason: 'Reason', evidence: ['test passed'], files: [] }]) {
      assert.throws(() => recordFinding({ ...f.input, status, ...partial }), /require/);
    }
  }
  assert.equal(readFindings(f.repo).findings.length, 0);
  assert.throws(() => recordFinding({ ...f.input, status: 'fixed' }), /Status/);
});

test('changing either request or response invalidates decisions and prevents misleading updates/rechecks', t => {
  const f = reviewed(t);
  const { findingId } = recordFinding({ ...f.input, status: 'confirmed', reason: 'Reproduced', evidence: ['assert failed'] });
  const original = readFileSync(f.run.request, 'utf8');
  for (const file of [f.run.request, f.run.response]) {
    const content = readFileSync(file, 'utf8'); writeFileSync(file, content + '\nchanged');
    assert.equal(readFindings(f.repo).findings[0].effectiveStatus, 'unverified');
    assert.throws(() => recordFinding({ repositoryPath: f.repo, runId: f.run.id, id: findingId, status: 'unverified' }), /content changed/);
    assert.throws(() => prepareRecheck(f.repo, undefined, findingId), /content changed/);
    writeFileSync(file, content);
  }
  assert.equal(readFileSync(f.run.request, 'utf8'), original);
});

test('targeted recheck carries current context, lineage and provider but no verdict or submission', t => {
  const f = reviewed(t);
  const { findingId } = recordFinding(f.input);
  writeFileSync(path.join(f.repo, 'code.js'), 'export const value = 2;\n');
  writeFileSync(path.join(f.repo, 'contract.txt'), 'Value must be 2.\n');
  const result = f.cli('recheck', ['--run-id', f.run.id, '--finding-id', findingId, '--file', 'contract.txt']);
  assert.equal(result.status, 0, result.stderr);
  const recheck = JSON.parse(result.stdout);
  assert.equal(recheck.submitted, false);
  assert.notEqual(recheck.runId, f.run.id);
  assert.match(readFileSync(recheck.requestPath, 'utf8'), /value = 2/);
  assert.match(readFileSync(recheck.requestPath, 'utf8'), /Value must be 2/);
  const metadata = JSON.parse(readFileSync(f.latest().metadata, 'utf8'));
  assert.equal(metadata.targetProvider, 'claude-chat');
  assert.equal(metadata.parentFindingId, findingId);
  assert.equal(metadata.parentRunId, f.run.id);
  assert.equal(metadata.sourceSnapshot.length, 2);
  assert.equal(existsSync(f.latest().response), false);
  assert.equal(readFindings(f.repo, f.run.id).findings[0].history.length, 1);
  assert.deepEqual(f.osCalls(), []);
});

test('deleted source is stale and explicitly represented in a recheck', t => {
  const f = reviewed(t); const { findingId } = recordFinding(f.input);
  rmSync(path.join(f.repo, 'code.js'));
  assert.equal(readFindings(f.repo).findings[0].stale, true);
  const result = prepareRecheck(f.repo, undefined, findingId);
  assert.match(readFileSync(result.requestPath, 'utf8'), /File deleted/);
});

test('rejects traversal, secrets and symlinked source/storage without writing outside repo', t => {
  const f = reviewed(t);
  const outside = path.join(f.root, 'outside'); mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret'), 'do not read');
  symlinkSync(outside, path.join(f.repo, 'linked'), 'dir');
  for (const file of ['../outside/secret', 'linked/secret', '.env', '.git/config', '.giviloop/setup.json']) {
    assert.throws(() => recordFinding({ ...f.input, files: [file] }), /inside|Symbolic|Sensitive/);
  }
  assert.throws(() => readFindings(f.repo, '../../bad'), /Invalid/);
  symlinkSync(path.join(outside, 'new.json'), path.join(f.run.dir, 'findings.json'));
  assert.throws(() => recordFinding(f.input), /Symbolic/);
  assert.equal(existsSync(path.join(outside, 'new.json')), false);
});

test('review writer lock prevents evidence races; findings survive retention', t => {
  const f = reviewed(t);
  writeFileSync(path.join(f.run.dir, 'review.lock'), '{}');
  assert.throws(() => recordFinding(f.input), /REVIEW_RUN_BUSY/);
  rmSync(path.join(f.run.dir, 'review.lock'));
  recordFinding(f.input);
  pruneCompletedRuns(f.repo, 0);
  assert.equal(existsSync(f.run.response), true);
});

test('no response, unknown finding and invalid CLI arguments fail explicitly', t => {
  const f = reviewed(t);
  assert.throws(() => recordFinding({ ...f.input, id: 'F-missing', status: 'unverified', title: undefined, claim: undefined }), /not found/);
  for (const args of [['update'], ['add', '--typo', 'x'], ['list', '--status', 'confirmed']]) {
    assert.notEqual(f.cli('findings', args).status, 0);
  }
  assert.match(f.cli('findings', ['list']).stdout, /does not mean the code is clean/);
  rmSync(f.run.response);
  assert.throws(() => recordFinding(f.input), /ENOENT/);
});

test('evidence is redacted text and never executed', t => {
  const f = reviewed(t);
  const marker = path.join(f.repo, 'marker');
  recordFinding({ ...f.input, status: 'confirmed', reason: 'Independently tested', evidence: [`touch ${marker}`, 'api_key="sk-abcdefghijklmnopqrstuvxyz"'] });
  const content = readFileSync(path.join(f.run.dir, 'findings.json'), 'utf8');
  assert.match(content, /REDACTED/);
  assert.equal(existsSync(marker), false);
});

test('recheck rejects missing extra files and binary/oversized context before creating a new run', t => {
  const f = reviewed(t); const { findingId } = recordFinding(f.input);
  assert.throws(() => prepareRecheck(f.repo, f.run.id, findingId, ['missing-contract.txt']), /ENOENT/);
  writeFileSync(path.join(f.repo, 'code.js'), 'binary\0bytes');
  assert.throws(() => prepareRecheck(f.repo, f.run.id, findingId), /binary/);
  writeFileSync(path.join(f.repo, 'code.js'), 'x'.repeat(400001));
  assert.throws(() => prepareRecheck(f.repo, f.run.id, findingId), /400000/);
  assert.equal(f.latest().id, f.run.id);
});

test('recheck redacts source and hashes exactly the original source bytes', t => {
  const f = reviewed(t); const { findingId } = recordFinding(f.input);
  writeFileSync(path.join(f.repo, 'config.txt'), 'api_key="sk-abcdefghijklmnopqrstuvxyz"\n');
  const result = prepareRecheck(f.repo, f.run.id, findingId, ['config.txt']);
  const request = readFileSync(result.requestPath, 'utf8');
  assert.match(request, /REDACTED/);
  assert.doesNotMatch(request, /sk-abcdefgh/);
  const snapshot = JSON.parse(readFileSync(f.latest().metadata, 'utf8')).sourceSnapshot;
  assert.equal(snapshot.length, 2);
  assert.match(snapshot[1].sha256, /^[a-f0-9]{64}$/);
});

test('MCP records, reads and prepares a recheck across server restarts', async t => {
  const f = reviewed(t);
  async function connect() {
    const c = new Client({ name: 'evidence-test', version: '1' });
    await c.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', bridgePath, path.join(distDir, 'mcp-server.js')], env: f.env, stderr: 'pipe' }));
    t.after(() => c.close()); return c;
  }
  const client = await connect();
  const parse = result => JSON.parse(result.content.find(x => x.type === 'text').text);
  const added = parse(await client.callTool({ name: 'givi_record_finding', arguments: f.input }));
  await client.close();
  const second = await connect();
  await second.callTool({ name: 'givi_record_finding', arguments: { repositoryPath: f.repo, runId: f.run.id, id: added.findingId, status: 'dismissed', reason: 'Contract', evidence: ['Expected value is 1'] } });
  const report = parse(await second.callTool({ name: 'givi_list_findings', arguments: { repositoryPath: f.repo, runId: f.run.id } }));
  assert.equal(report.findings[0].effectiveStatus, 'dismissed');
  const recheck = parse(await second.callTool({ name: 'givi_prepare_recheck', arguments: { repositoryPath: f.repo, runId: f.run.id, findingId: added.findingId } }));
  assert.equal(recheck.submitted, false);
  assert.equal(recheck.parentFindingId, added.findingId);
});
