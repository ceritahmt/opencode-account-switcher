import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimePaths } from "./types.js";

export async function appendDebugLog(paths: RuntimePaths, title: string, details: string[] = []): Promise<void> {
  try {
    await fs.mkdir(path.dirname(paths.logPath), { recursive: true, mode: 0o700 });
    const body = [`[${new Date().toISOString()}] ${redact(title)}`, ...details.map((line) => `  ${redact(line)}`), ""].join(
      "\n",
    );
    await fs.appendFile(paths.logPath, body, { mode: 0o600 });
    await fs.chmod(paths.logPath, 0o600).catch(() => undefined);
  } catch {
    // Logging must never break /as command execution.
  }
}

function redact(input: string): string {
  return input
    .replace(/(sk-[a-zA-Z0-9_-]{8,})/g, "[redacted-openai-key]")
    .replace(/(Bearer\s+)[a-zA-Z0-9._-]+/gi, "$1[redacted-token]")
    .replace(/("(?:key|token|access|refresh|secret)"\s*:\s*")[^"]+(")/gi, "$1[redacted]$2");
}
