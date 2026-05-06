import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "@opencode-ai/plugin";

type ProjectModule = {
  appendProjectLog: (paths: unknown, entry: { level?: "info" | "warn" | "error"; event: string; details?: string[] }) => Promise<void>;
  getRuntimePaths: (env?: NodeJS.ProcessEnv) => unknown;
  markActiveProfileLimited: (paths: unknown, reason: string) => Promise<string | null>;
};

const ServerAccountLimitPlugin: Plugin = async () => {
  await appendServerLog("server limit plugin registered");

  return {
    event: async ({ event }) => {
      await handleServerEvent(event);
    },
  };
};

const ACCOUNT_SWITCH_TRIGGER_RE =
  /usage limit|limit has been reached|rate limit|too many requests|insufficient_quota|quota|\b429\b|could not parse your authentication token|authentication token|signing in again|provider auth|auth(?:entication)? token/i;

async function handleServerEvent(event: unknown): Promise<void> {
  const eventType = getEventType(event);
  if (!isLimitCandidateEvent(eventType)) return;

  const reason = extractLimitReason(event);
  if (!reason) return;

  const project = await loadProjectModule().catch(() => null);
  if (!project) return;

  const paths = project.getRuntimePaths(process.env);
  const retryAttempt = extractRetryAttempt(event);
  if (retryAttempt !== null && retryAttempt < 2) {
    await project.appendProjectLog(paths, {
      event: "server account limit retry pending",
      details: [`eventType: ${eventType}`, `attempt: ${retryAttempt}`, `reason: ${reason}`],
    });
    return;
  }

  const limitedProfile = await project.markActiveProfileLimited(paths, reason).catch(async (error) => {
    await project.appendProjectLog(paths, {
      level: "error",
      event: "server account limit mark failed",
      details: [`eventType: ${eventType}`, `error: ${toErrorMessage(error)}`],
    });
    return null;
  });

  await project.appendProjectLog(paths, {
    event: "server account limit detected",
    details: [
      `eventType: ${eventType}`,
      retryAttempt === null ? "attempt: unknown" : `attempt: ${retryAttempt}`,
      limitedProfile ? `profile: ${limitedProfile}` : "profile: none",
      `reason: ${reason}`,
    ],
  });
}

async function appendServerLog(event: string, details: string[] = []): Promise<void> {
  const project = await loadProjectModule().catch(() => null);
  if (!project) return;

  await project.appendProjectLog(project.getRuntimePaths(process.env), { event, details });
}

function isLimitCandidateEvent(eventType: string): boolean {
  return (
    eventType === "session.next.retried" ||
    eventType === "session.error" ||
    eventType === "session.next.step.failed" ||
    eventType === "session.status" ||
    eventType === "message.updated"
  );
}

function extractLimitReason(event: unknown): string | null {
  const text = collectStrings(event).join("\n");
  if (!ACCOUNT_SWITCH_TRIGGER_RE.test(text)) return null;
  return summarizeForLog(extractErrorMessage(event) ?? text);
}

function extractRetryAttempt(event: unknown): number | null {
  const propertiesAttempt = extractPropertyNumber(event, "attempt");
  if (propertiesAttempt !== null) return propertiesAttempt;

  const text = collectStrings(event).join("\n");
  const match = /attempt\s*#?(\d+)/i.exec(text);
  if (!match) return null;

  const attempt = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(attempt) ? attempt : null;
}

function extractPropertyNumber(event: unknown, key: string): number | null {
  if (typeof event !== "object" || event === null) return null;
  const properties = (event as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return null;
  const value = (properties as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractErrorMessage(event: unknown): string | null {
  if (typeof event !== "object" || event === null) return null;
  const properties = (event as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return null;
  const error = (properties as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;

  const directMessage = (error as { message?: unknown }).message;
  if (typeof directMessage === "string" && directMessage.trim()) return directMessage;

  return null;
}

function collectStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null || seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) return value.flatMap((child) => collectStrings(child, seen));
  return Object.values(value as Record<string, unknown>).flatMap((child) => collectStrings(child, seen));
}

function getEventType(event: unknown): string {
  if (typeof event !== "object" || event === null) return "unknown";
  const type = (event as { type?: unknown }).type;
  return typeof type === "string" && type.trim() ? type : "unknown";
}

function summarizeForLog(input: string): string {
  const singleLine = input.replace(/\s+/g, " ").trim();
  return singleLine.length > 500 ? `${singleLine.slice(0, 500)}...` : singleLine;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadProjectModule(): Promise<ProjectModule> {
  const modulePath = path.join(process.cwd(), "dist", "src", "index.js");
  return (await import(pathToFileURL(modulePath).href)) as ProjectModule;
}

export default ServerAccountLimitPlugin;
