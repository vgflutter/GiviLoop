import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.env.npm_execpath;
if (!npm) throw new Error("Run this check with npm run test:package.");
const temporary = mkdtempSync(path.join(os.tmpdir(), "giviloop-package-"));
function run(command, args, options = {}) {
  try { return execFileSync(command, args, { cwd: root, encoding: "utf8", timeout: 120000, maxBuffer: 8_000_000, ...options }); }
  catch (error) {
    console.error(String(error.stdout ?? "").slice(-8000));
    console.error(String(error.stderr ?? "").slice(-4000));
    throw error;
  }
}
try {
  const [pack] = JSON.parse(run(process.execPath, [npm, "pack", "--json", "--pack-destination", temporary]));
  for (const { path: name } of pack.files) {
    assert.ok(name.startsWith("dist/") || ["README.md", "LICENSE", "package.json", "docs/accesso-provider.md", "docs/troubleshooting.md", "docs/release-readiness-2026-09-21.md", "CONTRIBUTING.md", "docs/ollama.md", "docs/dwarfstar.md", "docs/local-inference-validation-2026-09-21.md", "docs/local-engines.md", "docs/production-validation-2026-09-21.md", "docs/chatgpt-403-resolution-2026-09-21.md", "docs/usage.md", "docs/double-check.md", "docs/roadmap.md", "examples/double-check/sum.ts", "docs/costs-and-access.md", "docs/releases/0.3.0.md", "docs/releases/0.3.1.md", "docs/demo.md", "docs/e2e-validation-2026-09-21.md", "examples/double-check/verify.mjs"].includes(name), `Unexpected package file: ${name}`);
  }
  for (const required of ["README.md", "LICENSE", "package.json", ...JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).files.filter(name => !name.endsWith("/") && path.extname(name))]) {
    assert.ok(pack.files.some(file => file.path === required), `Missing package file: ${required}`);
  }
  const consumer = path.join(temporary, "consumer"); mkdirSync(consumer);
  writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ name: "giviloop-package-check", version: "1.0.0", private: true }));
  const archive = path.join(temporary, pack.filename);
  run(process.execPath, [npm, "install", "--omit=dev", archive], { cwd: consumer });
  const installed = path.join(consumer, "node_modules/giviloop");
  const dist = path.join(installed, "dist");
  const manifest = JSON.parse(readFileSync(path.join(installed, "package.json"), "utf8"));
  for (const [name, file] of Object.entries(manifest.bin)) {
    assert.ok(existsSync(path.join(installed, file)), `Missing ${name} entry point`);
    if (process.platform !== "win32") assert.ok(existsSync(path.join(consumer, "node_modules/.bin", name)));
  }
  const cli = process.platform === "win32" ? process.execPath : path.join(consumer, "node_modules/.bin/givi");
  const prefix = process.platform === "win32" ? [path.join(dist, "cli.js")] : [];
  assert.equal(run(cli, [...prefix, "--version"], { cwd: consumer }).trim(), manifest.version);
  assert.ok(run(cli, [...prefix, "help"], { cwd: consumer }).includes("--background"));
  assert.match(run(process.execPath, [path.join(installed, "examples/double-check/verify.mjs")], { cwd: consumer }), /4 regression cases passed/);
  const tests = readdirSync(path.join(root, "test")).filter(name => name.endsWith(".test.mjs")).map(name => path.join("test", name));
  const env = { ...process.env, GIVILOOP_TEST_DIST_DIR: dist };
  const unitOutput = run(process.execPath, ["--test", "--test-reporter=tap", ...tests], { env });
  const browser = process.argv.includes("--browser");
  const browserOutput = browser ? run(process.execPath, ["--test", "--test-reporter=tap", "--test-concurrency=1", "test/browser/roundtrip.test.mjs"], { env }) : "";
  const audit = JSON.parse(run(process.execPath, [npm, "audit", "--json"], { cwd: consumer }));
  const report = {
    version: manifest.version, files: pack.files.map(item => item.path), archiveBytes: pack.size,
    sha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
    unitTests: Number(/# pass (\d+)/.exec(unitOutput)?.[1]),
    browserTests: browser ? Number(/# pass (\d+)/.exec(browserOutput)?.[1]) : 0,
    auditVulnerabilities: audit.metadata.vulnerabilities.total,
    platform: process.platform, node: process.version, checkedAt: new Date().toISOString(),
  };
  assert.ok(Number.isSafeInteger(report.unitTests) && report.unitTests > 0, "Missing unit test count");
  if (browser) assert.ok(Number.isSafeInteger(report.browserTests) && report.browserTests > 0, "Missing browser test count");
  const releases = path.join(root, ".giviloop/releases"); mkdirSync(releases, { recursive: true });
  copyFileSync(archive, path.join(releases, pack.filename));
  writeFileSync(path.join(releases, "release-checks.json"), JSON.stringify(report, null, 2) + "\n");
  writeFileSync(path.join(releases, "package-unit-tests.tap"), unitOutput);
  if (browser) writeFileSync(path.join(releases, "package-browser-tests.tap"), browserOutput);
  console.log(JSON.stringify(report, null, 2));
} finally { rmSync(temporary, { recursive: true, force: true, maxRetries: 3 }); }
