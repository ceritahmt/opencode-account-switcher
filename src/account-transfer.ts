import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadConfig, saveConfig } from "./config.js";
import { UserFacingError } from "./errors.js";
import { ensureSecureDir, fsyncDirectory, pathExists, readTextFile } from "./fs-utils.js";
import { withLock } from "./lock.js";
import { extractProviderAuth } from "./provider-auth.js";
import type { AppConfig, ProfileMetadata, RuntimePaths } from "./types.js";
import { assertValidAuthJson, assertValidMetadata, validateProfileName } from "./validation.js";

const scrypt = promisify(scryptCallback);
const EXPORT_VERSION = 1;
const EXPORT_ALGORITHM = "aes-256-gcm";
const EXPORT_KDF = "scrypt";
const EXPORT_KEY_LENGTH = 32;
const EXPORT_FILENAME = "as-account-exported.json.enc";

export type AccountExportResult = {
  outputPath: string;
  profileCount: number;
};

export type AccountImportResult = {
  inputPath: string;
  importedProfileCount: number;
  skippedProfileCount: number;
};

type ExportProfile = {
  metadata: ProfileMetadata;
  authRaw: string;
};

type ExportPayload = {
  version: 1;
  exportedAt: string;
  config: Pick<AppConfig, "activeProfile" | "defaultProvider" | "settings" | "profileStatus">;
  profiles: ExportProfile[];
};

type EncryptedEnvelope = {
  version: 1;
  algorithm: typeof EXPORT_ALGORITHM;
  kdf: typeof EXPORT_KDF;
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
};

export function getDefaultAccountExportPath(cwd = process.cwd()): string {
  return path.join(cwd, EXPORT_FILENAME);
}

export async function exportAccountsEncrypted(
  paths: RuntimePaths,
  options: { outputPath?: string; passphrase: string },
): Promise<AccountExportResult> {
  const passphrase = validatePassphrase(options.passphrase);
  const outputPath = path.resolve(options.outputPath ?? getDefaultAccountExportPath());

  if (await pathExists(outputPath)) {
    throw new UserFacingError(`Export file already exists: ${outputPath}`);
  }

  const payload = await buildExportPayload(paths);
  const encrypted = await encryptPayload(payload, passphrase);
  await writeNewSecretFile(outputPath, `${JSON.stringify(encrypted, null, 2)}\n`);

  return { outputPath, profileCount: payload.profiles.length };
}

export async function importAccountsEncrypted(
  paths: RuntimePaths,
  options: { inputPath: string; passphrase: string },
): Promise<AccountImportResult> {
  const passphrase = validatePassphrase(options.passphrase);
  const inputPath = path.resolve(expandHome(options.inputPath));
  const envelope = parseEnvelope(await readTextFile(inputPath));
  const payload = await decryptPayload(envelope, passphrase);
  await ensureSecureDir(paths.dataDir);

  return withLock(paths.lockPath, async () => {
    await ensureSecureDir(paths.profilesDir);
    const profiles = validateExportPayload(payload);
    const existing = new Set<string>();

    for (const profile of profiles) {
      if (await pathExists(path.join(paths.profilesDir, profile.metadata.id))) existing.add(profile.metadata.id);
    }

    if (existing.size > 0) {
      throw new UserFacingError(`Import would overwrite existing profiles: ${Array.from(existing).join(", ")}`);
    }

    for (const profile of profiles) await writeImportedProfile(paths, profile);

    const currentConfig = await loadConfig(paths);
    await saveConfig(paths, mergeImportedConfig(currentConfig, payload.config, profiles));

    return { inputPath, importedProfileCount: profiles.length, skippedProfileCount: 0 };
  });
}

async function buildExportPayload(paths: RuntimePaths): Promise<ExportPayload> {
  await ensureSecureDir(paths.profilesDir);
  const config = await loadConfig(paths);
  const entries = await fs.readdir(paths.profilesDir, { withFileTypes: true });
  const profiles: ExportProfile[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const profileDir = path.join(paths.profilesDir, entry.name);
    const metadataRaw = JSON.parse(await readTextFile(path.join(profileDir, "metadata.json"))) as unknown;
    const metadata = assertValidMetadata(metadataRaw, entry.name);
    const authRaw = await readTextFile(path.join(profileDir, "auth.json"));
    const providerAuth = extractProviderAuth(authRaw, metadata.provider);
    if (providerAuth.hash !== metadata.authHash) {
      throw new UserFacingError(`Profile auth changed outside opencode-as: ${metadata.id}`);
    }
    profiles.push({ metadata, authRaw: providerAuth.raw });
  }

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    config: {
      activeProfile: config.activeProfile,
      defaultProvider: config.defaultProvider,
      settings: config.settings,
      profileStatus: config.profileStatus,
    },
    profiles: profiles.sort((a, b) => a.metadata.id.localeCompare(b.metadata.id)),
  };
}

async function writeImportedProfile(paths: RuntimePaths, profile: ExportProfile): Promise<void> {
  const profileDir = path.join(paths.profilesDir, profile.metadata.id);
  const stagingDir = path.join(paths.profilesDir, `.${profile.metadata.id}.${process.pid}.${Date.now()}.import`);

  try {
    await ensureSecureDir(stagingDir);
    await writeNewSecretFile(path.join(stagingDir, "auth.json"), profile.authRaw);
    await writeNewSecretFile(path.join(stagingDir, "metadata.json"), `${JSON.stringify(profile.metadata, null, 2)}\n`);
    await fs.rename(stagingDir, profileDir);
    await fsyncDirectory(paths.profilesDir);
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError(`Failed to import profile safely: ${(error as Error).message}`);
  }
}

function mergeImportedConfig(current: AppConfig, imported: ExportPayload["config"], profiles: ExportProfile[]): AppConfig {
  const importedProfileIds = new Set(profiles.map((profile) => profile.metadata.id));
  const importedStatus = Object.fromEntries(
    Object.entries(imported.profileStatus ?? {}).filter(([profileId]) => importedProfileIds.has(profileId)),
  );

  return {
    ...current,
    settings: { ...current.settings, ...imported.settings },
    profileStatus: { ...current.profileStatus, ...importedStatus },
  };
}

async function encryptPayload(payload: ExportPayload, passphrase: string): Promise<EncryptedEnvelope> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = (await scrypt(passphrase, salt, EXPORT_KEY_LENGTH)) as Buffer;
  const cipher = createCipheriv(EXPORT_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);

  return {
    version: EXPORT_VERSION,
    algorithm: EXPORT_ALGORITHM,
    kdf: EXPORT_KDF,
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

async function decryptPayload(envelope: EncryptedEnvelope, passphrase: string): Promise<ExportPayload> {
  const salt = Buffer.from(envelope.salt, "base64");
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const key = (await scrypt(passphrase, salt, EXPORT_KEY_LENGTH)) as Buffer;
  const decipher = createDecipheriv(EXPORT_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext) as ExportPayload;
  } catch {
    throw new UserFacingError("Failed to decrypt export. Check the file and passphrase.");
  }
}

function validateExportPayload(value: unknown): ExportProfile[] {
  if (typeof value !== "object" || value === null) throw new UserFacingError("Invalid export payload.");
  const payload = value as Partial<ExportPayload>;
  if (payload.version !== EXPORT_VERSION || !Array.isArray(payload.profiles)) throw new UserFacingError("Unsupported export payload.");

  return payload.profiles.map((profile, index) => {
    if (typeof profile !== "object" || profile === null) throw new UserFacingError(`Invalid export profile at index ${index}.`);
    const candidate = profile as Partial<ExportProfile>;
    if (typeof candidate.authRaw !== "string") throw new UserFacingError(`Invalid export auth at index ${index}.`);
    const expectedId = validateProfileName((candidate.metadata as { id?: unknown } | undefined)?.id as string);
    const metadata = assertValidMetadata(candidate.metadata, expectedId);
    assertValidAuthJson(candidate.authRaw);
    const providerAuth = extractProviderAuth(candidate.authRaw, metadata.provider);
    if (providerAuth.hash !== metadata.authHash) throw new UserFacingError(`Invalid export auth hash for profile: ${metadata.id}`);
    return { metadata, authRaw: providerAuth.raw };
  });
}

function parseEnvelope(raw: string): EncryptedEnvelope {
  try {
    const envelope = JSON.parse(raw) as Partial<EncryptedEnvelope>;
    if (
      envelope.version !== EXPORT_VERSION ||
      envelope.algorithm !== EXPORT_ALGORITHM ||
      envelope.kdf !== EXPORT_KDF ||
      typeof envelope.salt !== "string" ||
      typeof envelope.iv !== "string" ||
      typeof envelope.tag !== "string" ||
      typeof envelope.ciphertext !== "string"
    ) {
      throw new Error("invalid envelope");
    }
    return envelope as EncryptedEnvelope;
  } catch {
    throw new UserFacingError("Invalid encrypted account export file.");
  }
}

async function writeNewSecretFile(filePath: string, content: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, "wx", 0o600);
    await handle.writeFile(content);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.chmod(filePath, 0o600).catch(() => undefined);
    await fsyncDirectory(path.dirname(filePath));
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await fs.rm(filePath, { force: true }).catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new UserFacingError(`File already exists: ${filePath}`);
    throw new UserFacingError(`Failed to write file safely: ${(error as Error).message}`);
  }
}

function validatePassphrase(passphrase: string): string {
  if (!passphrase.trim()) throw new UserFacingError("Missing export passphrase.");
  return passphrase;
}

function expandHome(input: string): string {
  if (input === "~") return process.env.HOME ?? input;
  if (input.startsWith("~/")) return path.join(process.env.HOME ?? "", input.slice(2));
  return input;
}
