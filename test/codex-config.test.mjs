import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { distDir, fixture } from './helpers.mjs';
const { configureAutoReview } = await import(pathToFileURL(path.join(distDir, 'auto-review.js')));
const { savePreferences } = await import(pathToFileURL(path.join(distDir, 'preferences.js')));
const { configureCodexClient } = await import(pathToFileURL(path.join(distDir, 'codex-config.js')));
const read = file => readFileSync(file, 'utf8');
function setup(t) {
  const f = fixture(t, { git: true });
  savePreferences(f.repo, { schemaVersion: 1, provider: 'claude-web', background: true });
  mkdirSync(path.join(f.repo, '.codex'));
  return { ...f, config: path.join(f.repo, '.codex/config.toml') };
}

test('Codex opt-in connects the installed server and scopes automatic approval to the review workflow', t => {
  const f = setup(t);
  const result = f.cli('auto-review', ['enable', '--client', 'codex']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).codexConfigPath, realpathSync(f.config));
  const config = read(f.config);
  assert.ok(config.includes(`command = ${JSON.stringify(process.execPath)}`));
  assert.ok(config.includes(JSON.stringify(realpathSync(path.join(distDir, 'mcp-server.js')))));
  assert.match(config, /default_tools_approval_mode = "prompt"/);
  assert.deepEqual([...config.matchAll(/\[mcp_servers\.giviloop\.tools\.(\w+)\]\napproval_mode = "approve"/g)].map(m => m[1]).sort(),
    ['givi_auto_review', 'givi_export_report', 'givi_list_findings', 'givi_read_external_review', 'givi_record_finding', 'givi_status']);
  assert.doesNotMatch(config, /approval_policy|trust_level|givi_resume|givi_send|givi_open|givi_auto_review_acknowledge/);
  assert.equal(existsSync(path.join(f.repo, '.giviloop/runs')), false);
});

test('Codex installation is idempotent and disable removes only its managed configuration', t => {
  const f = setup(t);
  const outside = 'model = "existing-model"\n[mcp_servers.other]\ncommand = "other"\n';
  writeFileSync(f.config, outside);
  configureAutoReview(f.repo, 'enable', 'codex');
  const installed = read(f.config);
  configureAutoReview(f.repo, 'enable', 'codex');
  assert.equal(read(f.config), installed);
  assert.ok(installed.startsWith(outside));
  configureAutoReview(f.repo, 'disable');
  assert.equal(read(f.config).trimEnd(), outside.trimEnd());
  assert.equal(configureAutoReview(f.repo, 'status').enabled, false);
  assert.equal(configureAutoReview(f.repo, 'status').codexConfigPath, undefined);
});

test('existing unmanaged GiviLoop permissions require an explicit merge without enabling delivery', t => {
  const f = setup(t);
  const outside = '[mcp_servers.giviloop]\ncommand = "custom-wrapper"\n';
  writeFileSync(f.config, outside);
  assert.throws(() => configureAutoReview(f.repo, 'enable', 'codex'), /Merge.*manually/);
  assert.equal(read(f.config), outside);
  assert.equal(configureAutoReview(f.repo, 'status').enabled, false);
  assert.equal(existsSync(path.join(f.repo, 'AGENTS.md')), false);
  assert.ok(existsSync(path.join(f.repo, '.giviloop/codex-auto-review.toml')));
});

test('malformed and duplicated Codex markers are rejected without changing the file', t => {
  const f = setup(t);
  for (const text of ['# giviloop:auto-review:start', '# giviloop:auto-review:end\n# giviloop:auto-review:start', '# giviloop:auto-review:start\n# giviloop:auto-review:start\n# giviloop:auto-review:end']) {
    writeFileSync(f.config, text);
    assert.throws(() => configureCodexClient(f.repo, true), /Malformed/);
    assert.equal(read(f.config), text);
  }
});

test('Codex integration refuses symlinked configuration files', t => {
  const f = setup(t);
  const other = path.join(f.root, 'outside-config');
  writeFileSync(other, 'unchanged');
  symlinkSync(other, f.config);
  assert.throws(() => configureCodexClient(f.repo, true), /Symbolic/);
  assert.equal(read(other), 'unchanged');
});

test('generic enable emits the optional Codex snippet without installing client settings', t => {
  const f = setup(t);
  configureAutoReview(f.repo, 'enable');
  assert.equal(existsSync(f.config), false);
  assert.match(read(path.join(f.repo, '.giviloop/codex-auto-review.toml')), /mcp_servers\.giviloop/);
});

test('client flag rejects unsupported clients and actions before mutation', t => {
  const f = setup(t);
  for (const args of [['enable', '--client', 'other'], ['disable', '--client', 'codex'], ['run', '--client', 'codex']]) {
    const result = f.cli('auto-review', args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /--client codex is supported only/);
  }
  assert.equal(existsSync(f.config), false);
  assert.equal(configureAutoReview(f.repo, 'status').enabled, false);
});
