import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { distDir } from "./helpers.mjs";
const { navigateToChat, verificationTimeout } = await import(pathToFileURL(path.join(distDir, "providers/browser-runtime.js")));

function fixture(t, { nextStatus = 200, nextChallenge = false, nextOrigin = "https://chatgpt.com", neverResolve = false, close = false, domOnly = false, loop = false } = {}) {
  const page = new EventEmitter(), frame = {}, metrics = { navigations: 0, waits: 0, notifications: 0 };
  let now = 0, closed = false, currentUrl = "https://chatgpt.com/";
  t.mock.method(Date, "now", () => now);
  const response = (status, challenge) => ({ status: () => status, headers: () => challenge ? { "cf-mitigated": "challenge" } : {},
    frame: () => frame, request: () => ({ isNavigationRequest: () => true }) });
  Object.assign(page, {
    mainFrame: () => frame, isClosed: () => closed, url: () => currentUrl,
    goto: async () => { metrics.navigations++; const result = response(domOnly ? 200 : 403, !domOnly); page.emit("response", result); return result; },
    waitForTimeout: async ms => {
      now += ms; metrics.waits++;
      if (close) closed = true;
      if (loop) page.emit("response", response(403, true));
      if (!neverResolve && metrics.waits === 2) { currentUrl = nextOrigin + "/"; page.emit("response", response(nextStatus, nextChallenge)); }
    },
    locator(selector) { const locator = { first: () => locator, isVisible: async () => domOnly && selector.includes("#challenge") && metrics.waits < 2, innerText: async () => "", isEditable: async () => true }; return locator; },
  });
  return { page, metrics, run: () => navigateToChat(page, "https://chatgpt.com/", 5000, 2000, async () => { metrics.notifications++; }) };
}

test("human verification resumes the same navigation only after a successful document", async t => {
  const f = fixture(t);
  await f.run();
  assert.deepEqual(f.metrics, { navigations: 1, waits: 2, notifications: 1 });
  assert.equal(f.page.listenerCount("response"), 0);
});

test("a challenge detected only in the DOM waits and resumes when cleared", async t => {
  const f = fixture(t, { domOnly: true });
  await f.run();
  assert.deepEqual(f.metrics, { navigations: 1, waits: 2, notifications: 1 });
  assert.equal(f.page.listenerCount("response"), 0);
});

for (const [label, options, code] of [
  ["unresolved challenge", { neverResolve: true }, "ACCESS_CHALLENGE"],
  ["a denied document containing a composer", { nextStatus: 403 }, "ACCESS_DENIED"],
  ["a rate limit after verification", { nextStatus: 429 }, "PROVIDER_LIMIT"],
  ["a foreign origin containing a composer", { nextOrigin: "https://example.test" }, "UNEXPECTED_ORIGIN"],
  ["a second challenge document", { nextStatus: 200, nextChallenge: true }, "ACCESS_CHALLENGE"],
  ["repeated challenge documents", { loop: true, neverResolve: true }, "ACCESS_CHALLENGE_LOOP"],
  ["a closed browser", { close: true }, "BROWSER_CLOSED"],
]) {
  test(`${label} never resumes or repeats navigation`, async t => {
    const f = fixture(t, options);
    await assert.rejects(f.run(), error => error.code === code);
    assert.equal(f.metrics.navigations, 1);
    assert.equal(f.metrics.notifications, 1);
    assert.equal(f.page.listenerCount("response"), 0);
  });
}

test("verification defaults are interactive only for headed browsers and bounded", () => {
  assert.equal(verificationTimeout(undefined, false), 180000);
  assert.equal(verificationTimeout(undefined, true), 0);
  assert.equal(verificationTimeout(0, false), 0);
  for (const value of [-1, 1.5, NaN, Infinity, 900001]) assert.throws(() => verificationTimeout(value, false));
  assert.throws(() => verificationTimeout(1, true), /visible browser/);
});
