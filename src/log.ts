import fs from "node:fs/promises";
import path from "node:path";
import type { RuntimePaths } from "./types.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level?: LogLevel;
  event: string;
  details?: string[];
}

export async function appendProjectLog(paths: RuntimePaths, entry: LogEntry): Promise<void> {
  try {
    await fs.mkdir(path.dirname(paths.logPath), { recursive: true, mode: 0o700 });
    const body = `${JSON.stringify({
      time: new Date().toISOString(),
      level: entry.level ?? "info",
      event: redact(entry.event),
      details: (entry.details ?? []).map(redact),
    })}\n`;
    await fs.appendFile(paths.logPath, body, { mode: 0o600 });
    await fs.chmod(paths.logPath, 0o600).catch(() => undefined);
  } catch {
    // Logging must never break command execution.
  }
}

export async function appendDebugLog(paths: RuntimePaths, title: string, details: string[] = []): Promise<void> {
  await appendProjectLog(paths, { level: "debug", event: title, details });
}

function redact(input: string): string {
  return input
    .replace(/(sk-[a-zA-Z0-9_-]{8,})/g, "[redacted-openai-key]")
    .replace(/(Bearer\s+)[a-zA-Z0-9._-]+/gi, "$1[redacted-token]")
    .replace(/("(?:key|token|access|refresh|secret)"\s*:\s*")[^"]+(")/gi, "$1[redacted]$2");
}
