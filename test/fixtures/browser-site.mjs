// Real Chromium, isolated profile, local responses for every provider request.
// This is a test preload, never part of the published package.
import { createRequire } from "node:module";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const dist = process.env.GIVILOOP_TEST_DIST_DIR ?? path.resolve("dist");
const { chromium } = createRequire(path.join(dist, "cli.js"))("playwright");
const launch = chromium.launchPersistentContext.bind(chromium);
const html = readFileSync(process.env.GIVILOOP_TEST_PAGE, "utf8");
const log = process.env.GIVILOOP_TEST_BROWSER_LOG;
async function instrument(context) {
  let providerNavigations = 0;
  await context.exposeFunction("captureSubmission", async value => {
    if (process.env.GIVILOOP_TEST_CAPTURE_WINDOW_STATE) {
      const page = context.pages().find(page => page.url().startsWith(process.env.GIVILOOP_TEST_ORIGIN));
      const session = await context.newCDPSession(page);
      try { value.windowState = (await session.send("Browser.getWindowForTarget")).bounds.windowState; }
      finally { await session.detach(); }
    }
    appendFileSync(log, JSON.stringify({ action: "submit", ...value }) + "\n");
  });
  await context.route("**/*", route => {
    if (route.request().isNavigationRequest() && new URL(route.request().url()).origin === (process.env.GIVILOOP_TEST_ORIGIN ?? "https://chatgpt.com")) {
      providerNavigations++;
      if (process.env.GIVILOOP_TEST_LOGIN_PATH && providerNavigations === 1) {
        return route.fulfill({status:200, contentType:"text/html", body:`<script>location.href=${JSON.stringify(process.env.GIVILOOP_TEST_LOGIN_PATH)}</script>`});
      }
      if (process.env.GIVILOOP_TEST_VERIFICATION_FLOW && providerNavigations === 1) {
        // A controlled page transition stands in for completion by a human.
        // No actual provider challenge is accessed or solved in this fixture.
        return route.fulfill({ status: 403, headers: { "cf-mitigated": "challenge" }, contentType: "text/html",
          body: '<div id="challenge-stage">Synthetic verification</div><script>setTimeout(()=>location.reload(),1500)</script>' });
      }
      return route.fulfill({ status: Number(process.env.GIVILOOP_TEST_HTTP_STATUS ?? 200),
        headers: process.env.GIVILOOP_TEST_CHALLENGE ? { "cf-mitigated": "challenge" } : {},
        contentType: "text/html; charset=utf-8", body: html });
    }
    return route.abort();
  });
  return context;
}
chromium.launchPersistentContext = async (profile, options) => {
  appendFileSync(log, JSON.stringify({ action: "launch", profile, headless: options.headless }) + "\n");
  return instrument(await launch(profile, options));
};
const { nativeChrome } = await import(pathToFileURL(path.join(dist, "providers/native-chrome.js")));
const nativeLaunch = nativeChrome.launch;
nativeChrome.launch = async (profile, background) => {
  appendFileSync(log, JSON.stringify({ action: "launch", profile, headless: false, native: true }) + "\n");
  return instrument(await nativeLaunch(profile, background));
};
