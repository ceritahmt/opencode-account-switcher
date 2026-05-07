import { loadConfig, saveConfig } from "./config.js";
import { readTextFile } from "./fs-utils.js";
import { withLock } from "./lock.js";
import { ProfileStore } from "./profile-store.js";
import { listProfileSummaries, type ProfileSummary } from "./profile-summary.js";
import { extractProviderAuth } from "./provider-auth.js";
import type { AccountSettings, ProviderId, RuntimePaths } from "./types.js";

export const DEFAULT_LIMIT_COOLDOWN_MS = 5 * 60 * 60 * 1000;

export async function loadAccountSettings(paths: RuntimePaths): Promise<AccountSettings> {
  return (await loadConfig(paths)).settings;
}

export async function setAutoSwitch(paths: RuntimePaths, autoSwitch: boolean): Promise<AccountSettings> {
  return withLock(paths.lockPath, async () => {
    const config = await loadConfig(paths);
    const settings = { ...config.settings, autoSwitch };
    await saveConfig(paths, { ...config, settings });
    return settings;
  });
}

export async function markActiveProfileLimited(paths: RuntimePaths, reason: string): Promise<string | null> {
  return withLock(paths.lockPath, async () => {
    const config = await loadConfig(paths);
    const activeProfile =
      config.activeProfile && (await isProfileActiveInCurrentAuth(paths, config.activeProfile))
        ? config.activeProfile
        : await inferActiveProfileFromCurrentAuth(paths);
    if (!activeProfile) return null;
    const limitedAt = new Date();

    await saveConfig(paths, {
      ...config,
      activeProfile,
      profileStatus: {
        ...config.profileStatus,
        [activeProfile]: {
          ...config.profileStatus[activeProfile],
          limitedAt: limitedAt.toISOString(),
          limitedReason: sanitizeReason(reason),
          availableAt: new Date(limitedAt.getTime() + DEFAULT_LIMIT_COOLDOWN_MS).toISOString(),
        },
      },
    });

    return activeProfile;
  });
}

export async function clearLimitedProfiles(paths: RuntimePaths): Promise<void> {
  return withLock(paths.lockPath, async () => {
    const config = await loadConfig(paths);
    const profileStatus = Object.fromEntries(
      Object.entries(config.profileStatus).map(([profile, status]) => [
        profile,
        {
          ...status,
          limitedAt: undefined,
          limitedReason: undefined,
          availableAt: undefined,
        },
      ]),
    );
    await saveConfig(paths, { ...config, profileStatus });
  });
}

export async function findNextAvailableProfile(paths: RuntimePaths, provider: ProviderId): Promise<ProfileSummary | null> {
  if (!provider) return null;

  const profiles = (await listProfileSummaries(paths)).filter((profile) => profile.provider === provider);
  if (profiles.length <= 1) return null;

  const activeIndex = profiles.findIndex((profile) => profile.isActive);
  const startIndex = activeIndex === -1 ? 0 : activeIndex;

  for (let offset = 1; offset < profiles.length; offset += 1) {
    const profile = profiles[(startIndex + offset) % profiles.length];
    if (profile && !profile.isLimited) return profile;
  }

  return null;
}

async function isProfileActiveInCurrentAuth(paths: RuntimePaths, profileId: string): Promise<boolean> {
  let authRaw: string;
  try {
    authRaw = await readTextFile(paths.authPath);
  } catch {
    return false;
  }

  const store = new ProfileStore(paths);
  try {
    const profile = await store.readMetadata(profileId);
    return extractProviderAuth(authRaw, profile.provider).hash === profile.authHash;
  } catch {
    return false;
  }
}

async function inferActiveProfileFromCurrentAuth(paths: RuntimePaths): Promise<string | null> {
  let authRaw: string;
  try {
    authRaw = await readTextFile(paths.authPath);
  } catch {
    return null;
  }

  const store = new ProfileStore(paths);
  const profiles = await store.listProfiles();

  for (const profile of profiles) {
    try {
      const currentAuth = extractProviderAuth(authRaw, profile.provider);
      if (currentAuth.hash === profile.authHash) return profile.id;
    } catch {
      // Ignore profiles whose provider cannot be matched against the current auth file.
    }
  }

  return null;
}

function sanitizeReason(reason: string): string {
  const singleLine = reason.replace(/\s+/g, " ").trim();
  return singleLine.length > 200 ? `${singleLine.slice(0, 200)}...` : singleLine;
}
