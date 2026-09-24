// Experimental transport only. Production GiviLoop does not import this module.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { chromeExecutable } from '../../dist/providers/native-chrome.js';

export async function within(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function launchHidden(profile, { onSpawn = () => {}, diagnostics = {}, executable = chromeExecutable(), extraArgs = [], beforeTarget, targetMode = 'hidden', requestClose, env = process.env, terminalPTY = false } = {}) {
  if (!executable) throw new Error('Install Chrome or set GIVILOOP_CHROME_PATH.');
  const port = await availablePort();
  const browserArgs = [
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`,
    '--remote-debugging-address=127.0.0.1', '--no-first-run',
    '--no-default-browser-check', '--no-startup-window',
    ...extraArgs,
  ];
  const child = spawn(terminalPTY ? 'python3' : executable,
    terminalPTY ? [fileURLToPath(new URL('./terminal-launch.py', import.meta.url)), executable, ...browserArgs] : browserArgs,
    { stdio: ['pipe', 'ignore', 'pipe'], env });
  let finished = false, browser, ownerSession, closing, pollingEndpoint = false;
  let endpointResolve, endpointReject;
  const endpoint = new Promise((resolve, reject) => { endpointResolve = resolve; endpointReject = reject; });
  // Cleanup can run before the startup wait (for example if onSpawn fails).
  void endpoint.catch(() => {});
  const exited = new Promise(resolve => {
    child.once('exit', (code, signal) => {
      finished = true;
      endpointReject(new Error(`Chrome exited before connection (code ${code}, signal ${signal}).`));
      resolve();
    });
    child.once('error', error => { finished = true; endpointReject(error); resolve(); });
  });
  let stderr = '';
  let terminalPidReported = false;
  const collect = chunk => {
    stderr = (stderr + chunk.toString()).slice(-8192);
    const terminalPid = /POC_BROWSER_PID=(\d+)/.exec(stderr);
    if (terminalPTY && terminalPid && !terminalPidReported) {
      terminalPidReported = true;
      onSpawn(Number(terminalPid[1]));
    }
    const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[A-Za-z0-9-]+)/.exec(stderr);
    if (match && new URL(match[1]).port === String(port)) endpointResolve(match[1]);
  };
  child.stderr.on('data', collect);
  async function close() {
    return closing ??= (async () => {
      let forced = false;
      try {
        if (!finished && browser?.isConnected()) {
          await within((async () => {
            if (requestClose) return requestClose({ child, browser });
            const session = await browser.newBrowserCDPSession();
            await session.send('Browser.close');
          })(), 2000, 'Browser.close').catch(() => {});
        }
        if (!finished) {
          try { await within(exited, 5000, 'Chrome shutdown'); }
          catch {
            forced = true;
            child.kill('SIGTERM');
            try { await within(exited, 2000, 'Chrome termination'); }
            catch { child.kill('SIGKILL'); await within(exited, 2000, 'Chrome kill'); }
          }
        }
      } finally {
        await browser?.close().catch(() => {});
        child.stderr.destroy();
        process.off('SIGINT', interrupt);
        process.off('SIGTERM', terminate);
      }
      return { exited: finished, forced };
    })();
  }
  const interrupt = () => { void close().finally(() => process.exit(130)); };
  const terminate = () => { void close().finally(() => process.exit(143)); };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', terminate);
  // Playwright 1.61 exposes hidden Chromium targets as type "other" only with
  // this internal opt-in. This is a PoC dependency, not a supported public API.
  const previousAttach = process.env.PW_CHROMIUM_ATTACH_TO_OTHER;
  process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1';
  try {
    if (!terminalPTY) onSpawn(child.pid);
    diagnostics.terminalPTY = terminalPTY;
    // Carbonyl renders over Chromium's console output and does not print the
    // DevTools announcement. Discover the endpoint on this child's allocated
    // loopback port instead; never attach to the user's normal browser port.
    if (terminalPTY) {
      pollingEndpoint = true;
      void (async () => {
        while (pollingEndpoint && !finished) {
          try {
            const response = await fetch(`http://127.0.0.1:${port}/json/version`,
              { signal: AbortSignal.timeout(500), redirect: 'error' });
            if (response.ok) {
              const version = await response.json();
              const address = new URL(version.webSocketDebuggerUrl);
              if (address.protocol === 'ws:' && address.hostname === '127.0.0.1' &&
                  address.port === String(port) && address.pathname.startsWith('/devtools/browser/')) {
                diagnostics.endpointDiscovery = 'owned-loopback-port';
                endpointResolve(address.href);
                return;
              }
            }
          } catch { /* The owned process may not have opened its port yet. */ }
          await delay(100);
        }
      })();
    }
    const address = await within(endpoint, 15000, 'Chrome startup');
    pollingEndpoint = false;
    child.stderr.off('data', collect);
    child.stderr.resume();
    stderr = '';
    browser = await chromium.connectOverCDP(address, { timeout: 10000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error('Chrome did not expose its persistent context.');
    context.setDefaultTimeout(5000);
    ownerSession = await browser.newBrowserCDPSession();
    const version = await ownerSession.send('Browser.getVersion');
    diagnostics.browser = version.product;
    diagnostics.revision = version.revision;
    diagnostics.initialTargets = (await ownerSession.send('Target.getTargets')).targetInfos.map(info => ({ type: info.type, subtype: info.subtype }));
    if (beforeTarget) await beforeTarget({ browser, context, ownerSession, diagnostics });
    // Keep this session attached: hidden targets live only as long as their
    // creator session. Never create a visible fallback or change headless mode.
    let targetId;
    const started = Date.now();
    diagnostics.createAttempts = 0;
    for (; targetMode !== 'existing';) {
      diagnostics.createAttempts++;
      try {
        ({ targetId } = await ownerSession.send('Target.createTarget', {
          url: 'about:blank', background: true,
          ...(targetMode === 'minimized' ? { newWindow: true, windowState: 'minimized' } : { hidden: true }),
        }));
        break;
      } catch (error) {
        diagnostics.createElapsedMs = Date.now() - started;
        // Chromium's own BiDi runner retries this specific startup race. No
        // navigation or submission has happened; never retry provider failures.
        if (!error.message.includes('Hidden target can be created only when remote debugging is enabled') || diagnostics.createElapsedMs >= 10000) {
          diagnostics.finalTargets = (await ownerSession.send('Target.getTargets')).targetInfos.map(info => ({ type: info.type, subtype: info.subtype }));
          throw error;
        }
        await delay(100);
      }
    }
    diagnostics.createElapsedMs = Date.now() - started;
    let page;
    for (let attempt = 0; attempt < 100 && !page; attempt++) {
      for (const candidate of context.pages()) {
        const session = await context.newCDPSession(candidate);
        try {
          const candidateId = (await session.send('Target.getTargetInfo')).targetInfo.targetId;
          if (targetMode === 'existing' || candidateId === targetId) { page = candidate; targetId = candidateId; }
        } finally { await session.detach(); }
      }
      if (!page) await delay(50);
    }
    if (!page) throw new Error('Playwright did not discover the hidden page.');
    // A hidden WebContents has no native view to supply its viewport dimensions.
    if (targetMode === 'hidden') await page.setViewportSize({ width: 1400, height: 1000 });
    return { context, page, browser, ownerSession, targetId, pid: child.pid, close };
  } catch (error) {
    const launchHint = stderr.match(/(?:bad option|error|Error|FATAL|panicked)[^\n]{0,200}/)?.[0];
    if (launchHint) diagnostics.launchHint = launchHint.replaceAll(profile, '[temporary-profile]');
    const cleanup = await close();
    diagnostics.cleanup = cleanup;
    error.cleanup = cleanup;
    throw error;
  } finally {
    pollingEndpoint = false;
    if (previousAttach === undefined) delete process.env.PW_CHROMIUM_ATTACH_TO_OTHER;
    else process.env.PW_CHROMIUM_ATTACH_TO_OTHER = previousAttach;
  }
}

export async function assertNoWindow(run) {
  try {
    const result = await run.ownerSession.send('Browser.getWindowForTarget', { targetId: run.targetId });
    throw new Error(`Hidden target unexpectedly owns a ${result.bounds.windowState} OS window.`);
  } catch (error) {
    if (!/No window found|Browser window not found/i.test(error.message)) throw error;
  }
}
