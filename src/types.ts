export type ProviderId = "openai";

export type AuthSource = "current-snapshot" | "connect-flow";

export interface TargetConfig {
  type: "file";
  path: string;
}

export interface AppConfig {
  version: 1;
  activeProfile: string | null;
  defaultProvider: ProviderId;
  targets: {
    opencode: TargetConfig;
  };
}

export interface ProfileMetadata {
  id: string;
  label: string;
  provider: ProviderId;
  target: "opencode";
  createdAt: string;
  updatedAt: string;
  lastSelectedAt: string | null;
  authHash: string;
  authSource: AuthSource;
}

export interface RuntimePaths {
  dataDir: string;
  configPath: string;
  profilesDir: string;
  backupsDir: string;
  trashDir: string;
  lockPath: string;
  authPath: string;
  logPath: string;
}

export type DriftStatus = "synced" | "changed outside /as" | "missing auth" | "no active profile" | "missing profile";

export interface ActiveProfileStatus {
  activeProfile: string | null;
  metadata: ProfileMetadata | null;
  authPath: string;
  status: DriftStatus;
}
