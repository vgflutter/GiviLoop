import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { setTimeout, clearTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";

export function chromeExecutable(): string | undefined {
  const candidates = process.env.GIVILOOP_CHROME_PATH ? [process.env.GIVILOOP_CHROME_PATH]
    : process.platform === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    : process.platform === "win32" ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
      .filter((value): value is string => Boolean(value)).map(root => path.join(root, "Google", "Chrome", "Application", "chrome.exe"))
    : ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  return candidates.find(candidate => existsSync(candidate));
}

export class NativeChromeError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

const extensionPath = fileURLToPath(new URL("../../browser-extension", import.meta.url));
const hiddenContexts = new WeakMap<BrowserContext, { session: CDPSession; targets: WeakMap<Page, string> }>();
const unavailable = () => new NativeChromeError("WINDOWLESS_UNAVAILABLE",
  "Chrome could not maintain a windowless review. Update Chrome and GiviLoop, or explicitly use --foreground. No visible fallback was opened; check the run's submitted status before retrying.");

// Playwright 1.61.1 exposes CDP hidden targets (type `other`) through this
// internal opt-in. Pin that dependency and retain regression coverage. Reference
// counting preserves the caller's environment across simultaneous MCP launches.
let attaching = 0, previousAttach: string | undefined;
async function attachHidden<T>(operation: () => Promise<T>): Promise<T> {
  if (attaching++ === 0) {
    previousAttach = process.env.PW_CHROMIUM_ATTACH_TO_OTHER;
    process.env.PW_CHROMIUM_ATTACH_TO_OTHER = "1";
  }
  try { return await operation(); }
  finally {
    if (--attaching === 0) {
      if (previousAttach === undefined) delete process.env.PW_CHROMIUM_ATTACH_TO_OTHER;
      else process.env.PW_CHROMIUM_ATTACH_TO_OTHER = previousAttach;
    }
  }
}

async function assertWindowless(context: BrowserContext, page: Page): Promise<void> {
  const state = hiddenContexts.get(context);
  const targetId = state?.targets.get(page);
  if (!state || !targetId || page.isClosed()) throw unavailable();
  try {
    await state.session.send("Browser.getWindowForTarget", { targetId });
  } catch (error) {
    if (/No window found|Browser window not found/i.test(String(error))) return;
    throw unavailable();
  }
  throw unavailable();
}

async function prepareWindowless(browser: Browser, context: BrowserContext): Promise<void> {
  const session = await browser.newBrowserCDPSession();
  try {
    // Supported CDP loading, unlike --load-extension on branded Chrome. Load
    // only our bundled extension into this owned, dedicated profile. Its fixed
    // public key keeps its ID stable across package installation paths.
    const { id } = await session.send("Extensions.loadUnpacked", { path: extensionPath });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const { targetInfos } = await session.send("Target.getTargets");
      if (targetInfos.some(t => t.url === `chrome-extension://${id}/offscreen.html`)) {
        const worker = context.serviceWorkers().find(w => w.url() === `chrome-extension://${id}/worker.js`);
        if (worker && await worker.evaluate("globalThis.giviloopOffscreen?.ready === true")) { ready = true; break; }
      }
      await delay(100);
    }
    if (!ready) throw unavailable();
    // An unexpected restored page must not become the review destination.
    // In particular, never silently use or minimize an existing visible tab.
    if (context.pages().length) throw unavailable();
    const state = { session, targets: new WeakMap<Page, string>() };
    hiddenContexts.set(context, state);
    context.newPage = () => attachHidden(async () => {
      const { targetId } = await session.send("Target.createTarget", {
        url: "about:blank", hidden: true, background: true,
      });
      try {
        for (let attempt = 0; attempt < 100; attempt++) {
          for (const page of context.pages()) {
            if (state.targets.has(page)) continue;
            const target = await context.newCDPSession(page);
            try {
              if ((await target.send("Target.getTargetInfo")).targetInfo.targetId !== targetId) continue;
              await page.setViewportSize({ width: 1400, height: 1000 });
              state.targets.set(page, targetId);
              await assertWindowless(context, page);
              return page;
            } finally { await target.detach().catch(() => {}); }
          }
          await delay(50);
        }
        throw unavailable();
      } catch {
        await session.send("Target.closeTarget", { targetId }).catch(() => {});
        throw unavailable();
      }
    });
    await context.newPage();
    // Keep the creator session attached for the lifetime of its hidden pages.
  } catch {
    hiddenContexts.delete(context);
    await session.detach().catch(() => {});
    throw unavailable();
  }
}

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

// Reserve an OS-assigned loopback port, then connect only to the exact WebSocket
// announced by our child. Never attach to an arbitrary existing browser/service.
async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (!port) throw new NativeChromeError("BROWSER_LAUNCH_FAILED", "Could not reserve a local browser connection.");
  return port;
}

const closers = new Set<() => Promise<void>>();
let stopping = false;
function stopForSignal(code: number): void {
  if (stopping) return;
  stopping = true;
  void Promise.allSettled([...closers].map(close => close())).finally(() => process.exit(code));
}
const onInterrupt = () => stopForSignal(130);
const onTerminate = () => stopForSignal(143);
function register(close: () => Promise<void>): void {
  if (closers.size === 0) { process.on("SIGINT", onInterrupt); process.on("SIGTERM", onTerminate); }
  closers.add(close);
}
function unregister(close: () => Promise<void>): void {
  closers.delete(close);
  if (closers.size === 0) { process.off("SIGINT", onInterrupt); process.off("SIGTERM", onTerminate); }
}

async function launch(profile: string, background: boolean): Promise<BrowserContext> {
  const executable = chromeExecutable();
  if (!executable) throw new NativeChromeError("BROWSER_NOT_FOUND", "Google Chrome is required. Install Chrome or set GIVILOOP_CHROME_PATH.");
  const port = await availablePort();
  const child = spawn(executable, [
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1",
    "--no-first-run", "--no-default-browser-check",
    // No startup window. The extension provides Chrome's required initial
    // frame target; reviews run in separate hidden top-level web pages.
    ...(background ? ["--no-startup-window", "--enable-unsafe-extension-debugging"] : ["--new-window", "about:blank"]),
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let finished = false, startupError: Error | undefined, browser: Browser | undefined, closePromise: Promise<void> | undefined;
  let context: BrowserContext | undefined;
  let startupLogs = "";
  let announce: (endpoint: string) => void;
  const endpoint = new Promise<string>(resolve => { announce = resolve; });
  const exited = new Promise<boolean>(resolve => {
    child.once("exit", () => { finished = true; resolve(true); });
    child.once("error", error => { startupError = error; finished = true; resolve(true); });
  });
  const collect = (chunk: Buffer) => {
    startupLogs = (startupLogs + chunk.toString()).slice(-8192);
    const found = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[A-Za-z0-9-]+)/.exec(startupLogs);
    if (found && new URL(found[1]).port === String(port)) announce(found[1]);
  };
  child.stderr.on("data", collect);
  function close(): Promise<void> {
    return closePromise ??= (async () => {
      try {
        if (!finished && browser?.isConnected()) {
          await within((async () => {
            const session = await browser!.newBrowserCDPSession();
            await session.send("Browser.close");
          })().catch(() => {}), 2000);
        }
        if (!finished && !await within(exited, 5000)) child.kill("SIGTERM");
        if (!finished && !await within(exited, 2000)) child.kill("SIGKILL");
        if (!finished && !await within(exited, 2000)) throw new NativeChromeError("BROWSER_CLOSE_FAILED", "The owned Chrome process did not terminate. Check givi doctor before retrying.");
        await browser?.close().catch(() => {});
      } finally {
        // Chrome helpers can inherit stderr and outlive the browser process.
        // Do not keep the caller alive waiting for those helpers to close it.
        child.stderr.destroy();
        if (context) hiddenContexts.delete(context);
        unregister(close);
      }
    })();
  }
  register(close);
  void exited.then(() => unregister(close));
  try {
    const announced = await within(Promise.race([endpoint, exited.then(() => undefined)]), 30000);
    if (!announced) {
      const busy = /ProcessSingleton|SingletonLock|profile.*in use/i.test(startupLogs);
      throw new NativeChromeError(busy ? "BROWSER_PROFILE_BUSY" : "BROWSER_LAUNCH_FAILED",
        busy ? "Chrome is already using this profile. Close it before retrying."
          : startupError ? `Chrome could not start (${(startupError as NodeJS.ErrnoException).code ?? "launch error"}).`
            : "Chrome did not expose its local control connection. Check its installation, display and remote-debugging policy.");
    }
    // stderr is drained, but neither startup logs nor the control endpoint are persisted.
    child.stderr.off("data", collect);
    startupLogs = "";
    child.stderr.resume();
    browser = await chromium.connectOverCDP(announced, { timeout: 15000 });
    context = browser.contexts()[0];
    if (!context) throw new NativeChromeError("BROWSER_LAUNCH_FAILED", "Chrome did not expose its dedicated profile.");
    if (background) await prepareWindowless(browser, context);
    // On a CDP connection Playwright's default close only disconnects. Own and
    // await Chrome's real shutdown so cookies flush and the profile lock releases.
    context.close = close;
    return context;
  } catch (error) {
    await close().catch(() => {});
    if (error instanceof NativeChromeError) throw error;
    throw new NativeChromeError("BROWSER_LAUNCH_FAILED", "Could not connect to the Chrome process started by GiviLoop.");
  }
}

export const nativeChrome = { launch, isWindowless: (context: BrowserContext) => hiddenContexts.has(context), assertWindowless };
