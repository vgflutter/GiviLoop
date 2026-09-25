import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture, distDir } from './helpers.mjs';

const { opinionArgs } = await import(pathToFileURL(path.join(distDir, 'cli-shortcuts.js')));
const { configuredCliArgs } = await import(pathToFileURL(path.join(distDir, 'cli-preferences.js')));
const { savePreferences } = await import(pathToFileURL(path.join(distDir, 'preferences.js')));

test('opinion accepts one quoted question and rejects ambiguous input before creating a run', t => {
  assert.deepEqual(opinionArgs(['Qual è il rischio?', '-f', 'a b.ts', '-f', 'c.ts']), ['-f', 'a b.ts', '-f', 'c.ts', '--question=Qual è il rischio?']);
  assert.deepEqual(opinionArgs(['--', '--send']), ['--question=--send']);
  assert.deepEqual(opinionArgs(['-q', 'Second opinion']), ['-q', 'Second opinion']);
  const f = fixture(t);
  for (const args of [[], [''], ['two', 'questions'], ['first', '-q', 'second'], ['-q', 'first', '--question', 'second'], ['Question', '--bakground'], ['Question', '--file']]) {
    const result = f.cli('opinion', args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.equal(existsSync(path.join(f.repo, '.giviloop/runs')), false);
  }
});

test('opinion inherits only the chosen provider settings and respects manual preference', t => {
  const f = fixture(t), profile = path.join(f.root, 'dedicated-profile');
  savePreferences(f.repo, { schemaVersion: 1, provider: 'claude-web', background: true, browserProfile: profile });
  const normal = configuredCliArgs(['opinion', '--repo', f.repo, '--question=Review']);
  assert.ok(normal.includes('claude-web')); assert.ok(normal.includes(profile));
  const override = configuredCliArgs(['opinion', '--repo', f.repo, '--question=Review', '--send', 'chatgpt-web']);
  assert.ok(!override.includes(profile));
  assert.ok(!configuredCliArgs(['ask', '--repo', f.repo, '--question=Review']).includes('--send'));
  savePreferences(f.repo, { schemaVersion: 1, provider: 'manual', background: true });
  assert.throws(() => configuredCliArgs(['opinion', '--repo', f.repo, '--question=Review']), /Manual provider/);
});

test('answer refuses stale output from a failed attempt or a changed request', t => {
  const f = fixture(t);
  assert.equal(f.cli('ask', ['-q', 'Prepare']).status, 0);
  const run = f.latest();
  writeFileSync(run.response, 'Saved answer');
  assert.equal(f.cli('answer', []).stdout, 'Saved answer\n');
  const statusPath = path.join(run.dir, 'browser-status.json');
  writeFileSync(statusPath, JSON.stringify({ startedAt: new Date().toISOString(), outcome: 'failed' }));
  const failed = f.cli('answer', []);
  assert.notEqual(failed.status, 0); assert.equal(failed.stdout, '');
  writeFileSync(statusPath, JSON.stringify({ startedAt: new Date().toISOString(), outcome: 'completed', requestSha256: 'changed' }));
  assert.notEqual(f.cli('answer', []).status, 0);
  assert.equal(readFileSync(run.response, 'utf8'), 'Saved answer');
});
