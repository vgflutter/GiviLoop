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
  session.on('Page.screencastFrame', ({ sessionId }) => { void session.send('Page.screencastFrameAck', { sessionId }).catch(() => {}); });
  await session.send('Page.startScreencast', { format: 'jpeg', quality: 0, maxWidth: 1, maxHeight: 1 });
  await check('screencast');
  await session.send('Page.stopScreencast');
  await page.getByRole('button').press('Enter', { timeout: 2000 });
  console.log(JSON.stringify({ label: 'keyboard-activation', sent: await page.evaluate(() => window.sent ?? 0) }));
  await context.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html>
    <textarea></textarea><button>Send</button><output></output><script>
    window.keys=[];window.addEventListener('keydown',e=>keys.push({key:e.key,tag:e.target.tagName,trusted:e.isTrusted}));
    document.querySelector('button').onclick=e=>{
      window.sent=(window.sent||0)+1;
      document.querySelector('output').textContent='pending';
      setTimeout(()=>document.querySelector('output').textContent='done',100);
    };</script>` }));
  await page.goto('https://example.test/');
  await page.locator('textarea').fill('Synthetic request');
  await page.getByRole('button').press('Enter');
  await new Promise(resolve => setTimeout(resolve, 1500));
  console.log(JSON.stringify({ label: 'after-navigation', ...await page.evaluate(() => ({
    sent: window.sent, keys: window.keys, active: document.activeElement?.tagName,
    response: document.querySelector('output').textContent,
  })) }));
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await page.getByRole('button').press('Enter');
  await new Promise(resolve => setTimeout(resolve, 1500));
  console.log(JSON.stringify({ label: 'navigation-refocus', ...await page.evaluate(() => ({
    sent: window.sent, keys: window.keys, active: document.activeElement?.tagName,
    response: document.querySelector('output').textContent,
  })) }));
  async function inputCheck(label) {
    await page.getByRole('button').press('Enter');
    await new Promise(resolve => setTimeout(resolve, 250));
    console.log(JSON.stringify({ label, ...await page.evaluate(() => ({ sent: window.sent, keys: window.keys,
      response: document.querySelector('output').textContent })) }));
  }
  await page.getByRole('button').click({ force: true }); // Synthetic, isolated diagnostic only.
  await inputCheck('direct-pointer');
  await session.send('Page.setWebLifecycleState', { state: 'active' });
  await inputCheck('navigation-active');
  await session.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 750, deviceScaleFactor: 1, mobile: false });
  await inputCheck('navigation-resize');
  await session.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1, height: 1, scale: 1 } });
  await inputCheck('navigation-first-frame');
  const creator = await context.browser().newBrowserCDPSession();
  process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1';
  await creator.send('Target.createTarget', { url: 'https://initial-target.test/', hidden: true, background: true });
  let initial;
  for (let i = 0; i < 100 && !initial; i++) {
    initial = context.pages().find(p => p.url() === 'https://initial-target.test/');
    if (!initial) await new Promise(resolve => setTimeout(resolve, 50));
  }
  await initial.locator('textarea').fill('Synthetic request');
  await initial.getByRole('button').press('Enter');
  await new Promise(resolve => setTimeout(resolve, 250));
  console.log(JSON.stringify({ label: 'initial-target-origin', ...await initial.evaluate(() => ({ sent: window.sent, keys: window.keys,
    response: document.querySelector('output').textContent })) }));
  await session.detach();
} finally {
  await context.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
