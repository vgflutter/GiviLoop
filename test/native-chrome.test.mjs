import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

test("closing Chrome releases inherited stderr even while a helper stays alive", { skip: process.platform === "win32" }, async t => {
  const f = fixture(t), executable = path.join(f.root, "chrome-with-helper");
  const ownerFile = path.join(f.root, "owner.pid"), helperFile = path.join(f.root, "helper.pid");
  let helperPid;
  t.after(() => {
    if (helperPid) {
      try { process.kill(helperPid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  });
  writeFileSync(executable, `#!${process.execPath}\n
    const { spawn } = require('node:child_process');
    const { writeFileSync } = require('node:fs');
    const helper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { stdio: ['ignore', 'ignore', 2] });
    writeFileSync(${JSON.stringify(helperFile)}, String(helper.pid)); helper.unref();
    writeFileSync(${JSON.stringify(ownerFile)}, String(process.pid));
    const port = process.argv.find(arg => arg.startsWith('--remote-debugging-port=')).split('=')[1];
    process.stderr.write('DevTools listening on ws://127.0.0.1:' + port + '/devtools/browser/test-browser\\n');
    setInterval(() => {}, 1000);
  `);
  chmodSync(executable, 0o700);
  const runner = path.join(f.root, "runner.mjs");
  writeFileSync(runner, `
    import { createRequire } from 'node:module';
    import { readFileSync } from 'node:fs';
    const { chromium } = createRequire(${JSON.stringify(path.join(distDir, "cli.js"))})('playwright');
    chromium.connectOverCDP = async () => ({
      contexts: () => [{}], isConnected: () => true, close: async () => {},
      newBrowserCDPSession: async () => ({ send: async () => process.kill(Number(readFileSync(${JSON.stringify(ownerFile)}, 'utf8')), 'SIGTERM') }),
    });
    const { nativeChrome } = await import(${JSON.stringify(pathToFileURL(path.join(distDir, "providers/native-chrome.js")).href)});
    const context = await nativeChrome.launch(${JSON.stringify(path.join(f.root, "profile"))}, false);
    await context.close();
    console.log('closed');
  `);
  const result = spawnSync(process.execPath, [runner], { env: { ...process.env, GIVILOOP_CHROME_PATH: executable }, encoding: "utf8", timeout: 4000 });
  if (existsSync(helperFile)) helperPid = Number(readFileSync(helperFile, "utf8"));
  assert.match(result.stdout, /closed/);
  assert.equal(result.error, undefined, "a completed launch/close must allow the caller to exit without waiting for helper EOF");
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotThrow(() => process.kill(helperPid, 0), "cleanup must not kill a helper process it does not own");
});

test("unsupported extension loading closes owned Chrome without creating a visible fallback", { skip: process.platform === "win32" }, t => {
  const f = fixture(t), executable = path.join(f.root, "chrome-windowless-stub");
  const ownerFile = path.join(f.root, "owner.pid");
  writeFileSync(executable, `#!${process.execPath}\n
    const { writeFileSync } = require('node:fs');
    writeFileSync(${JSON.stringify(ownerFile)}, String(process.pid));
    const port = process.argv.find(arg => arg.startsWith('--remote-debugging-port=')).split('=')[1];
    process.stderr.write('DevTools listening on ws://127.0.0.1:' + port + '/devtools/browser/test-browser\\n');
    setInterval(() => {}, 1000);
  `);
  chmodSync(executable, 0o700);
  const runner = path.join(f.root, "unsupported.mjs");
  writeFileSync(runner, `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { readFileSync } from 'node:fs';
    const { chromium } = createRequire(${JSON.stringify(path.join(distDir, "cli.js"))})('playwright');
    const commands = [];
    const session = { detach: async () => {}, send: async method => {
      commands.push(method);
      if (method === 'Extensions.loadUnpacked') throw new Error('PRIVATE_EXTENSION_ERROR');
      if (method === 'Browser.close') process.kill(Number(readFileSync(${JSON.stringify(ownerFile)}, 'utf8')), 'SIGTERM');
    } };
    chromium.connectOverCDP = async () => ({
      contexts: () => [{}], isConnected: () => true, close: async () => {},
      newBrowserCDPSession: async () => session,
    });
    const { nativeChrome } = await import(${JSON.stringify(pathToFileURL(path.join(distDir, "providers/native-chrome.js")).href)});
    await assert.rejects(nativeChrome.launch(${JSON.stringify(path.join(f.root, "profile"))}, true), error => {
      assert.equal(error.code, 'WINDOWLESS_UNAVAILABLE');
      assert.doesNotMatch(error.message, /PRIVATE_EXTENSION_ERROR/);
      return true;
    });
    assert.deepEqual(commands, ['Extensions.loadUnpacked', 'Browser.close']);
    assert.equal(process.listenerCount('SIGINT'), 0);
    assert.equal(process.listenerCount('SIGTERM'), 0);
    console.log('closed without a fallback');
  `);
  const result = spawnSync(process.execPath, [runner], { env: { ...process.env, GIVILOOP_CHROME_PATH: executable }, encoding: "utf8", timeout: 5000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /closed without a fallback/);
});
