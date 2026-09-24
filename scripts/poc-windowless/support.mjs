import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { within } from './launch.mjs';

export async function observeDesktop(binary, root) {
  if (!binary) return { add() {}, stop: async () => ({ status: 'not-run' }) };
  assert.equal(process.platform, 'darwin', 'This optional observer measures macOS only.');
  const pids = path.join(root, 'observer-pids'), stop = path.join(root, 'observer-stop');
  writeFileSync(pids, '');
  const child = spawn(path.resolve(binary), [pids, stop], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const done = new Promise(resolve => {
    child.once('error', error => { readyReject(error); resolve({ error: error.message }); });
    child.once('close', code => { readyReject(new Error('Observer exited before ready.')); resolve({ code }); });
  });
  child.stdout.on('data', chunk => { output += chunk; if (output.startsWith('ready\n')) readyResolve(); });
  child.stderr.resume();
  try { await within(ready, 10000, 'Observer startup'); }
  catch (error) { child.kill(); await done; throw error; }
  return {
    add(pid) { if (pid) appendFileSync(pids, `${pid}\n`); },
    async stop() {
      writeFileSync(stop, 'stop');
      try {
        const exit = await within(done, 5000, 'Observer shutdown');
        assert.equal(exit.code, 0);
        const stats = JSON.parse(output.trim().split('\n').at(-1));
        assert.equal(stats.enumerationFailures, 0);
        return { status: 'completed', ...stats };
      } finally { if (child.exitCode === null) { child.kill(); await done; } }
    },
  };
}

export const fixtureURL = 'https://giviloop-poc.test/';
export async function routeFixture(context) {
  await context.route('**/*', route => {
    if (route.request().url() !== fixtureURL) return route.abort();
    return route.fulfill({ contentType: 'text/html', body: `<!doctype html>
      <textarea aria-label="Request"></textarea><button>Send</button><output></output>
      <script>
      document.querySelector('button').onclick = () => {
        const n = Number(localStorage.getItem('sends') || 0) + 1;
        localStorage.setItem('sends', String(n));
        document.querySelector('output').textContent = 'Response ' + n + ': pending';
        setTimeout(() => { document.querySelector('output').textContent = 'Response ' + n + ': done'; }, 150);
      };
      </script>` });
  });
}

export async function exercisePage(context, page, cycle, send) {
  page.setDefaultTimeout(5000);
  await page.goto(fixtureURL);
  if (cycle === 0) await context.addCookies([{ name: 'synthetic-session', value: 'poc-only',
    url: fixtureURL, secure: true, httpOnly: true, expires: Math.floor(Date.now() / 1000) + 3600 }]);
  assert.equal((await context.cookies(fixtureURL)).find(c => c.name === 'synthetic-session')?.value, 'poc-only');
  assert.equal(await page.evaluate(() => Number(localStorage.getItem('sends') || 0)), cycle);
  if (send) await send();
  else {
    await page.getByRole('textbox').fill('Synthetic review request');
    await page.getByRole('button', { name: 'Send' }).click();
  }
  assert.equal(await page.getByRole('textbox').inputValue(), 'Synthetic review request');
  const expected = `Response ${cycle + 1}: done`;
  await page.waitForFunction(text => document.querySelector('output').textContent === text, expected);
  assert.equal(await page.evaluate(() => Number(localStorage.getItem('sends'))), cycle + 1);
  return { syntheticCookieReadable: true, storagePreservedAcrossRestart: cycle > 0,
    inputVerified: true, singleSend: true, asynchronousResponse: true };
}
