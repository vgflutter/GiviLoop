import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from 'playwright';
import { launchHidden } from './launch.mjs';
import { observeDesktop, routeFixture, exercisePage } from './support.mjs';

const { values } = parseArgs({ options: {
  engine: { type: 'string' }, cycles: { type: 'string', default: '10' },
  runtime: { type: 'string' }, observer: { type: 'string' }, output: { type: 'string' },
} });
assert.ok(['electron', 'firefox', 'carbonyl'].includes(values.engine), '--engine electron|firefox|carbonyl is required');
const cycles = Number(values.cycles);
assert.ok(Number.isSafeInteger(cycles) && cycles >= 2 && cycles <= 10);
const root = await mkdtemp(path.join(os.tmpdir(), `givi-${values.engine}-poc-`));
const profile = path.join(root, 'profile');
const output = values.output ?? `.giviloop/windowless-poc/${values.engine}.json`;
const report = { engine: values.engine, platform: process.platform, arch: process.arch,
  startedAt: new Date().toISOString(), fixtureOnly: true, requestedCycles: cycles, results: [], status: 'running' };
let active, observer;
try {
  observer = await observeDesktop(values.observer, root);
  for (let cycle = 0; cycle < cycles; cycle++) {
    const result = { cycle: cycle + 1, stage: 'launch', diagnostics: {} };
    report.results.push(result);
    console.log(`${values.engine}: cycle ${cycle + 1}/${cycles}`);
    if (values.engine === 'firefox') {
      const context = await firefox.launchPersistentContext(profile, { headless: true, timeout: 30000, viewport: { width: 1400, height: 1000 } });
      active = { context, page: context.pages()[0] ?? await context.newPage(), close: async () => { await context.close(); return { exited: true, forced: false }; } };
      // Firefox's persistent-context API does not expose the native PID. The
      // optional observer must not be claimed as measuring its browser process.
      result.diagnostics.browser = context.browser()?.version();
      result.diagnostics.desktopObservation = 'unavailable: native PID not exposed by this API';
    } else {
      assert.ok(values.runtime, '--runtime must identify the isolated npm installation');
      const require = createRequire(path.join(path.resolve(values.runtime), 'package.json'));
      const executable = require(values.engine);
      const options = {
        executable, targetMode: 'existing', onSpawn: pid => observer.add(pid), diagnostics: result.diagnostics,
      };
      if (values.engine === 'electron') {
        options.env = { ...process.env };
        delete options.env.ELECTRON_RUN_AS_NODE;
        options.extraArgs = [fileURLToPath(new URL('./electron-main.cjs', import.meta.url)), `--poc-profile=${profile}`];
        options.requestClose = ({ child }) => { child.stdin.write('close\n'); };
      } else { options.extraArgs = ['about:blank']; options.terminalPTY = true; }
      active = await launchHidden(profile, options);
    }
    result.stage = 'fixture';
    await routeFixture(active.context);
    Object.assign(result, await exercisePage(active.context, active.page, cycle));
    result.stage = 'close';
    result.cleanup = await active.close();
    active = undefined;
    assert.deepEqual(result.cleanup, { exited: true, forced: false });
    result.status = 'passed'; result.stage = 'complete';
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1;
  if (report.results.length) report.results.at(-1).status = 'failed';
} finally {
  try { if (active) report.finalCleanup = await active.close(); }
  catch (error) { report.cleanupError = error.message; report.status = 'failed'; process.exitCode = 1; }
  if (observer) {
    try {
      report.observer = await observer.stop();
      if (report.observer.status === 'completed' && values.engine !== 'firefox') {
        assert.ok(report.observer.ownedProcessSamples > 0, 'Owned process was never observed');
        assert.equal(report.observer.maxOnscreenWindows, 0, 'An owned window became visible');
        assert.equal(report.observer.foregroundSamples, 0, 'An owned browser became foreground');
      }
    } catch (error) { report.observerError = error.message; report.status = 'failed'; process.exitCode = 1; }
  }
  if (!report.cleanupError) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  report.finishedAt = new Date().toISOString();
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, completed: report.results.filter(r => r.status === 'passed').length,
    error: report.error, observer: report.observer, observerError: report.observerError, output }, null, 2));
}
