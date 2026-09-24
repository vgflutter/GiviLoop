// Explicit live acceptance only. The child sends the public synthetic fixtures
// from web-acceptance.mjs. No repository source or account content is collected.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { observeDesktop } from './poc-windowless/support.mjs';

const { values } = parseArgs({ options: {
  provider: { type: 'string' }, observer: { type: 'string' }, 'browser-profile': { type: 'string' },
} });
assert.ok(['chatgpt-web','claude-web','gemini-web','deepseek-web'].includes(values.provider), 'Select --provider explicitly to authorize a live test.');
const root = await mkdtemp(path.join(os.tmpdir(), 'giviloop-windowless-live-'));
const report = { startedAt: new Date().toISOString(), provider: values.provider, platform: process.platform,
  source: 'public synthetic fixtures only', status: 'running' };
let observer;
try {
  observer = await observeDesktop(values.observer, root);
  const hook = fileURLToPath(new URL('../test/fixtures/browser-observer.mjs', import.meta.url));
  const child = spawn(process.execPath, [fileURLToPath(new URL('./web-acceptance.mjs', import.meta.url)),
    '--provider', values.provider, ...(values['browser-profile'] ? ['--browser-profile', values['browser-profile']] : [])], {
    stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env,
      ...(values.observer ? { GIVILOOP_TEST_OBSERVER_PIDS: path.join(root, 'observer-pids'),
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${JSON.stringify(hook)}` } : {}),
    },
  });
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  assert.equal(exit.code, 0, `Live acceptance failed (${exit.code ?? exit.signal}). Inspect the retained delivery evidence before retrying.`);
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally {
  if (observer) {
    try {
      report.observer = await observer.stop();
      if (report.observer.status === 'completed') {
        assert.ok(report.observer.ownedProcessSamples > 0);
        assert.equal(report.observer.maxOnscreenWindows, 0, 'An owned browser window was visible');
        assert.equal(report.observer.foregroundSamples, 0, 'An owned browser became foreground');
      }
    } catch (error) { report.status = 'failed'; report.observerError = error.message; process.exitCode = 1; }
  }
  const output = `.giviloop/diagnostics/windowless-${values.provider}-${Date.now()}.json`;
  await mkdir(path.dirname(output), { recursive: true });
  report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await rm(root, { recursive: true, force: true });
  console.log(JSON.stringify({ ...report, output }, null, 2));
}
