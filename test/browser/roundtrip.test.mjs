import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { test as nodeTest } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { cliPath, distDir, fixture, repoRoot } from "../helpers.mjs";

const preload = new URL("../fixtures/browser-site.mjs", import.meta.url).href;
const answer = "Review verificata: più contesto è utile.\nSeconda riga.";

// Hosted Windows can spend much longer starting/stopping ordinary Chrome.
// Scale harness deadlines and successful-response budgets, not the deliberate
// short response timeouts in negative tests or any product defaults.
const hostBudget = process.platform === 'win32' ? 2 : 1;
const successfulResponseMs = 5000 * hostBudget;
function test(name, options, run) {
  return nodeTest(name, { ...options, timeout: options.timeout * hostBudget }, run);
}

const webCases = [
  { provider: "deepseek-web", origin: "https://chat.deepseek.com", login: "/sign_in",
    input: '<textarea id="chat-input" placeholder="Message DeepSeek"></textarea>',
    response: '<div class="ds-message"><div class="ds-markdown"></div></div>', content: '.ds-markdown' },
  { provider: "claude-web", origin: "https://claude.ai", login: "/login",
    input: '<div class="ProseMirror" contenteditable="true"></div>',
    response: '<div data-is-streaming="true"><div class="font-claude-response"></div></div>', content: '.font-claude-response' },
  { provider: "gemini-web", origin: "https://gemini.google.com", input: '<rich-textarea><div contenteditable="true" role="textbox"></div></rich-textarea>',
    response: '<model-response><message-content><div class="markdown"></div></message-content></model-response>', content: '.markdown' },
];

function otherFixture(t, spec, incomplete = false) {
  const f = setup(t);
  f.env.GIVILOOP_TEST_ORIGIN = spec.origin;
  writeFileSync(f.env.GIVILOOP_TEST_PAGE, `<!doctype html><html><style>body {white-space:pre-wrap}</style><body>
    ${spec.input}<button aria-label="Send message">Send</button>
    <div id="conversation">${spec.response.replace('></div>', '>Previous answer</div>')}</div>
    <script>
    const input=document.querySelector('textarea,[contenteditable]');
    const send=()=>{
      window.captureSubmission({prompt:input.value ?? input.innerText});
      const template=document.createElement('template');template.innerHTML=${JSON.stringify(spec.response)};
      const item=template.content.firstElementChild;document.querySelector('#conversation').append(item);
      item.querySelector(${JSON.stringify(spec.content)}).textContent=${JSON.stringify(answer)};
      const codeCopy=document.createElement('button');codeCopy.setAttribute('aria-label','Copy code');item.append(codeCopy);
      ${incomplete ? '' : `setTimeout(()=>{item.setAttribute('data-is-streaming','false');const copy=document.createElement('button');copy.setAttribute('aria-label','Copy response');item.append(copy);const retry=document.createElement('button');retry.setAttribute('aria-label','Regenerate');item.append(retry);},900);`}
    };
    document.querySelector('button').onclick=send;
    input.onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}};
    </script></body></html>`);
  return f;
}

for (const spec of webCases) {
  for (const visibility of ['--headless', '--background']) test(`${spec.provider} ${visibility}: CLI text review -> one send -> complete answer -> MCP read`, { timeout: 30_000 }, async t => {
    const f = otherFixture(t, spec);
    writeFileSync(path.join(f.repo, 'code.txt'), 'Source context è\n\n  x < y && z > 0\n\tindentation\n<script>throw new Error("must remain text")</script>\n');
    const sent = await cli(f, 'ask', ['--send', spec.provider, '--question', 'Review', '--file', 'code.txt', '--mode', 'auto', visibility, '--browser-profile', f.profile, '--response-stable-ms', '100', '--max-wait-ms', String(successfulResponseMs)]);
    assert.equal(sent.code, 0, sent.stderr);
    const run = f.latest();
    assert.equal(readFileSync(run.response, 'utf8'), answer);
    assert.equal(JSON.parse(readFileSync(run.metadata)).targetProvider, spec.provider.replace('-web', '-chat'));
    const status = JSON.parse(readFileSync(path.join(run.dir, 'browser-status.json')));
    assert.equal(status.provider, spec.provider);
    assert.equal(status.outcome, 'completed');
    assert.equal(f.events().filter(e => e.action === 'submit').length, 1);
    assert.match(f.events().find(e => e.action === 'submit').prompt, /Source context è/);
    if (visibility === '--background') assert.equal(f.events().find(e => e.action === 'submit').prompt, readFileSync(run.request, 'utf8'));
    const client = await connect(t, f);
    const read = await client.callTool({ name: 'givi_read_external_review', arguments: {repositoryPath:f.repo, runId:run.id} });
    assert.ok(read.content.some(item => item.type === 'text' && item.text.includes(answer)));
  });

  test(`${spec.provider}: MCP prepare and send preserve the chosen destination`, { timeout: 30_000 }, async t => {
    const f = otherFixture(t, spec);
    const prepared = await cli(f, 'ask', ['--question', 'Review', '--target-provider', spec.provider.replace('-web', '-chat')]);
    assert.equal(prepared.code, 0, prepared.stderr);
    const client = await connect(t, f);
    const result = await client.callTool({name:'givi_send_to_web_llm', arguments:{repositoryPath:f.repo, webProvider:spec.provider, mode:'auto', headless:true, browserProfile:f.profile, responseStableMs:100, maxWaitMs:successfulResponseMs}});
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.equal(readFileSync(f.latest().response,'utf8'),answer);
    assert.equal(f.events().filter(e=>e.action==='submit').length,1);
  });

  test(`${spec.provider}: a paused answer with only a code-copy button is never saved or resent`, { timeout: 30_000 }, async t => {
    const f = otherFixture(t, spec, true);
    const sent = await cli(f, 'ask', ['--send',spec.provider,'--question','Review','--mode','auto','--headless','--browser-profile',f.profile,'--response-stable-ms','100','--max-wait-ms','1600']);
    assert.equal(sent.code,1);
    assert.match(sent.stderr,/RESPONSE_INCOMPLETE/);
    assert.equal(existsSync(f.latest().response),false);
    assert.equal(f.events().filter(e=>e.action==='submit').length,1);
  });

  if (spec.login) test(`${spec.provider}: login redirect stops before filling or sending`, { timeout: 15_000 }, async t => {
    const f = otherFixture(t,spec);
    f.env.GIVILOOP_TEST_LOGIN_PATH=spec.login;
    const probe=await cli(f,'browser',['check','--provider',spec.provider,'--headless','--browser-profile',f.profile]);
    assert.equal(probe.code,1);
    const report=JSON.parse(probe.stdout);
    assert.equal(report.errorCode,'LOGIN_REQUIRED');
    assert.equal(report.provider,spec.provider);
    assert.match(report.nextStep,new RegExp(`--provider ${spec.provider}`));
    assert.equal(f.events().filter(e=>e.action==='submit').length,0);
  });
}

for (const spec of [webCases[1], webCases[2]]) test(`${spec.provider} quiet first-use cookie choice pauses; explicit foreground resume sends once`, { timeout: 30_000 }, async t => {
  const f = otherFixture(t, spec);
  f.env.GIVILOOP_TEST_CAPTURE_WINDOW_STATE = '1';
  const html=readFileSync(f.env.GIVILOOP_TEST_PAGE,'utf8').replace('},900);','},2200);');
  writeFileSync(f.env.GIVILOOP_TEST_PAGE,html.replace('</body>', '<div role="dialog" style="position:fixed;inset:0;background:white"><button data-testid="consent-reject" onclick="this.parentElement.remove()">Rifiuta tutto</button></div></body>'));
  const sent=await cli(f,'ask',['--send',spec.provider,'--question','Review','--mode','auto','--background','--browser-profile',f.profile,'--response-stable-ms','100','--max-wait-ms',String(successfulResponseMs)]);
  assert.equal(sent.code,1,sent.stderr);
  assert.match(sent.stderr,/BROWSER_SETUP_REQUIRED/);
  assert.equal(f.events().filter(e=>e.action==='submit').length,0);
  assert.equal(JSON.parse(readFileSync(path.join(f.latest().dir, 'browser-status.json'))).outcome, 'needs-attention');
  const resumed = await cli(f, 'resume', ['--foreground']);
  assert.equal(resumed.code, 0, resumed.stderr);
  assert.equal(readFileSync(f.latest().response,'utf8'),answer);
  assert.equal(f.events().filter(e=>e.action==='submit').length,1);
});

test('DeepSeek does not mistake the submitted user markdown and its copy button for an answer', {timeout:30_000},async t=>{
  const f=otherFixture(t,webCases[0],true);
  const html=readFileSync(f.env.GIVILOOP_TEST_PAGE,'utf8').replace("codeCopy.setAttribute('aria-label','Copy code')","codeCopy.setAttribute('aria-label','Copy response')");
  writeFileSync(f.env.GIVILOOP_TEST_PAGE,html);
  const sent=await cli(f,'ask',['--send','deepseek-web','--question','Review','--mode','auto','--headless','--browser-profile',f.profile,'--response-stable-ms','100','--max-wait-ms','1600']);
  assert.equal(sent.code,1);
  assert.match(sent.stderr,/RESPONSE_INCOMPLETE/);
  assert.equal(existsSync(f.latest().response),false);
  assert.equal(f.events().filter(e=>e.action==='submit').length,1);
});

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
  // Close children/clients before deleting the profile they still own. Node's
  // after hooks run in registration order, so a later client hook is too late.
  const fixtureCleanup = [], resources = new Set();
  const f = fixture({ after: cleanup => fixtureCleanup.push(cleanup) }, { git: options.archive });
  t.after(async () => {
    const results = await Promise.allSettled([...resources].map(cleanup => cleanup()));
    for (const cleanup of fixtureCleanup) await cleanup();
    const failures = results.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Browser fixture cleanup failed');
  });
  const page = path.join(f.root, "provider.html"), log = path.join(f.root, "browser.jsonl");
  writeFileSync(page, pageFixture(options)); writeFileSync(log, "");
  return { ...f, log, signal: t.signal,
    own(cleanup) { resources.add(cleanup); return () => resources.delete(cleanup); },
    profile: path.join(f.root, "chrome-profile"),
    env: { ...f.env, GIVILOOP_TEST_PAGE: page, GIVILOOP_TEST_BROWSER_LOG: log, GIVILOOP_TEST_DIST_DIR: distDir },
    events: () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)),
  };
}

const childStops = new WeakMap();
function stopChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  if (childStops.has(child)) return childStops.get(child);
  const stop = (async () => {
    const exited = new Promise(resolve => { child.once('exit', () => resolve(true)); child.once('error', () => resolve(true)); });
    const wait = async milliseconds => {
      let timer;
      try { return await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); })]); }
      finally { clearTimeout(timer); }
    };
    child.kill('SIGTERM');
    // Allow the native launcher's bounded cooperative close to finish first.
    if (await wait(12000)) return;
    child.kill('SIGKILL');
    if (!await wait(2000)) throw new Error('Owned fixture child did not exit after TERM/KILL');
  })();
  childStops.set(child, stop);
  return stop;
}

async function cli(f, command, args = []) {
  const child = spawn(process.execPath, ["--import", preload, cliPath, command, ...(command === "browser" ? [] : ["--repo", f.repo]), ...args], {
    cwd: repoRoot, env: f.env, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  const disown = f.own(() => stopChild(child));
  const stop = () => { void stopChild(child).catch(() => {}); };
  const timer = setTimeout(stop, 30_000 * hostBudget);
  f.signal.addEventListener('abort', stop, { once: true });
  if (f.signal.aborted) stop();
  try {
    const code = await new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer); f.signal.removeEventListener('abort', stop);
    await stopChild(child); disown();
  }
}

async function connect(t, f) {
  const client = new Client({ name: "giviloop-browser-test", version: "1.0.0" });
  let connected = false;
  f.own(async () => {
    try {
      // Await Chrome shutdown before the SDK's short stdio-close deadline can
      // terminate the server. EOF shutdown itself has a separate regression.
      if (connected) {
        const released = await client.callTool({ name: 'givi_release_browser_sessions', arguments: {} });
        assert.notEqual(released.isError, true, JSON.stringify(released));
      }
    } finally { await client.close(); }
  });
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: ["--import", preload, path.join(distDir, "mcp-server.js")], cwd: repoRoot, env: f.env, stderr: "pipe" }));
  connected = true;
  return client;
}

async function enableAutomaticFixture(f) {
  execFileSync('git', ['init', f.repo], { stdio: 'ignore' });
  execFileSync('git', ['-C', f.repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'fixture'], { stdio: 'ignore' });
  writeFileSync(path.join(f.repo, 'sum.js'), 'export const sum = xs => xs.reduce((a,b) => a+b);\n');
  const configured = await cli(f, 'setup', ['--provider', 'claude-web', '--non-interactive', '--browser-profile', f.profile]);
  assert.equal(configured.code, 0, configured.stderr);
  const enabled = await cli(f, 'auto-review', ['enable']);
  assert.equal(enabled.code, 0, enabled.stderr);
}

test('automatic MCP review uses windowless Chrome, sends once and is deduplicated across CLI/MCP', { timeout: 35000 }, async t => {
  const f = otherFixture(t, webCases[1]);
  f.env.GIVILOOP_TEST_CAPTURE_WINDOW_STATE = '1';
  await enableAutomaticFixture(f);
  const client = await connect(t, f);
  const input = { repositoryPath: f.repo, taskId: 'user-task', checks: 'passed', files: ['sum.js'] };
  const response = await client.callTool({ name: 'givi_auto_review', arguments: input });
  assert.notEqual(response.isError, true, JSON.stringify(response));
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.state, 'completed');
  assert.equal(readFileSync(result.responsePath, 'utf8'), answer);
  const browserStatus = JSON.parse(readFileSync(path.join(f.latest().dir, 'browser-status.json')));
  assert.equal(browserStatus.background, true);
  assert.equal(browserStatus.headless, false);
  assert.equal(browserStatus.visibility, 'windowless');
  const duplicate = await cli(f, 'auto-review', ['run', '--task-id', 'different-task', '--checks', 'passed', '--file', 'sum.js']);
  assert.equal(JSON.parse(duplicate.stdout).reason, 'unchanged-snapshot');
  writeFileSync(path.join(f.repo, 'sum.js'), 'export const sum = xs => xs.reduce((a,b) => a+b, 0);\n');
  const afterFix = await client.callTool({ name: 'givi_auto_review', arguments: input });
  assert.equal(JSON.parse(afterFix.content[0].text).reason, 'task-already-reviewed');
  assert.equal(f.events().filter(e => e.action === 'submit').length, 1);
  assert.equal(f.events().find(e => e.action === 'submit').windowState, 'windowless');
});

test('automatic login attention suspends new tasks; explicit resume sends the original request once', { timeout: 35000 }, async t => {
  const f = otherFixture(t, webCases[1]);
  await enableAutomaticFixture(f);
  f.env.GIVILOOP_TEST_LOGIN_PATH = '/login';
  const paused = await cli(f, 'auto-review', ['run', '--task-id', 'login-task', '--checks', 'passed', '--file', 'sum.js']);
  assert.equal(paused.code, 1, paused.stderr);
  const result = JSON.parse(paused.stdout);
  assert.equal(result.state, 'needs-attention');
  const stopped = await cli(f, 'auto-review', ['run', '--task-id', 'new-task', '--checks', 'passed', '--file', 'sum.js']);
  assert.equal(JSON.parse(stopped.stdout).state, 'suspended');
  assert.equal(f.events().filter(e => e.action === 'submit').length, 0);
  delete f.env.GIVILOOP_TEST_LOGIN_PATH;
  const resumed = await cli(f, 'resume', ['--run-id', result.runId]);
  assert.equal(resumed.code, 0, resumed.stderr);
  const duplicate = await cli(f, 'auto-review', ['run', '--task-id', 'new-task', '--checks', 'passed', '--file', 'sum.js']);
  assert.equal(JSON.parse(duplicate.stdout).reason, 'unchanged-snapshot');
  assert.equal(f.events().filter(e => e.action === 'submit').length, 1);
});

test('live demo transfers only its public example and exports independently reproduced evidence', { timeout: 30000 }, async t => {
  const f = otherFixture(t, webCases[1]);
  // The demo starts a child CLI; instrument that real-browser child as well.
  f.env.NODE_OPTIONS = `${f.env.NODE_OPTIONS ?? ''} --import ${JSON.stringify(preload)}`;
  writeFileSync(path.join(f.repo, 'private.txt'), 'PRIVATE_PROJECT_CONTEXT');
  const result = await cli(f, 'demo', ['--provider', 'claude-web', '--browser-profile', f.profile, '--json']);
  assert.equal(result.code, 0, result.stderr);
  const demo = JSON.parse(result.stdout);
  assert.equal(demo.state, 'completed');
  assert.equal(demo.submitted, true);
  assert.match(demo.verification, /4 regression cases passed/);
  assert.equal(readFileSync(demo.responsePath, 'utf8'), answer);
  assert.match(readFileSync(demo.reportPath, 'utf8'), /Bundled demonstration/);
  assert.equal(f.events().filter(e => e.action === 'submit').length, 1);
  assert.doesNotMatch(f.events().find(e => e.action === 'submit').prompt, /PRIVATE_PROJECT_CONTEXT/);
  const finish = await cli(f, 'demo', ['--finish', '--json']);
  assert.equal(finish.code, 0, finish.stderr);
  assert.equal(f.events().filter(e => e.action === 'submit').length, 1, 'finish must never send again');
});

test('demo login attention preserves one request; resume and finish complete it without another submission', { timeout: 35000 }, async t => {
  const f = otherFixture(t, webCases[1]);
  f.env.NODE_OPTIONS = `${f.env.NODE_OPTIONS ?? ''} --import ${JSON.stringify(preload)}`;
  f.env.GIVILOOP_TEST_LOGIN_PATH = '/login';
  const paused = await cli(f, 'demo', ['--provider', 'claude-web', '--browser-profile', f.profile, '--json']);
  assert.equal(paused.code, 1, paused.stderr);
  const demo = JSON.parse(paused.stdout);
  assert.equal(demo.state, 'needs-attention');
  assert.equal(demo.submitted, false);
  assert.equal(f.events().filter(e => e.action === 'submit').length, 0);
  delete f.env.GIVILOOP_TEST_LOGIN_PATH;
  const resumed = await cli({ ...f, repo: demo.repositoryPath }, 'resume', []);
  assert.equal(resumed.code, 0, resumed.stderr);
  const finished = await cli(f, 'demo', ['--finish', '--json']);
  assert.equal(finished.code, 0, finished.stderr);
  assert.equal(JSON.parse(finished.stdout).runId, demo.runId);
  assert.equal(f.events().filter(e => e.action === 'submit').length, 1);
});

test('CLI review uses saved preferences and resolves a relative repository once', { timeout: 25000 }, async t => {
  const f = setup(t, { archive: true });
  // We need a Git repository, but this review is inline text, without upload.
  writeFileSync(f.env.GIVILOOP_TEST_PAGE, pageFixture());
  writeFileSync(path.join(f.repo, 'source.txt'), 'changed\n');
  const configured = await cli(f, 'setup', ['--non-interactive', '--provider', 'chatgpt-web', '--browser-profile', f.profile]);
  assert.equal(configured.code, 0, configured.stderr);
  const child = spawn(process.execPath, ['--import', preload, cliPath, 'review', '--repo', path.relative(repoRoot, f.repo), '--response-stable-ms', '100', '--max-wait-ms', String(successfulResponseMs)], { cwd: repoRoot, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stdout.resume(); child.stderr.on('data', chunk => { stderr += chunk; });
  f.own(() => stopChild(child));
  assert.equal(await new Promise(resolve => child.once('exit', resolve)), 0, stderr);
  const report = await cli(f, 'status', ['--json']);
  assert.equal(report.code, 0, report.stderr);
  assert.equal(JSON.parse(report.stdout).state, 'completed');
  assert.equal(f.events().filter(e => e.action === 'submit').length, 1);
  assert.match(f.events().find(e => e.action === 'submit').prompt, /changed/);
});

test('saved defaults and MCP reuse keep two reviews isolated in one owned Chrome', { timeout: 30000 }, async t => {
  const f = otherFixture(t, webCases[1]);
  const configured = await cli(f, 'setup', ['--non-interactive', '--provider', 'claude-web', '--browser-profile', f.profile]);
  assert.equal(configured.code, 0, configured.stderr);
  const client = await connect(t, f);
  for (const [index, question] of ['First independent review', 'Second independent review'].entries()) {
    const result = await client.callTool({ name: 'givi_ask_web_llm', arguments: { repositoryPath: f.repo, question, responseStableMs: 100, maxWaitMs: successfulResponseMs } });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const status = JSON.parse(readFileSync(path.join(f.latest().dir, 'browser-status.json')));
    assert.equal(status.outcome, 'completed');
    assert.equal(status.provider, 'claude-web');
    assert.equal(status.background, true);
    assert.equal(status.sessionReused, index === 1);
    assert.equal(readFileSync(f.latest().response, 'utf8'), answer);
  }
  assert.equal(f.events().filter(e => e.action === 'launch').length, 1);
  const submissions = f.events().filter(e => e.action === 'submit');
  assert.equal(submissions.length, 2);
  assert.match(submissions[1].prompt, /Second independent review/);
  assert.doesNotMatch(submissions[1].prompt, /First independent review/);
  const released = await client.callTool({ name: 'givi_release_browser_sessions', arguments: {} });
  assert.notEqual(released.isError, true, JSON.stringify(released));
  const { profileOwnerPid } = await import(pathToFileURL(path.join(distDir, 'providers/browser-runtime.js')));
  assert.equal(profileOwnerPid(f.profile), undefined);
});

test('MCP status and cooperative cancellation stop a pending review without resending', { timeout: 25000 }, async t => {
  const f = setup(t, { incomplete: true });
  const client = await connect(t, f);
  const pending = client.callTool({ name: 'givi_ask_web_llm', arguments: { repositoryPath: f.repo, question: 'Wait for cancellation', browserProfile: f.profile, maxWaitMs: 20000 } }).catch(error => error);
  const deadline = Date.now() + 12000 * hostBudget;
  while (!f.events().some(e => e.action === 'submit') && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
  assert.equal(f.events().filter(e => e.action === 'submit').length, 1);
  const status = await client.callTool({ name: 'givi_status', arguments: { repositoryPath: f.repo } });
  assert.notEqual(status.isError, true);
  assert.match(JSON.stringify(status), /running/);
  const cancelled = await client.callTool({ name: 'givi_cancel', arguments: { repositoryPath: f.repo } });
  assert.notEqual(cancelled.isError, true, JSON.stringify(cancelled));
  const result = await pending;
  assert.match(result.message, /BROWSER_CANCELLED/);
  const saved = JSON.parse(readFileSync(path.join(f.latest().dir, 'browser-status.json')));
  assert.equal(saved.errorCode, 'BROWSER_CANCELLED');
  assert.equal(saved.submitted, true);
  assert.equal(existsSync(f.latest().response), false);
  assert.equal(f.events().filter(e => e.action === 'submit').length, 1);
  await assert.rejects(client.callTool({ name: 'givi_resume', arguments: { repositoryPath: f.repo } }), /resume|Resume|attention/);
  const { profileOwnerPid } = await import(pathToFileURL(path.join(distDir, 'providers/browser-runtime.js')));
  assert.equal(profileOwnerPid(f.profile), undefined);
});

test('MCP stdin EOF closes retained Chrome without relying on a termination signal', { timeout: 20000 }, async t => {
  const f = setup(t);
  const child = spawn(process.execPath, ['--import', preload, path.join(distDir, 'mcp-server.js')], { cwd: repoRoot, env: f.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  f.own(() => stopChild(child));
  let buffer = '', stderr = ''; const replies = new Map();
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => { buffer += chunk; let end; while ((end = buffer.indexOf('\n')) !== -1) { const message = JSON.parse(buffer.slice(0, end)); buffer = buffer.slice(end + 1); if (message.id !== undefined) replies.set(message.id, message); } });
  const send = message => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  const receive = async id => { const deadline = Date.now() + 12000 * hostBudget; while (!replies.has(id) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50)); assert.ok(replies.has(id), stderr); return replies.get(id); };
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'eof-test', version: '1' } } });
  await receive(1); send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/call', params: { name: 'givi_ask_web_llm', arguments: { repositoryPath: f.repo, question: 'Review', browserProfile: f.profile, responseStableMs: 100, maxWaitMs: successfulResponseMs } } });
  const response = await receive(2);
  assert.equal(response.error, undefined, JSON.stringify(response));
  assert.notEqual(response.result?.isError, true, JSON.stringify(response));
  const { profileOwnerPid } = await import(pathToFileURL(path.join(distDir, 'providers/browser-runtime.js')));
  if (process.platform !== 'win32') assert.ok(profileOwnerPid(f.profile));
  child.stdin.end();
  assert.deepEqual(await exited, { code: 0, signal: null });
  assert.equal(profileOwnerPid(f.profile), undefined);
  // Windows uses a native profile mutex instead of SingletonLock. A successful
  // fresh launch proves EOF released ownership on every supported platform.
  const reopened = await cli(f, 'browser', ['check', '--browser-profile', f.profile]);
  assert.equal(reopened.code, 0, reopened.stderr);
});

test("terminating a CLI check closes only its owned native Chrome and releases the profile", { timeout: 25_000, skip: process.platform === "win32" }, async t => {
  const f = setup(t);
  f.env.GIVILOOP_TEST_HTTP_STATUS = "403";
  f.env.GIVILOOP_TEST_CHALLENGE = "true";
  const { profileOwnerPid } = await import(pathToFileURL(path.join(distDir, "providers/browser-runtime.js")));
  const child = spawn(process.execPath, ["--import", preload, cliPath, "browser", "check", "--foreground", "--browser-profile", f.profile, "--verification-wait-ms", "20000"], {
    cwd: repoRoot, env: f.env, stdio: ["ignore", "ignore", "pipe"],
  });
  const exited = new Promise(resolve => child.once("exit", (code, signal) => resolve({ code, signal })));
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  f.own(() => stopChild(child));
  const deadline = Date.now() + 12000 * hostBudget;
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

test('setup browser check uses the explicit isolated profile and does not submit', { timeout: 30000 }, async t => {
  const f = setup(t);
  const result = await cli(f, 'setup', ['--non-interactive', '--check', '--browser-profile', f.profile]);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.access.ready, true);
  assert.equal(report.access.submitted, false);
  assert.equal(f.events().filter(e => e.action === 'submit').length, 0);
  assert.ok(f.events().filter(e => e.action === 'launch').every(e => e.profile === f.profile));
});

test('failed setup access check never proceeds to an explicitly requested demo', { timeout: 30000 }, async t => {
  const f = setup(t);
  f.env.GIVILOOP_TEST_HTTP_STATUS = '403'; f.env.GIVILOOP_TEST_CHALLENGE = 'true';
  const result = await cli(f, 'setup', ['--non-interactive', '--check', '--demo', '--browser-profile', f.profile]);
  assert.equal(result.code, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.access.ready, false);
  assert.equal(report.demo.submitted, false);
  assert.equal(f.events().filter(e => e.action === 'submit').length, 0);
  assert.equal(existsSync(path.join(f.repo, '.giviloop/setup-demos')), false);
});

test('evidence recheck sends the new snapshot through MCP and preserves parent review', { timeout: 30000 }, async t => {
  const f = setup(t);
  writeFileSync(path.join(f.repo, 'code.ts'), 'export const value = 1;');
  const first = await cli(f, 'ask', ['--file', 'code.ts', '--question', 'Review', '--send', 'chatgpt-web', '--mode', 'auto', '--headless', '--browser-profile', f.profile, '--response-stable-ms', '100']);
  assert.equal(first.code, 0, first.stderr);
  const parent = f.latest();
  const added = await cli(f, 'findings', ['add', '--run-id', parent.id, '--title', 'Value', '--claim', 'Value must be 2', '--file', 'code.ts']);
  assert.equal(added.code, 0, added.stderr);
  writeFileSync(path.join(f.repo, 'code.ts'), 'export const value = 2;');
  const prepared = await cli(f, 'recheck', ['--run-id', parent.id, '--finding-id', JSON.parse(added.stdout).findingId]);
  assert.equal(prepared.code, 0, prepared.stderr);
  const current = f.latest();
  const client = await connect(t, f);
  const sent = await client.callTool({ name: 'givi_send_to_web_llm', arguments: { repositoryPath: f.repo, runId: current.id, mode: 'auto', headless: true, browserProfile: f.profile, responseStableMs: 100, maxWaitMs: successfulResponseMs } });
  assert.notEqual(sent.isError, true, JSON.stringify(sent));
  assert.equal(readFileSync(parent.response, 'utf8'), answer);
  assert.equal(readFileSync(current.response, 'utf8'), answer);
  const submissions = f.events().filter(e => e.action === 'submit');
  assert.equal(submissions.length, 2);
  assert.match(submissions[1].prompt, /value = 2/);
  assert.match(submissions[1].prompt, /Targeted recheck/);
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

test('--background frame scheduling preserves cancellation, native delivery and frame/origin boundaries', { timeout: 20000 }, async t => {
  const f = fixture(t);
  const { nativeChrome } = await import(pathToFileURL(path.join(distDir, 'providers/native-chrome.js')));
  const { installWindowlessFrameFallback } = await import(pathToFileURL(path.join(distDir, 'providers/windowless-rendering.js')));
  const context = await nativeChrome.launch(path.join(f.root, 'frame-scheduling'), true);
  try {
    const page = context.pages()[0];
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><iframe srcdoc="<p>Child frame</p>"></iframe>' }));
    await page.goto('https://chatgpt.com/frame-fixture', { waitUntil: 'load' });
    await page.evaluate(() => {
      window.sequence = 0; window.nativeFrames = false;
      window.requestAnimationFrame = callback => { const id = ++window.sequence; if (window.nativeFrames) setTimeout(() => callback(performance.now()), 0); return id; };
      window.cancelAnimationFrame = () => {};
      window.initialFrameRequest = window.requestAnimationFrame;
    });
    await page.evaluate(installWindowlessFrameFallback, 'https://unrelated.invalid');
    assert.equal(await page.evaluate(() => window.requestAnimationFrame === window.initialFrameRequest), true);
    const child = page.frames().find(frame => frame !== page.mainFrame());
    await child.evaluate(() => { window.initialFrameRequest = window.requestAnimationFrame; });
    await child.evaluate(installWindowlessFrameFallback, 'null');
    assert.equal(await child.evaluate(() => window.requestAnimationFrame === window.initialFrameRequest), true);
    await page.evaluate(installWindowlessFrameFallback, 'https://chatgpt.com');
    for (const native of [false, true]) {
      const result = await page.evaluate(async native => {
        window.nativeFrames = native;
        let calls = 0, cancelledCalls = 0, timestamp = 0;
        const start = performance.now();
        requestAnimationFrame(time => { calls++; timestamp = time; });
        const cancelled = requestAnimationFrame(() => cancelledCalls++); cancelAnimationFrame(cancelled);
        await new Promise(resolve => setTimeout(resolve, 250));
        return { calls, cancelledCalls, validTimestamp: timestamp >= start };
      }, native);
      assert.deepEqual(result, { calls: 1, cancelledCalls: 0, validTimestamp: true });
    }
    await nativeChrome.assertWindowless(context, page);
  } finally { await context.close(); }
});

test('--background captures an answer whose DOM update requires an animation frame', { timeout: 20000 }, async t => {
  const f = setup(t);
  const html = readFileSync(f.env.GIVILOOP_TEST_PAGE, 'utf8');
  writeFileSync(f.env.GIVILOOP_TEST_PAGE, html.replace('</body>', `<script>
    document.querySelector('[data-testid=composer-submit-button]').onclick=()=>{
      window.captureSubmission({prompt:document.querySelector('#input').value});
      const item=document.createElement('li');item.setAttribute('data-message-role','assistant');
      const content=document.createElement('div');content.setAttribute('data-assistant-markdown','');item.append(content);
      document.querySelector('#conversation').append(item);
      requestAnimationFrame(()=>{content.textContent=${JSON.stringify(answer)};item.setAttribute('data-message-complete','');});
    };
    </script></body>`));
  const result = await cli(f, 'ask', ['--question', 'Public frame test', '--send', 'chatgpt-web', '--background', '--browser-profile', f.profile, '--response-stable-ms', '100', '--max-wait-ms', String(successfulResponseMs)]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(readFileSync(f.latest().response, 'utf8'), answer);
  assert.equal(f.events().filter(event => event.action === 'submit').length, 1);
});

test('windowless input recognizes ProseMirror cursor placeholders without trimming code', { timeout: 20000 }, async t => {
  const f = fixture(t);
  const { nativeChrome } = await import(pathToFileURL(path.join(distDir, 'providers/native-chrome.js')));
  const { fillWindowlessInput, confirmWindowlessInput } = await import(pathToFileURL(path.join(distDir, 'providers/windowless-input.js')));
  const context = await nativeChrome.launch(path.join(f.root, 'rich-editor'), true);
  try {
    const page = context.pages()[0];
    await page.setContent('<div contenteditable="true" style="white-space:pre-wrap"><p><br></p></div>');
    const input = page.locator('[contenteditable]');
    await input.evaluate(node => node.addEventListener('input', () => {
      const placeholder = document.createElement('br'); placeholder.className = 'ProseMirror-trailingBreak';
      node.firstElementChild.append(placeholder);
    }));
    const text = '  const html = "<p>&</p>";\n\treturn html;\n\n';
    await fillWindowlessInput(input, text);
    assert.equal(await input.innerText(), text + '\n', 'Reproduce the extra editor-only line break');
    await confirmWindowlessInput(input, text);
    for (const change of ['newline', 'indentation', 'code']) {
      await input.evaluate((node, change) => {
        const paragraph = node.firstElementChild;
        if (change === 'newline') paragraph.insertBefore(document.createElement('br'), paragraph.lastChild);
        else paragraph.firstChild.textContent = change === 'indentation' ? ' const html = "<p>&</p>";' : 'changed code';
      }, change);
      await assert.rejects(confirmWindowlessInput(input, text), /text-mismatch/);
      if (change === 'newline') await input.evaluate(node => node.firstElementChild.lastChild.previousSibling.remove());
    }
    // The live site also hydrates the initial textarea into one paragraph per
    // line. The editor document is unchanged even though innerText doubles gaps.
    await input.evaluate((node, text) => {
      node.classList.add('ProseMirror'); node.replaceChildren();
      for (const line of text.split('\n')) {
        const p = document.createElement('p'); p.textContent = line;
        if (!line) { const br = document.createElement('br'); br.className = 'ProseMirror-trailingBreak'; p.append(br); }
        node.append(p);
      }
    }, text);
    assert.notEqual(await input.innerText(), text);
    await confirmWindowlessInput(input, text);
    await input.evaluate(node => node.append(document.createElement('p')));
    await assert.rejects(confirmWindowlessInput(input, text), /text-mismatch/);
    await input.evaluate(node => { node.innerHTML = '<p>one</p><p>two</p>'; });
    assert.equal(await input.innerText(), 'one\n\ntwo');
    await assert.rejects(confirmWindowlessInput(input, 'one\n\ntwo'), /text-mismatch/);
  } finally { await context.close(); }
});

for (const change of ['rewrite', 'overlay', 'late-rewrite']) test(`windowless input ${change} stops before any submission`, { timeout: 20000 }, async t => {
  const f = setup(t);
  const html = readFileSync(f.env.GIVILOOP_TEST_PAGE, 'utf8');
  writeFileSync(f.env.GIVILOOP_TEST_PAGE, html.replace('</body>', change === 'rewrite'
    ? '<script>document.querySelector("#input").addEventListener("input", e => { e.target.value="changed request"; });</script></body>'
    : change === 'late-rewrite'
    ? '<script>const send=document.querySelector("[data-testid=composer-submit-button]"); send.disabled=true; document.querySelector("#input").addEventListener("input", e => { setTimeout(()=>{e.target.value="changed after fill";send.disabled=false;},300); });</script></body>'
    : '<div style="position:fixed;inset:0;z-index:1000;background:white">Blocking overlay</div></body>'));
  const result = await cli(f, 'ask', ['--question', 'Original request', '--send', 'chatgpt-web', '--background', '--browser-profile', f.profile]);
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /BROWSER_INTERACTION_REQUIRED/);
  assert.match(result.stderr, new RegExp(change === 'overlay' ? 'covered' : 'text-mismatch'));
  assert.equal(f.events().filter(event => event.action === 'submit').length, 0);
  const status = JSON.parse(readFileSync(path.join(f.latest().dir, 'browser-status.json')));
  assert.equal(status.submitted, false);
  assert.equal(status.outcome, 'needs-attention');
  assert.equal(existsSync(f.latest().response), false);
});

for (const timing of ['before', 'after', 'quoted']) test(`--background verification failure ${timing} submission is distinguished from a response timeout`, { timeout: 20000 }, async t => {
  const f = setup(t);
  const message = 'An error occurred during verification, please try again.';
  const html = readFileSync(f.env.GIVILOOP_TEST_PAGE, 'utf8');
  const extra = timing === 'after'
    ? `<script>document.querySelector('[data-testid=composer-submit-button]').onclick=()=>{window.captureSubmission({prompt:document.querySelector('#input').value});const p=document.createElement('p');p.textContent=${JSON.stringify(message)};document.body.append(p);};</script>`
    : `<p ${timing === 'quoted' ? 'data-message-role="user"' : ''}>${message}</p>`;
  writeFileSync(f.env.GIVILOOP_TEST_PAGE, html.replace('</body>', extra + '</body>'));
  const result = await cli(f, 'ask', ['--question', message, '--send', 'chatgpt-web', '--background', '--browser-profile', f.profile, '--response-stable-ms', '100', '--max-wait-ms', String(successfulResponseMs)]);
  assert.equal(result.code, timing === 'quoted' ? 0 : 1, result.stderr);
  if (timing !== 'quoted') assert.match(result.stderr, /ACCESS_CHALLENGE/);
  const status = JSON.parse(readFileSync(path.join(f.latest().dir, 'browser-status.json')));
  assert.equal(status.submitted, timing !== 'before');
  assert.equal(status.verificationRequired, timing !== 'quoted');
  assert.equal(f.events().filter(event => event.action === 'submit').length, timing === 'before' ? 0 : 1);
  assert.equal(existsSync(f.latest().response), timing === 'quoted');
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
    "--foreground", "--browser-profile", f.profile, "--verification-wait-ms", "8000", "--response-stable-ms", "100", "--max-wait-ms", String(successfulResponseMs)]);
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
    verificationWaitMs: 20000, background: false,
  } }, undefined, { signal: controller.signal, timeout: 25000 * hostBudget }).then(() => undefined, error => error);
  t.after(() => controller.abort());
  let run, status;
  const deadline = Date.now() + 15000 * hostBudget;
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
  const cleanupDeadline = Date.now() + 5000 * hostBudget;
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
  const result = await cli(f, "ask", ["--question", "Review source", "--file", "code.txt", "--send", "chatgpt-web", "--mode", "auto", "--headless", "--browser-profile", f.profile, "--response-stable-ms", "200", "--max-wait-ms", String(successfulResponseMs)]);
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

for (const variant of [{}, { mediaInputs: true }, { delayedUpload: true, background: true }]) test(`MCP sends a source archive only when uploads are ready${variant.mediaInputs ? "; skips photo/video inputs" : variant.delayedUpload ? "; explicit foreground waits for interactive controls" : ""}`, { timeout: 30_000 }, async t => {
  const f = setup(t, { archive: true, ...variant });
  const prepared = await cli(f, "archive", ["--goal", "Review source", "--no-untracked"]);
  assert.equal(prepared.code, 0, prepared.stderr);
  const client = await connect(t, f);
  const result = await client.callTool({ name: "givi_send_to_web_llm", arguments: {
    repositoryPath: f.repo, runId: f.latest().id, mode: "auto", headless: !variant.background, background: false,
    browserProfile: f.profile, responseStableMs: 200, maxWaitMs: successfulResponseMs,
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
  const result = await cli(f, "ask", ["--question", "Review", "--send", "chatgpt-web", "--mode", "auto", "--headless", "--browser-profile", f.profile, "--response-stable-ms", "100", "--max-wait-ms", String(successfulResponseMs)]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(readFileSync(f.latest().response, "utf8"), answer);
});

for (const visibility of ['--headless', '--background']) test(`required model ${visibility} selects and confirms the exact label, ignoring unrelated buttons and longer labels`, { timeout: 30_000 }, async t => {
  const f = setup(t, { model: true });
  const result = await cli(f, "ask", ["--question", "Review", "--send", "chatgpt-web", "--mode", "auto", visibility, "--browser-profile", f.profile, "--model", "GPT Pro", "--require-model", "--response-stable-ms", "100", "--max-wait-ms", String(successfulResponseMs)]);
  assert.equal(result.code, 0, result.stderr);
  const submissions = f.events().filter(event => event.action === "submit");
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].model, "GPT Pro");
});

for (const [name, options, error] of [
  ["unavailable exact model", { missingModel: true }, "MODEL_UNAVAILABLE"],
  ["model selection without confirmation", { confirmModel: false }, "MODEL_SELECTION_UNCONFIRMED"],
]) {
  for (const visibility of ['--headless', '--background']) test(`required ${name} ${visibility} fails before sending`, { timeout: 30_000 }, async t => {
    const f = setup(t, { model: true, ...options });
    const result = await cli(f, "ask", ["--question", "Review", "--send", "chatgpt-web", "--mode", "auto", visibility, "--browser-profile", f.profile, "--model", "GPT Pro", "--require-model"]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, new RegExp(error));
    assert.equal(f.events().filter(event => event.action === "submit").length, 0);
    const status = JSON.parse(readFileSync(path.join(f.latest().dir, "browser-status.json"), "utf8"));
    assert.equal(status.submitted, false);
  });
}

for (const visibility of ['--headless', '--background']) test(`preferred unavailable model ${visibility} reports fallback and dismisses the menu before sending`, { timeout: 30_000 }, async t => {
  const f = setup(t, { model: true, missingModel: true });
  const result = await cli(f, "ask", ["--question", "Review", "--send", "chatgpt-web", "--mode", "auto", visibility, "--browser-profile", f.profile, "--model", "GPT Pro", "--response-stable-ms", "100", "--max-wait-ms", String(successfulResponseMs)]);
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout + result.stderr, /currently selected ChatGPT model/);
  const submissions = f.events().filter(event => event.action === "submit");
  assert.equal(submissions.length, 1);
  assert.equal(submissions[0].model, "GPT Base");
  assert.equal(submissions[0].menuOpen, false);
});

for (const provider of ['claude-web', 'deepseek-web']) {
  for (const incomplete of [false, true]) test(`${provider}: live-shaped sibling toolbar ${incomplete ? 'cannot complete a partial answer' : 'confirms only final answer text'}`, {timeout:30000}, async t => {
    const f=otherFixture(t,webCases.find(c=>c.provider===provider),incomplete);
    const html=readFileSync(f.env.GIVILOOP_TEST_PAGE,'utf8');
    const shape=provider==='claude-web' ? `
      item.setAttribute('data-testid','assistant-message');
      const row=document.createElement('div');row.className='group/message-row';item.replaceWith(row);row.append(item);
      const content=item.querySelector('.font-claude-response');content.textContent='';
      const thinking=document.createElement('div');thinking.textContent='THINKING MUST NOT BE SAVED';content.append(thinking);
      const final=document.createElement('div');final.setAttribute('data-perf-reply-text','');final.textContent=${JSON.stringify(answer)};content.append(final);
      const code=document.createElement('button');code.setAttribute('aria-label','Copia negli appunti');content.append(code);
      ${incomplete ? '' : `setTimeout(()=>{const toolbar=document.createElement('div');const copy=document.createElement('button');copy.dataset.testid='action-bar-copy';copy.textContent='Copia';toolbar.append(copy);row.append(toolbar);},1000);`}
    ` : `
      item.querySelector('.ds-markdown').classList.add('ds-assistant-message-main-content');
      const row=document.createElement('div');item.replaceWith(row);row.append(item);
      const toolbar=document.createElement('div');row.append(toolbar);
      for(const label of ${JSON.stringify(incomplete ? ['Copy code','Copia'] : ['Copia','Rigenera'])}) {
        const b=document.createElement('div');b.setAttribute('role','button');b.textContent='icon';toolbar.append(b);
        b.onmouseenter=()=>{document.querySelector('.ds-tooltip')?.remove();const tip=document.createElement('div');tip.className='ds-tooltip';tip.textContent=label;document.body.append(tip);};
        b.onmouseleave=()=>document.querySelector('.ds-tooltip')?.remove();
      }
    `;
    writeFileSync(f.env.GIVILOOP_TEST_PAGE,html.replace("const codeCopy=document.createElement('button');",shape+"const codeCopy=document.createElement('button');")
      .replace("copy.setAttribute('aria-label','Copy response')", "copy.setAttribute('aria-label','Copy code')")
      .replace("retry.setAttribute('aria-label','Regenerate')", "retry.setAttribute('aria-label','Unrelated')"));
    const sent=await cli(f,'ask',['--send',provider,'--question','Review','--mode','auto','--headless','--browser-profile',f.profile,'--response-stable-ms','100','--max-wait-ms',incomplete?'2500':'6000']);
    assert.equal(sent.code,incomplete?1:0,sent.stderr);
    if(incomplete)assert.equal(existsSync(f.latest().response),false);
    else assert.equal(readFileSync(f.latest().response,'utf8'),answer);
    assert.equal(f.events().filter(e=>e.action==='submit').length,1);
  });
}

test('Claude optional-cookie dialog is rejected before the sole send', {timeout:30000}, async t=>{
  const f=otherFixture(t,webCases[1]);
  const html=readFileSync(f.env.GIVILOOP_TEST_PAGE,'utf8');
  writeFileSync(f.env.GIVILOOP_TEST_PAGE,html.replace('</body>','<div role="dialog" style="position:fixed;inset:0;background:white"><button data-testid="consent-reject" onclick="this.parentElement.remove()">Rifiuta</button></div></body>'));
  const sent=await cli(f,'ask',['--send','claude-web','--question','Review','--mode','auto','--headless','--browser-profile',f.profile,'--response-stable-ms','100','--max-wait-ms',String(successfulResponseMs)]);
  assert.equal(sent.code,0,sent.stderr);
  assert.equal(f.events().filter(e=>e.action==='submit').length,1);
  assert.equal(readFileSync(f.latest().response,'utf8'),answer);
});

test('native maximized window can enter background mode and closes cleanly', {timeout:30000}, async t=>{
  const f=fixture(t),profile=path.join(f.root,'maximized-profile');
  const {launchChatBrowser,minimizeBrowser,profileOwnerPid}=await import(pathToFileURL(path.join(distDir,'providers/browser-runtime.js')));
  const c=await launchChatBrowser(profile,false);
  try {
    const p=c.pages()[0]||await c.newPage();const session=await c.newCDPSession(p);
    const {windowId}=await session.send('Browser.getWindowForTarget');
    await session.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'maximized'}});
    for(let i=0;i<30;i++){if((await session.send('Browser.getWindowBounds',{windowId})).bounds.windowState==='maximized')break;await p.waitForTimeout(100);}
    assert.equal((await session.send('Browser.getWindowBounds',{windowId})).bounds.windowState,'maximized');
    await minimizeBrowser(c,p);
    assert.equal((await session.send('Browser.getWindowBounds',{windowId})).bounds.windowState,'minimized');
    await session.detach();
  }finally{await c.close();}
  assert.equal(profileOwnerPid(profile),undefined);
});

test('native background pages have no OS window across restart, new pages and concurrent launches', {timeout:120000}, async t=>{
  const f=fixture(t),profile=path.join(f.root,'background-start-profile');
  const {launchChatBrowser,profileOwnerPid,minimizeBrowser,showBrowser}=await import(pathToFileURL(path.join(distDir,'providers/browser-runtime.js')));
  const previousAttach=process.env.PW_CHROMIUM_ATTACH_TO_OTHER;
  for(let cycle=0;cycle<10;cycle++) {
    const contexts=await Promise.allSettled([profile,path.join(f.root,'parallel-profile')].map(p=>launchChatBrowser(p,false,true)));
    try {
      for(const result of contexts) assert.equal(result.status,'fulfilled',`Restart ${cycle}: ${String(result.reason)}`);
      for(const {value:c} of contexts) {
        const pages=c.pages();assert.equal(pages.length,1);assert.equal(pages[0].url(),'about:blank');
        const p=pages[0];
        const session=await c.newCDPSession(p);
        await assert.rejects(session.send('Browser.getWindowForTarget'),/No window found|Browser window not found/);
        await session.detach();
        await minimizeBrowser(c,p);
        await assert.rejects(showBrowser(c,p),/BROWSER_INTERACTION_REQUIRED/);
        if(cycle===0) await c.addCookies([{name:'windowless-session',value:'persistent',url:'https://example.test/',secure:true,httpOnly:true,expires:Math.floor(Date.now()/1000)+3600}]);
        assert.equal((await c.cookies('https://example.test/')).find(c=>c.name==='windowless-session')?.value,'persistent');
        for(let pageIndex=0;pageIndex<5;pageIndex++) {
          const next=await c.newPage();
          await minimizeBrowser(c,next);
          await next.close();
        }
      }
      assert.equal(process.env.PW_CHROMIUM_ATTACH_TO_OTHER,previousAttach,'Concurrent launches must restore the caller environment');
    } finally { await Promise.all(contexts.filter(c=>c.status==='fulfilled').map(c=>c.value.close())); }
    assert.equal(profileOwnerPid(profile),undefined);
    assert.equal(JSON.parse(readFileSync(path.join(profile,'Default','Preferences'))).profile.exit_type,'Normal');
  }
});

test('native background pages ignore a target closed during discovery', {timeout:30000}, async t=>{
  const f=fixture(t);
  const {launchChatBrowser,minimizeBrowser}=await import(pathToFileURL(path.join(distDir,'providers/browser-runtime.js')));
  const context=await launchChatBrowser(path.join(f.root,'closing-candidate'),false,true);
  const creator=await context.browser().newBrowserCDPSession();
  const previousAttach=process.env.PW_CHROMIUM_ATTACH_TO_OTHER;
  const attach=context.newCDPSession.bind(context);
  try {
    process.env.PW_CHROMIUM_ATTACH_TO_OTHER='1';
    const pending=context.waitForEvent('page',{timeout:5000});
    const {targetId}=await creator.send('Target.createTarget',{url:'about:blank',hidden:true,background:true});
    const stale=await pending;
    if(previousAttach===undefined) delete process.env.PW_CHROMIUM_ATTACH_TO_OTHER;
    else process.env.PW_CHROMIUM_ATTACH_TO_OTHER=previousAttach;
    let raced=false;
    context.newCDPSession=async page=>{
      if(page===stale&&!raced) {
        raced=true;
        await creator.send('Target.closeTarget',{targetId});
      }
      return attach(page);
    };
    const page=await context.newPage();
    assert.equal(raced,true,'Close an unregistered candidate between enumeration and CDP attachment');
    assert.notEqual(page,stale);
    await minimizeBrowser(context,page);
    assert.equal(context.pages().length,2);
    assert.equal(process.env.PW_CHROMIUM_ATTACH_TO_OTHER,previousAttach);
  } finally {
    if(previousAttach===undefined) delete process.env.PW_CHROMIUM_ATTACH_TO_OTHER;
    else process.env.PW_CHROMIUM_ATTACH_TO_OTHER=previousAttach;
    context.newCDPSession=attach;
    await creator.detach().catch(()=>{});
    await context.close();
  }
});
