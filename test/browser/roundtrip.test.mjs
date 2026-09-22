import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cliPath, distDir, fixture, repoRoot } from "../helpers.mjs";

const preload = fileURLToPath(new URL("../fixtures/browser-site.mjs", import.meta.url));
const answer = "Review verificata: più contesto è utile.\nSeconda riga.";

for (const headless of [true, false]) test(`${headless ? "headless" : "native headed"} browser preserves native cookies and closes cleanly`, { timeout: 30_000 }, async t => {
  const f = fixture(t), profile = path.join(f.root, "native-store-profile");
  const { chromium } = createRequire(path.join(distDir, "cli.js"))("playwright");
  const { launchChatBrowser } = await import(pathToFileURL(path.join(distDir, "providers/browser-runtime.js")));
  // Seed an isolated profile using the credential store of a normal Chrome launch.
  const native = await chromium.launchPersistentContext(profile, {
    channel: "chrome", headless: true, executablePath: process.env.GIVILOOP_CHROME_PATH,
    chromiumSandbox: true,
    ignoreDefaultArgs: ["--use-mock-keychain", "--password-store=basic"],
  });
  try {
    await native.addCookies([{ name: "giviloop-test-session", value: "synthetic-session",
      domain: "example.test", path: "/", secure: true, httpOnly: true, expires: Math.floor(Date.now() / 1000) + 3600 }]);
  } finally { await native.close(); }
  const automated = await launchChatBrowser(profile, headless);
  try {
    const page = automated.pages()[0] ?? await automated.newPage();
    const session = await automated.newCDPSession(page);
    try {
      let commandLine;
      try {
        commandLine = (await session.send("Browser.getBrowserCommandLine")).arguments.join(" ");
      } catch (error) {
        // Chrome gates this CDP method behind --enable-automation, which the
        // production launcher omits. Its internal version page exposes the same
        // real process arguments without changing how the browser is launched.
        assert.match(error.message, /--enable-automation not set/);
        await page.goto("chrome://version/");
        commandLine = await page.locator("#command_line").innerText();
      }
      assert.match(commandLine, /--user-data-dir/);
      assert.doesNotMatch(commandLine, /(?:^|\s)--no-sandbox(?:\s|$)/, "Chrome must retain its native sandbox");
      if (!headless) {
        assert.match(commandLine, /--remote-debugging-address=127\.0\.0\.1/);
        assert.match(commandLine, /--remote-debugging-port=[1-9]\d*/);
        assert.doesNotMatch(commandLine, /--remote-debugging-pipe|--use-mock-keychain|--password-store=basic/);
      }
    } finally { await session.detach(); }
    const cookies = await automated.cookies("https://example.test/");
    assert.equal(cookies.find(cookie => cookie.name === "giviloop-test-session")?.value, "synthetic-session");
  } finally { await automated.close(); }
  const preferences = JSON.parse(readFileSync(path.join(profile, "Default", "Preferences"), "utf8"));
  assert.equal(preferences.profile?.exit_type, "Normal", "cooperative browser close must flush a clean shutdown to its fresh profile");
  const { diagnoseBrowser } = await import(pathToFileURL(path.join(distDir, "browser-commands.js")));
  const report = diagnoseBrowser(profile);
  assert.equal(report.previousExit, "Normal");
  assert.equal(report.previousExitNote, "Chrome recorded a clean shutdown.");
  assert.match(report.nextStep, /browser check/);
});

test("a new Chrome window acknowledges an old crash marker and preserves the login store", { timeout: 30_000 }, async t => {
  const f = fixture(t), profile = path.join(f.root, "old-crash-profile");
  const { launchChatBrowser } = await import(pathToFileURL(path.join(distDir, "providers/browser-runtime.js")));
  const { diagnoseBrowser } = await import(pathToFileURL(path.join(distDir, "browser-commands.js")));
  const seed = await launchChatBrowser(profile, false);
  try {
    await seed.addCookies([{ name: "giviloop-test-session", value: "synthetic-session",
      domain: "example.test", path: "/", secure: true, httpOnly: true, expires: Math.floor(Date.now() / 1000) + 3600 }]);
  } finally { await seed.close(); }
  // Reproduce a pending restore only in this isolated synthetic profile.
  const preferencesPath = path.join(profile, "Default", "Preferences");
  const preferences = JSON.parse(readFileSync(preferencesPath, "utf8"));
  preferences.profile.exit_type = "Crashed";
  writeFileSync(preferencesPath, JSON.stringify(preferences));
  assert.equal(diagnoseBrowser(profile).previousExit, "Crashed");
  const recovery = await launchChatBrowser(profile, false);
  try {
    const session = await recovery.browser().newBrowserCDPSession();
    try { await session.send("Target.createTarget", { url: "about:blank", newWindow: true }); }
    finally { await session.detach(); }
  } finally { await recovery.close(); }
  assert.equal(diagnoseBrowser(profile).previousExit, "Normal", "Chrome itself must persist the acknowledged clean shutdown");
  const next = await launchChatBrowser(profile, false, true);
  try {
    const cookies = await next.cookies("https://example.test/");
    assert.equal(cookies.find(cookie => cookie.name === "giviloop-test-session")?.value, "synthetic-session");
  } finally { await next.close(); }
  assert.equal(diagnoseBrowser(profile).previousExit, "Normal", "the next background session must also close cleanly");
});

function pageFixture({ archive = false, incomplete = false, legacy = false, model = false, missingModel = false, confirmModel = true, anonymous = false, loginRequired = false, mediaInputs = false, mediaOnly = false, delayedUpload = false } = {}) {
  return `<!doctype html><html><head><style>#conversation li div { white-space: pre-wrap; }</style></head><body>
  <textarea style="display:none"></textarea>
  <textarea id="input" ${loginRequired ? "hidden" : ""}></textarea>
  ${anonymous || loginRequired ? '<button>Log in</button>' : ''}
  <button data-testid="composer-plus-btn" ${mediaInputs ? "hidden" : ""}
    ${delayedUpload ? 'aria-haspopup="menu" aria-expanded="false" onclick="if(window.uploaderReady)this.setAttribute(\'aria-expanded\',\'true\')"' : 'onclick="document.querySelector(\'input[type=file]\').click()"'}>Attach</button>
  <input type="file" multiple ${mediaOnly ? "disabled" : ""} hidden><div id="uploads"></div>
  ${mediaInputs ? '<input type="file" multiple accept="image/*" disabled hidden><input type="file" multiple accept="image/*,video/*" hidden onchange="window.captureSubmission({actionDetail:\'wrong-media-input\'})">' : ''}
  <button data-testid="composer-submit-button" ${archive ? "disabled" : ""}>Send</button>
  <button data-testid="stop-button" hidden>Stop</button>
  ${model ? `<button data-testid="model-switcher-dropdown-button" onclick="document.querySelector('[role=menu]').hidden=false">GPT Base</button>
  <button>GPT Pro</button>
  <div role="menu" hidden><button role="menuitem">GPT Pro Max</button>${missingModel ? "" : '<button role="menuitem">GPT Pro</button>'}</div>` : ""}
  <ol id="conversation"><li data-message-role="user">Wrong user message</li></ol>
  <script>
  let uploadsReady=${!archive};
  document.querySelectorAll('[role=menuitem]').forEach(option=>option.onclick=()=>{
    ${confirmModel ? "document.querySelector('[data-testid=model-switcher-dropdown-button]').textContent=option.textContent;" : ""}
    document.querySelector('[role=menu]').hidden=true;
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape' && document.querySelector('[role=menu]')) document.querySelector('[role=menu]').hidden=true;});
  const acceptUpload=e=>{
    document.querySelector('#uploads').textContent=[...e.target.files].map(file=>file.name).join(' ');
    setTimeout(()=>{uploadsReady=true;document.querySelector('[data-testid=composer-submit-button]').disabled=false;},400);
  };
  if (${delayedUpload}) {
    document.querySelector('input[type=file]').onchange=()=>window.captureSubmission({actionDetail:'premature-upload'});
    setTimeout(()=>{window.uploaderReady=true;document.querySelector('input[type=file]').onchange=acceptUpload;},1500);
  } else document.querySelector('input[type=file]').onchange=acceptUpload;
  document.querySelector('[data-testid=composer-submit-button]').onclick=()=>{
    window.captureSubmission({prompt:document.querySelector('#input').value,uploadsReady,files:[...document.querySelector('input[type=file]').files].map(file=>file.name),model:document.querySelector('[data-testid=model-switcher-dropdown-button]')?.textContent,menuOpen:document.querySelector('[role=menu]')?.hidden===false});
    const item=document.createElement('li');
    item.setAttribute(${JSON.stringify(legacy ? "data-message-author-role" : "data-message-role")},'assistant');
    item.innerHTML=${JSON.stringify(legacy ? "<div>" + answer + "</div>" : "<h4>ChatGPT ha detto:</h4><div data-assistant-markdown></div><button>Copia risposta</button>")};
    ${legacy ? "" : `item.querySelector('[data-assistant-markdown]').textContent=${JSON.stringify(answer)};`}
    document.querySelector('#conversation').append(item);
    ${incomplete ? "" : "setTimeout(()=>item.setAttribute('data-message-complete',''),600);"}
  };
  </script></body></html>`;
}

function setup(t, options = {}) {
  const f = fixture(t, { git: options.archive });
  const page = path.join(f.root, "provider.html"), log = path.join(f.root, "browser.jsonl");
  writeFileSync(page, pageFixture(options)); writeFileSync(log, "");
  return { ...f, log, profile: path.join(f.root, "chrome-profile"),
    env: { ...f.env, GIVILOOP_TEST_PAGE: page, GIVILOOP_TEST_BROWSER_LOG: log, GIVILOOP_TEST_DIST_DIR: distDir },
    events: () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)),
  };
}

async function cli(f, command, args = []) {
  const child = spawn(process.execPath, ["--import", preload, cliPath, command, ...(command === "browser" ? [] : ["--repo", f.repo]), ...args], {
    cwd: repoRoot, env: f.env, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  const timer = setTimeout(() => child.kill("SIGTERM"), 30_000);
  try {
    const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}

async function connect(t, f) {
  const client = new Client({ name: "giviloop-browser-test", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: ["--import", preload, path.join(distDir, "mcp-server.js")], cwd: repoRoot, env: f.env, stderr: "pipe" }));
  return client;
}

test("terminating a CLI check closes only its owned native Chrome and releases the profile", { timeout: 25_000, skip: process.platform === "win32" }, async t => {
  const f = setup(t);
  f.env.GIVILOOP_TEST_HTTP_STATUS = "403";
  f.env.GIVILOOP_TEST_CHALLENGE = "true";
  const { profileOwnerPid } = await import(pathToFileURL(path.join(distDir, "providers/browser-runtime.js")));
  const child = spawn(process.execPath, ["--import", preload, cliPath, "browser", "check", "--browser-profile", f.profile, "--verification-wait-ms", "20000"], {
    cwd: repoRoot, env: f.env, stdio: ["ignore", "ignore", "pipe"],
  });
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); });
  const deadline = Date.now() + 12000;
  while (!stderr.includes("complete the browser verification") && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(stderr, /complete the browser verification/);
  assert.ok(profileOwnerPid(f.profile), "the dedicated native Chrome must be running");
  child.kill("SIGTERM");
  assert.deepEqual(await exited, { code: 143, signal: null });
  assert.equal(profileOwnerPid(f.profile), undefined);
  const preferences = JSON.parse(readFileSync(path.join(f.profile, "Default", "Preferences"), "utf8"));
  assert.equal(preferences.profile.exit_type, "Normal");
  assert.equal(f.events().filter(event => event.action === "submit").length, 0);
});

test("browser check inspects a usable composer without creating or sending a review", { timeout: 30_000 }, async t => {
  const f = setup(t);
  const result = await cli(f, "browser", ["check", "--headless", "--browser-profile", f.profile]);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, true);
  assert.equal(report.submitted, false);
  assert.equal(report.authentication, "unknown");
  assert.equal(f.events().filter(event => event.action === "submit").length, 0);
  assert.equal(existsSync(path.join(f.repo, ".giviloop/latest-run-id")), false);
});

test("anonymous chat with a login button supports check, CLI auto send and saved response", { timeout: 30_000 }, async t => {
  const f = setup(t, { anonymous: true });
  const probe = await cli(f, "browser", ["check", "--browser-profile", f.profile]);
  assert.equal(probe.code, 0, probe.stderr);
  const access = JSON.parse(probe.stdout);
  assert.equal(access.ready, true);
  assert.equal(access.authentication, "anonymous");
  assert.equal(access.sessionCookieReadable, false);
  assert.equal(f.events().filter(event => event.action === "submit").length, 0);
  const sent = await cli(f, "ask", ["--question", "Review this anonymous fixture", "--send", "chatgpt-web",
    "--mode", "auto", "--background", "--browser-profile", f.profile, "--response-stable-ms", "500"]);
  assert.equal(sent.code, 0, sent.stderr);
  const run = f.latest();
  assert.equal(readFileSync(run.response, "utf8"), answer);
  const status = JSON.parse(readFileSync(path.join(run.dir, "browser-status.json"), "utf8"));
  assert.equal(status.outcome, "completed");
  assert.equal(status.submitted, true);
  assert.equal(f.events().filter(event => event.action === "submit").length, 1);
});

test("a login wall without an editable composer is reported without submitting", { timeout: 15_000 }, async t => {
  const f = setup(t, { loginRequired: true });
  const probe = await cli(f, "browser", ["check", "--browser-profile", f.profile, "--navigation-timeout-ms", "1000"]);
  assert.equal(probe.code, 1, probe.stderr);
  const access = JSON.parse(probe.stdout);
  assert.equal(access.ready, false);
  assert.equal(access.errorCode, "LOGIN_REQUIRED");
  assert.equal(access.submitted, false);
  assert.equal(f.events().filter(event => event.action === "submit").length, 0);
  assert.equal(existsSync(path.join(f.repo, ".giviloop/latest-run-id")), false);
});

test("browser check returns a challenge before a composer or challenge DOM appears", { timeout: 30_000 }, async t => {
  const f = setup(t);
  f.env.GIVILOOP_TEST_HTTP_STATUS = "403";
  f.env.GIVILOOP_TEST_CHALLENGE = "true";
  const result = await cli(f, "browser", ["check", "--headless", "--browser-profile", f.profile]);
  assert.notEqual(result.code, 0);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, false);
  assert.equal(report.errorCode, "ACCESS_CHALLENGE");
  assert.equal(report.verificationRequired, true);
  assert.equal(report.verificationCompleted, false);
  assert.equal(report.submitted, false);
  assert.equal(f.events().filter(event => event.action === "submit").length, 0);
});

test("headed CLI pauses for verification, resumes the same review, and sends exactly once", { timeout: 30_000 }, async t => {
  const f = setup(t);
  f.env.GIVILOOP_TEST_VERIFICATION_FLOW = "true";
  const result = await cli(f, "ask", ["--question", "Review", "--send", "chatgpt-web", "--mode", "auto",
    "--browser-profile", f.profile, "--verification-wait-ms", "8000", "--response-stable-ms", "100", "--max-wait-ms", "5000"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stderr, /human verification/);
  assert.equal(f.events().filter(event => event.action === "submit").length, 1);
  const status = JSON.parse(readFileSync(path.join(f.latest().dir, "browser-status.json"), "utf8"));
  assert.equal(status.verificationRequired, true);
  assert.equal(status.verificationCompleted, true);
  assert.equal(status.outcome, "completed");
  assert.equal(readFileSync(f.latest().response, "utf8"), answer);
});

test("MCP cancellation closes a browser waiting for human verification and keeps the server usable", { timeout: 30_000 }, async t => {
  const f = setup(t);
  f.env.GIVILOOP_TEST_HTTP_STATUS = "403";
  f.env.GIVILOOP_TEST_CHALLENGE = "true";
  const client = await connect(t, f);
  const controller = new AbortController();
  const pending = client.callTool({ name: "givi_ask_web_llm", arguments: {
    repositoryPath: f.repo, question: "Review", mode: "auto", browserProfile: f.profile,
    verificationWaitMs: 20000,
  } }, undefined, { signal: controller.signal, timeout: 25000 }).then(() => undefined, error => error);
  t.after(() => controller.abort());
  let run, status;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (existsSync(path.join(f.repo, ".giviloop/latest-run-id"))) {
      run = f.latest();
      const file = path.join(run.dir, "browser-status.json");
      if (existsSync(file)) status = JSON.parse(readFileSync(file, "utf8"));
      if (status?.phase === "waiting-for-verification") break;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(status?.phase, "waiting-for-verification");
  controller.abort();
  assert.ok(await pending, "the client receives cancellation rather than a completed answer");
  const cleanupDeadline = Date.now() + 5000;
  while (existsSync(path.join(run.dir, "review.lock")) && Date.now() < cleanupDeadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  status = JSON.parse(readFileSync(path.join(run.dir, "browser-status.json"), "utf8"));
  assert.equal(status.errorCode, "BROWSER_CANCELLED");
  assert.equal(status.outcome, "failed");
  assert.equal(status.submitted, false);
  assert.equal(existsSync(path.join(run.dir, "review.lock")), false);
  assert.equal(existsSync(run.response), false);
  assert.equal(f.events().filter(event => event.action === "submit").length, 0);
  assert.ok((await client.listTools()).tools.some(tool => tool.name === "givi_ask_web_llm"));

  // Reopening the same profile proves cancellation released Chrome's ownership.
  const check = await cli(f, "browser", ["check", "--headless", "--browser-profile", f.profile]);
  assert.equal(JSON.parse(check.stdout).errorCode, "ACCESS_CHALLENGE", check.stderr);
});

test("CLI auto -> real headless browser -> saved response -> MCP read", { timeout: 30_000 }, async t => {
  const f = setup(t);
  writeFileSync(path.join(f.repo, "code.txt"), "Source context: è\n");
  const result = await cli(f, "ask", ["--question", "Review source", "--file", "code.txt", "--send", "chatgpt-web", "--mode", "auto", "--headless", "--browser-profile", f.profile, "--response-stable-ms", "200", "--max-wait-ms", "5000"]);
  assert.equal(result.code, 0, result.stderr);
  const run = f.latest();
  assert.equal(readFileSync(run.response, "utf8"), answer);
  const status = JSON.parse(readFileSync(path.join(run.dir, "browser-status.json"), "utf8"));
  assert.equal(status.outcome, "completed");
  assert.equal(status.submitted, true);
  const submissions = f.events().filter(event => event.action === "submit");
  assert.equal(submissions.length, 1);
  assert.ok(submissions[0].prompt.includes("Source context: è"));
  const client = await connect(t, f);
  const read = await client.callTool({ name: "givi_read_external_review", arguments: { repositoryPath: f.repo, runId: run.id } });
  assert.ok(read.content.some(item => item.type === "text" && item.text.includes(answer)));
});

for (const variant of [{}, { mediaInputs: true }, { delayedUpload: true, background: true }]) test(`MCP sends a source archive only when uploads are ready${variant.mediaInputs ? "; skips photo/video inputs" : variant.delayedUpload ? "; background waits for interactive controls" : ""}`, { timeout: 30_000 }, async t => {
  const f = setup(t, { archive: true, ...variant });
  const prepared = await cli(f, "archive", ["--goal", "Review source", "--no-untracked"]);
  assert.equal(prepared.code, 0, prepared.stderr);
  const client = await connect(t, f);
  const result = await client.callTool({ name: "givi_send_to_web_llm", arguments: {
    repositoryPath: f.repo, runId: f.latest().id, mode: "auto", headless: !variant.background, background: Boolean(variant.background),
    browserProfile: f.profile, responseStableMs: 200, maxWaitMs: 5000,
  } });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.equal(readFileSync(f.latest().response, "utf8"), answer);
  const submissions = f.events().filter(event => event.action === "submit");
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].uploadsReady, true);
  assert.deepEqual(submissions[0].files, ["source-context.zip"]);
});

test("archive upload refuses disabled and media-only inputs before sending", { timeout: 15_000 }, async t => {
  const f = setup(t, { archive: true, mediaInputs: true, mediaOnly: true });
  const prepared = await cli(f, "archive", ["--goal", "Review source", "--no-untracked"]);
  assert.equal(prepared.code, 0, prepared.stderr);
  const sent = await cli(f, "send", ["--mode", "auto", "--headless", "--browser-profile", f.profile]);
  assert.equal(sent.code, 1);
  assert.match(sent.stderr, /ATTACHMENT_UNAVAILABLE/);
  assert.equal(f.events().filter(event => event.action === "submit").length, 0);
  assert.equal(existsSync(f.latest().response), false);
  assert.equal(JSON.parse(readFileSync(path.join(f.latest().dir, "browser-status.json"), "utf8")).submitted, false);
});

test("a paused current response times out without saving or repeating the send", { timeout: 30_000 }, async t => {
  const f = setup(t, { incomplete: true });
  const result = await cli(f, "ask", ["--question", "Review", "--send", "chatgpt-web", "--mode", "auto", "--headless", "--browser-profile", f.profile, "--response-stable-ms", "100", "--max-wait-ms", "1400"]);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /RESPONSE_INCOMPLETE/);
  assert.equal(f.events().filter(event => event.action === "submit").length, 1);
  assert.equal(JSON.parse(readFileSync(path.join(f.latest().dir, "browser-status.json"), "utf8")).outcome, "failed");
});

test("legacy response remains readable when an unrelated Stop button is hidden", { timeout: 30_000 }, async t => {
  const f = setup(t, { legacy: true });
  const result = await cli(f, "ask", ["--question", "Review", "--send", "chatgpt-web", "--mode", "auto", "--headless", "--browser-profile", f.profile, "--response-stable-ms", "100", "--max-wait-ms", "5000"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(readFileSync(f.latest().response, "utf8"), answer);
});

test("required model selects and confirms the exact label, ignoring unrelated buttons and longer labels", { timeout: 30_000 }, async t => {
  const f = setup(t, { model: true });
  const result = await cli(f, "ask", ["--question", "Review", "--send", "chatgpt-web", "--mode", "auto", "--headless", "--browser-profile", f.profile, "--model", "GPT Pro", "--require-model", "--response-stable-ms", "100", "--max-wait-ms", "5000"]);
  assert.equal(result.code, 0, result.stderr);
  const submissions = f.events().filter(event => event.action === "submit");
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].model, "GPT Pro");
});

for (const [name, options, error] of [
  ["unavailable exact model", { missingModel: true }, "MODEL_UNAVAILABLE"],
  ["model selection without confirmation", { confirmModel: false }, "MODEL_SELECTION_UNCONFIRMED"],
]) {
  test(`required ${name} fails before sending`, { timeout: 30_000 }, async t => {
    const f = setup(t, { model: true, ...options });
    const result = await cli(f, "ask", ["--question", "Review", "--send", "chatgpt-web", "--mode", "auto", "--headless", "--browser-profile", f.profile, "--model", "GPT Pro", "--require-model"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, new RegExp(error));
    assert.equal(f.events().filter(event => event.action === "submit").length, 0);
    const status = JSON.parse(readFileSync(path.join(f.latest().dir, "browser-status.json"), "utf8"));
    assert.equal(status.submitted, false);
  });
}

test("preferred unavailable model reports fallback and dismisses the menu before sending", { timeout: 30_000 }, async t => {
  const f = setup(t, { model: true, missingModel: true });
  const result = await cli(f, "ask", ["--question", "Review", "--send", "chatgpt-web", "--mode", "auto", "--headless", "--browser-profile", f.profile, "--model", "GPT Pro", "--response-stable-ms", "100", "--max-wait-ms", "5000"]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout + result.stderr, /currently selected ChatGPT model/);
  const submissions = f.events().filter(event => event.action === "submit");
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].model, "GPT Base");
  assert.equal(submissions[0].menuOpen, false);
});
