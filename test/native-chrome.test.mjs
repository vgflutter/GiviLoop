import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { distDir, fixture } from "./helpers.mjs";
const { nativeChrome } = await import(pathToFileURL(path.join(distDir, "providers/native-chrome.js")));

for (const [name, stderr, code] of [
  ["startup failure", "Browser could not start: PRIVATE_DIAGNOSTIC", "BROWSER_LAUNCH_FAILED"],
  ["competing profile owner", "ProcessSingleton: profile in use PRIVATE_DIAGNOSTIC", "BROWSER_PROFILE_BUSY"],
  ["non-loopback debugging endpoint", "DevTools listening on ws://example.com:9999/devtools/browser/untrusted", "BROWSER_LAUNCH_FAILED"],
]) test(`native Chrome rejects ${name} without exposing logs or leaving signal handlers`, { skip: process.platform === "win32" }, async t => {
  const f = fixture(t), executable = path.join(f.root, "chrome-stub");
  writeFileSync(executable, `#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(stderr + "\n")});process.exitCode=7;\n`);
  chmodSync(executable, 0o700);
  const previous = process.env.GIVILOOP_CHROME_PATH;
  process.env.GIVILOOP_CHROME_PATH = executable;
  t.after(() => previous === undefined ? delete process.env.GIVILOOP_CHROME_PATH : process.env.GIVILOOP_CHROME_PATH = previous);
  const interruptListeners = process.listenerCount("SIGINT"), terminateListeners = process.listenerCount("SIGTERM");
  await assert.rejects(nativeChrome.launch(path.join(f.root, "profile"), false), error => {
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /PRIVATE_DIAGNOSTIC|ws:\/\//);
    return true;
  });
  assert.equal(process.listenerCount("SIGINT"), interruptListeners);
  assert.equal(process.listenerCount("SIGTERM"), terminateListeners);
});
