import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fixture, distDir } from './helpers.mjs';

test('noninteractive setup exports usable MCP config in paths with spaces, no browser or editor edits', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.repo, 'settings.json'), '{"keep":true}');
  const result = f.cli('setup', ['--provider', 'manual', '--non-interactive']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.provider, 'manual');
  assert.equal(report.access, 'not checked');
  const config = JSON.parse(readFileSync(report.mcpConfigPath, 'utf8'));
  assert.equal(config.mcpServers.giviloop.command, process.execPath);
  assert.equal(realpathSync(config.mcpServers.giviloop.args[0]), realpathSync(path.join(distDir, 'mcp-server.js')));
  assert.equal(readFileSync(path.join(f.repo, 'settings.json'), 'utf8'), '{"keep":true}');
  assert.deepEqual(f.osCalls(), []);
  assert.equal(existsSync(path.join(f.repo, '.giviloop/runs')), false);
});

test('setup defaults are non-blocking on piped input; no implicit login or generation', t => {
  const f = fixture(t);
  const result = f.cli('setup', []);
  const report = JSON.parse(result.stdout);
  assert.equal(report.provider, 'chatgpt-web');
  assert.equal(report.access, 'not checked');
  assert.match(report.nextCommands.login, / login --repo /);
  assert.ok(report.nextCommands.login.includes(f.repo));
  assert.deepEqual(f.osCalls(), []);
});

test('manual opt-in demo only prepares bundled public source in a separate directory', t => {
  const f = fixture(t);
  writeFileSync(path.join(f.repo, 'private.txt'), 'PRIVATE_SOURCE_NEVER_INCLUDED');
  const result = f.cli('setup', ['--provider', 'manual', '--non-interactive', '--demo']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.demo.submitted, false);
  assert.equal(existsSync(path.join(report.demo.repositoryPath, 'sum.ts')), true);
  const id = readFileSync(path.join(report.demo.repositoryPath, '.giviloop/latest-run-id'), 'utf8').trim();
  const request = readFileSync(path.join(report.demo.repositoryPath, '.giviloop/runs', id, 'external-review-request.md'), 'utf8');
  assert.match(request, /values.reduce/);
  assert.doesNotMatch(request, /PRIVATE_SOURCE/);
  assert.equal(existsSync(path.join(f.repo, '.giviloop/latest-run-id')), false);
  assert.deepEqual(f.osCalls(), []);
});

test('setup rejects invalid/contradictory choices before opening browsers or sending', t => {
  const f = fixture(t);
  for (const args of [['--provider', 'unknown'], ['--login', '--check'], ['--provider', 'ollama', '--login'], ['--provider', 'ollama', '--demo'], ['--provider', 'manual', '--model', 'wrong'], ['--chek']]) {
    assert.notEqual(f.cli('setup', ['--non-interactive', ...args]).status, 0, args.join(' '));
  }
  assert.deepEqual(f.osCalls(), []);
  assert.equal(existsSync(path.join(f.repo, '.giviloop')), false);
});

test('setup refuses symlinked storage instead of overwriting an external file', t => {
  const f = fixture(t);
  symlinkSync(f.root, path.join(f.repo, '.giviloop'), 'dir');
  const result = f.cli('setup', ['--provider', 'manual', '--non-interactive']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Symbolic links/);
  assert.equal(existsSync(path.join(f.root, 'mcp.json')), false);
});
