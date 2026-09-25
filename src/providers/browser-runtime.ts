import { chromium, type BrowserContext, type Locator, type Page, type Response } from "playwright";
import { existsSync, mkdirSync, readlinkSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { WEB_CONFIG, type WebProvider } from "./web-config.js";
import { nativeChrome, NativeChromeError } from "./native-chrome.js";

export class BrowserRunError extends Error {
  constructor(public readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "BrowserRunError";
  }
}

export function browserProfilePath(provider: WebProvider = "chatgpt-web"): string {
  return path.join(os.homedir(), ".giviloop", "browser-profiles", WEB_CONFIG[provider].profile);
}

export function profileOwnerPid(profile: string): number | undefined {
  try {
    const lock = readlinkSync(path.join(profile, "SingletonLock"));
    const match = /-(\d+)$/.exec(lock);
    if (!match) return undefined;
    const pid = Number(match[1]);
    try { process.kill(pid, 0); return pid; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return pid;
    }
  } catch { /* Chrome may use a native mutex instead (Windows). */ }
  return undefined;
}

export async function launchChatBrowser(profile: string, headless: boolean, background = false): Promise<BrowserContext> {
  const owner = profileOwnerPid(profile);
  if (owner) {
    throw new BrowserRunError("BROWSER_PROFILE_BUSY", `The GiviLoop browser profile is already open (PID ${owner}). Close that browser, then retry. Profile: ${profile}`);
  }
  mkdirSync(profile, { recursive: true });
  try {
    const context = headless ? await chromium.launchPersistentContext(profile, {
      channel: "chrome", headless, chromiumSandbox: true, timeout: 30_000,
      executablePath: process.env.GIVILOOP_CHROME_PATH,
      // Reuse the native OS credential store used by `givi browser login`.
      // Playwright's testing defaults otherwise make existing cookies unreadable.
      ignoreDefaultArgs: ["--use-mock-keychain", "--password-store=basic"],
      viewport: { width: 1400, height: 1000 },
      args: background ? ["--start-minimized"] : [],
    }) : await nativeChrome.launch(profile, background);
    context.setDefaultTimeout(10_000);
    return context;
  } catch (error) {
    if (error instanceof NativeChromeError) throw new BrowserRunError(error.code, error.message);
    const message = error instanceof Error ? error.message : String(error);
    if (/Singleton|ProcessSingleton|profile.*in use|user data directory.*in use/i.test(message)) {
      throw new BrowserRunError("BROWSER_PROFILE_BUSY", `Chrome is already using this profile. Close it before retrying: ${profile}`);
    }
    if (/not found|doesn.t exist|not installed|executable/i.test(message)) {
      throw new BrowserRunError("BROWSER_NOT_FOUND", "Google Chrome is required for web automation. Install Chrome, then run givi doctor.");
    }
    throw new BrowserRunError("BROWSER_LAUNCH_FAILED", `Chrome could not start: ${message.split("\n")[0]}`);
  }
}

export async function minimizeBrowser(context: BrowserContext, page: Page): Promise<void> {
  if (nativeChrome.isWindowless(context)) {
    try { await nativeChrome.assertWindowless(context, page); return; }
    catch (error) {
      if (error instanceof NativeChromeError) throw new BrowserRunError(error.code, error.message);
      throw error;
    }
  }
  const session = await context.newCDPSession(page);
  try {
    const { windowId, bounds: initial } = await session.send("Browser.getWindowForTarget");
    if (initial.windowState === "minimized") return;
    // Chrome on macOS can acknowledge minimize while staying maximized.
    // Leave maximized/fullscreen first and wait for the native transition.
    if (initial.windowState === "maximized" || initial.windowState === "fullscreen") {
      await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      let restored = false;
      for (let attempt = 0; attempt < 30; attempt++) {
        const { bounds } = await session.send("Browser.getWindowBounds", { windowId });
        if (bounds.windowState === "normal") { restored = true; break; }
        await page.waitForTimeout(100);
      }
      if (!restored) throw new Error("Chrome did not leave its maximized/fullscreen state.");
    }
    await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
    // macOS completes the window animation asynchronously after the CDP ack.
    for (let attempt = 0; attempt < 20; attempt++) {
      const { bounds } = await session.send("Browser.getWindowBounds", { windowId });
      if (bounds.windowState === "minimized") return;
      // AppKit can acknowledge "normal" before its restore animation ends,
      // then ignore the first minimize request. Repeat only this idempotent
      // window operation, within the existing deadline, after checking state.
      if (bounds.windowState === "normal" && attempt > 0 && attempt % 5 === 0) {
        await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "minimized" } });
      }
      await page.waitForTimeout(100);
    }
    throw new Error("Chrome did not confirm a minimized window.");
  } catch {
    throw new BrowserRunError("BACKGROUND_UNAVAILABLE", "Chrome could not minimize its window on this system. Retry without --background.");
  } finally {
    await session.detach();
  }
}

export async function showBrowser(context: BrowserContext, page: Page): Promise<void> {
  if (nativeChrome.isWindowless(context)) throw new BrowserRunError("BROWSER_INTERACTION_REQUIRED",
    "This review has no visible window. Use givi open for login/setup, close that browser, then resume; use resume --foreground for uploads.");
  const session = await context.newCDPSession(page);
  try {
    const { windowId } = await session.send("Browser.getWindowForTarget");
    await session.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
    await page.bringToFront();
  } finally { await session.detach(); }
}

export function verificationTimeout(value: number | undefined, headless: boolean): number {
  const result = value ?? (headless ? 0 : 180_000);
  if (!Number.isSafeInteger(result) || result < 0 || result > 900_000) {
    throw new Error("Verification wait must be an integer from 0 to 900000 ms.");
  }
  if (headless && result > 0) throw new Error("Interactive verification requires a visible browser. Omit --headless or set verification wait to 0.");
  return result;
}

export function chatInput(page: Page, provider: WebProvider = "chatgpt-web"): Locator {
  return page.locator(WEB_CONFIG[provider].input).first();
}

export function assertChatOrigin(page: Page, expectedUrl: string): void {
  let matches = false;
  try { matches = new URL(page.url()).origin === new URL(expectedUrl).origin; } catch { /* Invalid or closed page. */ }
  if (!matches) throw new BrowserRunError("UNEXPECTED_ORIGIN", "The browser left the configured provider origin. Sending stopped to protect the review context.");
}

export async function pageBlocker(page: Page, provider: WebProvider = "chatgpt-web"): Promise<BrowserRunError | undefined> {
  if (page.isClosed()) return new BrowserRunError("BROWSER_CLOSED", "The browser was closed before the review completed.");
  const url = page.url();
  if (/^chrome-error:/.test(url)) {
    return new BrowserRunError("NETWORK_ERROR", "Chrome could not load the page. Check the network and whether the computer went to sleep.");
  }
  if (/^https:\/\/(auth\.openai\.com|accounts\.google\.com)\//.test(url) || /^https:\/\/(chat\.deepseek\.com\/sign_in|claude\.ai\/login)(?:[/?#]|$)/.test(url)) {
    return new BrowserRunError("LOGIN_REQUIRED", `${WEB_CONFIG[provider].name} requires login. Run givi browser login --provider ${provider}, sign in in the dedicated Chrome profile, then close it and retry.`);
  }
  const challenge = page.locator('#challenge-running:visible, #challenge-stage:visible, iframe[src*="challenges.cloudflare.com"]:visible').first();
  if (await challenge.isVisible().catch(() => false)) {
    return new BrowserRunError("ACCESS_CHALLENGE", "The site requires interactive verification. Automatic sending stopped. Open the dedicated browser with givi browser login.");
  }
  // ChatGPT's anonymous UI can fail its verification without rendering a
  // challenge iframe. Do not mistake quoted prompt/response text for its UI.
  if (provider === "chatgpt-web" && await page.locator(
    ':text-is("An error occurred during verification, please try again."):not([data-message-role], [data-message-role] *, [data-message-author-role], [data-message-author-role] *, [contenteditable], [contenteditable] *, textarea)',
  ).first().isVisible().catch(() => false)) {
    return new BrowserRunError("ACCESS_CHALLENGE", "ChatGPT reports that its verification failed. No automatic retry was attempted. Check this run's submitted status, then use givi open to inspect the dedicated browser session.");
  }
  const alert = await page.locator('[role="alert"]').first().innerText({ timeout: 250 }).catch(() => "");
  if (/usage limit|rate limit|too many requests|limite di utilizzo|troppe richieste/i.test(alert)) {
    return new BrowserRunError("PROVIDER_LIMIT", "The provider reports a usage or request limit. Wait for the limit to reset before retrying.");
  }
  return undefined;
}

export async function navigateToChat(page: Page, url: string, timeoutMs: number, verificationWaitMs = 0, onVerificationRequired?: () => Promise<void>, provider: WebProvider = "chatgpt-web"): Promise<void> {
  let documentStatus: number | undefined, documentChallenge = false, challengeDocuments = 0;
  const observe = (response: Response) => {
    if (response.request().isNavigationRequest() && response.frame() === page.mainFrame()) {
      documentStatus = response.status();
      documentChallenge = response.headers()["cf-mitigated"] === "challenge";
      if (documentChallenge) challengeDocuments++;
    }
  };
  async function waitForVerification(): Promise<void> {
    if (verificationWaitMs === 0) throw new BrowserRunError("ACCESS_CHALLENGE", `The site requires browser verification. No prompt was sent. Run givi browser login --provider ${provider}, complete verification and close Chrome, then use givi resume for the paused run. Quiet checks never open an interactive window.`);
    await onVerificationRequired?.();
    const deadline = Date.now() + verificationWaitMs;
    while (Date.now() < deadline) {
      if (page.isClosed()) throw new BrowserRunError("BROWSER_CLOSED", "The browser closed while waiting for your verification. No prompt was sent.");
      if (documentStatus === 429) throw new BrowserRunError("PROVIDER_LIMIT", "The provider reported a request limit during verification. No prompt was sent.");
      if (documentStatus === 403 && !documentChallenge) throw new BrowserRunError("ACCESS_DENIED", "The provider denied access during verification. No prompt was sent.");
      if (challengeDocuments >= 3 && documentChallenge) throw new BrowserRunError("ACCESS_CHALLENGE_LOOP", "The site presented verification repeatedly without granting access. Stop repeating the tap. No prompt was sent. Check access in regular Chrome; the stored login alone cannot resolve a rejected verification.");
      // Header challenges need a fresh allowed document; DOM-only challenges may
      // clear in the original HTTP 200 document. Never trust a composer in a denial.
      if (documentStatus !== undefined && documentStatus >= 200 && documentStatus < 400 && !documentChallenge) {
        assertChatOrigin(page, url);
        const blocker = await pageBlocker(page, provider);
        if (blocker && blocker.code !== "ACCESS_CHALLENGE") throw blocker;
        if (!blocker && await chatInput(page, provider).isEditable({ timeout: 250 }).catch(() => false)) return;
      }
      await page.waitForTimeout(500);
    }
    throw new BrowserRunError("ACCESS_CHALLENGE", "Browser verification was not completed before the waiting period ended. No prompt was sent. Retry when you can complete the verification, or increase --verification-wait-ms.");
  }
  if (verificationWaitMs > 0) page.on("response", observe);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        const status = response?.status();
        if (response?.headers?.()["cf-mitigated"] === "challenge") return await waitForVerification();
        if (status === 403 || status === 429) throw new BrowserRunError(status === 403 ? "ACCESS_DENIED" : "PROVIDER_LIMIT", `The provider returned HTTP ${status}. No prompt was sent. Interactive access or a later retry is required.`);
        if (status && status >= 400) throw new Error(`The provider returned HTTP ${status}.`);
        const blocker = await pageBlocker(page, provider);
        if (blocker?.code === "ACCESS_CHALLENGE") return await waitForVerification();
        if (blocker) throw blocker;
        assertChatOrigin(page, url);
        return;
      } catch (error) {
        if (error instanceof BrowserRunError) throw error;
        const blocker = await pageBlocker(page, provider);
        if (blocker?.code === "ACCESS_CHALLENGE") return await waitForVerification();
        if (blocker) throw blocker;
        // A slow optional resource must not block an already usable composer.
        if (await chatInput(page, provider).isEditable({ timeout: 500 }).catch(() => false)) {
          assertChatOrigin(page, url);
          return;
        }
        if (attempt === 1) throw new BrowserRunError("NAVIGATION_FAILED", `${WEB_CONFIG[provider].name} could not be loaded after two attempts. No prompt was sent. Check the network, browser profile and computer sleep state. ${error instanceof Error ? error.message.split("\n")[0] : ""}`);
        await page.waitForTimeout(750);
      }
    }
  } finally { if (verificationWaitMs > 0) page.off("response", observe); }
}

export async function waitForChatInput(page: Page, timeoutMs: number, provider: WebProvider = "chatgpt-web", onSetupRequired?: () => Promise<void>): Promise<Locator> {
  const deadline = Date.now() + timeoutMs;
  const input = chatInput(page, provider);
  while (Date.now() < deadline) {
    const blocker = await pageBlocker(page, provider);
    if (blocker) throw blocker;
    if (await input.isEditable({ timeout: 250 }).catch(() => false)) {
      if (provider === "gemini-web" || provider === "claude-web") {
        // Dismiss only the explicit optional-cookie choice, never accept
        // account terms, solve a challenge or click arbitrary consent buttons.
        const reject = provider === "claude-web" ? page.getByTestId("consent-reject")
          : page.getByRole("button", { name: /^(Reject all|Rifiuta tutto)$/i }).first();
        if (await reject.isVisible()) {
          assertChatOrigin(page, WEB_CONFIG[provider].url);
          await onSetupRequired?.();
          try {
            await reject.click({ timeout: 5000 });
            await reject.waitFor({ state: "hidden", timeout: 10_000 });
          } catch {
            throw new BrowserRunError("BROWSER_SETUP_REQUIRED", `${WEB_CONFIG[provider].name}'s cookie choice could not be completed. Run givi browser login --provider ${provider}, finish setup and close Chrome. No prompt was sent.`);
          }
        }
      }
      return input;
    }
    await page.waitForTimeout(250);
  }
  const login = page.getByRole("button", { name: /^(Log in|Sign in|Accedi)$/i }).first();
  if (await login.isVisible().catch(() => false)) {
    throw new BrowserRunError("LOGIN_REQUIRED", `No usable chat input is available and ${WEB_CONFIG[provider].name} shows a login button. Run givi browser login --provider ${provider}, sign in, close that browser, then retry.`);
  }
  throw new BrowserRunError("CHAT_INPUT_UNAVAILABLE", `No editable ${WEB_CONFIG[provider].name} input appeared. The page may still be loading or its interface may have changed. No prompt was sent.`);
}

export function atomicWrite(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}
