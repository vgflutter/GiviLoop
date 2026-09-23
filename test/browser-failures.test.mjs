import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { distDir } from "./helpers.mjs";
const { chromium } = createRequire(path.join(distDir, "cli.js"))("playwright");
const { sendToChatGptWeb } = await import(pathToFileURL(path.join(distDir, "providers/chatgpt-web.js")));
const { nativeChrome } = await import(pathToFileURL(path.join(distDir, "providers/native-chrome.js")));

function scenario(t, settings = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "giviloop-browser-failure-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previousAllowed = process.env.GIVILOOP_ALLOWED_REPOSITORIES;
  process.env.GIVILOOP_ALLOWED_REPOSITORIES = root;
  t.after(() => previousAllowed === undefined
    ? delete process.env.GIVILOOP_ALLOWED_REPOSITORIES
    : process.env.GIVILOOP_ALLOWED_REPOSITORIES = previousAllowed);
  const request = path.join(root, "request.md"), response = path.join(root, "response.md");
  writeFileSync(request, "PRIVATE_PROMPT_MUST_NOT_APPEAR_IN_STATUS");
  const profile = path.join(root, "profile");
  const metrics = { navigations: 0, clicks: 0, launches: 0, closes: 0, uploads: 0 };
  let closed = false;
  let now = 0;
  t.mock.method(Date, "now", () => now);
  const page = {
    isClosed: () => closed, url: () => (metrics.clicks ? settings.responseOrigin : undefined) ?? settings.origin ?? "https://chatgpt.com/",
    goto: async () => {
      metrics.navigations++;
      if (metrics.navigations <= (settings.navigationFailures ?? 0)) throw new Error("Navigation timeout");
      return { status: () => settings.httpStatus ?? 200, headers: () => settings.challengeHeader ? { "cf-mitigated": "challenge" } : {} };
    },
    waitForTimeout: async ms => { now += ms; settings.onWait?.(metrics); },
    waitForEvent: async () => ({ setFiles: async () => { metrics.uploads++; } }),
    getByRole: () => ({ first: () => ({ isVisible: async () => settings.loginRequired ?? false }) }),
    locator(selector) {
      const locator = {
        first: () => locator, nth: () => locator, locator: child => page.locator(child),
        isVisible: async () => Boolean(settings.uploadUnconfirmed && selector.includes("composer-plus-btn")), allTextContents: async () => [],
        isEditable: async () => !settings.loginRequired && metrics.navigations > (settings.navigationFailures ?? 0),
        isEnabled: async () => true, fill: async () => {},
        click: async () => {
          metrics.clicks++;
          if (settings.clickThrows) throw new Error("Page disconnected during click");
        },
        count: async () => selector.includes("data-message-role") ? (metrics.clicks ? 1 : 0)
          : selector.includes("data-assistant-markdown") ? 1 : 0,
        getAttribute: async name => name === "data-message-role" ? "assistant"
          : name === "data-message-complete" && !settings.incomplete ? "" : null,
        innerText: async () => selector.includes('role="alert"') || (settings.uploadUnconfirmed && selector === "body") ? "" : "Review answer",
      };
      return locator;
    },
  };
  const launch = async () => {
    metrics.launches++;
    settings.onLaunch?.();
    return { pages: () => [], newPage: async () => page, setDefaultTimeout: () => {}, close: async () => {
      metrics.closes++; closed = true; settings.onClose?.();
    } };
  };
  t.mock.method(chromium, "launchPersistentContext", launch);
  t.mock.method(nativeChrome, "launch", launch);
  return {
    root, profile, response, metrics,
    run: options => sendToChatGptWeb({ repositoryPath: root, userDataDir: profile, requestPath: request,
      responsePath: response, mode: "auto", background: false, verificationWaitMs: 0, responseStableMs: 500, maxWaitMs: 3000, ...options }),
    status: () => JSON.parse(readFileSync(path.join(root, "browser-status.json"), "utf8")),
  };
}

test("a pre-cancelled browser review never launches and releases its run lock", async t => {
  const f = scenario(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.run({ signal: controller.signal }), /BROWSER_CANCELLED/);
  assert.equal(f.metrics.launches, 0);
  assert.equal(f.status().errorCode, "BROWSER_CANCELLED");
  assert.equal(f.status().submitted, false);
  assert.equal(existsSync(path.join(f.root, "review.lock")), false);
  assert.equal(existsSync(f.response), false);
});

test("cancellation during launch closes the returned context before navigation", async t => {
  const controller = new AbortController();
  const f = scenario(t, { onLaunch: () => controller.abort() });
  await assert.rejects(f.run({ signal: controller.signal }), /BROWSER_CANCELLED/);
  assert.equal(f.metrics.launches, 1);
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.metrics.navigations, 0);
  assert.equal(f.status().errorCode, "BROWSER_CANCELLED");
  assert.equal(existsSync(path.join(f.root, "review.lock")), false);
});

test("cancelling a pending response closes its context once and preserves the previous response", async t => {
  const controller = new AbortController();
  const f = scenario(t, { incomplete: true, onWait: metrics => { if (metrics.clicks) controller.abort(); } });
  writeFileSync(f.response, "Previous completed review");
  await assert.rejects(f.run({ signal: controller.signal }), /BROWSER_CANCELLED/);
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.metrics.clicks, 1);
  assert.equal(f.status().errorCode, "BROWSER_CANCELLED");
  assert.equal(f.status().submitted, true);
  assert.equal(readFileSync(f.response, "utf8"), "Previous completed review");
  assert.equal(existsSync(path.join(f.root, "review.lock")), false);
});

test("cancelling during final browser cleanup does not commit a new response", async t => {
  const controller = new AbortController();
  const f = scenario(t, { onClose: () => controller.abort() });
  writeFileSync(f.response, "Previous completed review");
  await assert.rejects(f.run({ signal: controller.signal }), /BROWSER_CANCELLED/);
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.status().errorCode, "BROWSER_CANCELLED");
  assert.equal(readFileSync(f.response, "utf8"), "Previous completed review");
  assert.equal(existsSync(path.join(f.root, "review.lock")), false);
});

test("navigation can recover once before sending; the prompt is sent exactly once", async t => {
  const f = scenario(t, { navigationFailures: 1 });
  await f.run();
  assert.equal(f.metrics.navigations, 2);
  assert.equal(f.metrics.clicks, 1);
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.status().outcome, "completed");
  assert.equal(f.status().submitted, true);
  assert.ok(!JSON.stringify(f.status()).includes("PRIVATE_PROMPT"));
});

test("persistent navigation failures stop before sending and close the browser", async t => {
  const f = scenario(t, { navigationFailures: 10 });
  await assert.rejects(f.run(), /NAVIGATION_FAILED/);
  assert.equal(f.metrics.navigations, 2);
  assert.equal(f.metrics.clicks, 0);
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.status().submitted, false);
});

test("an access denial is not retried and never sends a prompt", async t => {
  const f = scenario(t, { httpStatus: 403 });
  await assert.rejects(f.run(), /ACCESS_DENIED/);
  assert.equal(f.metrics.navigations, 1);
  assert.equal(f.metrics.clicks, 0);
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.status().errorCode, "ACCESS_DENIED");
});

test("a Cloudflare challenge is recognized from headers before its DOM exists", async t => {
  const f = scenario(t, { httpStatus: 403, challengeHeader: true });
  await assert.rejects(f.run(), /ACCESS_CHALLENGE/);
  assert.equal(f.metrics.navigations, 1);
  assert.equal(f.metrics.clicks, 0);
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.status().errorCode, "ACCESS_CHALLENGE");
  assert.equal(f.status().submitted, false);
});

test("a redirect to a foreign composer cannot receive the review", async t => {
  const f = scenario(t, { origin: "https://example.test/" });
  await assert.rejects(f.run(), /UNEXPECTED_ORIGIN/);
  assert.equal(f.metrics.clicks, 0);
  assert.equal(f.status().submitted, false);
});

test("a click with an uncertain outcome is never repeated", async t => {
  const f = scenario(t, { clickThrows: true });
  await assert.rejects(f.run(), /SUBMISSION_UNCERTAIN/);
  assert.equal(f.metrics.clicks, 1);
  assert.equal(f.metrics.navigations, 1);
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.status().submitted, "unknown");
  assert.equal(existsSync(f.response), false);
});

test("a failed prefill closes its browser and identifies missing login", async t => {
  const f = scenario(t, { loginRequired: true });
  await assert.rejects(f.run({ mode: "prefill" }), /LOGIN_REQUIRED/);
  assert.equal(f.metrics.clicks, 0);
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.status().phase, "waiting-for-input");
});

test("an incomplete later attempt preserves a previously saved response", async t => {
  const f = scenario(t, { incomplete: true });
  writeFileSync(f.response, "Previous completed review");
  await assert.rejects(f.run(), /RESPONSE_INCOMPLETE/);
  assert.equal(readFileSync(f.response, "utf8"), "Previous completed review");
  assert.equal(f.status().outcome, "failed");
  assert.equal(f.status().submitted, true);
});

test("a successful prefill keeps the browser open without submitting", async t => {
  const f = scenario(t);
  await f.run({ mode: "prefill" });
  assert.equal(f.metrics.clicks, 0);
  assert.equal(f.metrics.closes, 0);
  assert.equal(f.status().outcome, "prefilled");
});

test("an occupied Chrome profile fails before browser launch", { skip: process.platform === "win32" }, async t => {
  const f = scenario(t);
  mkdirSync(f.profile);
  symlinkSync(`${os.hostname()}-${process.pid}`, path.join(f.profile, "SingletonLock"));
  await assert.rejects(f.run(), /BROWSER_PROFILE_BUSY/);
  assert.equal(f.metrics.launches, 0);
  assert.equal(f.status().phase, "launching");
});

test("an uploaded attachment without confirmation is not uploaded twice or submitted", async t => {
  const f = scenario(t, { uploadUnconfirmed: true });
  const attachment = path.join(f.root, "source.zip");
  writeFileSync(attachment, "attachment fixture");
  await assert.rejects(f.run({ attachmentPaths: [attachment] }), /ATTACHMENT_UNCONFIRMED/);
  assert.equal(f.metrics.uploads, 1);
  assert.equal(f.metrics.clicks, 1); // The attachment control, never the send button.
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.status().submitted, false);
  assert.equal(f.status().phase, "uploading");
  assert.equal(existsSync(f.response), false);
});


test("leaving the provider during generation does not read or save a foreign answer", async t => {
  const f = scenario(t, { responseOrigin: "https://example.test/" });
  writeFileSync(f.response, "Previous completed review");
  await assert.rejects(f.run(), /UNEXPECTED_ORIGIN/);
  assert.equal(f.metrics.clicks, 1);
  assert.equal(f.metrics.closes, 1);
  assert.equal(f.status().submitted, true);
  assert.equal(readFileSync(f.response, "utf8"), "Previous completed review");
});
