import { execFile, type ChildProcess } from "node:child_process";

/** Last resort after cooperative shutdown, scoped to our still-running child. */
export async function terminateOwnedWindowsTree(child: ChildProcess): Promise<void> {
  if (process.platform !== "win32") throw new Error("Windows process cleanup is only supported on Windows.");
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  // Node's Windows SIGTERM/SIGKILL terminate only the root process. Chrome's
  // renderer/utility descendants can keep resources alive. Never use /IM or
  // kill all Chrome instances: this PID comes directly from our spawn handle.
  await new Promise<void>(resolve => {
    execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"],
      { windowsHide: true, timeout: 5000 }, () => resolve());
  });
  // The caller still awaits the child's real exit and reports failure if it
  // stays alive, including when taskkill races with a natural exit or fails.
}
