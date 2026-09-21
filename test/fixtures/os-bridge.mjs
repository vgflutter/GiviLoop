// Test-only preload: use files for clipboard calls and record browser launches.
// No real account, browser, clipboard or external provider is touched.
import cp from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(process.env.GIVILOOP_TEST_DIST_DIR
  ? path.join(process.env.GIVILOOP_TEST_DIST_DIR, "cli.js")
  : import.meta.url);
const { chromium } = require("playwright");

const clipboard = process.env.GIVILOOP_TEST_CLIPBOARD;
const calls = process.env.GIVILOOP_TEST_OS_CALLS;
if (!clipboard || !calls) throw new Error("Missing isolated OS test fixture.");
chromium.launchPersistentContext = async () => {
  throw new Error("Unexpected browser launch in an isolated integration test.");
};
const nativeModule = process.env.GIVILOOP_TEST_DIST_DIR
  ? pathToFileURL(path.join(process.env.GIVILOOP_TEST_DIST_DIR, "providers/native-chrome.js"))
  : new URL("../../dist/providers/native-chrome.js", import.meta.url);
const { nativeChrome } = await import(nativeModule);
nativeChrome.launch = async () => {
  throw new Error("Unexpected native browser launch in an isolated integration test.");
};
const exec = cp.execFileSync;
cp.execFileSync = (command, args, options) => {
  const argv = Array.isArray(args) ? args : [];
  const settings = Array.isArray(args) ? options : args;
  const write = ["pbcopy", "wl-copy"].includes(command) || (command === "xclip" && !argv.includes("-o")) || argv.includes("Set-Clipboard");
  const read = ["pbpaste", "wl-paste"].includes(command) || (command === "xclip" && argv.includes("-o")) || argv.includes("Get-Clipboard -Raw");
  const open = ["open", "xdg-open", "rundll32.exe"].includes(command);
  if (write || read || open) {
    appendFileSync(calls, JSON.stringify({ command, args: argv, action: write ? "write" : read ? "read" : "open" }) + "\n");
    if (write) writeFileSync(clipboard, settings.input);
    if (read) return readFileSync(clipboard, "utf8");
    if (open && process.env.GIVILOOP_TEST_OPEN_FAIL === "1") throw new Error("Browser unavailable");
    return Buffer.alloc(0);
  }
  // Linux clipboard discovery is simulated even on headless CI hosts.
  if (command === "which" && ["wl-copy", "wl-paste"].includes(argv[0])) return Buffer.from(`/test/${argv[0]}\n`);
  return exec(command, args, options);
};
syncBuiltinESMExports();
