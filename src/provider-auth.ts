import { UserFacingError } from "./errors.js";
import { sha256AuthHash } from "./hash.js";
import type { ProviderId } from "./types.js";
import { assertValidAuthJson } from "./validation.js";

const SUPPORTED_PROVIDERS = new Set<ProviderId>(["openai"]);

export interface ProviderAuthSnapshot {
  provider: ProviderId;
  raw: string;
  hash: string;
  value: Record<string, unknown>;
}

export function parseProviderId(input: string | undefined): ProviderId {
  const provider = normalizeProviderId(input ?? "openai");
  if (!SUPPORTED_PROVIDERS.has(provider as ProviderId)) {
    throw new UserFacingError(`Unsupported provider: ${input ?? ""}. Supported provider: openai`);
  }
  return provider as ProviderId;
}

export function extractProviderAuth(authRaw: string, providerInput: ProviderId): ProviderAuthSnapshot {
  const provider = parseProviderId(providerInput);
  const auth = assertValidAuthJson(authRaw) as Record<string, unknown>;
  const providerValue = auth[provider] ?? auth[`${provider}/`];

  assertValidProviderCredential(providerValue, provider);

  const value = { [provider]: providerValue };
  const raw = `${stableJson(value)}\n`;
  return {
    provider,
    raw,
    hash: sha256AuthHash(raw),
    value,
  };
}

export function mergeProviderAuth(activeAuthRaw: string | null, providerAuthRaw: string, providerInput: ProviderId): string {
  const provider = parseProviderId(providerInput);
  const providerAuth = extractProviderAuth(providerAuthRaw, provider);
  const current = activeAuthRaw ? (assertValidAuthJson(activeAuthRaw) as Record<string, unknown>) : {};

  delete current[provider];
  delete current[`${provider}/`];
  current[provider] = providerAuth.value[provider];

  return `${stableJson(current)}\n`;
}

function normalizeProviderId(input: string): string {
  return input.trim().toLowerCase().replace(/\/+$/, "");
}

function assertValidProviderCredential(value: unknown, provider: ProviderId): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UserFacingError(`Provider auth not found: ${provider}. Login first, then run npm run as -- add <name> --provider ${provider} --current.`);
  }

  const credential = value as Record<string, unknown>;
  if (credential.type !== "api" && credential.type !== "oauth" && credential.type !== "wellknown") {
    throw new UserFacingError(`Unsupported auth type for provider: ${provider}`);
  }

  if (credential.type === "api" && (typeof credential.key !== "string" || credential.key.length === 0)) {
    throw new UserFacingError(`Invalid API auth object for provider: ${provider}`);
  }

  if (
    credential.type === "oauth" &&
    (typeof credential.refresh !== "string" || credential.refresh.length === 0) &&
    (typeof credential.access !== "string" || credential.access.length === 0)
  ) {
    throw new UserFacingError(`Invalid OAuth auth object for provider: ${provider}`);
  }

  if (
    credential.type === "wellknown" &&
    (typeof credential.key !== "string" || credential.key.length === 0) &&
    (typeof credential.token !== "string" || credential.token.length === 0)
  ) {
    throw new UserFacingError(`Invalid well-known auth object for provider: ${provider}`);
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortForJson(value), null, 2);
}

function sortForJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForJson);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, sortForJson(child)]),
  );
}
