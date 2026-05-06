import type { ActiveProfileStatus, ProfileMetadata } from "./types.js";
import type { AccountExportResult, AccountImportResult } from "./account-transfer.js";

export function formatProviders(): string {
  return "OpenAI  supported";
}

export function formatSavedProfile(metadata: ProfileMetadata): string {
  return [
    `Adding profile: ${metadata.id}`,
    "Provider: OpenAI",
    "Saved auth scope: selected provider object only",
    `Profile saved: ${metadata.id}`,
    `Use it with: npm run as -- use ${metadata.id}`,
  ].join("\n");
}

export function formatUpdatedProfile(metadata: ProfileMetadata): string {
  return [
    `Updating profile: ${metadata.id}`,
    "Provider: OpenAI",
    "Saved auth scope: selected provider object only",
    `Profile updated: ${metadata.id}`,
  ].join("\n");
}

export function formatAddProviderSelection(profileName: string, provider = "openai"): string {
  return [
    `Profile: ${profileName}`,
    "Select provider:",
    "  OpenAI",
    "",
    "OpenCode içinde login/connect için:",
    "  /connect",
    "  provider: OpenAI",
    "",
    "Terminal alternatifi:",
    `  opencode providers login --provider ${provider}`,
    "",
    "Login tamamlandıktan sonra sadece seçilen provider objesini kaydet:",
    `  npm run as -- add ${profileName} --provider ${provider} --current`,
    "",
    "Terminalde tek komut denemek için:",
    `  npm run as -- add ${profileName} --provider ${provider} --login`,
  ].join("\n");
}

export function formatUsingProfile(metadata: ProfileMetadata): string {
  return [`Using profile: ${metadata.id}`, "Restart OpenCode if auth does not refresh automatically."].join("\n");
}

export function formatRemovedProfile(name: string): string {
  return [`Profile moved to trash: ${name}`, "Trash is not secure deletion."].join("\n");
}

export function formatExportedAccounts(result: AccountExportResult): string {
  return [`Encrypted account export created: ${result.outputPath}`, `Profiles exported: ${result.profileCount}`].join("\n");
}

export function formatImportedAccounts(result: AccountImportResult): string {
  return [`Encrypted account export imported: ${result.inputPath}`, `Profiles imported: ${result.importedProfileCount}`].join("\n");
}

export function formatWho(status: ActiveProfileStatus): string {
  if (!status.activeProfile) {
    return [`Active profile: none`, "Provider: OpenAI", `Target: ${status.authPath}`, `Status: ${status.status}`].join("\n");
  }

  return [
    `Active profile: ${status.activeProfile}`,
    `Provider: ${status.metadata?.provider === "openai" ? "OpenAI" : "unknown"}`,
    `Target: ${status.authPath}`,
    `Status: ${status.status}`,
    `Last selected: ${status.metadata?.lastSelectedAt ?? "never"}`,
  ].join("\n");
}

export function formatList(profiles: ProfileMetadata[], activeProfile: string | null): string {
  if (profiles.length === 0) return "Profiles: none";

  return [
    "Profiles:",
    ...profiles.map((profile) => `${profile.id === activeProfile ? "*" : " "} ${profile.id}  ${profile.provider}`),
  ].join("\n");
}

export function formatMenu(status: ActiveProfileStatus, profiles: ProfileMetadata[]): string {
  return [
    `Current: ${status.activeProfile ?? "none"}`,
    "Provider: OpenAI",
    `Status: ${status.status}`,
    "",
    formatList(profiles, status.activeProfile),
    "",
    "Actions:",
    "  npm run as -- add <name>",
    "  npm run as -- add <name> --provider openai --current",
    "  npm run as -- update <name> --provider openai --current",
    "  npm run as -- use <name>",
    "  npm run as -- rm <name>",
    "  npm run as -- export --passphrase-env OPENCODE_AS_EXPORT_PASSPHRASE",
    "  npm run as -- import <path> --passphrase-env OPENCODE_AS_EXPORT_PASSPHRASE",
    "  npm run as -- who",
    "  npm run as -- ls",
    "  npm run as -- providers",
  ].join("\n");
}

export function formatHelp(): string {
  return [
    "Usage:",
    "  npm run as --",
    "  npm run as -- ls",
    "  npm run as -- who",
    "  npm run as -- add <name>",
    "  npm run as -- add <name> --provider openai --current",
    "  npm run as -- add <name> --provider openai --login",
    "  npm run as -- update <name> --provider openai --current",
    "  npm run as -- use <name>",
    "  npm run as -- <name>",
    "  npm run as -- rm <name>",
    "  npm run as -- export --passphrase-env OPENCODE_AS_EXPORT_PASSPHRASE",
    "  npm run as -- import <path> --passphrase-env OPENCODE_AS_EXPORT_PASSPHRASE",
    "  npm run as -- providers",
  ].join("\n");
}
