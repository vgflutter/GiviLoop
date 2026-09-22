// Records a real review in a documentation-only terminal view, not the desktop.
// Prerequisites: built GiviLoop, Chrome, ffmpeg, Playwright's recording binary,
// and a signed-in dedicated Claude GiviLoop profile. Sends only public sum.ts.
// The false claim is explicitly labeled as an author-supplied control.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const output = path.join(root, '.giviloop/diagnostics/adoption-demo');
mkdirSync(output, { recursive: true });
const repo = mkdtempSync(path.join(os.tmpdir(), 'giviloop-public-demo-'));
for (const name of ['sum.ts', 'verify.mjs']) copyFileSync(path.join(root, 'examples/double-check', name), path.join(repo, name));
const source = readFileSync(path.join(repo, 'sum.ts'), 'utf8');
const sourceHash = createHash('sha256').update(source).digest('hex');
const env = { ...process.env, GIVILOOP_ALLOWED_REPOSITORIES: repo };
const recorderServer = await chromium.launchServer({ channel: 'chrome', headless: true, chromiumSandbox: true });
// The recorder also owns its Chrome pipes. A surviving Chrome helper must not
// keep Playwright waiting for EOF after the recorder browser itself has exited.
const recorderProcess = recorderServer.process();
recorderProcess.once('exit', () => { recorderProcess.stdout?.destroy(); recorderProcess.stderr?.destroy(); });
const browser = await chromium.connect(recorderServer.wsEndpoint());
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: output, size: { width: 1280, height: 800 } } });
const page = await context.newPage();
const video = page.video();
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let activeChild;
async function scene(step, title, subtitle, text) {
  console.log(step);
  await page.evaluate(({ step, title, subtitle, text }) => {
    document.querySelector('#step').textContent = step;
    document.querySelector('h1').textContent = title;
    document.querySelector('#subtitle').textContent = subtitle;
    document.querySelector('pre').textContent = text;
    document.querySelector('pre').scrollTop = 0;
  }, { step, title, subtitle, text });
}
function run(args, onOutput) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    activeChild = child;
    let text = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 240_000);
    const collect = chunk => { text += chunk.toString(); onOutput?.(text.replaceAll(repo, '.')); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.once('error', error => { clearTimeout(timer); activeChild = undefined; reject(error); });
    child.once('exit', code => { clearTimeout(timer); activeChild = undefined; code === 0 ? resolve(text) : reject(new Error(`Demo command exited ${code}: ${text}`)); });
  });
}
try {
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box}body{margin:0;background:#0b1020;color:#e7edf6;font-family:-apple-system,BlinkMacSystemFont,Arial,sans-serif;padding:38px 52px}
    header{display:flex;justify-content:space-between;align-items:center;color:#83e4ca;font-size:19px;letter-spacing:.04em}header strong{font-size:24px;color:white}
    h1{font-size:40px;line-height:1.15;margin:25px 0 10px;font-weight:650}#subtitle{font-size:19px;color:#acb8cd;margin:0 0 24px;min-height:24px}
    .terminal{background:#131c2e;border:1px solid #34405b;border-radius:14px;overflow:hidden;box-shadow:0 16px 40px #0005}.bar{padding:13px 20px;border-bottom:1px solid #34405b;color:#91a1ba;font:15px monospace;display:flex;justify-content:space-between}
    pre{margin:0;padding:24px;white-space:pre-wrap;overflow-wrap:anywhere;font:19px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;height:440px;overflow:hidden;color:#e0e8f2}
    footer{margin-top:22px;display:flex;justify-content:space-between;color:#a6b3ca;font-size:16px}#step{color:#83e4ca}.dot{color:#83e4ca}#play{display:none;position:absolute;right:90px;bottom:160px;background:#83e4ca;color:#071c1a;padding:16px 26px;border-radius:40px;font-size:23px;font-weight:650}
  </style></head><body><header><strong>GiviLoop</strong><span>DOUBLE CHECK</span></header>
  <h1></h1><p id="subtitle"></p><div class="terminal"><div class="bar"><span><span class="dot">●</span> Terminal · documentation view</span><span>Real commands and output</span></div><pre></pre></div>
  <footer><span id="step"></span><span>Public example · live Claude review · no API key</span></footer><div id="play">▶ Watch the real run</div></body></html>`);
  const setup = JSON.parse(await run([path.join(root, 'dist/cli.js'), 'setup', '--repo', repo, '--provider', 'claude-web', '--non-interactive']));
  assert.equal(setup.prerequisitesReady, true);
  await scene('1 / 6 · Guided setup', 'A second review. Evidence you can keep.', 'GiviLoop ' + version + ' · Real CLI/MCP output in a documentation view.', '$ givi setup --provider claude-web --non-interactive\n\n' + JSON.stringify({ provider: setup.provider, prerequisitesReady: setup.prerequisitesReady, access: setup.access, mcpConfigPath: '.giviloop/mcp.json' }, null, 2) + '\n\nMCP entry generated; editor settings untouched.\nDedicated Claude profile already signed in for this demo.');
  await pause(1000);
  await page.locator('#play').evaluate(el => el.style.display = 'block');
  await page.screenshot({ path: path.join(output, 'double-check-preview.png') });
  await page.locator('#play').evaluate(el => el.style.display = 'none');
  await pause(4000);
  const question = 'Find a concrete bug, the smallest fix and regression tests. Keep the answer under 120 words.';
  const command = '$ givi ask --repo . --file sum.ts \\\n    --question "Find a concrete bug, the smallest fix and regression tests. Keep the answer under 120 words." \\\n    --send claude-web --mode auto --background';
  await scene('2 / 6 · Automatic background review', 'Send the file. Keep the review.', 'Chrome uses the dedicated session. GiviLoop waits for the completed answer.', command + '\n\nStarting…');
  const started = Date.now();
  let liveText = '', rendering = false;
  const ticker = setInterval(async () => {
    if (rendering) return; rendering = true;
    try { await page.locator('pre').evaluate((el, text) => el.textContent = text, command + '\n\n' + liveText + '\nWaiting for the review… ' + Math.floor((Date.now() - started) / 1000) + 's'); }
    finally { rendering = false; }
  }, 500);
  let stdout;
  try { stdout = await run([path.join(root, 'dist/cli.js'), 'ask', '--repo', repo, '--file', 'sum.ts', '--question', question, '--send', 'claude-web', '--mode', 'auto', '--background'], text => { liveText = text; }); }
  finally { clearInterval(ticker); while (rendering) await pause(20); }
  const durationMs = Date.now() - started;
  const runId = readFileSync(path.join(repo, '.giviloop/latest-run-id'), 'utf8').trim();
  const runDir = path.join(repo, '.giviloop/runs', runId);
  const response = readFileSync(path.join(runDir, 'external-review-response.md'), 'utf8');
  const status = JSON.parse(readFileSync(path.join(runDir, 'browser-status.json'), 'utf8'));
  assert.equal(status.outcome, 'completed'); assert.equal(status.submitted, true);
  assert.match(response, /reduce/); assert.match(response, /empty|sum\(\[\]\)/i);
  await scene('2 / 6 · Saved response', 'The answer stays with its request.', 'Completed in ' + (durationMs / 1000).toFixed(1) + 's. Website token usage is not reported.', stdout.replaceAll(repo, '.') + '\n\nRequest and response saved under the same run ID.');
  await pause(4000);
  const client = new Client({ name: 'giviloop-demo', version: '1.0.0' }, { capabilities: {} });
  let toolResult;
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/mcp-server.js')], env, stderr: 'pipe' }));
    toolResult = await client.callTool({ name: 'givi_read_external_review', arguments: { repositoryPath: repo, runId, reviewResponseMode: 'analyze-only' } });
    assert.notEqual(toolResult.isError, true);
    assert.ok(toolResult.content.some(item => item.type === 'text' && item.text.includes(response)));
  } finally { await client.close(); }
  await scene('3 / 6 · MCP handoff', 'Bring the review back to your agent.', 'Actual saved response excerpt. The agent still needs to verify the advice.', 'MCP: givi_read_external_review\nreviewResponseMode: "analyze-only"\nPASS: MCP returned the saved answer for this run.\n\n' + response.slice(0, 660) + (response.length > 660 ? '\n[excerpt continues in the saved response]' : ''));
  await page.locator('pre').evaluate(el => el.style.fontSize = '17px');
  await pause(10000);
  const verification = await run([path.join(repo, 'verify.mjs')]);
  assert.match(verification, /4 regression cases passed/);
  assert.equal(readFileSync(path.join(repo, 'sum.ts'), 'utf8'), source);
  await page.locator('pre').evaluate(el => el.style.fontSize = '19px');
  await scene('4 / 6 · Independent verification', 'Advice checked against executable cases.', 'This example script runs separately from GiviLoop. It does not execute model output.', '$ node verify.mjs\n\n' + verification);
  await pause(10000);
  const evidenceClient = new Client({ name: 'giviloop-demo-evidence', version: '1.0.0' });
  let confirmed, dismissed, recheck, stale;
  // Deliberately authored negative control. This is NOT attributed to Claude.
  const loadFixture = text => new Function(text.replace('export function', 'function').replaceAll(': number[]', '').replaceAll(': number', '') + '; return sum;')();
  assert.equal(loadFixture(source)([-2, 3, -1]), 0);
  try {
    await evidenceClient.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/mcp-server.js')], env, stderr: 'pipe' }));
    const call = async (name, args) => {
      const result = await evidenceClient.callTool({ name, arguments: { repositoryPath: repo, runId, ...args } });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      return JSON.parse(result.content.find(c => c.type === 'text').text);
    };
    confirmed = await call('givi_record_finding', { title: 'Empty sum throws', claim: 'sum([]) throws; contract requires 0.', status: 'confirmed', files: ['sum.ts', 'verify.mjs'], reason: 'Independent fixture script reproduced the exception.', evidence: [verification.trim()] });
    dismissed = await call('givi_record_finding', { title: 'Author-supplied false-claim control', claim: 'Negative numbers break addition (synthetic control, not a Claude finding).', status: 'dismissed', files: ['sum.ts'], reason: 'Negative numbers are allowed by number[] and the independent case passes.', evidence: ['Independent assertion: sum([-2,3,-1]) === 0 passed on the original fixture.'] });
    const ledger = await call('givi_list_findings', {});
    assert.deepEqual(ledger.findings.map(f => f.effectiveStatus), ['confirmed', 'dismissed']);
    await scene('5 / 6 · Persist evidence through MCP', 'Keep the bug. Dismiss the false claim.', 'The false claim is an author-supplied control, NOT a Claude finding.', 'MCP: givi_record_finding → givi_list_findings\n\n' + JSON.stringify(ledger.findings.map(f => ({ id: f.id, title: f.title, status: f.effectiveStatus, evidence: f.history.at(-1).evidence[0].split('\n')[0] })), null, 2));
    await page.locator('pre').evaluate(el => el.style.fontSize = '16px');
    await pause(11000);
    // Apply only the independently checked, author-selected one-line correction
    // to the temporary demo copy, never to the actual example or model text.
    writeFileSync(path.join(repo, 'sum.ts'), source.replace('total + value)', 'total + value, 0)'));
    stale = await call('givi_list_findings', {});
    assert.equal(stale.findings[0].stale, true);
    assert.equal(stale.findings[0].effectiveStatus, 'unverified');
    recheck = await call('givi_prepare_recheck', { findingId: confirmed.findingId });
    assert.equal(recheck.submitted, false);
    assert.match(readFileSync(recheck.requestPath, 'utf8'), /total \+ value, 0/);
    await scene('6 / 6 · Snapshot-aware recheck', 'Code changed? Revisit the conclusion.', 'Correction applied only to the temporary demo copy. Nothing is sent automatically.', 'Applied: values.reduce((total, value) => total + value, 0)\n\nMCP: givi_list_findings\n  previous status: confirmed\n  effective status: unverified\n  stale: true — sum.ts changed\n\nMCP: givi_prepare_recheck\n  new run linked to the original finding\n  updated source attached\n  submitted: false\n\nInspect, send, verify again. Previous decisions stay saved.');
    await page.locator('pre').evaluate(el => el.style.fontSize = '19px');
    await pause(10000);
  } finally { await evidenceClient.close(); }
  assert.equal(createHash('sha256').update(readFileSync(path.join(root, 'examples/double-check/sum.ts'))).digest('hex'), sourceHash);
  await scene('Complete · GiviLoop ' + version, 'Review. Verify. Keep the evidence.', 'Choose your reviewer. Avoid an additional review API call where applicable.', '✓ Setup and MCP configuration generated\n✓ Live Claude review saved and read through MCP\n✓ Real bug confirmed with independent assertions\n✓ Author-supplied false claim dismissed\n✓ Source change marked previous assessment stale\n✓ Targeted recheck prepared with current source\n\nWeb access is experimental; terms and quotas apply.\nTotal token savings are not measured.\n\ngithub.com/vgflutter/GiviLoop');
  await pause(7000);
  const report = { version, provider: 'claude-web', runId, durationMs, verificationRequired: status.verificationRequired, sourceHash, repositoryExampleUnchanged: true, temporaryDemoCopyCorrected: true, mcpReadCompleted: true, confirmedFinding: confirmed.findingId, falseClaimControl: { id: dismissed.findingId, origin: 'author-supplied, not provider output' }, proposedFixCases: 4, recheckRunId: recheck.runId, recheckSubmitted: false, staleDetectionPassed: true, webTokens: null };
  writeFileSync(path.join(output, 'demo-run.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(path.join(output, 'demo-response.md'), response);
  writeFileSync(path.join(output, 'demo-verification.txt'), verification);
  await context.close();
  await video.saveAs(path.join(output, 'giviloop-double-check.webm'));
  await browser.close(); await recorderServer.close();
  execFileSync('ffmpeg', ['-y', '-i', path.join(output, 'giviloop-double-check.webm'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(output, 'giviloop-double-check.mp4')], { stdio: 'ignore' });
  console.log(JSON.stringify(report, null, 2));
} finally {
  activeChild?.kill('SIGTERM');
  await context.close().catch(() => {}); await browser.close().catch(() => {});
  await recorderServer.close().catch(() => {});
  rmSync(repo, { recursive: true, force: true });
}
