// cmd.exe does not expand globs, and Node 20's test runner does not either.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const browser = process.argv.includes('--browser');
const directory = browser ? 'test/browser' : 'test';
const files = readdirSync(path.join(root, directory)).filter(name => name.endsWith('.test.mjs')).sort();
if (!files.length) throw new Error('No test files found');
const result = spawnSync(process.execPath, ['--test', ...(browser ? ['--test-concurrency=1'] : []),
  ...process.argv.slice(2).filter(arg => arg !== '--browser'), ...files.map(name => path.join(directory, name))],
{ cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
