// Synthetic diagnostics: no provider/account traffic or existing profiles.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nativeChrome } from '../dist/providers/native-chrome.js';

const root = mkdtempSync(path.join(os.tmpdir(), 'givi-input-diagnostic-'));
const context = await nativeChrome.launch(root, true);
try {
  const page = context.pages()[0];
  const session = await context.newCDPSession(page);
  console.log(JSON.stringify({ platform: process.platform, chrome: context.browser().version() }));
  await page.setContent('<button onclick="window.sent=(window.sent||0)+1">Send</button>');
  async function check(label) {
    const state = await page.evaluate(async () => ({
      visibility: document.visibilityState, focused: document.hasFocus(),
      raf: await Promise.race([new Promise(r => requestAnimationFrame(() => r(true))), new Promise(r => setTimeout(() => r(false), 1000))]),
    }));
    try { await page.getByRole('button').click({ timeout: 2000 }); state.click = 'passed'; }
    catch (error) { state.click = error.message; }
    state.sent = await page.evaluate(() => window.sent ?? 0);
    console.log(JSON.stringify({ label, ...state }));
  }
  await check('initial');
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await check('focus-emulation');
  await session.send('Page.setWebLifecycleState', { state: 'active' });
  await check('active-lifecycle');
  await session.detach();
} finally {
  await context.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
