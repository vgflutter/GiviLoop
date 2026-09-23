import { WEB_CONFIG, type WebProvider } from "./providers/web-config.js";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserRunError, browserProfilePath, launchChatBrowser, navigateToChat, profileOwnerPid, showBrowser, verificationTimeout, waitForChatInput } from "./providers/browser-runtime.js";
import { chromeExecutable } from "./providers/native-chrome.js";
export { chromeExecutable } from "./providers/native-chrome.js";

export function diagnoseBrowser(profile = browserProfilePath()) {
  const resolved = path.resolve(profile);
  let exitType: string | undefined;
  try {
    const preferences = JSON.parse(readFileSync(path.join(resolved, "Default", "Preferences"), "utf8"));
    exitType = typeof preferences.profile?.exit_type === "string" ? preferences.profile.exit_type : undefined;
  } catch { /* New or unavailable profiles have no saved shutdown state. */ }
  const ownerPid = profileOwnerPid(resolved);
  const profileExists = existsSync(resolved);
  const profileBusy = ownerPid !== undefined;
  const previousExitNote = profileBusy
    ? "Chrome marks active sessions as Crashed; wait for this profile to close before interpreting its saved marker."
    : exitType === "Crashed"
      ? "Saved Chrome crash marker. It can persist after clean exits until the pending session restore is acknowledged; it does not prove the last run crashed."
      : exitType === "Normal" ? "Chrome recorded a clean shutdown."
        : exitType === "SessionEnded" ? "Chrome recorded a session ended by the operating system."
          : "No recognized Chrome shutdown marker is available.";
  return {
    node: process.version, platform: `${process.platform}/${os.arch()}`,
    chromeExecutable: chromeExecutable() ?? null,
    profile: resolved, profileExists,
    ownerPid: ownerPid ?? null, profileBusy,
    previousExit: profileBusy ? "unknown (profile is currently open)" : exitType ?? "unknown",
    previousExitNote,
    authentication: "unknown (doctor does not inspect cookies or open the website)",
    nextStep: profileBusy ? "Quit the dedicated Chrome instance before sending."
      : exitType === "Crashed"
        ? "Use givi browser login with this profile. Restore or dismiss 'Restore pages?', or open a new window after startup, then quit that Chrome normally and run givi doctor again."
        : profileExists ? "Use givi browser check with this profile to verify website access without sending a prompt."
          : "Use givi browser login for initial sign-in, quit that Chrome, then send the review.",
  };
}

/** Access probe only: never fill a composer, submit, or read conversation text. */
export async function checkBrowserAccess(profile: string | undefined = undefined, headless = false, timeoutMs = 30_000, verificationWait?: number, provider: WebProvider = "chatgpt-web", background = !headless) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("Browser check timeout must be an integer from 1 to 60000 ms.");
  }
  profile ??= browserProfilePath(provider);
  const config = WEB_CONFIG[provider];
  const requestedWait = verificationTimeout(verificationWait, headless);
  const verificationWaitMs = background ? 0 : requestedWait;
  const report = {
    provider, checkedAt: new Date().toISOString(), profile: path.resolve(profile), headless, background, transport: headless ? "playwright" : "native-cdp",
    ready: false, submitted: false, sessionCookieReadable: provider === "chatgpt-web" ? false : null as boolean | null,
    authentication: "unknown", errorCode: undefined as string | undefined,
    verificationRequired: false, verificationCompleted: false,
    verificationCookieStored: false, verificationExpiresAt: null as string | null,
    nextStep: "",
  };
  let context: Awaited<ReturnType<typeof launchChatBrowser>> | undefined;
  try {
    context = await launchChatBrowser(report.profile, headless, background);
    if (provider === "chatgpt-web") report.sessionCookieReadable = (await context.cookies(config.url)).some(cookie => cookie.name.includes("session-token"));
    const page = context.pages()[0] ?? await context.newPage();
    await navigateToChat(page, config.url, timeoutMs, verificationWaitMs, async () => {
      report.verificationRequired = true;
      await showBrowser(context!, page);
      console.error(`GiviLoop: complete the browser verification in Chrome. Waiting up to ${Math.ceil(verificationWaitMs / 1000)} seconds; this check sends no prompt.`);
    }, provider);
    report.verificationCompleted = report.verificationRequired;
    await waitForChatInput(page, timeoutMs, provider, async () => {
      if (background) throw new BrowserRunError("BROWSER_SETUP_REQUIRED", "Finish the website's initial cookie choice with givi browser login, close Chrome, then retry the check. Quiet checks do not restore the window.");
    });
    const loginVisible = await page.getByRole("button", { name: /^(Log in|Sign in|Accedi)$/i }).first().isVisible();
    report.ready = true;
    report.authentication = loginVisible ? "anonymous" : report.sessionCookieReadable ? "session available" : "unknown";
    report.nextStep = "Composer available. This probe does not validate a model, a completed generation or provider authorization.";
  } catch (error) {
    report.errorCode = error instanceof BrowserRunError ? error.code : "BROWSER_OPERATION_FAILED";
    if (report.errorCode === "ACCESS_CHALLENGE" || report.errorCode === "ACCESS_CHALLENGE_LOOP") report.verificationRequired = true;
    report.nextStep = error instanceof BrowserRunError ? error.message : "Browser access could not be inspected. Run givi doctor.";
  } finally {
    if (context) {
      const clearance = (await context.cookies(config.url).catch(() => [])).find(cookie => cookie.name === "cf_clearance");
      report.verificationCookieStored = Boolean(clearance);
      if (clearance && clearance.expires > 0) report.verificationExpiresAt = new Date(clearance.expires * 1000).toISOString();
    }
    await context?.close();
  }
  return report;
}

export async function openLoginBrowser(profile: string | undefined = undefined, provider: WebProvider = "chatgpt-web"): Promise<string> {
  profile ??= browserProfilePath(provider);
  const executable = chromeExecutable();
  if (!executable) throw new Error("Google Chrome was not found. Install it or set GIVILOOP_CHROME_PATH to its executable.");
  const resolved = path.resolve(profile);
  mkdirSync(resolved, { recursive: true });
  if (profileOwnerPid(resolved)) throw new Error("This profile is already open. Close its Chrome, or ask your MCP agent to call givi_release_browser_sessions (idle expiry: 60 seconds), before opening login. No new window was opened.");
  const chromeArgs = [
    `--user-data-dir=${resolved}`, "--no-first-run", "--no-default-browser-check",
    "--new-window", "--start-maximized", WEB_CONFIG[provider].url,
  ];
  // LaunchServices brings the login app to the foreground on macOS. A profile
  // previously used for background automation must not reopen a minimized tab.
  const bundle = process.platform === "darwin" ? /^(.*\.app)\/Contents\//.exec(executable)?.[1] : undefined;
  const child = spawn(bundle ? "/usr/bin/open" : executable,
    bundle ? ["-n", "-a", bundle, "--args", ...chromeArgs] : chromeArgs,
    { detached: true, stdio: "ignore" });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, 1_000);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(); // An existing Chrome may own the new window.
      else reject(new Error(`Chrome login launcher exited before opening a window (${signal ?? code}). Run givi doctor and check the dedicated profile.`));
    });
  });
  child.unref();
  return resolved;
}
