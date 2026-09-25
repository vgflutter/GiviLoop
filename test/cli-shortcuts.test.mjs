import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixture, distDir } from './helpers.mjs';

const { opinionArgs } = await import(pathToFileURL(path.join(distDir, 'cli-shortcuts.js')));
const { configuredCliArgs } = await import(pathToFileURL(path.join(distDir, 'cli-preferences.js')));
const { savePreferences } = await import(pathToFileURL(path.join(distDir, 'preferences.js')));
const { normalizeCliArgs, commandSpecs } = await import(pathToFileURL(path.join(distDir, 'cli-interface.js')));

test('every command has side-effect-free help and rejects unknown options before execution', t => {
  const f = fixture(t);
  for (const command of [...Object.keys(commandSpecs), 'login', 'check']) {
    const help = f.cli(command, ['--help']);
    assert.equal(help.status, 0, `${command}: ${help.stderr}`);
    assert.match(help.stdout, /Usage: givi/);
    assert.match(help.stdout, /--repo PATH/);
    const invalid = f.cli(command, ['--typo-option']);
    assert.notEqual(invalid.status, 0, command);
    assert.match(invalid.stderr, /Unknown option/);
  }
  assert.equal(existsSync(path.join(f.repo, '.giviloop')), false);
  assert.deepEqual(f.osCalls(), []);
});

test('short forms share canonical options and reject ambiguous destinations and run IDs', () => {
  for (const command of ['answer', 'status', 'open', 'resume', 'cancel', 'send', 'copy', 'ingest', 'report']) {
    assert.deepEqual(normalizeCliArgs([command, 'RUN']), [command, '--run-id=RUN']);
    assert.throws(() => normalizeCliArgs([command, 'RUN', '--run-id', 'OTHER']), /Usage/);
  }
  assert.deepEqual(normalizeCliArgs(['login']), ['browser', 'login']);
  assert.deepEqual(normalizeCliArgs(['check']), ['browser', 'check']);
  assert.throws(() => normalizeCliArgs(['login', '--background']), /explicitly opens a visible browser/);
  assert.deepEqual(normalizeCliArgs(['findings']), ['findings', 'list']);
  assert.deepEqual(normalizeCliArgs(['auto-review']), ['auto-review', 'status']);
  assert.deepEqual(normalizeCliArgs(['recheck', 'FINDING', '-fa.ts']), ['recheck', '--file=a.ts', '--finding-id=FINDING']);
  assert.deepEqual(normalizeCliArgs(['send', '--provider', 'ollama']), ['send', '--send=ollama']);
  assert.deepEqual(normalizeCliArgs(['review', '--provider', 'chatgpt-chat']), ['review', '--target-provider=chatgpt-chat']);
  assert.throws(() => normalizeCliArgs(['send', '--provider', 'ollama', '--send', 'chatgpt-web']), /Repeated option/);
  assert.throws(() => normalizeCliArgs(['status', '--repo', 'a', '--repositoryPath', 'b']), /Repeated option/);
  assert.throws(() => normalizeCliArgs(['review', '--foreground', '--background']), /Choose only one/);
});

test('positional ask and prepare remain unsent; clipboard and selected-run shortcuts preserve run identity', t => {
  const f = fixture(t, { git: true });
  writeFileSync(path.join(f.repo, 'context with spaces.ts'), 'SELECTED_CONTEXT');
  assert.equal(f.cli('ask', ['Question with spaces', '-fcontext with spaces.ts']).status, 0);
  const first = f.latest();
  assert.match(readFileSync(first.request, 'utf8'), /Question with spaces/);
  assert.match(readFileSync(first.request, 'utf8'), /SELECTED_CONTEXT/);
  assert.equal(existsSync(path.join(first.dir, 'browser-status.json')), false);
  assert.equal(f.cli('prepare', ['Inspect current changes']).status, 0);
  assert.notEqual(f.latest().id, first.id);
  assert.equal(f.cli('copy', [first.id]).status, 0);
  assert.equal(readFileSync(f.clipboard, 'utf8'), readFileSync(first.request, 'utf8'));
  writeFileSync(f.clipboard, 'MANUAL_SELECTED_ANSWER');
  assert.equal(f.cli('ingest', [first.id]).status, 0);
  assert.match(f.cli('answer', [first.id]).stdout, /MANUAL_SELECTED_ANSWER/);
  assert.notEqual(f.cli('answer').status, 0);
  assert.match(f.cli('status', [first.id, '--json']).stdout, new RegExp(first.id));
});

test('help-looking question is literal data after the option terminator', t => {
  const f = fixture(t);
  const result = f.cli('ask', ['--', '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(f.latest().request, 'utf8'), /--help/);
});

test('opinion accepts one quoted question and rejects ambiguous input before creating a run', t => {
  assert.deepEqual(opinionArgs(['Qual è il rischio?', '-f', 'a b.ts', '-fc.ts']), ['--file=a b.ts', '--file=c.ts', '--question=Qual è il rischio?']);
  assert.deepEqual(opinionArgs(['--', '--send']), ['--question=--send']);
  assert.deepEqual(opinionArgs(['-q', 'Second opinion']), ['--question=Second opinion']);
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
