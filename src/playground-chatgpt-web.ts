#!/usr/bin/env node

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2).map(arg => arg.replace(/^--repositoryPath(?==|$)/, "--repo"));
if (!args.some(arg => arg === "--mode" || arg.startsWith("--mode="))) args.push("--mode", "prefill");
const child = spawn(process.execPath, [
  fileURLToPath(new URL("./cli.js", import.meta.url)), "send", ...args,
], { stdio: "inherit" });
child.once("error", error => { console.error(error.message); process.exitCode = 1; });
child.once("exit", code => { process.exitCode = code ?? 1; });
