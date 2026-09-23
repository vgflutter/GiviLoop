import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Cooperative cancellation targets a run nonce, never an arbitrary OS PID. */
export function runControl(directory: string, external?: AbortSignal) {
  const token = randomUUID();
  const controller = new AbortController();
  const signal = external ? AbortSignal.any([external, controller.signal]) : controller.signal;
  const file = path.join(directory, "review-control.json");
  const timer = setInterval(() => {
    try {
      if (existsSync(file)) {
        const command = JSON.parse(readFileSync(file, "utf8"));
        if (command.token === token && command.action === "cancel") controller.abort();
      }
    } catch { /* An incomplete or unrelated control file cannot cancel a run. */ }
  }, 250);
  timer.unref();
  return { token, signal, dispose: () => clearInterval(timer) };
}
