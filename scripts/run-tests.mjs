// cmd.exe does not expand globs, and Node 20's test runner does not either.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { browserTestEnvironment } from './test-visibility.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const browser = process.argv.includes('--browser');
const foreground = process.argv.includes('--foreground');
if (foreground && !browser) throw new Error('--foreground requires --browser');
const env = browserTestEnvironment(foreground);
const directory = browser ? 'test/browser' : 'test';
const files = readdirSync(path.join(root, directory)).filter(name => name.endsWith('.test.mjs')).sort();
if (!files.length) throw new Error('No test files found');
const result = spawnSync(process.execPath, ['--test', ...(browser ? ['--test-concurrency=1'] : []),
  ...process.argv.slice(2).filter(arg => arg !== '--browser' && arg !== '--foreground'), ...files.map(name => path.join(directory, name))],
{ cwd: root, stdio: 'inherit', env });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
