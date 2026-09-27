import { TASKS } from './token-tasks.mjs';
import { pathToFileURL } from 'node:url';
try {
  const task = TASKS.find(t => t.id === process.argv[2]);
  if (!task) throw new Error('Unknown task');
  console.log(JSON.stringify(await task.grade(await import(pathToFileURL(process.argv[3]).href))));
} catch (error) {
  console.log(JSON.stringify({passed:false,error:error.message}));
  process.exitCode = 1;
}
