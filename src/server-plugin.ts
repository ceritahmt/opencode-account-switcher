import { markActiveProfileLimited } from "./account-settings.js";
import { appendProjectLog } from "./log.js";
import { getRuntimePaths } from "./paths.js";

type ServerPlugin = () => Promise<{
  event: (input: { event: unknown }) => Promise<void>;
}>;

const ACCOUNT_SWITCH_TRIGGER_RE =
  /usage limit|limit has been reached/i;

const ServerAccountLimitPlugin: ServerPlugin = async () => {
  await appendServerLog("server limit plugin registered");

  return {
    event: async ({ event }) => {
      await handleServerEvent(event);
    },
  };
};

async function handleServerEvent(event: unknown): Promise<void> {
  const eventType = getEventType(event);
  if (!isLimitCandidateEvent(eventType)) return;

  const reason = extractLimitReason(event);
  if (!reason) return;

  const paths = getRuntimePaths(process.env);
  const retryAttempt = extractRetryAttempt(event);
  if (retryAttempt !== null && retryAttempt < 2) {
    await appendProjectLog(paths, {
      event: "server account limit retry pending",
      details: [`eventType: ${eventType}`, `attempt: ${retryAttempt}`, `reason: ${reason}`],
    });
    return;
  }

  const limitedProfile = await markActiveProfileLimited(paths, reason).catch(async (error) => {
    await appendProjectLog(paths, {
      level: "error",
      event: "server account limit mark failed",
      details: [`eventType: ${eventType}`, `error: ${toErrorMessage(error)}`],
    });
    return null;
  });

  await appendProjectLog(paths, {
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
  await appendProjectLog(getRuntimePaths(process.env), { event, details });
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
  const text = extractSafeLimitText(event);
  if (!text || !ACCOUNT_SWITCH_TRIGGER_RE.test(text)) return null;
  return summarizeForLog(text);
}

function extractRetryAttempt(event: unknown): number | null {
  const propertiesAttempt = extractPropertyNumber(event, "attempt");
  if (propertiesAttempt !== null) return propertiesAttempt;

  const text = extractSafeLimitText(event) ?? "";
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

function extractSafeLimitText(event: unknown): string | null {
  const eventType = getEventType(event);
  const properties = getProperties(event);
  if (!properties) return null;

  const texts: string[] = [];

  if (
    eventType === "session.next.retried" ||
    eventType === "session.error" ||
    eventType === "session.next.step.failed"
  ) {
    texts.push(...extractErrorTexts(properties.error));
  }

  if (eventType === "session.status") {
    texts.push(...extractMessageTexts(properties.status));
  }

  if (eventType === "message.updated") {
    const info = getRecord(properties.info);
    if (info) texts.push(...extractErrorTexts(info.error));
  }

  return texts.map((text) => text.trim()).filter(Boolean).join("\n") || null;
}

function extractErrorTexts(value: unknown): string[] {
  const record = getRecord(value);
  if (!record) return typeof value === "string" ? [value] : [];

  return extractMessageTexts(record);
}

function extractMessageTexts(value: unknown): string[] {
  const record = getRecord(value);
  if (!record) return typeof value === "string" ? [value] : [];

  const texts: string[] = [];
  const message = record.message;
  if (typeof message === "string") texts.push(message);

  const data = getRecord(record.data);
  if (data && typeof data.message === "string") texts.push(data.message);

  return texts;
}

function getProperties(event: unknown): Record<string, unknown> | null {
  if (typeof event !== "object" || event === null) return null;
  return getRecord((event as { properties?: unknown }).properties);
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
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

export default ServerAccountLimitPlugin;
