import fs from "node:fs/promises";
import { UserFacingError } from "./errors.js";

const STALE_LOCK_MS = 10 * 60 * 1000;

export async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  const release = await acquireLock(lockPath);
  try {
    return await fn();
  } finally {
    await release();
  }
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  try {
    const handle = await fs.open(lockPath, "wx", 0o600);
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    await handle.close();
    return async () => {
      await fs.rm(lockPath, { force: true });
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw new UserFacingError(`Failed to acquire lock: ${(error as Error).message}`);
    }
  }

  if (await removeIfStale(lockPath)) return acquireLock(lockPath);
  throw new UserFacingError("Another opencode-as operation is already running. Remove a stale lock only if no operation is active.");
}

async function removeIfStale(lockPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(lockPath);
    if (Date.now() - stat.mtimeMs < STALE_LOCK_MS) return false;
    await fs.rm(lockPath, { force: true });
    return true;
  } catch {
    return false;
  }
}
