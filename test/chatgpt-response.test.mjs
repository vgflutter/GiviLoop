import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.env.GIVILOOP_TEST_DIST_DIR ?? path.join(repoRoot, "dist");
const { chromium } = createRequire(path.join(distDir, "cli.js"))("playwright");
const { sendToChatGptWeb } = await import(
  pathToFileURL(path.join(distDir, "providers/chatgpt-web.js")).href
);

for (const [renderer, generating] of [
  ["legacy", true], ["legacy", false], ["current", true], ["current", false],
]) {
  test(
    `${renderer} renderer: ` + (generating
      ? "auto mode rejects a timed-out partial response and closes the browser"
      : "auto mode saves a stable completed response and closes the browser"),
    async (t) => {
      const repo = mkdtempSync(path.join(os.tmpdir(), "giviloop-response-"));
      t.after(() => rmSync(repo, { recursive: true, force: true }));
      const previousAllowedRoots = process.env.GIVILOOP_ALLOWED_REPOSITORIES;
      process.env.GIVILOOP_ALLOWED_REPOSITORIES = repo;
      t.after(() => {
        if (previousAllowedRoots === undefined) {
          delete process.env.GIVILOOP_ALLOWED_REPOSITORIES;
        } else {
          process.env.GIVILOOP_ALLOWED_REPOSITORIES = previousAllowedRoots;
        }
      });
      const requestPath = path.join(repo, "request.md");
      const responsePath = path.join(repo, "response.md");
      writeFileSync(requestPath, "Review this change.");
      let now = 0;
      let submitted = false;
      let closed = false;
      t.mock.method(Date, "now", () => now);
      const page = {
        goto: async () => {},
        url: () => "https://chatgpt.com/",
        isClosed: () => false,
        waitForLoadState: async () => {},
        waitForTimeout: async (milliseconds) => { now += milliseconds; },
        keyboard: { press: async () => {}, insertText: async () => {} },
        locator(selector) {
          const locator = {
            first: () => locator,
            nth: () => locator,
            locator: childSelector => page.locator(childSelector),
            waitFor: async () => {},
            fill: async () => {},
            isVisible: async () => selector.includes("stop-button") && renderer === "legacy" && generating,
            isEditable: async () => selector.includes("prompt-textarea"),
            isEnabled: async () => selector.includes("composer-submit-button"),
            allTextContents: async () => [],
            evaluate: async () => false,
            click: async () => {
              if (selector.includes("composer-submit-button")) submitted = true;
            },
            count: async () => {
              if (selector.includes("data-message-role")) return renderer === "current" && submitted ? 1 : 0;
              // Both containers can occur in a nested layout; they must not be
              // counted twice. The current renderer uses its completion marker.
              if (selector.includes("data-message-author-role")) return submitted ? 1 : 0;
              if (selector.includes("data-assistant-markdown")) return renderer === "current" ? 1 : 0;
              if (selector.includes("stop-button")) return renderer === "legacy" && generating ? 1 : 0;
              return selector.includes("prompt-textarea") ? 1 : 0;
            },
            getAttribute: async name => {
              if (name === "data-message-role" && renderer === "current") return "assistant";
              if (name === "data-message-complete" && renderer === "current" && !generating) return "";
              return null;
            },
            innerText: async () => selector.includes('role="alert"') ? "" : renderer === "current" && !selector.includes("data-assistant-markdown")
              ? "ChatGPT ha detto: Review text. Copia risposta."
              : "Review text",
          };
          return locator;
        },
      };
      t.mock.method(chromium, "launchPersistentContext", async () => ({
        newPage: async () => page,
        pages: () => [],
        setDefaultTimeout: () => {},
        close: async () => { closed = true; },
      }));
      const review = sendToChatGptWeb({
        repositoryPath: repo, requestPath, responsePath,
        userDataDir: path.join(repo, "profile"),
        mode: "auto", headless: true,
        responseStableMs: 500, maxWaitMs: 3000,
      });
      if (generating) {
        await assert.rejects(review, /Timed out.*incomplete/);
        assert.equal(existsSync(responsePath), false);
      } else {
        assert.equal((await review).responseText, "Review text");
        assert.equal(readFileSync(responsePath, "utf8"), "Review text");
      }
      assert.equal(submitted, true);
      assert.equal(closed, true);
    },
  );
}
