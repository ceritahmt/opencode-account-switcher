import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
      skipFilter?: boolean;
    }) => unknown;
    toast: (input: ToastInput) => void;
    dialog: {
      replace: (render: () => unknown, onClose?: () => void) => void;
      clear: () => void;
    };
  };
  slots?: {
    register: (plugin: { order?: number; slots: { home_footer: () => unknown } }) => unknown;
  };
  renderer?: {
    requestRender?: () => void;
  };
  kv?: {
    get: <Value = unknown>(key: string, fallback?: Value) => Value;
    set: (key: string, value: unknown) => void;
  };
  event?: {
    on: (type: string, handler: (event: unknown) => void) => () => void;
  };
  lifecycle?: {
    signal?: AbortSignal;
    onDispose?: (fn: () => void) => () => void;
  };
};

type CliResult = { code: number; stdout: string; stderr: string };
type AccountAction = "use" | "reconnect" | "delete";
type SettingsAction = "auto-on" | "auto-off" | "clear-limits" | "version";
type AccountSettings = { autoSwitch: boolean };
type ProfileSummary = {
  id: string;
  provider: string;
  isActive: boolean;
  lastSelectedAt: string | null;
  expiresAt: string | null;
  isLimited: boolean;
  limitedAt: string | null;
  limitedReason: string | null;
  availableAt: string | null;
};
type ProjectModule = {
  clearLimitedProfiles: (paths: unknown) => Promise<void>;
  findNextAvailableProfile: (paths: unknown) => Promise<ProfileSummary | null>;
  getRuntimePaths: (env?: NodeJS.ProcessEnv) => unknown;
  loadAccountSettings: (paths: unknown) => Promise<AccountSettings>;
  listProfileSummaries: (paths: unknown) => Promise<ProfileSummary[]>;
  runCli: (argv: string[], env?: NodeJS.ProcessEnv) => Promise<CliResult>;
  setAutoSwitch: (paths: unknown, autoSwitch: boolean) => Promise<AccountSettings>;
};

const PROVIDER = "openai";
const PROFILE_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
let lastLimitHandledAt = 0;
let lastPersistedLimitHandledKey: string | null = null;
let homeFooterStatus: string | null = null;

const ACCOUNT_SWITCH_TRIGGER_RE =
  /usage limit|limit has been reached/i;

const plugin = {
  id: "opencode-as.tui",
  tui: async (api: TuiApi) => {
    registerLimitDetection(api);
    registerPersistedLimitPolling(api);
    registerHomeFooter(api);

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
      {
        title: "AS: Settings",
        value: "opencode-as.settings",
        description: "Configure account auto-switch behavior",
        category: "Account",
        slash: {
          name: "as-settings",
        },
        onSelect: () => {
          void showAccountSettingsDialog(api);
        },
      },
    ]);
  },
};

function registerLimitDetection(api: TuiApi): void {
  void appendDiagnosticLog("limit detection registration", [`eventApi: ${api.event ? "present" : "missing"}`]);

  const disposers = [
    api.event?.on("session.next.retried", (event) => {
      void appendDiagnosticLog("limit event received", [`eventType: ${getEventType(event)}`, `summary: ${summarizeEventForLog(event)}`]);
      void handlePossibleLimitEvent(api, event);
    }),
    api.event?.on("session.error", (event) => {
      void appendDiagnosticLog("limit event received", [`eventType: ${getEventType(event)}`, `summary: ${summarizeEventForLog(event)}`]);
      void handlePossibleLimitEvent(api, event);
    }),
    api.event?.on("session.next.step.failed", (event) => {
      void appendDiagnosticLog("limit event received", [`eventType: ${getEventType(event)}`, `summary: ${summarizeEventForLog(event)}`]);
      void handlePossibleLimitEvent(api, event);
    }),
    api.event?.on("session.status", (event) => {
      void appendDiagnosticLog("limit event received", [`eventType: ${getEventType(event)}`, `summary: ${summarizeEventForLog(event)}`]);
      void handlePossibleLimitEvent(api, event);
    }),
    api.event?.on("message.updated", (event) => {
      void appendDiagnosticLog("limit event received", [`eventType: ${getEventType(event)}`, `summary: ${summarizeEventForLog(event)}`]);
      void handlePossibleLimitEvent(api, event);
    }),
    api.event?.on("tui.toast.show", (event) => {
      void appendDiagnosticLog("limit event received", [`eventType: ${getEventType(event)}`, `summary: ${summarizeEventForLog(event)}`]);
      void handlePossibleLimitEvent(api, event);
    }),
  ].filter((dispose): dispose is () => void => typeof dispose === "function");

  void appendDiagnosticLog("limit detection registered", [`handlers: ${disposers.length}`]);

  if (disposers.length > 0) {
    api.lifecycle?.onDispose?.(() => {
      for (const dispose of disposers) dispose();
    });
  }
}

function registerPersistedLimitPolling(api: TuiApi): void {
  void appendDiagnosticLog("persisted limit polling registered");

  const interval = setInterval(() => {
    void handlePersistedLimitState(api);
  }, 2000);

  api.lifecycle?.onDispose?.(() => {
    clearInterval(interval);
  });
}

function registerHomeFooter(api: TuiApi): void {
  if (!api.slots?.register) return;

  void refreshHomeFooterStatus(api);
  const interval = setInterval(() => {
    void refreshHomeFooterStatus(api);
  }, 5000);

  api.lifecycle?.onDispose?.(() => {
    clearInterval(interval);
  });

  api.slots.register({
    order: 900,
    slots: {
      home_footer() {
        return homeFooterStatus;
      },
    },
  });
}

async function refreshHomeFooterStatus(api: TuiApi): Promise<void> {
  const profiles = await listProfileSummaries().catch(async (error) => {
    await appendDiagnosticLog("home footer profile lookup failed", [`error: ${toErrorMessage(error)}`]);
    return [] as ProfileSummary[];
  });
  const activeProfile = profiles.find((profile) => profile.isActive);
  const nextStatus = activeProfile ? formatHomeFooterStatus(activeProfile) : null;

  if (nextStatus === homeFooterStatus) return;
  homeFooterStatus = nextStatus;
  api.renderer?.requestRender?.();
}

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

async function showAccountSettingsDialog(api: TuiApi): Promise<void> {
  await appendDiagnosticLog("/as-settings started");

  let settings: AccountSettings;
  const packageVersion = await loadPackageVersion();
  try {
    settings = await loadAccountSettings();
  } catch (error) {
    const message = toErrorMessage(error);
    await appendDiagnosticLog("/as-settings failed to load settings", [`error: ${message}`]);
    api.ui.toast({ variant: "error", message });
    return;
  }

  api.ui.dialog.replace(() =>
    api.ui.DialogSelect<SettingsAction>({
      title: "Account Settings",
      placeholder: "Select setting",
      current: settings.autoSwitch ? "auto-on" : "auto-off",
      options: [
        {
          title: "Auto-switch: Enabled",
          value: "auto-on",
          description: "Automatically switch to the next available account when usage limits are detected",
          category: "Settings",
          disabled: settings.autoSwitch,
        },
        {
          title: "Auto-switch: Disabled",
          value: "auto-off",
          description: "Ask for confirmation before switching accounts",
          category: "Settings",
          disabled: !settings.autoSwitch,
        },
        {
          title: `Version: ${packageVersion}`,
          value: "version",
          description: "Installed opencode-as package version",
          category: "Info",
          disabled: true,
        },
        {
          title: "Clear limited markers",
          value: "clear-limits",
          description: "Reset locally remembered account issue states",
          category: "Settings",
        },
      ],
      onSelect: (option) => {
        api.ui.dialog.clear();
        void applySettingsAction(api, option.value);
      },
    }),
  );
}

async function applySettingsAction(api: TuiApi, action: SettingsAction): Promise<void> {
  try {
    if (action === "version") return;

    if (action === "clear-limits") {
      await clearLimitedProfiles();
      await appendDiagnosticLog("/as-settings limited markers cleared");
      api.ui.toast({ variant: "success", message: "Limited account markers cleared.", duration: 8000 });
      return;
    }

    const autoSwitch = action === "auto-on";
    await setAutoSwitch(autoSwitch);
    await appendDiagnosticLog("/as-settings auto-switch updated", [`autoSwitch: ${autoSwitch}`]);
    api.ui.toast({ variant: "success", message: `Auto-switch ${autoSwitch ? "enabled" : "disabled"}.`, duration: 8000 });
  } catch (error) {
    const message = toErrorMessage(error);
    await appendDiagnosticLog("/as-settings update failed", [`error: ${message}`]);
    api.ui.toast({ variant: "error", message, duration: 10000 });
  }
}

async function loadPackageVersion(): Promise<string> {
  const candidates = [new URL("../../package.json", import.meta.url), new URL("../package.json", import.meta.url)];

  for (const candidate of candidates) {
    try {
      const manifest = JSON.parse(await fs.readFile(candidate, "utf8")) as { version?: unknown };
      if (typeof manifest.version === "string" && manifest.version.trim()) return manifest.version;
    } catch {
      // Best-effort display only.
    }
  }

  return "unknown";
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

async function handlePossibleLimitEvent(api: TuiApi, event: unknown): Promise<void> {
  if (isInternalLimitToast(event)) return;

  const reason = extractLimitReason(event);
  if (!reason) {
    await appendDiagnosticLog("limit event ignored", [`eventType: ${getEventType(event)}`, `summary: ${summarizeEventForLog(event)}`]);
    return;
  }

  const retryAttempt = extractRetryAttempt(event);
  if (shouldWaitForRetryAttempt(event, retryAttempt)) {
    await appendDiagnosticLog("account limit retry pending", [
      `eventType: ${getEventType(event)}`,
      `attempt: ${retryAttempt}`,
      `reason: ${summarizeForLog(reason)}`,
    ]);
    return;
  }

  const now = Date.now();
  if (now - lastLimitHandledAt < 10_000) {
    await appendDiagnosticLog("account limit throttled", [`reason: ${summarizeForLog(reason)}`]);
    return;
  }
  lastLimitHandledAt = now;

  await appendDiagnosticLog("account limit detected", [
    `reason: ${summarizeForLog(reason)}`,
    retryAttempt === null ? "attempt: unknown" : `attempt: ${retryAttempt}`,
  ]);

  await appendDiagnosticLog("account limit observed by tui", ["waiting for server persisted marker"]);
  void handlePersistedLimitState(api);
}

async function handlePersistedLimitState(api: TuiApi): Promise<void> {
  const profiles = await listProfileSummaries().catch(async (error) => {
    await appendDiagnosticLog("persisted limit polling failed", [`error: ${toErrorMessage(error)}`]);
    return [] as ProfileSummary[];
  });

  const limitedProfile = profiles.find((profile) => profile.isActive && profile.isLimited);
  if (!limitedProfile || !limitedProfile.limitedAt) return;

  const key = `${limitedProfile.id}:${limitedProfile.limitedAt}`;
  if (lastPersistedLimitHandledKey === key) return;

  const nextProfile = await findNextAvailableProfile().catch(async (error) => {
    await appendDiagnosticLog("persisted limit next profile lookup failed", [`error: ${toErrorMessage(error)}`]);
    return null;
  });
  if (!nextProfile) return;

  lastPersistedLimitHandledKey = key;
  await appendDiagnosticLog("persisted account limit detected", [
    `limitedProfile: ${limitedProfile.id}`,
    `nextProfile: ${nextProfile.id}`,
    limitedProfile.limitedReason ? `reason: ${summarizeForLog(limitedProfile.limitedReason)}` : "reason: none",
  ]);

  const settings = await loadAccountSettings().catch(() => ({ autoSwitch: false }));
  if (settings.autoSwitch) {
    await switchProfileAfterLimit(api, limitedProfile.id, nextProfile.id, true);
    return;
  }

  showLimitSwitchConfirm(api, limitedProfile.id, nextProfile.id);
}

function showLimitSwitchConfirm(api: TuiApi, limitedProfile: string, nextProfile: string): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogConfirm({
      title: "Usage limit detected",
      message: `${limitedProfile} reached a usage limit. Switch to ${nextProfile}?`,
      onConfirm: () => {
        api.ui.dialog.clear();
        void switchProfileAfterLimit(api, limitedProfile, nextProfile, false);
      },
      onCancel: () => {
        api.ui.dialog.clear();
        api.ui.toast({ variant: "warning", message: `Account issue detected for ${limitedProfile}.`, duration: 8000 });
      },
    }),
  );
}

async function switchProfileAfterLimit(api: TuiApi, limitedProfile: string, nextProfile: string, automatic: boolean): Promise<void> {
  await appendDiagnosticLog("account limit switch started", [
    `limitedProfile: ${limitedProfile}`,
    `nextProfile: ${nextProfile}`,
    `automatic: ${automatic}`,
  ]);

  const result = await runCli(["use", nextProfile]);
  await appendDiagnosticLog("account limit switch completed", [
    `limitedProfile: ${limitedProfile}`,
    `nextProfile: ${nextProfile}`,
    `exitCode: ${result.code}`,
    result.stderr ? `stderr: ${summarizeForLog(result.stderr)}` : "stderr: none",
  ]);

  if (result.code === 0) {
    api.ui.toast({
      variant: "success",
      message: `${automatic ? "Auto-switched" : "Switched"} from ${limitedProfile} to ${nextProfile}.`,
      duration: 10000,
    });
    return;
  }

  api.ui.toast({ variant: "error", message: result.stderr || `Failed to switch to ${nextProfile}.`, duration: 10000 });
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
      message: `OpenAI auth was not detected/changed. Try /as-connect again after connecting.`,
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
      message: `Saved OpenAI profile "${profile}". Open /as-accounts to use it.`,
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

async function loadAccountSettings(): Promise<AccountSettings> {
  const project = await loadProjectModule();
  return project.loadAccountSettings(project.getRuntimePaths(process.env));
}

async function setAutoSwitch(autoSwitch: boolean): Promise<AccountSettings> {
  const project = await loadProjectModule();
  return project.setAutoSwitch(project.getRuntimePaths(process.env), autoSwitch);
}

async function clearLimitedProfiles(): Promise<void> {
  const project = await loadProjectModule();
  await project.clearLimitedProfiles(project.getRuntimePaths(process.env));
}

async function findNextAvailableProfile(): Promise<ProfileSummary | null> {
  const project = await loadProjectModule();
  return project.findNextAvailableProfile(project.getRuntimePaths(process.env));
}

async function loadProjectModule(): Promise<ProjectModule> {
  return (await import("./index.js")) as ProjectModule;
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
  if (profile.isLimited) {
    parts.push(`limited${profile.limitedReason ? `: ${profile.limitedReason}` : ""}`);
    parts.push(`available in: ${formatAvailableIn(profile.availableAt)}`);
  }
  if (profile.expiresAt) parts.push(`expires: ${profile.expiresAt}`);
  if (profile.lastSelectedAt) parts.push(`last used: ${profile.lastSelectedAt}`);
  return parts.join(" · ");
}

function formatHomeFooterStatus(profile: ProfileSummary): string {
  const parts = [`AS: ${profile.id}`];
  if (profile.expiresAt) parts.push(`expires: ${formatFooterDate(profile.expiresAt)}`);
  return parts.join(" · ");
}

function formatFooterDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toISOString();
}

function formatAvailableIn(availableAt: string | null): string {
  if (!availableAt) return "unknown";

  const timestamp = Date.parse(availableAt);
  if (!Number.isFinite(timestamp)) return "unknown";

  const remainingMs = timestamp - Date.now();
  if (remainingMs <= 0) return "now";

  const totalMinutes = Math.ceil(remainingMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function extractLimitReason(event: unknown): string | null {
  const text = extractSafeLimitText(event);
  if (!text || !isUsageLimitText(text)) return null;
  return summarizeForLog(text);
}

function extractRetryAttempt(event: unknown): number | null {
  const propertiesAttempt = extractPropertyNumber(event, "attempt");
  if (propertiesAttempt !== null) return propertiesAttempt;

  const text = extractSafeLimitText(event) ?? "";
  const match = /attempt\s*#?(\d+)/i.exec(text);
  if (!match) return null;

  const attempt = Number.parseInt(match[1] ?? "", 10);
  return Number.isFinite(attempt) ? attempt : null;
}

function shouldWaitForRetryAttempt(event: unknown, retryAttempt: number | null): boolean {
  return retryAttempt !== null && retryAttempt < 2;
}

function extractPropertyNumber(event: unknown, key: string): number | null {
  if (typeof event !== "object" || event === null) return null;
  const properties = (event as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return null;
  const value = (properties as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isInternalLimitToast(event: unknown): boolean {
  if (getEventType(event) !== "tui.toast.show") return false;
  const message = extractToastMessage(event);
  return message.startsWith("Usage limit detected") || message.includes("Auto-switched") || message.includes("Switched from");
}

function extractToastMessage(event: unknown): string {
  if (typeof event !== "object" || event === null) return "";
  const properties = (event as { properties?: unknown }).properties;
  if (typeof properties !== "object" || properties === null) return "";
  const message = (properties as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function extractSafeLimitText(event: unknown): string | null {
  const eventType = getEventType(event);
  const properties = getProperties(event);
  if (!properties) return null;

  const texts: string[] = [];

  if (
    eventType === "session.next.retried" ||
    eventType === "session.error" ||
    eventType === "session.next.step.failed"
  ) {
    texts.push(...extractErrorTexts(properties.error));
  }

  if (eventType === "session.status") {
    texts.push(...extractMessageTexts(properties.status));
  }

  if (eventType === "message.updated") {
    const info = getRecord(properties.info);
    if (info) texts.push(...extractErrorTexts(info.error));
  }

  if (eventType === "tui.toast.show") {
    texts.push(...extractMessageTexts(properties));
  }

  return texts.map((text) => text.trim()).filter(Boolean).join("\n") || null;
}

function extractErrorTexts(value: unknown): string[] {
  const record = getRecord(value);
  if (!record) return typeof value === "string" ? [value] : [];

  const texts = extractMessageTexts(record);
  const responseBody = record.responseBody;
  if (typeof responseBody === "string") texts.push(responseBody);
  return texts;
}

function extractMessageTexts(value: unknown): string[] {
  const record = getRecord(value);
  if (!record) return typeof value === "string" ? [value] : [];

  const texts: string[] = [];
  const message = record.message;
  if (typeof message === "string") texts.push(message);

  const data = getRecord(record.data);
  if (data && typeof data.message === "string") texts.push(data.message);

  return texts;
}

function getProperties(event: unknown): Record<string, unknown> | null {
  if (typeof event !== "object" || event === null) return null;
  return getRecord((event as { properties?: unknown }).properties);
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function getEventType(event: unknown): string {
  if (typeof event !== "object" || event === null) return "unknown";
  const type = (event as { type?: unknown }).type;
  return typeof type === "string" && type.trim() ? type : "unknown";
}

function summarizeEventForLog(event: unknown): string {
  const text = collectStrings(event).join(" ");
  return text ? summarizeForLog(text) : "no string payload";
}

function collectStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null || seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) return value.flatMap((child) => collectStrings(child, seen));
  return Object.values(value as Record<string, unknown>).flatMap((child) => collectStrings(child, seen));
}

function isUsageLimitText(input: string): boolean {
  return ACCOUNT_SWITCH_TRIGGER_RE.test(input);
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
