import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig, saveConfig } from "./config.js";
import { UserFacingError } from "./errors.js";
import { atomicWriteFile, ensureSecureDir, fsyncDirectory, pathExists, readJsonFile, readTextFile } from "./fs-utils.js";
import { sha256AuthHash } from "./hash.js";
import { withLock } from "./lock.js";
import { extractProviderAuth, mergeProviderAuth, parseProviderId } from "./provider-auth.js";
import type { ActiveProfileStatus, ProfileMetadata, RuntimePaths } from "./types.js";
import { assertValidAuthJson, assertValidMetadata, validateProfileName } from "./validation.js";

export class ProfileStore {
  constructor(private readonly paths: RuntimePaths) {}

  async listProfiles(): Promise<ProfileMetadata[]> {
    await ensureSecureDir(this.paths.profilesDir);
    const entries = await fs.readdir(this.paths.profilesDir, { withFileTypes: true });
    const profiles: ProfileMetadata[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        profiles.push(await this.readMetadata(entry.name));
      } catch {
        // Corrupt profile directories are ignored in list output to avoid exposing auth contents.
      }
    }

    return profiles.sort((a, b) => a.id.localeCompare(b.id));
  }

  async saveCurrentProfile(name: string, providerInput = "openai"): Promise<ProfileMetadata> {
    const id = validateProfileName(name);
    const provider = parseProviderId(providerInput);
    await ensureSecureDir(this.paths.dataDir);

    return withLock(this.paths.lockPath, async () => {
      const profileDir = this.profileDir(id);
      if (await pathExists(profileDir)) throw new UserFacingError(`Profile already exists: ${id}`);

      const authRaw = await readTextFile(this.paths.authPath);
      const providerAuth = extractProviderAuth(authRaw, provider);
      const now = new Date().toISOString();

      const metadata: ProfileMetadata = {
        id,
        label: id,
        provider,
        target: "opencode",
        createdAt: now,
        updatedAt: now,
        lastSelectedAt: null,
        authHash: providerAuth.hash,
        authSource: "current-snapshot",
      };

      const stagingDir = path.join(this.paths.profilesDir, `.${id}.${process.pid}.${Date.now()}.staging`);
      try {
        await ensureSecureDir(stagingDir);
        await atomicWriteFile(path.join(stagingDir, "auth.json"), providerAuth.raw);
        await atomicWriteFile(path.join(stagingDir, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
        await fs.rename(stagingDir, profileDir);
        await fsyncDirectory(this.paths.profilesDir);
        return metadata;
      } catch (error) {
        await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
        if (error instanceof UserFacingError) throw error;
        throw new UserFacingError(`Failed to save profile safely: ${(error as Error).message}`);
      }
    });
  }

  async updateCurrentProfile(name: string, providerInput = "openai"): Promise<ProfileMetadata> {
    const id = validateProfileName(name);
    const provider = parseProviderId(providerInput);
    await ensureSecureDir(this.paths.dataDir);

    return withLock(this.paths.lockPath, async () => {
      const profileDir = this.profileDir(id);
      if (!(await pathExists(profileDir))) throw new UserFacingError(`Profile not found: ${id}`);

      const metadata = await this.readMetadata(id);
      if (metadata.provider !== provider) {
        throw new UserFacingError(`Profile provider mismatch: ${id} is ${metadata.provider}, not ${provider}`);
      }

      const authPath = path.join(profileDir, "auth.json");
      const previousAuthRaw = await readTextFile(authPath);
      const providerAuth = extractProviderAuth(await readTextFile(this.paths.authPath), provider);
      const updatedMetadata: ProfileMetadata = {
        ...metadata,
        updatedAt: new Date().toISOString(),
        authHash: providerAuth.hash,
        authSource: "connect-flow",
      };

      try {
        await atomicWriteFile(authPath, providerAuth.raw);
        await this.writeMetadata(updatedMetadata);
        await fsyncDirectory(profileDir);
        return updatedMetadata;
      } catch (error) {
        await atomicWriteFile(authPath, previousAuthRaw).catch(() => undefined);
        await this.writeMetadata(metadata).catch(() => undefined);
        throw new UserFacingError(`Failed to update profile safely: ${(error as Error).message}`);
      }
    });
  }

  async useProfile(name: string): Promise<ProfileMetadata> {
    const id = validateProfileName(name);

    return withLock(this.paths.lockPath, async () => {
      const configBefore = await loadConfig(this.paths);
      const metadata = await this.readMetadata(id);
      const profileAuthPath = path.join(this.profileDir(id), "auth.json");
      const profileAuthRaw = await readTextFile(profileAuthPath);
      const profileAuth = extractProviderAuth(profileAuthRaw, metadata.provider);

      if (profileAuth.hash !== metadata.authHash) {
        throw new UserFacingError(`Profile auth changed outside /as: ${id}`);
      }

      const activeBefore = await this.readOptionalActiveAuth();
      if (activeBefore) await this.backupActiveAuth(activeBefore.raw);

      const activeAfterBackup = await this.readOptionalActiveAuth();
      if (activeBefore && activeAfterBackup && activeBefore.hash !== activeAfterBackup.hash) {
        throw new UserFacingError("Active auth changed during switch. Aborting without modifying auth.json.");
      }

      const now = new Date().toISOString();
      const updatedMetadata: ProfileMetadata = {
        ...metadata,
        updatedAt: now,
        lastSelectedAt: now,
      };

      let authWritten = false;
      try {
        const mergedAuthRaw = mergeProviderAuth(activeAfterBackup?.raw ?? null, profileAuthRaw, metadata.provider);
        await atomicWriteFile(this.paths.authPath, mergedAuthRaw);
        authWritten = true;
        await this.writeMetadata(updatedMetadata);
        await saveConfig(this.paths, { ...configBefore, activeProfile: id });
      } catch (error) {
        await this.rollbackSwitch(authWritten, activeBefore?.raw ?? null, metadata, configBefore);
        if (error instanceof UserFacingError) {
          throw new UserFacingError(`Switch failed and rollback was attempted: ${error.message}`);
        }
        throw new UserFacingError(`Switch failed and rollback was attempted: ${(error as Error).message}`);
      }

      return updatedMetadata;
    });
  }

  async removeProfile(name: string): Promise<string> {
    const id = validateProfileName(name);
    await ensureSecureDir(this.paths.dataDir);

    return withLock(this.paths.lockPath, async () => {
      const config = await loadConfig(this.paths);
      if (config.activeProfile === id) throw new UserFacingError(`Cannot remove active profile: ${id}. Switch first.`);

      const profileDir = this.profileDir(id);
      if (!(await pathExists(profileDir))) throw new UserFacingError(`Profile not found: ${id}`);

      await ensureSecureDir(this.paths.trashDir);
      const trashName = `${id}-${safeTimestamp()}`;
      const trashPath = path.join(this.paths.trashDir, trashName);
      await fs.rename(profileDir, trashPath);
      await fsyncDirectory(this.paths.trashDir);
      return trashName;
    });
  }

  async getActiveStatus(): Promise<ActiveProfileStatus> {
    const config = await loadConfig(this.paths);
    const activeProfile = config.activeProfile;

    if (!activeProfile) {
      return { activeProfile: null, metadata: null, authPath: this.paths.authPath, status: "no active profile" };
    }

    let metadata: ProfileMetadata;
    try {
      metadata = await this.readMetadata(activeProfile);
    } catch {
      return { activeProfile, metadata: null, authPath: this.paths.authPath, status: "missing profile" };
    }

    const active = await this.readOptionalActiveAuth();
    if (!active) return { activeProfile, metadata, authPath: this.paths.authPath, status: "missing auth" };

    let activeProviderHash: string;
    try {
      activeProviderHash = extractProviderAuth(active.raw, metadata.provider).hash;
    } catch {
      return { activeProfile, metadata, authPath: this.paths.authPath, status: "changed outside /as" };
    }

    return {
      activeProfile,
      metadata,
      authPath: this.paths.authPath,
      status: activeProviderHash === metadata.authHash ? "synced" : "changed outside /as",
    };
  }

  async readMetadata(name: string): Promise<ProfileMetadata> {
    const id = validateProfileName(name);
    const metadataPath = path.join(this.profileDir(id), "metadata.json");
    if (!(await pathExists(metadataPath))) throw new UserFacingError(`Profile not found: ${id}`);
    return assertValidMetadata(await readJsonFile<unknown>(metadataPath), id);
  }

  private async writeMetadata(metadata: ProfileMetadata): Promise<void> {
    await atomicWriteFile(path.join(this.profileDir(metadata.id), "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  }

  private profileDir(name: string): string {
    return path.join(this.paths.profilesDir, validateProfileName(name));
  }

  private async readOptionalActiveAuth(): Promise<{ raw: string; hash: string } | null> {
    if (!(await pathExists(this.paths.authPath))) return null;
    const raw = await readTextFile(this.paths.authPath);
    assertValidAuthJson(raw);
    return { raw, hash: sha256AuthHash(raw) };
  }

  private async backupActiveAuth(raw: string): Promise<void> {
    await ensureSecureDir(this.paths.backupsDir);
    const config = await loadConfig(this.paths);
    const label = config.activeProfile ?? "unknown";
    const backupPath = path.join(this.paths.backupsDir, `${safeTimestamp()}-${label}.auth.json`);
    await atomicWriteFile(backupPath, raw);
  }

  private async rollbackSwitch(
    authWritten: boolean,
    previousAuthRaw: string | null,
    previousMetadata: ProfileMetadata,
    previousConfig: Awaited<ReturnType<typeof loadConfig>>,
  ): Promise<void> {
    if (authWritten) {
      if (previousAuthRaw === null) {
        await fs.rm(this.paths.authPath, { force: true }).catch(() => undefined);
      } else {
        await atomicWriteFile(this.paths.authPath, previousAuthRaw).catch(() => undefined);
      }
    }

    await this.writeMetadata(previousMetadata).catch(() => undefined);
    await saveConfig(this.paths, previousConfig).catch(() => undefined);
  }
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
