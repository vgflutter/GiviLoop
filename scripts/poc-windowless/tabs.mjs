import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { launchHidden } from './launch.mjs';
import { observeDesktop, routeFixture, exercisePage } from './support.mjs';

const { values } = parseArgs({ options: { observer: { type: 'string' } } });
const root = await mkdtemp(path.join(os.tmpdir(), 'giviloop-inactive-tabs-'));
const report = { startedAt: new Date().toISOString(), platform: process.platform, fixtureOnly: true,
  mode: 'extension in an already-running isolated browser', setupWindow: 'minimized surrogate for an existing user window',
  bridge: 'test harness via CDP; native-messaging integration not implemented', results: [], status: 'running' };
let active, observer;
try {
  observer = await observeDesktop(values.observer, root);
  for (let restart = 0; restart < 2; restart++) {
    const diagnostics = {};
    active = await launchHidden(path.join(root, 'profile'), {
      executable: chromium.executablePath(), targetMode: 'minimized', diagnostics,
      extraArgs: [`--load-extension=${fileURLToPath(new URL('./tab-extension', import.meta.url))}`],
      onSpawn: pid => observer.add(pid),
    });
    let worker = active.context.serviceWorkers().find(w => w.url().endsWith('/worker.js'));
    if (!worker) worker = await active.context.waitForEvent('serviceworker', { predicate: w => w.url().endsWith('/worker.js'), timeout: 10000 });
    assert.equal(await worker.evaluate(() => chrome.runtime.getManifest().name), 'GiviLoop inactive-tab feasibility probe');
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await worker.evaluate(() => typeof globalThis.activeTabs === 'function')) break;
      if (attempt === 99) throw new Error('Extension worker did not initialize its job handlers.');
      await delay(100);
    }
    await routeFixture(active.context);
    const initial = await worker.evaluate(() => globalThis.activeTabs());
    assert.ok(initial.length >= 1, 'The surrogate existing browser needs an active tab');
    const activeTabIds = initial.map(tab => tab.id).sort();
    const existingTab = initial[0];
    const existingWindows = await worker.evaluate(() => globalThis.windowIds());
    for (let job = 0; job < 10; job++) {
      console.log(`existing browser ${restart + 1}/2, inactive tab job ${job + 1}/10`);
      const createdPage = active.context.waitForEvent('page', { timeout: 10000 });
      const tab = await worker.evaluate(windowId => globalThis.openReview(windowId), existingTab.windowId);
      const page = await createdPage;
      // Register interception on this target explicitly. An extension-created
      // tab after session restore did not consistently inherit context routing
      // over CDP in this runtime; fail before any real provider is involved.
      await routeFixture(page);
      assert.equal(tab.active, false);
      assert.equal(tab.windowId, existingTab.windowId);
      const checks = await exercisePage(active.context, page, restart * 10 + job,
        () => worker.evaluate(tabId => globalThis.submitReview(tabId), tab.id));
      const after = await worker.evaluate(() => globalThis.activeTabs());
      assert.deepEqual(after.map(tab => tab.id).sort(), activeTabIds,
        'The review changed the active tabs');
      assert.deepEqual(await worker.evaluate(() => globalThis.windowIds()), existingWindows,
        'The review created another browser window');
      await worker.evaluate(tabId => globalThis.closeReview(tabId), tab.id);
      report.results.push({ restart: restart + 1, job: job + 1, status: 'passed',
        ...checks, storagePreservedAcrossRestart: restart > 0,
        activeTabUnchanged: true, browserWindowsUnchanged: true,
        sameBrowserProcess: true, browser: diagnostics.browser });
    }
    assert.deepEqual(await active.close(), { exited: true, forced: false });
    active = undefined;
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }
finally {
  try { if (active) report.finalCleanup = await active.close(); }
  catch (error) { report.cleanupError = error.message; report.status = 'failed'; process.exitCode = 1; }
  if (observer) {
    try {
      report.observer = await observer.stop();
      if (report.observer.status === 'completed') {
        assert.ok(report.observer.ownedProcessSamples > 0);
        // This mode presupposes an existing browser window. Its preparation is
        // included in the observer trace; measure tab/window stability per job.
        assert.equal(report.observer.foregroundSamples, 0);
      }
    } catch (error) { report.observerError = error.message; report.status = 'failed'; process.exitCode = 1; }
  }
  if (!report.cleanupError) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  const output = '.giviloop/windowless-poc/inactive-tabs.json';
  await mkdir(path.dirname(output), { recursive: true });
  report.finishedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, completed: report.results.length, error: report.error,
    observer: report.observer, observerError: report.observerError, output }, null, 2));
}
