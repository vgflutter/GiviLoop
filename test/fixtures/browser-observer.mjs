// Optional acceptance-test observer hook. Capture only owned Chrome launch PIDs,
// never command text, endpoints, cookies, prompts or arbitrary process metadata.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { appendFileSync } from 'node:fs';

const output = process.env.GIVILOOP_TEST_OBSERVER_PIDS;
if (output) {
  const original = childProcess.spawn;
  childProcess.spawn = function(command, args, options) {
    const child = original.call(this, command, args, options);
    if (Array.isArray(args) && args.some(arg => arg.startsWith('--remote-debugging-port=')) &&
        args.some(arg => arg.startsWith('--user-data-dir=')) && child.pid) {
      appendFileSync(output, `${child.pid}\n`);
    }
    return child;
  };
  syncBuiltinESMExports();
}
