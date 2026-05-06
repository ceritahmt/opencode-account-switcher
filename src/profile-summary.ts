import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./config.js";
import { ProfileStore } from "./profile-store.js";
import type { ProfileMetadata, ProviderId, RuntimePaths } from "./types.js";

export interface ProfileSummary {
  id: string;
  provider: ProviderId;
  isActive: boolean;
  lastSelectedAt: string | null;
  expiresAt: string | null;
  isLimited: boolean;
  limitedAt: string | null;
  limitedReason: string | null;
}

const EXPIRY_KEYS = new Set(["expiresat", "expires", "expiry", "expiration", "expirationtime", "expireson"]);

export async function listProfileSummaries(paths: RuntimePaths): Promise<ProfileSummary[]> {
  const store = new ProfileStore(paths);
  const [profiles, status, config] = await Promise.all([store.listProfiles(), store.getActiveStatus(), loadConfig(paths)]);

  return Promise.all(
    profiles.map(async (profile) => {
      const runtimeStatus = config.profileStatus[profile.id];
      return {
        id: profile.id,
        provider: profile.provider,
        isActive: profile.id === status.activeProfile,
        lastSelectedAt: profile.lastSelectedAt,
        expiresAt: await readProfileExpiry(paths, profile),
        isLimited: Boolean(runtimeStatus?.limitedAt),
        limitedAt: runtimeStatus?.limitedAt ?? null,
        limitedReason: runtimeStatus?.limitedReason ?? null,
      };
    }),
  );
}

export function extractProviderExpiry(authRaw: string, provider: ProviderId): string | null {
  const auth = JSON.parse(authRaw) as Record<string, unknown>;
  const providerAuth = auth[provider] ?? auth[`${provider}/`];
  return findExpiry(providerAuth);
}

async function readProfileExpiry(paths: RuntimePaths, profile: ProfileMetadata): Promise<string | null> {
  try {
    const authRaw = await fs.readFile(path.join(paths.profilesDir, profile.id, "auth.json"), "utf8");
    return extractProviderExpiry(authRaw, profile.provider);
  } catch {
    return null;
  }
}

function findExpiry(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;

  if (Array.isArray(value)) {
    for (const child of value) {
      const expiry = findExpiry(child);
      if (expiry) return expiry;
    }
    return null;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (EXPIRY_KEYS.has(normalizeKey(key))) {
      const expiry = parseExpiryValue(child);
      if (expiry) return expiry;
    }
  }

  for (const child of Object.values(value as Record<string, unknown>)) {
    const expiry = findExpiry(child);
    if (expiry) return expiry;
  }

  return null;
}

function parseExpiryValue(value: unknown): string | null {
  if (typeof value === "number") return formatNumericExpiry(value);

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) return formatNumericExpiry(numeric);

  const timestamp = Date.parse(trimmed);
  if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();

  return trimmed;
}

function formatNumericExpiry(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  if (value > 1_000_000_000_000) return new Date(value).toISOString();
  if (value > 1_000_000_000) return new Date(value * 1000).toISOString();
  return null;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}
