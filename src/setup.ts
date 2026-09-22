import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { checkBrowserAccess, diagnoseBrowser, openLoginBrowser } from "./browser-commands.js";
import { browserProfilePath } from "./providers/browser-runtime.js";
import { WEB_PROVIDERS, isWebProvider } from "./providers/web-config.js";
import { LOCAL_PROVIDERS, isLocalProvider } from "./providers/local-types.js";
import { probeLocalProvider } from "./providers/local-review.js";
import { atomicJson, safePath } from "./review-evidence.js";

export type SetupOptions = { repositoryPath: string; provider?: string; nonInteractive?: boolean; login?: boolean; check?: boolean; demo?: boolean; model?: string; baseUrl?: string; browserProfile?: string };
const providers = [...WEB_PROVIDERS, ...LOCAL_PROVIDERS, "manual"];
// JSON strings also keep spaces and non-ASCII paths intact in MCP config.
const quote = (s: string) => process.platform === "win32" ? JSON.stringify(s) : `'${s.replaceAll("'", "'\\''")}'`;

export async function setup(options: SetupOptions) {
  const root = path.resolve(options.repositoryPath);
  if (!existsSync(root)) throw new Error("Setup repository directory does not exist.");
  const interactive = !options.nonInteractive && Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const terminal = interactive ? createInterface({ input: process.stdin, output: process.stderr }) : undefined;
  const yes = async (question: string) => Boolean(terminal && /^(y|yes)$/i.test((await terminal.question(question + " [y/N] ")).trim()));
  try {
    let provider = options.provider;
    if (!provider && terminal) {
      console.error("Choose a reviewer. Web access is experimental; provider terms and quotas apply. Manual/local options are also available.");
      providers.forEach((p, i) => console.error(`  ${i + 1}. ${p}`));
      const choice = (await terminal.question("Provider [1]: ")).trim() || "1";
      provider = /^\d+$/.test(choice) ? providers[Number(choice) - 1] : choice;
      if (!provider) throw new Error("Invalid provider selection.");
    }
    provider ??= "chatgpt-web";
    if (!providers.includes(provider as typeof providers[number])) throw new Error(`Unsupported setup provider: ${provider}`);
    if (!isLocalProvider(provider) && (options.model || options.baseUrl)) throw new Error("Setup --model and --base-url apply only to local providers.");
    if (options.browserProfile && !isWebProvider(provider)) throw new Error("--browser-profile applies only to browser providers.");
    if (options.login && !isWebProvider(provider)) throw new Error("--login is only available for browser providers.");
    if (options.login && (options.check || options.demo)) throw new Error("Complete login and quit dedicated Chrome before running --check or --demo.");
    if (options.demo && isLocalProvider(provider) && !options.model?.trim()) throw new Error("A local demo requires --model. Discover models with setup --check first.");
    let git: string | null = null;
    try { git = execFileSync("git", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { /* Report missing prerequisite. */ }
    const profile = options.browserProfile ? path.resolve(options.browserProfile) : undefined;
    const browser = isWebProvider(provider) ? diagnoseBrowser(profile ?? browserProfilePath(provider)) : undefined;
    const prerequisitesReady = Number(process.versions.node.split(".")[0]) >= 20 && Boolean(git) && (!browser || Boolean(browser.chromeExecutable));
    if (terminal) console.error(`Node ${process.version}; Git ${git ?? "missing"}${browser ? `; Chrome ${browser.chromeExecutable ?? "missing"}` : ""}.`);
    const cli = fileURLToPath(new URL("cli.js", import.meta.url));
    const server = fileURLToPath(new URL("mcp-server.js", import.meta.url));
    const prefix = `${quote(process.execPath)} ${quote(cli)}`;
    const common = ` --repo ${quote(root)}`;
    const profileArgument = profile ? ` --browser-profile ${quote(profile)}` : "";
    const baseArgument = options.baseUrl ? ` --base-url ${quote(options.baseUrl)}` : "";
    const configDirectory = safePath(root, ".giviloop");
    mkdirSync(configDirectory, { recursive: true });
    const mcpPath = safePath(root, ".giviloop/mcp.json");
    const mcp = { mcpServers: { giviloop: { command: process.execPath, args: [server] } } };
    atomicJson(mcpPath, mcp);
    const report: Record<string, unknown> = {
      provider, prerequisitesReady, prerequisites: { node: process.version, git, ...(browser ? { chrome: browser.chromeExecutable, profileBusy: browser.profileBusy } : {}) },
      access: "not checked", mcpConfigPath: mcpPath, mcpConfig: mcp,
      instructions: "Merge this entry into your MCP client's configuration and restart that client/server. For clients using another format, use the same command and args. Setup does not edit editor settings or set a default provider for later commands. Add .giviloop/ to your repository's .gitignore.",
      nextCommands: isWebProvider(provider) ? {
        login: `${prefix} browser login --provider ${provider}${profileArgument}`,
        check: `${prefix} browser check --provider ${provider}${profileArgument}`,
        demo: `${prefix} setup${common} --provider ${provider}${profileArgument} --non-interactive --demo`,
      } : isLocalProvider(provider) ? {
        check: `${prefix} models --provider ${provider}${baseArgument}`,
        demo: `${prefix} setup${common} --provider ${provider}${baseArgument} --non-interactive --model ${options.model ? quote(options.model) : "MODEL"} --demo`,
      } : { prepare: `${prefix} prepare${common} --goal 'Find concrete bugs'`, copy: `${prefix} copy${common} --open`, ingest: `${prefix} ingest${common}` },
      limitations: "Web setup checks the composer only, not generation, a subscription model or authorization. Human verification may recur. No prompt is sent unless you explicitly choose the public demo.",
    };
    const login = options.login || (isWebProvider(provider) && prerequisitesReady && await yes("Open dedicated Chrome for login? Quit it normally after signing in; rerun setup to continue."));
    if (login && isWebProvider(provider)) {
      await openLoginBrowser(profile, provider);
      report.access = "login opened; finish sign-in, quit dedicated Chrome, then run setup --check";
    } else {
      const check = options.check || (provider !== "manual" && prerequisitesReady && await yes("Check provider access now? Web checks open Chrome but send no prompt."));
      if (check && isWebProvider(provider)) report.access = await checkBrowserAccess(profile, false, 30_000, 0, provider);
      if (check && isLocalProvider(provider)) report.access = await probeLocalProvider(provider, options.baseUrl);
      const accessFailed = typeof report.access === "object" && report.access !== null && "ready" in report.access && report.access.ready === false;
      if (accessFailed) report.demo = { submitted: false, skipped: "Access check failed. Resolve the login/verification issue before requesting a demo." };
      const demo = !accessFailed && (options.demo || (prerequisitesReady && await yes(provider === "manual" ? "Prepare the bundled public example locally?" : "Send ONLY the bundled public sum example for a review now?")));
      if (demo) {
        if (!prerequisitesReady) throw new Error("Install the missing prerequisites before running the demo.");
        if (isLocalProvider(provider) && !options.model?.trim()) throw new Error("Select --model from setup --check before running a local demo.");
        const demoRoot = safePath(root, ".giviloop/setup-demos"); mkdirSync(demoRoot, { recursive: true });
        const demoRepo = mkdtempSync(path.join(demoRoot, "example-"));
        for (const name of ["sum.ts", "verify.mjs"]) copyFileSync(fileURLToPath(new URL(`../examples/double-check/${name}`, import.meta.url)), path.join(demoRepo, name));
        const args = [cli, "ask", "--repo", demoRepo, "--file", "sum.ts", "--question", "Find a concrete bug, minimal correction and regression tests. Contract: sum([]) must return 0."];
        if (isWebProvider(provider)) args.push("--send", provider, "--mode", "auto", "--background");
        if (profile) args.push("--browser-profile", profile);
        if (isLocalProvider(provider)) {
          args.push("--send", provider, "--model", options.model!);
          if (options.baseUrl) args.push("--base-url", options.baseUrl);
        }
        // Only our bundled CLI and fixed example are executed, never model text.
        const { spawn } = await import("node:child_process");
        await new Promise<void>((resolve, reject) => {
          const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
          child.stdout.pipe(process.stderr); child.stderr.pipe(process.stderr);
          child.once("error", reject);
          child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Public demo failed (exit ${code}); inspect ${demoRepo}.`)));
        });
        report.demo = { repositoryPath: demoRepo, submitted: provider !== "manual", verifyCommand: `${quote(process.execPath)} ${quote(path.join(demoRepo, "verify.mjs"))}`, nextStep: "Read the saved review and independently check its claims. No fixes were applied." };
      }
    }
    const reportPath = safePath(root, ".giviloop/setup.json");
    atomicJson(reportPath, report);
    return report;
  } finally { terminal?.close(); }
}
