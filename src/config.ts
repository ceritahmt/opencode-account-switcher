import { atomicWriteFile, ensureSecureDir, pathExists, readJsonFile } from "./fs-utils.js";
import type { AppConfig, RuntimePaths } from "./types.js";

export function defaultConfig(paths: RuntimePaths): AppConfig {
  return {
    version: 1,
    activeProfile: null,
    defaultProvider: "openai",
    settings: {
      autoSwitch: false,
    },
    profileStatus: {},
    targets: {
      opencode: {
        type: "file",
        path: paths.authPath,
      },
    },
  };
}

export async function ensureStorage(paths: RuntimePaths): Promise<void> {
  await ensureSecureDir(paths.dataDir);
  await ensureSecureDir(paths.profilesDir);
  await ensureSecureDir(paths.backupsDir);
  await ensureSecureDir(paths.trashDir);
}

export async function loadConfig(paths: RuntimePaths): Promise<AppConfig> {
  await ensureStorage(paths);
  if (!(await pathExists(paths.configPath))) return defaultConfig(paths);
  const config = await readJsonFile<AppConfig>(paths.configPath);
  return {
    ...defaultConfig(paths),
    ...config,
    settings: {
      ...defaultConfig(paths).settings,
      ...(config.settings ?? {}),
    },
    profileStatus: config.profileStatus ?? {},
    targets: {
      opencode: {
        type: "file",
        path: paths.authPath,
      },
    },
  };
}

export async function saveConfig(paths: RuntimePaths, config: AppConfig): Promise<void> {
  await atomicWriteFile(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);
}
