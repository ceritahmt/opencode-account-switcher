import { loadConfig, saveConfig } from "./config.js";
import { readTextFile } from "./fs-utils.js";
import { withLock } from "./lock.js";
import { ProfileStore } from "./profile-store.js";
import { listProfileSummaries, type ProfileSummary } from "./profile-summary.js";
import { extractProviderAuth } from "./provider-auth.js";
import type { AccountSettings, RuntimePaths } from "./types.js";

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
    const activeProfile = config.activeProfile ?? (await inferActiveProfileFromCurrentAuth(paths));
    if (!activeProfile) return null;

    await saveConfig(paths, {
      ...config,
      activeProfile,
      profileStatus: {
        ...config.profileStatus,
        [activeProfile]: {
          ...config.profileStatus[activeProfile],
          limitedAt: new Date().toISOString(),
          limitedReason: sanitizeReason(reason),
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
        },
      ]),
    );
    await saveConfig(paths, { ...config, profileStatus });
  });
}

export async function findNextAvailableProfile(paths: RuntimePaths): Promise<ProfileSummary | null> {
  const profiles = await listProfileSummaries(paths);
  if (profiles.length <= 1) return null;

  const activeIndex = profiles.findIndex((profile) => profile.isActive);
  const startIndex = activeIndex === -1 ? 0 : activeIndex;

  for (let offset = 1; offset < profiles.length; offset += 1) {
    const profile = profiles[(startIndex + offset) % profiles.length];
    if (profile && !profile.isLimited) return profile;
  }

  return null;
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
