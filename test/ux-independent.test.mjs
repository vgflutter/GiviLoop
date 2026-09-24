import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, distDir, bridgePath } from './helpers.mjs';

const { nativeChrome } = await import(pathToFileURL(path.join(distDir, 'providers/native-chrome.js')));
const { sendToWebChat } = await import(pathToFileURL(path.join(distDir, 'providers/chatgpt-web.js')));
const { checkBrowserAccess } = await import(pathToFileURL(path.join(distDir, 'browser-commands.js')));
const { readPreferences, savePreferences, webDefaults } = await import(pathToFileURL(path.join(distDir, 'preferences.js')));
const { runStatus, resumeRun } = await import(pathToFileURL(path.join(distDir, 'run-status.js')));
const { runControl } = await import(pathToFileURL(path.join(distDir, 'run-control.js')));
const { BrowserSessions } = await import(pathToFileURL(path.join(distDir, 'providers/browser-sessions.js')));

// Independent acceptance fixture: an attempt to activate/restore the window is
// observable even if production catches that attempt and returns another error.
// No Chrome process, account, network request, or personal profile is used.
function quietFixture(t, { challenge = false, provider = 'chatgpt-web', cookie = false } = {}) {
  const f = fixture(t);
  const origin = provider === 'claude-web' ? 'https://claude.ai' : 'https://chatgpt.com';
  const requestPath = path.join(f.repo, 'request.md');
  const responsePath = path.join(f.repo, 'response.md');
  writeFileSync(requestPath, 'INDEPENDENT_PRIVATE_REVIEW');
  const metrics = { launches: [], navigations: 0, fills: 0, submits: 0, cookies: 0, activations: 0, restores: 0, closes: 0 };
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const page = {
    url: () => origin + '/', isClosed: () => false,
    on() {}, off() {},
    goto: async () => { metrics.navigations++; return { status: () => challenge ? 403 : 200, headers: () => challenge ? { 'cf-mitigated': 'challenge' } : {} }; },
    waitForTimeout: async ms => { now += ms; },
    bringToFront: async () => { metrics.activations++; },
    getByRole: () => ({ first: () => ({ isVisible: async () => false }) }),
    getByTestId: () => ({ isVisible: async () => cookie, click: async () => { metrics.cookies++; }, waitFor: async () => {} }),
    locator(selector) {
      const locator = {
        first: () => locator, nth: () => locator, locator: child => page.locator(child),
        isVisible: async () => false, isEditable: async () => true, isEnabled: async () => true,
        allTextContents: async () => [], fill: async () => { metrics.fills++; },
        click: async () => { metrics.submits++; }, press: async () => { metrics.submits++; },
        evaluate: async () => true,
        count: async () => selector.includes('data-message-role') ? Number(metrics.submits > 0) : selector.includes('data-assistant-markdown') ? 1 : 0,
        getAttribute: async name => name === 'data-message-role' ? 'assistant' : name === 'data-message-complete' ? '' : null,
        innerText: async () => selector.includes('role="alert"') ? '' : 'Independent completed review',
      };
      return locator;
    },
  };
  const context = {
    pages: () => [page], newPage: async () => page, setDefaultTimeout() {},
    cookies: async () => [], close: async () => { metrics.closes++; },
    newCDPSession: async () => ({
      send: async (method, args) => {
        if (method === 'Browser.setWindowBounds' && args.bounds.windowState !== 'minimized') metrics.restores++;
        return { windowId: 1, bounds: { windowState: 'minimized' } };
      }, detach: async () => {},
    }),
  };
  t.mock.method(nativeChrome, 'launch', async (profile, background) => { metrics.launches.push({ profile, background }); return context; });
  const oldAllowed = process.env.GIVILOOP_ALLOWED_REPOSITORIES;
  process.env.GIVILOOP_ALLOWED_REPOSITORIES = f.repo;
  t.after(() => oldAllowed === undefined ? delete process.env.GIVILOOP_ALLOWED_REPOSITORIES : process.env.GIVILOOP_ALLOWED_REPOSITORIES = oldAllowed);
  return {
    ...f, metrics, requestPath, responsePath,
    status: () => JSON.parse(readFileSync(path.join(f.repo, 'browser-status.json'), 'utf8')),
    run: options => sendToWebChat({ repositoryPath: f.repo, requestPath, responsePath, userDataDir: path.join(f.root, 'isolated-profile'), webProvider: provider, responseStableMs: 100, maxWaitMs: 2000, ...options }),
    check: () => checkBrowserAccess(path.join(f.root, 'isolated-profile'), false, 1000, undefined, provider),
  };
}

function assertNeverShown(f) {
  assert.equal(f.metrics.activations, 0, 'quiet operations must not call bringToFront');
  assert.equal(f.metrics.restores, 0, 'quiet operations must not restore the window');
}

test('independent UX: omitted mode/background completes one review without showing Chrome', async t => {
  const f = quietFixture(t);
  const result = await f.run();
  assert.equal(result.responseText, 'Independent completed review');
  assert.equal(f.metrics.launches[0].background, true);
  assert.equal(f.metrics.submits, 1);
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.status().outcome, 'completed');
  assertNeverShown(f);
});

test('independent UX: challenge pauses quietly before touching the composer', async t => {
  const f = quietFixture(t, { challenge: true });
  await assert.rejects(f.run({ verificationWaitMs: 180000 }), /ACCESS_CHALLENGE/);
  assert.equal(f.metrics.launches[0].background, true);
  assert.equal(f.metrics.navigations, 1);
  assert.equal(f.metrics.fills, 0);
  assert.equal(f.metrics.submits, 0);
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.status().submitted, false);
  assert.equal(f.status().outcome, 'needs-attention');
  assert.equal(existsSync(f.responsePath), false);
  assertNeverShown(f);
});

test('independent UX: browser check never activates Chrome for a challenge', async t => {
  const f = quietFixture(t, { challenge: true });
  const report = await f.check();
  assert.equal(report.ready, false);
  assert.equal(report.submitted, false);
  assert.equal(report.errorCode, 'ACCESS_CHALLENGE');
  assert.equal(f.metrics.launches[0].background, true);
  assert.equal(f.metrics.closes, 1);
  assertNeverShown(f);
});

test('independent UX: first-use cookie consent becomes attention, with no click or activation', async t => {
  const f = quietFixture(t, { provider: 'claude-web', cookie: true });
  await assert.rejects(f.run(), /BROWSER_SETUP_REQUIRED/);
  assert.equal(f.metrics.cookies, 0);
  assert.equal(f.metrics.fills, 0);
  assert.equal(f.metrics.submits, 0);
  assert.equal(f.status().outcome, 'needs-attention');
  assertNeverShown(f);
});

test('independent UX: quiet access check cannot click first-use cookie controls', async t => {
  const f = quietFixture(t, { provider: 'claude-web', cookie: true });
  const report = await f.check();
  assert.equal(report.ready, false);
  assert.equal(report.errorCode, 'BROWSER_SETUP_REQUIRED');
  assert.equal(f.metrics.cookies, 0);
  assert.equal(f.metrics.submits, 0);
  assertNeverShown(f);
});

test('independent UX: quiet attachment delivery pauses before browser launch', async t => {
  const f = quietFixture(t);
  const attachment = path.join(f.root, 'synthetic.zip');
  writeFileSync(attachment, 'synthetic archive');
  await assert.rejects(f.run({ attachmentPaths: [attachment] }), /BROWSER_INTERACTION_REQUIRED/);
  assert.deepEqual(f.metrics.launches, []);
  assert.equal(f.status().submitted, false);
  assert.equal(f.status().outcome, 'needs-attention');
  assertNeverShown(f);
});

test('independent UX: explicit foreground still completes one review', async t => {
  const f = quietFixture(t);
  await f.run({ background: false });
  assert.equal(f.metrics.launches[0].background, false);
  assert.equal(f.metrics.submits, 1);
  assert.equal(f.metrics.closes, 1);
});

test('independent UX: choosing another reviewer cannot inherit the saved private browser profile', t => {
  const f = fixture(t);
  const savedProfile = path.join(f.root, 'Claude only profile');
  savePreferences(f.repo, { schemaVersion: 1, provider: 'claude-web', background: true, browserProfile: savedProfile });
  assert.equal(webDefaults(f.repo).provider, 'claude-web');
  assert.equal(webDefaults(f.repo).browserProfile, savedProfile);
  assert.equal(webDefaults(f.repo, 'deepseek-web').provider, 'deepseek-web');
  assert.equal(webDefaults(f.repo, 'deepseek-web').browserProfile, undefined);
});

test('independent UX: preferences cannot point through a symlink to another project', t => {
  const f = fixture(t);
  const external = path.join(f.root, 'external-settings.json');
  const original = JSON.stringify({ schemaVersion: 1, provider: 'manual', background: true });
  writeFileSync(external, original);
  mkdirSync(path.join(f.repo, '.giviloop'));
  symlinkSync(external, path.join(f.repo, '.giviloop', 'preferences.json'));
  assert.throws(() => readPreferences(f.repo), /Symbolic links/);
  assert.throws(() => savePreferences(f.repo, { schemaVersion: 1, provider: 'claude-web', background: true }), /Symbolic links/);
  assert.equal(readFileSync(external, 'utf8'), original);
});

function savedRun(t, changes = {}) {
  const f = fixture(t);
  assert.equal(f.cli('ask', ['--question', 'Independent resume test']).status, 0);
  const run = f.latest();
  const status = {
    startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:00:01.000Z',
    provider: 'chatgpt-web', outcome: 'needs-attention', submitted: false,
    errorCode: 'LOGIN_REQUIRED', profile: path.join(f.root, 'isolated-profile'),
    requestSha256: createHash('sha256').update(readFileSync(run.request)).digest('hex'), ...changes,
  };
  writeFileSync(path.join(run.dir, 'browser-status.json'), JSON.stringify(status));
  let launches = 0;
  t.mock.method(nativeChrome, 'launch', async () => { launches++; throw new Error('UNEXPECTED_BROWSER_LAUNCH'); });
  const oldAllowed = process.env.GIVILOOP_ALLOWED_REPOSITORIES;
  process.env.GIVILOOP_ALLOWED_REPOSITORIES = f.repo;
  t.after(() => oldAllowed === undefined ? delete process.env.GIVILOOP_ALLOWED_REPOSITORIES : process.env.GIVILOOP_ALLOWED_REPOSITORIES = oldAllowed);
  return { ...f, run, status, launches: () => launches };
}

test('independent UX: status is read-only and resume refuses every submitted or uncertain run', async t => {
  const f = savedRun(t);
  assert.equal(runStatus(f.repo).resumable, true);
  for (const change of [
    { outcome: 'completed', submitted: true },
    { outcome: 'failed', submitted: 'unknown' },
    { outcome: 'needs-attention', submitted: true },
    { outcome: 'completed', submitted: false },
  ]) {
    writeFileSync(path.join(f.run.dir, 'browser-status.json'), JSON.stringify({ ...f.status, ...change }));
    assert.equal(runStatus(f.repo).resumable, false);
    await assert.rejects(resumeRun(f.repo), /Resume refused/);
  }
  assert.equal(f.launches(), 0);
  assert.deepEqual(f.osCalls(), []);
});

test('independent UX: resume refuses a modified prompt before a browser starts', async t => {
  const f = savedRun(t);
  writeFileSync(f.run.request, 'Changed request after the attention stop');
  assert.equal(runStatus(f.repo).requestChanged, true);
  assert.equal(runStatus(f.repo).resumable, false);
  await assert.rejects(resumeRun(f.repo), /request changed/);
  assert.equal(f.launches(), 0);
});

test('independent UX: archive resume checks the real nested archive hash', async t => {
  const f = savedRun(t);
  const metadata = JSON.parse(readFileSync(f.run.metadata, 'utf8'));
  metadata.mode = 'source-archive';
  metadata.archive = { sha256: createHash('sha256').update('original archive').digest('hex') };
  writeFileSync(f.run.metadata, JSON.stringify(metadata));
  writeFileSync(path.join(f.run.dir, 'source-context.zip'), 'changed archive');
  await assert.rejects(resumeRun(f.repo, f.run.id, true), /Archive changed/);
  assert.equal(f.launches(), 0);
});

test('independent UX: stale cancellation cannot stop a new run in the same directory', async t => {
  const f = fixture(t);
  const old = runControl(f.repo);
  old.dispose();
  const current = runControl(f.repo);
  t.after(() => current.dispose());
  const controlPath = path.join(f.repo, 'review-control.json');
  writeFileSync(controlPath, JSON.stringify({ action: 'cancel', token: old.token }));
  await delay(300);
  assert.equal(current.signal.aborted, false);
  writeFileSync(controlPath, JSON.stringify({ action: 'cancel', token: current.token }));
  await delay(300);
  assert.equal(current.signal.aborted, true);
});

test('independent UX: setup remembers reviewer without turning prepare-only ask into a send', t => {
  const f = fixture(t);
  const setup = f.cli('setup', ['--provider', 'claude-web', '--non-interactive'], { GIVILOOP_CHROME_PATH: process.execPath });
  assert.equal(setup.status, 0, setup.stderr);
  assert.equal(readPreferences(f.repo).provider, 'claude-web');
  const foreground = f.cli('setup', ['--foreground', '--non-interactive'], { GIVILOOP_CHROME_PATH: process.execPath });
  assert.equal(foreground.status, 0, foreground.stderr);
  assert.equal(readPreferences(f.repo).background, false);
  const background = f.cli('setup', ['--background', '--non-interactive'], { GIVILOOP_CHROME_PATH: process.execPath });
  assert.equal(background.status, 0, background.stderr);
  assert.equal(readPreferences(f.repo).background, true);
  const contradictory = f.cli('setup', ['--foreground', '--background', '--non-interactive'], { GIVILOOP_CHROME_PATH: process.execPath });
  assert.notEqual(contradictory.status, 0);
  assert.equal(readPreferences(f.repo).background, true, 'rejected conflicting flags cannot change the saved setting');
  const asked = f.cli('ask', ['--question', 'Prepare this for my chosen reviewer']);
  assert.equal(asked.status, 0, asked.stderr);
  assert.equal(JSON.parse(readFileSync(f.latest().metadata, 'utf8')).targetProvider, 'claude-chat');
  assert.equal(existsSync(path.join(f.latest().dir, 'browser-status.json')), false);
  assert.equal(runStatus(f.repo).state, 'prepared');
  assert.deepEqual(f.osCalls(), []);
});

test('independent UX: capacity and simultaneous profile requests never duplicate launch', async t => {
  const launches = [];
  const pool = new BrowserSessions(60000, async profile => {
    launches.push(profile);
    return { browser: () => ({ isConnected: () => true }), close: async () => { await delay(20); } };
  });
  t.after(() => pool.closeAll());
  await (await pool.acquire('idle-A')).release(true);
  await (await pool.acquire('idle-B')).release(true);
  const acquired = await Promise.allSettled([pool.acquire('new-C'), pool.acquire('new-C')]);
  assert.equal(launches.filter(p => p === 'new-C').length, 0);
  assert.ok(acquired.every(r => r.status === 'rejected' && /BROWSER_PROFILE_BUSY/.test(String(r.reason))));
  assert.deepEqual(await pool.closeIdle(), { closed: 2, remaining: 0 });
  const fresh = await Promise.allSettled([pool.acquire('new-C'), pool.acquire('new-C')]);
  assert.equal(launches.filter(p => p === 'new-C').length, 1);
  assert.equal(fresh.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(String(fresh.find(r => r.status === 'rejected')?.reason), /BROWSER_PROFILE_BUSY/);
  await fresh.find(r => r.status === 'fulfilled').value.release(false);
});

test('independent UX: reused sessions are exclusive, failures close once, and manual release leaves active reviews alone', async t => {
  let launches = 0, closes = 0;
  const pool = new BrowserSessions(60000, async () => {
    launches++;
    return { browser: () => ({ isConnected: () => true }), close: async () => { closes++; } };
  });
  t.after(() => pool.closeAll());
  const first = await pool.acquire('A');
  assert.equal(first.reused, false);
  await first.release(true);
  const second = await pool.acquire('A');
  assert.equal(second.reused, true);
  assert.equal(second.context, first.context);
  assert.deepEqual(await pool.closeIdle(), { closed: 0, remaining: 1 });
  await assert.rejects(pool.closeIdle('A'), /BROWSER_PROFILE_BUSY/);
  await assert.rejects(pool.acquire('A'), /BROWSER_PROFILE_BUSY/);
  await Promise.all([second.release(false), second.release(false)]);
  assert.equal(closes, 1);
  await (await pool.acquire('A')).release(false);
  assert.equal(launches, 2);
  assert.equal(closes, 2);
});

test('independent UX: idle expiry closes owned sessions; disconnected context is discarded before reuse', async t => {
  let closes = 0, connected = true;
  const pool = new BrowserSessions(25, async () => ({ browser: () => ({ isConnected: () => connected }), close: async () => { closes++; } }));
  t.after(() => pool.closeAll());
  await (await pool.acquire('A')).release(true);
  connected = false;
  await assert.rejects(pool.acquire('A'), /disconnected/);
  assert.equal(closes, 1);
  connected = true;
  await (await pool.acquire('A')).release(true);
  await delay(60);
  assert.equal(closes, 2);
  assert.deepEqual(await pool.closeIdle(), { closed: 0, remaining: 0 });
});

test('independent UX: shutdown during launch closes the owned context exactly once and refuses future work', async () => {
  let resolveLaunch, closes = 0;
  const pool = new BrowserSessions(60000, () => new Promise(resolve => { resolveLaunch = resolve; }));
  const acquiring = pool.acquire('A');
  const stopped = assert.rejects(acquiring, /stopped during launch/);
  const shutdown = pool.closeAll();
  resolveLaunch({ browser: () => ({ isConnected: () => true }), close: async () => { closes++; await delay(10); } });
  await Promise.all([stopped, shutdown]);
  assert.equal(closes, 1);
  await assert.rejects(pool.acquire('A'), /shutting down/);
});

test('independent UX: failed launch releases its slot so the same profile can retry', async t => {
  let attempts = 0;
  const pool = new BrowserSessions(60000, async () => {
    if (++attempts === 1) throw new Error('synthetic launch failure');
    return { browser: () => ({ isConnected: () => true }), close: async () => {} };
  });
  t.after(() => pool.closeAll());
  await assert.rejects(pool.acquire('A'), /synthetic launch failure/);
  const retry = await pool.acquire('A');
  assert.equal(retry.reused, false);
  await retry.release(false);
});

test('independent UX: MCP advertises controls without defaults that override quiet saved preferences', async t => {
  const f = fixture(t);
  const client = new Client({ name: 'giviloop-independent-ux-check', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--import', bridgePath, path.join(distDir, 'mcp-server.js')], env: f.env, stderr: 'pipe' }));
  const { tools } = await client.listTools();
  for (const name of ['givi_status', 'givi_cancel', 'givi_open', 'givi_resume', 'givi_release_browser_sessions']) assert.ok(tools.some(tool => tool.name === name), name);
  const webTools = tools.filter(tool => tool.inputSchema.properties?.background);
  assert.equal(webTools.length, 3);
  for (const tool of webTools) {
    assert.equal(tool.inputSchema.properties.background.default, undefined, `${tool.name} should defer to saved/dynamic preference`);
    assert.equal(tool.inputSchema.properties.webProvider?.default, undefined, `${tool.name} must not replace a saved reviewer`);
    assert.doesNotMatch(tool.inputSchema.properties.verificationWaitMs.description, /temporarily shows/);
  }
  const result = await client.callTool({ name: 'givi_status', arguments: { repositoryPath: f.repo } });
  assert.notEqual(result.isError, true);
  assert.equal(JSON.parse(result.content.find(c => c.type === 'text').text).state, 'no-review');
  assert.deepEqual(f.osCalls(), []);
});
