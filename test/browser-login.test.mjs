import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { cliPath, fixture } from "./helpers.mjs";

function login(f, executable, profile, provider) {
  return spawnSync(process.execPath, [cliPath, "browser", "login", "--browser-profile", profile, ...(provider ? ["--provider", provider] : [])], {
    encoding: "utf8", timeout: 5000, cwd: f.repo, env: { ...f.env, GIVILOOP_CHROME_PATH: executable },
  });
}

test("login reports an immediately failing browser instead of claiming it opened", { skip: process.platform === "win32" }, t => {
  const f = fixture(t), executable = path.join(f.root, "chrome-failure");
  writeFileSync(executable, "#!/bin/sh\nexit 7\n");
  chmodSync(executable, 0o700);
  const result = login(f, executable, path.join(f.root, "profile"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /launcher exited/);
  assert.doesNotMatch(result.stdout, /Opened regular Chrome/);
});

for (const [provider,url] of [["chatgpt-web","https://chatgpt.com/"],["deepseek-web","https://chat.deepseek.com/"],["claude-web","https://claude.ai/new"],["gemini-web","https://gemini.google.com/app"]]) test(`${provider}: native login requests the correct site and survives the CLI`, { skip: process.platform === "win32" }, t => {
  const f = fixture(t), executable = path.join(f.root, "chrome-stub"), capture = path.join(f.root, "launch.json");
  writeFileSync(executable, `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({pid:process.pid,args:process.argv.slice(2)}));setTimeout(()=>{},15000);\n`);
  chmodSync(executable, 0o700);
  t.after(() => { if (existsSync(capture)) { try { process.kill(JSON.parse(readFileSync(capture, "utf8")).pid, "SIGTERM"); } catch {} } });
  const profile = path.join(f.root, "dedicated profile");
  const result = login(f, executable, profile, provider);
  assert.equal(result.status, 0, result.stderr);
  const launched = JSON.parse(readFileSync(capture, "utf8"));
  assert.doesNotThrow(() => process.kill(launched.pid, 0));
  assert.ok(launched.args.includes(url));
  assert.ok(launched.args.includes("--new-window"));
  assert.ok(launched.args.includes("--start-maximized"));
  assert.ok(launched.args.includes(`--user-data-dir=${profile}`));
  assert.equal(launched.args.some(arg => arg.includes("remote-debugging") || arg.includes("automation")), false);
});
