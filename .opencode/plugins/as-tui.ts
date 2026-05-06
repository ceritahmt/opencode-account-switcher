import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

type ToastInput = {
  variant?: "info" | "success" | "warning" | "error";
  title?: string;
  message: string;
  duration?: number;
};

type DialogSelectOption<Value = unknown> = {
  title: string;
  value: Value;
  description?: string;
  category?: string;
  disabled?: boolean;
  onSelect?: () => void;
};

type TuiApi = {
  command: {
    register: (cb: () => unknown[]) => void;
    trigger: (value: string) => void;
  };
  ui: {
    DialogPrompt: (props: {
      title: string;
      description?: () => unknown;
      placeholder?: string;
      value?: string;
      busy?: boolean;
      busyText?: string;
      onConfirm?: (value: string) => void;
      onCancel?: () => void;
    }) => unknown;
    DialogConfirm: (props: {
      title: string;
      message: string;
      onConfirm?: () => void;
      onCancel?: () => void;
    }) => unknown;
    DialogSelect: <Value = unknown>(props: {
      title: string;
      placeholder?: string;
      options: DialogSelectOption<Value>[];
      onSelect?: (option: DialogSelectOption<Value>) => void;
      current?: Value;
    }) => unknown;
    toast: (input: ToastInput) => void;
    dialog: {
      replace: (render: () => unknown, onClose?: () => void) => void;
      clear: () => void;
    };
  };
  kv?: {
    get: <Value = unknown>(key: string, fallback?: Value) => Value;
    set: (key: string, value: unknown) => void;
  };
  lifecycle?: {
    signal?: AbortSignal;
  };
};

type CliResult = { code: number; stdout: string; stderr: string };
type AccountAction = "use" | "reconnect" | "delete";
type ProfileSummary = { id: string; provider: string; isActive: boolean; lastSelectedAt: string | null; expiresAt: string | null };
type ProjectModule = {
  getRuntimePaths: (env?: NodeJS.ProcessEnv) => unknown;
  listProfileSummaries: (paths: unknown) => Promise<ProfileSummary[]>;
  runCli: (argv: string[], env?: NodeJS.ProcessEnv) => Promise<CliResult>;
};

const PROVIDER = "openai";
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;

const plugin = {
  id: "opencode-as.tui",
  tui: async (api: TuiApi) => {
    api.command.register(() => [
      {
        title: "AS: Connect provider and save profile",
        value: "opencode-as.connect",
        description: "Open native provider login/connect and save OpenAI as a profile",
        category: "Account",
        slash: {
          name: "as-connect",
        },
        onSelect: () => {
          showConnectProfilePrompt(api);
        },
      },
      {
        title: "AS: Accounts",
        value: "opencode-as.accounts",
        description: "List saved profiles and switch active account",
        category: "Account",
        slash: {
          name: "as-accounts",
        },
        onSelect: () => {
          void showAccountsDialog(api);
        },
      },
    ]);
  },
};

function showConnectProfilePrompt(api: TuiApi): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "Profile Name",
      placeholder: "profile-name",
      value: "",
      onConfirm: (raw) => {
        const profile = raw.trim();
        if (!PROFILE_NAME_PATTERN.test(profile) || profile === "." || profile === "..") {
          api.ui.toast({
            variant: "error",
            message: "Invalid profile name. Use 1-64 chars: letters, numbers, dot, underscore, dash.",
          });
          return;
        }

        api.ui.dialog.clear();
        void connectAndAutosave(api, profile);
      },
      onCancel: () => {
        api.ui.dialog.clear();
      },
    }),
  );
}

async function showAccountsDialog(api: TuiApi): Promise<void> {
  await appendDiagnosticLog("/as-accounts started");

  let profiles: ProfileSummary[];
  try {
    profiles = await listProfileSummaries();
  } catch (error) {
    const message = toErrorMessage(error);
    await appendDiagnosticLog("/as-accounts failed to list profiles", [`error: ${message}`]);
    api.ui.toast({ variant: "error", message });
    return;
  }

  if (profiles.length === 0) {
    api.ui.toast({ variant: "info", message: "No profiles found. Create one with /as-connect." });
    return;
  }

  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<string>({
      title: "Accounts",
      placeholder: "Select profile",
      current: profiles.find((profile) => profile.isActive)?.id,
      options: profiles.map((profile) => ({
        title: `${profile.isActive ? "●" : "○"} ${profile.id}`,
        value: profile.id,
        description: formatProfileDescription(profile),
        category: profile.provider,
      })),
      onSelect: (option) => {
        const profile = profiles.find((item) => item.id === option.value);
        if (profile) showAccountActionDialog(api, profile);
      },
    }),
  );
}

function showAccountActionDialog(api: TuiApi, profile: ProfileSummary): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<AccountAction>({
      title: profile.id,
      placeholder: "Select action",
      options: [
        {
          title: "Use",
          value: "use",
          description: "Switch OpenCode auth to this profile",
          category: "Action",
        },
        {
          title: "Reconnect",
          value: "reconnect",
          description: "Refresh provider auth and update this profile",
          category: "Action",
        },
        {
          title: "Delete",
          value: "delete",
          description: profile.isActive ? "Active profile cannot be deleted" : "Move this profile to trash",
          category: "Action",
          disabled: profile.isActive,
        },
      ],
      onSelect: (option) => {
        if (option.value === "use") {
          api.ui.dialog.clear();
          void useProfileFromDialog(api, profile.id);
          return;
        }

        if (option.value === "reconnect") {
          api.ui.dialog.clear();
          void reconnectProfileFromDialog(api, profile.id);
          return;
        }

        showDeleteProfileConfirm(api, profile.id);
      },
    }),
  );
}

function showDeleteProfileConfirm(api: TuiApi, profile: string): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogConfirm({
      title: `Delete ${profile}?`,
      message: "This moves the profile to trash. It does not securely delete stored auth data.",
      onConfirm: () => {
        api.ui.dialog.clear();
        void deleteProfileFromDialog(api, profile);
      },
      onCancel: () => {
        void showAccountsDialog(api);
      },
    }),
  );
}

async function useProfileFromDialog(api: TuiApi, profile: string): Promise<void> {
  await appendDiagnosticLog("/as-accounts action selected", [`profile: ${profile}`, "action: use"]);

  const result = await runCli(["use", profile]);
  await appendDiagnosticLog("/as-accounts profile switch completed", [
    `profile: ${profile}`,
    `exitCode: ${result.code}`,
    result.stderr ? `stderr: ${summarizeForLog(result.stderr)}` : "stderr: none",
  ]);

  if (result.code === 0) {
    api.ui.toast({ variant: "success", message: `Using profile: ${profile}`, duration: 8000 });
    return;
  }

  api.ui.toast({ variant: "error", message: result.stderr || `Failed to use profile: ${profile}`, duration: 10000 });
}

async function deleteProfileFromDialog(api: TuiApi, profile: string): Promise<void> {
  await appendDiagnosticLog("/as-accounts action selected", [`profile: ${profile}`, "action: delete"]);

  const result = await runCli(["rm", profile]);
  await appendDiagnosticLog("/as-accounts profile delete completed", [
    `profile: ${profile}`,
    `exitCode: ${result.code}`,
    result.stderr ? `stderr: ${summarizeForLog(result.stderr)}` : "stderr: none",
  ]);

  if (result.code === 0) {
    api.ui.toast({ variant: "success", message: `Deleted profile: ${profile}`, duration: 8000 });
    return;
  }

  api.ui.toast({ variant: "error", message: result.stderr || `Failed to delete profile: ${profile}`, duration: 10000 });
}

async function reconnectProfileFromDialog(api: TuiApi, profile: string): Promise<void> {
  await appendDiagnosticLog("/as-accounts action selected", [`profile: ${profile}`, "action: reconnect"]);

  const useResult = await runCli(["use", profile]);
  if (useResult.code !== 0) {
    await appendDiagnosticLog("/as-accounts reconnect failed before provider.connect", [
      `profile: ${profile}`,
      `stderr: ${summarizeForLog(useResult.stderr)}`,
    ]);
    api.ui.toast({ variant: "error", message: useResult.stderr || `Failed to use profile: ${profile}`, duration: 10000 });
    return;
  }

  const authPath = resolveAuthPath();
  const beforeHash = await readProviderHash(authPath, PROVIDER).catch(() => null);
  await appendDiagnosticLog("/as-accounts reconnect triggering provider.connect", [
    `profile: ${profile}`,
    `beforeHash: ${beforeHash ? "present" : "missing"}`,
  ]);

  api.ui.toast({
    variant: "info",
    message: `Opening OpenAI reconnect for "${profile}". The profile will be updated after auth changes.`,
  });
  api.command.trigger("provider.connect");

  const changed = await waitForProviderAuthChange(authPath, PROVIDER, beforeHash, api.lifecycle?.signal);
  await appendDiagnosticLog("/as-accounts reconnect auth wait completed", [`profile: ${profile}`, `changed: ${changed}`]);
  if (!changed) {
    api.ui.toast({
      variant: "warning",
      message: `OpenAI auth was not detected/changed. Profile was not updated: ${profile}`,
      duration: 10000,
    });
    return;
  }

  const updateResult = await runCli(["update", profile, "--provider", PROVIDER, "--current"]);
  await appendDiagnosticLog("/as-accounts reconnect profile update completed", [
    `profile: ${profile}`,
    `exitCode: ${updateResult.code}`,
    updateResult.stderr ? `stderr: ${summarizeForLog(updateResult.stderr)}` : "stderr: none",
  ]);

  if (updateResult.code === 0) {
    api.ui.toast({ variant: "success", message: `Reconnected profile: ${profile}`, duration: 10000 });
    return;
  }

  api.ui.toast({ variant: "error", message: updateResult.stderr || `Failed to reconnect profile: ${profile}`, duration: 10000 });
}

async function connectAndAutosave(api: TuiApi, profile: string): Promise<void> {
  await appendDiagnosticLog("/as-connect started", [`profile: ${profile}`]);

  const authPath = resolveAuthPath();
  const beforeHash = await readProviderHash(authPath, PROVIDER).catch(() => null);
  await appendDiagnosticLog("/as-connect auth snapshot captured", [
    `authPath: ${authPath}`,
    `provider: ${PROVIDER}`,
    `beforeHash: ${beforeHash ? "present" : "missing"}`,
  ]);

  api.ui.toast({
    variant: "info",
    message: `Opening OpenAI connect. Profile will be saved as "${profile}" after auth changes.`,
  });

  await appendDiagnosticLog("/as-connect triggering provider.connect");
  api.command.trigger("provider.connect");

  const changed = await waitForProviderAuthChange(authPath, PROVIDER, beforeHash, api.lifecycle?.signal);
  await appendDiagnosticLog("/as-connect provider auth wait completed", [`changed: ${changed}`]);
  if (!changed) {
    api.ui.toast({
      variant: "warning",
      message: `OpenAI auth was not detected/changed. After connecting, run: npm run as -- add ${profile} --provider openai --current`,
      duration: 10000,
    });
    return;
  }

  const result = await runCli(["add", profile, "--provider", PROVIDER, "--current"]);
  await appendDiagnosticLog("/as-connect profile save completed", [
    `exitCode: ${result.code}`,
    result.stderr ? `stderr: ${summarizeForLog(result.stderr)}` : "stderr: none",
  ]);
  if (result.code === 0) {
    api.ui.toast({
      variant: "success",
      message: `Saved OpenAI profile "${profile}". Use it with: npm run as -- use ${profile}`,
      duration: 10000,
    });
    return;
  }

  api.ui.toast({
    variant: "error",
    message: result.stderr || `Failed to save profile "${profile}".`,
    duration: 10000,
  });
}

async function waitForProviderAuthChange(
  authPath: string,
  provider: string,
  beforeHash: string | null,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  const timeoutAt = Date.now() + 120_000;

  while (!signal?.aborted && Date.now() < timeoutAt) {
    const currentHash = await readProviderHash(authPath, provider).catch(() => null);
    if (currentHash && currentHash !== beforeHash) return true;
    await delay(1000);
  }

  return false;
}

async function readProviderHash(authPath: string, provider: string): Promise<string | null> {
  const raw = await fs.readFile(authPath, "utf8");
  const auth = JSON.parse(raw) as Record<string, unknown>;
  const value = auth[provider] ?? auth[`${provider}/`];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return createHash("sha256").update(JSON.stringify(sortForJson(value))).digest("hex");
}

async function runCli(args: string[]): Promise<CliResult> {
  try {
    const project = await loadProjectModule();
    return await project.runCli(args, process.env);
  } catch (error) {
    return {
      code: 1,
      stdout: "",
      stderr: `Failed to load opencode-as CLI. Run npm run build first. ${(error as Error).message}`,
    };
  }
}

async function listProfileSummaries(): Promise<ProfileSummary[]> {
  const project = await loadProjectModule();
  return project.listProfileSummaries(project.getRuntimePaths(process.env));
}

async function loadProjectModule(): Promise<ProjectModule> {
  const modulePath = path.join(process.cwd(), "dist", "src", "index.js");
  return (await import(pathToFileURL(modulePath).href)) as ProjectModule;
}

function resolveAuthPath(): string {
  if (process.env.OPENCODE_AUTH_PATH) return path.resolve(expandHome(process.env.OPENCODE_AUTH_PATH));

  const dataHome = process.env.XDG_DATA_HOME ? expandHome(process.env.XDG_DATA_HOME) : path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "auth.json");
}

function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function appendDiagnosticLog(title: string, details: string[] = []): Promise<void> {
  try {
    const logPath = resolveLogPath();
    await fs.mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
    const body = `${JSON.stringify({
      time: new Date().toISOString(),
      level: "info",
      event: redact(title),
      details: details.map(redact),
    })}\n`;
    await fs.appendFile(logPath, body, { mode: 0o600 });
    await fs.chmod(logPath, 0o600).catch(() => undefined);
  } catch {
    // Diagnostic logging must never break /as-connect.
  }
}

function resolveLogPath(): string {
  return path.join(resolveProjectDataDir(), "logs", `log${formatDate(new Date())}.log`);
}

function resolveProjectDataDir(): string {
  if (process.env.OPENCODE_AS_HOME) return path.resolve(expandHome(process.env.OPENCODE_AS_HOME));

  const dataHome = process.env.XDG_DATA_HOME ? path.resolve(expandHome(process.env.XDG_DATA_HOME)) : path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "opencode-as-account");
}

function formatDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}

function redact(input: string): string {
  return input
    .replace(/(sk-[a-zA-Z0-9_-]{8,})/g, "[redacted-openai-key]")
    .replace(/(Bearer\s+)[a-zA-Z0-9._-]+/gi, "$1[redacted-token]")
    .replace(/("(?:key|token|access|refresh|secret)"\s*:\s*")[^"]+(")/gi, "$1[redacted]$2");
}

function summarizeForLog(input: string): string {
  const singleLine = input.replace(/\s+/g, " ").trim();
  return singleLine.length > 500 ? `${singleLine.slice(0, 500)}...` : singleLine;
}

function formatProfileDescription(profile: ProfileSummary): string {
  const parts = [profile.provider];
  if (profile.expiresAt) parts.push(`expires: ${profile.expiresAt}`);
  if (profile.lastSelectedAt) parts.push(`last used: ${profile.lastSelectedAt}`);
  return parts.join(" · ");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

export default plugin;
