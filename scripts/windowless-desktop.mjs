// Native desktop evidence for production regressions, with a visible positive
// control so an inaccessible desktop cannot produce a misleading zero result.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(path.join(os.tmpdir(), 'giviloop-desktop-'));
if (process.argv.includes('--foreground-control')) {
  const { nativeChrome } = await import('../dist/providers/native-chrome.js');
  let context;
  try {
    context = await nativeChrome.launch(path.join(temporary, 'control'), false);
    const page = context.pages()[0] ?? await context.newPage();
    await page.setContent('<p>GiviLoop desktop observer positive control</p>');
    await page.bringToFront();
    console.log(JSON.stringify({ chrome: context.browser().version() }));
    await delay(2500);
  } finally {
    await context?.close();
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
  }
} else {
  const destination = path.join(root, '.giviloop/diagnostics');
  mkdirSync(destination, { recursive: true });
  const report = { platform: process.platform, os: os.version(), release: os.release(), arch: os.arch(), node: process.version,
    checkedAt: new Date().toISOString(), status: 'failed' };
  function start(command, args, options = {}) {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    const result = { stdout: '', stderr: '', code: null };
    child.stdout.on('data', data => { result.stdout += data; });
    child.stderr.on('data', data => { result.stderr += data; });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => { result.code = code; resolve(result); });
    });
    done.catch(() => {});
    return { child, result, done };
  }
  async function bounded(promise, ms) {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Desktop test timed out')), ms); })]); }
    finally { clearTimeout(timer); }
  }
  let observerCommand = process.platform === 'linux' ? '/usr/bin/python3' : 'python';
  let observerPrefix = [path.join(root, 'scripts/observe-desktop.py')];
  try {
    if (process.platform === 'darwin') {
      observerCommand = path.join(temporary, 'observe-macos');
      execFileSync('xcrun', ['swiftc', '-module-cache-path', path.join(temporary, 'swift-cache'),
        path.join(root, 'scripts/poc-windowless/observe-macos.swift'), '-o', observerCommand], { timeout: 120000 });
      observerPrefix = [];
    }
    async function phase(name, args) {
      const pids = path.join(temporary, `${name}.pids`), stop = path.join(temporary, `${name}.stop`);
      writeFileSync(pids, '');
      const observer = start(observerCommand, [...observerPrefix, pids, stop,
        ...(process.platform === 'darwin' && name === 'control' ? ['--activate-control'] : [])]);
      let workload;
      try {
        await bounded((async () => {
          while (!observer.result.stdout.startsWith('ready\n') && !observer.result.stdout.startsWith('ready\r\n')) {
            if (observer.child.exitCode !== null) throw new Error(observer.result.stderr || 'Observer exited before ready');
            await delay(20);
          }
        })(), 15000);
        const hook = new URL('../test/fixtures/browser-observer.mjs', import.meta.url).href;
        workload = start(process.execPath, args, { env: { ...process.env, GIVILOOP_TEST_OBSERVER_PIDS: pids,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${JSON.stringify(hook)}` } });
        const result = await bounded(workload.done, 240000);
        writeFileSync(path.join(destination, `desktop-${name}.log`), result.stdout + result.stderr);
        assert.equal(result.code, 0, result.stdout + result.stderr);
        if (name === 'control') report.chrome = JSON.parse(result.stdout.trim()).chrome;
        // Include shutdown, not only steady-state navigation/input.
        await delay(250);
      } finally {
        if (workload?.child.exitCode === null) workload.child.kill();
        writeFileSync(stop, 'stop');
        try {
          const observed = await bounded(observer.done, 10000);
          assert.equal(observed.code, 0, observed.stderr);
          report[name] = JSON.parse(observed.stdout.trim().split(/\r?\n/).at(-1));
          report[name].launchedProcessCount = readFileSync(pids, 'utf8').trim().split(/\r?\n/).filter(Boolean).length;
        } finally { if (observer.child.exitCode === null) observer.child.kill(); }
      }
      assert.equal(report[name].enumerationFailures, 0);
      assert.ok(report[name].ownedProcessSamples > 0);
      assert.ok(report[name].observedProcessCount > 0);
      assert.equal(report[name].observedProcessCount, report[name].launchedProcessCount, 'Every launched browser must be observed');
    }
    await phase('control', [fileURLToPath(import.meta.url), '--foreground-control']);
    assert.ok(report.control.maxOnscreenWindows > 0, 'Observer must detect the deliberately visible Chrome window');
    assert.ok(report.control.foregroundSamples > 0, 'Observer must detect the deliberately foreground Chrome window');
    await phase('background', ['--test', '--test-reporter=tap', '--test-concurrency=1',
      '--test-name-pattern=background pages|automatic MCP review uses windowless|saved defaults and MCP reuse', 'test/browser/roundtrip.test.mjs']);
    assert.equal(report.background.maxOnscreenWindows, 0, 'Background browser became visible');
    assert.equal(report.background.foregroundSamples, 0, 'Background browser took desktop focus');
    report.status = 'passed';
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    writeFileSync(path.join(destination, 'windowless-desktop.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
    rmSync(temporary, { recursive: true, force: true, maxRetries: 5 });
  }
}
