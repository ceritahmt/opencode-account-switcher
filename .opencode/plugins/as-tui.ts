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
type CliModule = { runCli: (argv: string[], env?: NodeJS.ProcessEnv) => Promise<CliResult> };

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
          aliases: ["as-login"],
        },
        onSelect: () => {
          showConnectProfilePrompt(api);
        },
      },
      {
        title: "AS: Save connected OpenAI as profile",
        value: "opencode-as.save-help",
        description: "Show the save command after connecting OpenAI",
        category: "Account",
        slash: {
          name: "as-save-help",
        },
        onSelect: () => {
          api.ui.toast({
            variant: "info",
            message: "Run /as-connect, enter profile name, complete OpenAI connect, then use: npm run as -- use <name>.",
          });
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
    const modulePath = path.join(process.cwd(), "dist", "src", "cli.js");
    const cli = (await import(pathToFileURL(modulePath).href)) as CliModule;
    return await cli.runCli(args, process.env);
  } catch (error) {
    return {
      code: 1,
      stdout: "",
      stderr: `Failed to load opencode-as CLI. Run npm run build first. ${(error as Error).message}`,
    };
  }
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
