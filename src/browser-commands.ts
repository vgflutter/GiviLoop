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
  return {
    node: process.version, platform: `${process.platform}/${os.arch()}`,
    chromeExecutable: chromeExecutable() ?? null,
    profile: resolved, profileExists: existsSync(resolved),
    ownerPid: ownerPid ?? null, profileBusy: ownerPid !== undefined,
    previousExit: ownerPid ? "unknown (profile is currently open)" : exitType ?? "unknown",
    previousExitNote: "Saved Chrome preference; an earlier crash marker can persist after later clean exits. This field alone does not diagnose the last run.",
    authentication: "unknown (doctor does not inspect cookies or open the website)",
    nextStep: ownerPid ? "Close the dedicated Chrome window before sending."
      : "Use givi browser login for initial sign-in, close Chrome, then send the review.",
  };
}

/** Access probe only: never fill a composer, submit, or read conversation text. */
export async function checkBrowserAccess(profile = browserProfilePath(), headless = false, timeoutMs = 30_000, verificationWait?: number) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new Error("Browser check timeout must be an integer from 1 to 60000 ms.");
  }
  const verificationWaitMs = verificationTimeout(verificationWait, headless);
  const report = {
    checkedAt: new Date().toISOString(), profile: path.resolve(profile), headless, transport: headless ? "playwright" : "native-cdp",
    ready: false, submitted: false, sessionCookieReadable: false,
    authentication: "unknown", errorCode: undefined as string | undefined,
    verificationRequired: false, verificationCompleted: false,
    verificationCookieStored: false, verificationExpiresAt: null as string | null,
    nextStep: "",
  };
  let context: Awaited<ReturnType<typeof launchChatBrowser>> | undefined;
  try {
    context = await launchChatBrowser(report.profile, headless);
    report.sessionCookieReadable = (await context.cookies("https://chatgpt.com")).some(cookie => cookie.name.includes("session-token"));
    const page = context.pages()[0] ?? await context.newPage();
    await navigateToChat(page, "https://chatgpt.com/", timeoutMs, verificationWaitMs, async () => {
      report.verificationRequired = true;
      await showBrowser(context!, page);
      console.error(`GiviLoop: complete the browser verification in Chrome. Waiting up to ${Math.ceil(verificationWaitMs / 1000)} seconds; this check sends no prompt.`);
    });
    report.verificationCompleted = report.verificationRequired;
    await waitForChatInput(page, timeoutMs);
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
      const clearance = (await context.cookies("https://chatgpt.com").catch(() => [])).find(cookie => cookie.name === "cf_clearance");
      report.verificationCookieStored = Boolean(clearance);
      if (clearance && clearance.expires > 0) report.verificationExpiresAt = new Date(clearance.expires * 1000).toISOString();
    }
    await context?.close();
  }
  return report;
}

export async function openLoginBrowser(profile = browserProfilePath()): Promise<string> {
  const executable = chromeExecutable();
  if (!executable) throw new Error("Google Chrome was not found. Install it or set GIVILOOP_CHROME_PATH to its executable.");
  const resolved = path.resolve(profile);
  mkdirSync(resolved, { recursive: true });
  const chromeArgs = [
    `--user-data-dir=${resolved}`, "--no-first-run", "--no-default-browser-check",
    "--new-window", "--start-maximized", "https://chatgpt.com/",
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
