import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPreferences } from "./preferences.js";
import { atomicJson, readFindings, recordFinding, safePath } from "./review-evidence.js";
import { exportReviewReport } from "./review-report.js";
import { runStatus } from "./run-status.js";
import { isWebProvider } from "./providers/web-config.js";
import { isLocalProvider } from "./providers/local-types.js";
import { RUN_ID_PATTERN } from "./run-storage.js";

type Options = { repositoryPath: string; provider?: string; offline?: boolean; finish?: boolean; model?: string; baseUrl?: string; browserProfile?: string; foreground?: boolean };
const bundled = (name: string) => fileURLToPath(new URL(`../examples/double-check/${name}`, import.meta.url));
const quote = (s: string) => process.platform === "win32" ? JSON.stringify(s) : `'${s.replaceAll("'", "'\\''")}'`;

async function invoke(args: string[]): Promise<number | null> {
  const child = spawn(process.execPath, [fileURLToPath(new URL("cli.js", import.meta.url)), ...args], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(process.stderr); child.stderr.pipe(process.stderr);
  let kill: NodeJS.Timeout | undefined;
  let stopped = false;
  const stop = () => { if (stopped) return; stopped = true; child.kill("SIGTERM"); kill = setTimeout(() => child.kill("SIGKILL"), 12000); };
  const timer = setTimeout(stop, 240000);
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try { return await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); }); }
  finally { clearTimeout(timer); clearTimeout(kill); process.off("SIGINT", stop); process.off("SIGTERM", stop); }
}

export async function runDemo(options: Options) {
  const root = realpathSync(options.repositoryPath);
  const pointer = safePath(root, ".giviloop/latest-demo.json");
  let demoRepo: string;
  let mode: "offline" | "live";
  if (options.finish) {
    if (options.offline || options.provider || options.model || options.baseUrl || options.browserProfile || options.foreground) throw new Error("--finish only inspects the latest demo; do not supply delivery options.");
    if (!existsSync(pointer)) throw new Error("No demo to finish. Run givi demo or givi demo --offline first.");
    const saved = JSON.parse(readFileSync(pointer, "utf8"));
    if (typeof saved.directory !== "string" || !/^\.giviloop\/demos\/example-[A-Za-z0-9]+$/.test(saved.directory) || !["offline", "live"].includes(saved.mode)) throw new Error("Invalid demo pointer.");
    demoRepo = safePath(root, saved.directory); mode = saved.mode;
  } else {
    const preferences = options.offline ? undefined : readPreferences(root);
    const provider = options.provider ?? preferences?.provider ?? "chatgpt-web";
    const matching = preferences?.provider === provider ? preferences : undefined;
    const model = options.model ?? matching?.model;
    const baseUrl = options.baseUrl ?? matching?.baseUrl;
    const profile = options.browserProfile ?? matching?.browserProfile;
    if (options.offline && (options.provider || options.model || options.baseUrl || options.browserProfile || options.foreground)) throw new Error("--offline takes no provider or browser options; nothing is sent.");
    if (!options.offline) {
      if (!isWebProvider(provider) && !isLocalProvider(provider)) throw new Error("Choose a web/local --provider, or use demo --offline for the authored illustration.");
      if (isLocalProvider(provider) && !model) throw new Error("Local demo needs a saved model or --model. Discover one with givi models --provider NAME.");
      if (baseUrl && !isLocalProvider(provider) || profile && !isWebProvider(provider) || model && !isLocalProvider(provider) && provider !== "chatgpt-web") throw new Error("Demo model/profile/endpoint options do not match the provider.");
    }
    const directory = safePath(root, ".giviloop/demos"); mkdirSync(directory, { recursive: true });
    demoRepo = mkdtempSync(path.join(directory, "example-"));
    mode = options.offline ? "offline" : "live";
    for (const name of ["sum.ts", "verify.mjs"]) copyFileSync(bundled(name), path.join(demoRepo, name));
    atomicJson(pointer, { directory: path.relative(root, demoRepo).split(path.sep).join("/"), mode });
    console.error(`GiviLoop demo: ${mode === "offline" ? "offline authored illustration; no provider contacted" : "sending only the bundled public example to " + provider}.`);
    const args = ["ask", "--repo", demoRepo, "--file", "sum.ts", "--question", "Find a concrete bug, the minimal correction and regression tests. Contract: sum([]) must return 0. Keep the answer concise."];
    if (!options.offline) {
      args.push("--send", provider);
      if (model) args.push("--model", model);
      if (baseUrl) args.push("--base-url", baseUrl);
      if (profile) args.push("--browser-profile", path.resolve(profile));
      if (isWebProvider(provider)) args.push(options.foreground || matching?.background === false ? "--foreground" : "--background");
    }
    const code = await invoke(args);
    if (code !== 0) return paused(root, demoRepo);
  }
  // Only the fixed, bundled verifier is executed. Never run a copied/edited
  // verifier from the demo directory or any code returned by a model.
  for (const name of ["sum.ts", "verify.mjs"]) {
    if (!readFileSync(safePath(demoRepo, name)).equals(readFileSync(bundled(name)))) throw new Error("Demo source/verifier changed. Start a new demo; modified examples are not executed or certified.");
  }
  const id = readFileSync(safePath(demoRepo, ".giviloop/latest-run-id"), "utf8").trim();
  if (!RUN_ID_PATTERN.test(id)) throw new Error("Invalid demo run id.");
  const runFile = (name: string) => safePath(demoRepo, `.giviloop/runs/${id}/${name}`);
  if (mode === "offline" && !options.finish) {
    writeFileSync(runFile("external-review-response.md"), "# Offline illustrative review\n\nAuthored by GiviLoop; no provider contacted.\n\nThe bundled example calls reduce without an initial value. sum([]) throws instead of returning 0. Candidate correction: supply 0 as the initial accumulator. Independently verify with the bundled reproduction.\n", { mode: 0o600 });
  }
  if (!existsSync(runFile("external-review-response.md"))) return paused(root, demoRepo);
  if (mode === "live" && runStatus(demoRepo, id).state !== "completed") return paused(root, demoRepo);
  console.error("GiviLoop demo: independently reproducing the known example and testing the candidate correction.");
  const verification = execFileSync(process.execPath, [bundled("verify.mjs")], { encoding: "utf8", timeout: 10000, maxBuffer: 100000, stdio: ["ignore", "pipe", "pipe"] }).trim();
  for (const name of ["sum.ts", "verify.mjs"]) if (!readFileSync(safePath(demoRepo, name)).equals(readFileSync(bundled(name)))) throw new Error("Demo files changed during verification.");
  // Idempotent finish: retain the original assessment instead of adding copies.
  const previous = existsSync(runFile("demonstration.json")) ? JSON.parse(readFileSync(runFile("demonstration.json"), "utf8")) : undefined;
  let findingId = previous?.findingId;
  const findings = readFindings(demoRepo, id);
  if (!findingId || !findings.findings.some(f => f.id === findingId)) {
    findingId = recordFinding({ repositoryPath: demoRepo, runId: id, title: "Bundled control: empty sum violates its contract", claim: "The authored sum example throws TypeError for [] although its contract requires 0.", status: "confirmed", reason: "The bundled deterministic reproduction passed. This verifies the known example, not the accuracy of every claim in the provider response.", evidence: [verification], files: ["sum.ts", "verify.mjs"] }).findingId;
  }
  atomicJson(runFile("demonstration.json"), { mode, findingId, provenance: "Bundled authored example and verifier; no model output executed." });
  const report = exportReviewReport(demoRepo, id);
  return { state: "completed", mode, repositoryPath: demoRepo, runId: id, submitted: mode === "live", responsePath: runFile("external-review-response.md"), reportPath: report.reportPath, verification, nextStep: "Read the review and compare it with the reproduction. Try givi review on your own changes, ask your agent to verify and record findings, then givi report. No project source was changed." };
}

function paused(root: string, repository: string) {
  const status = runStatus(repository);
  return { state: status.state, repositoryPath: repository, runId: status.runId, submitted: status.submitted, nextStep: status.nextStep,
    commands: { status: `givi status --repo ${quote(repository)}`, ...(status.resumable ? { open: `givi open --repo ${quote(repository)}`, resume: `givi resume --repo ${quote(repository)}` } : {}), finish: `givi demo --repo ${quote(root)} --finish` } };
}
