import { UserFacingError } from "./errors.js";
import type { ProfileMetadata } from "./types.js";

export const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

export function validateProfileName(name: string): string {
  if (!PROFILE_NAME_PATTERN.test(name) || name === "." || name === "..") {
    throw new UserFacingError("Invalid profile name. Use 1-64 chars: letters, numbers, dot, underscore, dash.");
  }

  if (name.includes("/") || name.includes("\\")) {
    throw new UserFacingError("Invalid profile name. Path separators are not allowed.");
  }

  return name;
}

export function assertValidAuthJson(raw: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UserFacingError("Invalid auth.json: file is not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new UserFacingError("Invalid auth.json: expected a JSON object.");
  }

  if (Object.keys(parsed).length === 0) {
    throw new UserFacingError("Invalid auth.json: expected a non-empty auth object.");
  }

  return parsed;
}

export function assertValidMetadata(value: unknown, expectedId: string): ProfileMetadata {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserFacingError(`Invalid metadata for profile: ${expectedId}`);
  }

  const metadata = value as Partial<ProfileMetadata>;
  if (metadata.id !== expectedId) throw new UserFacingError(`Invalid metadata id for profile: ${expectedId}`);
  if (metadata.label === undefined || typeof metadata.label !== "string") {
    throw new UserFacingError(`Invalid metadata label for profile: ${expectedId}`);
  }
  if (metadata.provider !== "openai") throw new UserFacingError(`Invalid metadata provider for profile: ${expectedId}`);
  if (metadata.target !== "opencode") throw new UserFacingError(`Invalid metadata target for profile: ${expectedId}`);
  if (typeof metadata.createdAt !== "string" || typeof metadata.updatedAt !== "string") {
    throw new UserFacingError(`Invalid metadata timestamps for profile: ${expectedId}`);
  }
  if (metadata.lastSelectedAt !== null && typeof metadata.lastSelectedAt !== "string") {
    throw new UserFacingError(`Invalid metadata lastSelectedAt for profile: ${expectedId}`);
  }
  if (typeof metadata.authHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(metadata.authHash)) {
    throw new UserFacingError(`Invalid metadata auth hash for profile: ${expectedId}`);
  }
  if (metadata.authSource !== "current-snapshot" && metadata.authSource !== "connect-flow") {
    throw new UserFacingError(`Invalid metadata auth source for profile: ${expectedId}`);
  }

  return metadata as ProfileMetadata;
}
