import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { setTimeout, clearTimeout } from "node:timers";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright";

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
    "--no-first-run", "--no-default-browser-check", "--new-window",
    ...(background ? ["--start-minimized"] : []), "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let finished = false, startupError: Error | undefined, browser: Browser | undefined, closePromise: Promise<void> | undefined;
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
      } finally { unregister(close); }
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
    const context = browser.contexts()[0];
    if (!context) throw new NativeChromeError("BROWSER_LAUNCH_FAILED", "Chrome did not expose its dedicated profile.");
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

export const nativeChrome = { launch };
