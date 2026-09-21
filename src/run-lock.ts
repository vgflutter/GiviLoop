import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** One writer per review, shared by browser and local transports. */
export function acquireRunLock(directory: string, provider: string): () => void {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "review.lock");
  let descriptor: number;
  try { descriptor = openSync(file, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`[REVIEW_RUN_BUSY] This review already has a writer. Check ${file}; remove a stale lock only after its recorded process has stopped.`);
    }
    throw error;
  }
  const token = randomUUID();
  try {
    writeFileSync(descriptor, JSON.stringify({ pid: process.pid, provider, token, startedAt: new Date().toISOString() }) + "\n");
  } catch (error) {
    rmSync(file, { force: true });
    throw error;
  } finally { closeSync(descriptor); }
  return () => {
    try {
      if (JSON.parse(readFileSync(file, "utf8")).token === token) rmSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
}
