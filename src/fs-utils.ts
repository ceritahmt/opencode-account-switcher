import fs from "node:fs/promises";
import path from "node:path";
import { UserFacingError } from "./errors.js";

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureSecureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true, mode: 0o700 });
  await chmodOrFail(dirPath, 0o700, "directory");
}

export async function chmodOrFail(filePath: string, mode: number, kind: string): Promise<void> {
  if (process.platform === "win32") return;

  try {
    await fs.chmod(filePath, mode);
  } catch (error) {
    throw new UserFacingError(`Failed to set secure permissions on ${kind}: ${(error as Error).message}`);
  }
}

export async function readTextFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new UserFacingError(`Failed to read file: ${(error as Error).message}`);
  }
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readTextFile(filePath);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new UserFacingError(`Invalid JSON file: ${path.basename(filePath)}`);
  }
}

export async function atomicWriteFile(filePath: string, content: string | Buffer, mode = 0o600): Promise<void> {
  const dir = path.dirname(filePath);
  await ensureSecureDir(dir);

  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  let handle: fs.FileHandle | undefined;

  try {
    handle = await fs.open(tempPath, "wx", mode);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await chmodOrFail(tempPath, mode, "file");
    await fs.rename(tempPath, filePath);
    await fsyncDirectory(dir);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError(`Failed to write file safely: ${(error as Error).message}`);
  }
}

export async function fsyncDirectory(dirPath: string): Promise<void> {
  if (process.platform === "win32") return;

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(dirPath, "r");
    await handle.sync();
  } catch {
    // Some filesystems do not allow fsync on directories. File fsync + atomic rename still protects content.
  } finally {
    if (handle) await handle.close().catch(() => undefined);
  }
}
