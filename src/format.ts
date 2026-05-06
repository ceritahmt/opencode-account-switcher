import type { ActiveProfileStatus, ProfileMetadata } from "./types.js";

export function formatProviders(): string {
  return "OpenAI  supported";
}

export function formatSavedProfile(metadata: ProfileMetadata): string {
  return [
    `Adding profile: ${metadata.id}`,
    "Provider: OpenAI",
    "Saved auth scope: selected provider object only",
    `Profile saved: ${metadata.id}`,
    `Use it with: /as use ${metadata.id}`,
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
    `  opencode auth login --provider ${provider}`,
    "",
    "Login tamamlandıktan sonra sadece seçilen provider objesini kaydet:",
    `  /as add ${profileName} --provider ${provider} --current`,
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
    "  /as add <name>",
    "  /as add <name> --provider openai --current",
    "  /as use <name>",
    "  /as rm <name>",
    "  /as who",
    "  /as ls",
    "  /as providers",
  ].join("\n");
}

export function formatHelp(): string {
  return [
    "Usage:",
    "  /as",
    "  /as ls",
    "  /as who",
    "  /as add <name>",
    "  /as add <name> --provider openai --current",
    "  /as add <name> --provider openai --login",
    "  /as use <name>",
    "  /as <name>",
    "  /as rm <name>",
    "  /as providers",
  ].join("\n");
}
