// Local feasibility probe: no provider/account, no production transport changes.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { launchHidden, assertNoWindow } from './launch.mjs';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { routeFixture, exercisePage } from './support.mjs';

const { values } = parseArgs({ options: {
  cycles: { type: 'string', default: '3' },
  output: { type: 'string', default: '.giviloop/windowless-poc/result.json' },
  observer: { type: 'string' },
  bootstrap: { type: 'boolean', default: false },
  'bootstrap-method': { type: 'string', default: 'cli' },
  chrome: { type: 'string', default: 'installed' },
} });
assert.ok(['installed', 'testing'].includes(values.chrome), '--chrome must be installed or testing');
assert.ok(['cli', 'cdp'].includes(values['bootstrap-method']));
assert.ok(!values.bootstrap || values.chrome === 'testing' || values['bootstrap-method'] === 'cdp', 'Ordinary Chrome requires CDP extension loading.');
const extensionPath = fileURLToPath(new URL('./bootstrap-extension', import.meta.url));
const cycles = Number(values.cycles);
assert.ok(Number.isSafeInteger(cycles) && cycles >= 2 && cycles <= 10, '--cycles must be 2..10');
const root = await mkdtemp(path.join(os.tmpdir(), 'giviloop-windowless-'));
const profile = path.join(root, 'profile');
const pidsFile = path.join(root, 'owned-pids');
const stopFile = path.join(root, 'observer-stop');
const report = {
  startedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
  osRelease: os.release(), node: process.version, requestedCycles: cycles,
  fixtureOnly: true, profile: 'temporary, synthetic cookies only',
  variant: values.bootstrap ? 'offscreen-extension' : 'baseline', chrome: values.chrome,
  bootstrapMethod: values.bootstrap ? values['bootstrap-method'] : undefined,
  results: [], observer: { status: 'not-run' }, status: 'running',
};
let active, observer, observerDone, observerOutput = '';
const timeout = (ms, message) => {
  let timer;
  return { promise: new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
    cancel: () => clearTimeout(timer) };
};

try {
  if (values.observer) {
    assert.equal(process.platform, 'darwin', 'The supplied observer is macOS-specific; the Chrome probe is portable.');
    await writeFile(pidsFile, '');
    observer = spawn(path.resolve(values.observer), [pidsFile, stopFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    observerDone = new Promise(resolve => {
      observer.once('error', error => { readyReject(error); resolve({ error: error.message }); });
      observer.once('close', code => { readyReject(new Error(`Observer exited before ready (${code})`)); resolve({ code }); });
    });
    observer.stdout.on('data', data => {
      observerOutput += data.toString();
      if (observerOutput.startsWith('ready\n')) readyResolve();
    });
    observer.stderr.resume();
    const deadline = timeout(10000, 'Observer startup timed out');
    try { await Promise.race([ready, deadline.promise]); } finally { deadline.cancel(); }
  }
  for (let cycle = 0; cycle < cycles; cycle++) {
    const result = { cycle: cycle + 1, stage: 'launch', diagnostics: {} };
    report.results.push(result);
    console.log(`Starting hidden Chrome: cycle ${cycle + 1}/${cycles}`);
    active = await launchHidden(profile, {
      diagnostics: result.diagnostics,
      onSpawn: pid => { if (observer && pid) appendFileSync(pidsFile, `${pid}\n`); },
      ...(values.chrome === 'testing' ? { executable: chromium.executablePath() } : {}),
      ...(values.bootstrap ? {
        extraArgs: values['bootstrap-method'] === 'cdp' ? ['--enable-unsafe-extension-debugging'] : [`--load-extension=${extensionPath}`],
        beforeTarget: async ({ ownerSession, diagnostics, context }) => {
          if (values['bootstrap-method'] === 'cdp') {
            const loaded = await ownerSession.send('Extensions.loadUnpacked', { path: extensionPath });
            diagnostics.extensionLoadedViaCDP = Boolean(loaded.id);
          }
          for (let attempt = 0; attempt < 100; attempt++) {
            const targets = (await ownerSession.send('Target.getTargets')).targetInfos;
            const offscreen = targets.find(t => t.url.startsWith('chrome-extension://') && t.url.endsWith('/offscreen.html'));
            if (offscreen) {
              const worker = context.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${new URL(offscreen.url).host}/`));
              const state = await worker?.evaluate(() => globalThis.pocStatus);
              if (state?.stage === 'ready') {
                diagnostics.offscreenBootstrap = { present: true, targetType: offscreen.type, parserVerified: state.parserVerified };
                return;
              }
            }
            await delay(100);
          }
          diagnostics.bootstrapTargets = (await ownerSession.send('Target.getTargets')).targetInfos.map(t => ({ type: t.type, extension: t.url.startsWith('chrome-extension://') }));
          diagnostics.bootstrapWorkers = await Promise.all(context.serviceWorkers().map(worker => worker.evaluate(() => globalThis.pocStatus ?? { stage: 'unknown' }).catch(e => ({ error: e.message }))));
          throw new Error('Offscreen extension did not initialize within 10 seconds.');
        },
      } : {}),
    });
    const { context, page } = active;
    result.stage = 'fixture';
    await assertNoWindow(active);
    await routeFixture(context);
    Object.assign(result, await exercisePage(context, page, cycle));
    await assertNoWindow(active);
    result.noTargetWindow = true;
    result.stage = 'close';
    result.cleanup = await active.close();
    active = undefined;
    assert.deepEqual(result.cleanup, { exited: true, forced: false });
    const prefs = JSON.parse(await readFile(path.join(profile, 'Default', 'Preferences'), 'utf8'));
    result.exitType = prefs.profile?.exit_type;
    assert.equal(result.exitType, 'Normal');
    result.stage = 'complete';
    result.status = 'passed';
    console.log(JSON.stringify(result));
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  if (report.results.length) report.results.at(-1).status = 'failed';
  process.exitCode = 1;
} finally {
  if (active) report.finalCleanup = await active.close();
  if (observer) {
    await writeFile(stopFile, 'stop');
    const deadline = timeout(5000, 'Observer shutdown timed out');
    try {
      const exit = await Promise.race([observerDone, deadline.promise]);
      assert.equal(exit.code, 0, 'Observer failed');
      report.observer = { status: 'completed', ...JSON.parse(observerOutput.trim().split('\n').at(-1)) };
      assert.equal(report.observer.enumerationFailures, 0);
      assert.ok(report.observer.ownedProcessSamples > 0, 'Observer never sampled an owned browser');
      assert.equal(report.observer.maxOnscreenWindows, 0, 'An owned Chrome window was visible');
      assert.equal(report.observer.foregroundSamples, 0, 'Owned Chrome became the foreground application');
    } catch (error) {
      report.observer = { ...report.observer, status: 'failed', error: error.message };
      report.status = 'failed';
      process.exitCode = 1;
      observer.kill();
    } finally { deadline.cancel(); }
  }
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  report.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(path.resolve(values.output)), { recursive: true });
  await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report: ${path.resolve(values.output)}`);
}
