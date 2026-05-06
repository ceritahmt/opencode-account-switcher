import { spawn } from "node:child_process";
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

const PENDING_PROFILE_KEY = "opencode-as.pendingProfile";
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
            message: "Run /as-connect, enter profile name, complete OpenAI connect, then use /as use <name>.",
          });
        },
      },
    ]);
  },
};

function showConnectProfilePrompt(api: TuiApi): void {
  api.ui.dialog.replace(() =>
    api.ui.DialogPrompt({
      title: "Save OpenAI profile as",
      placeholder: "profile-name",
      value: api.kv?.get<string>(PENDING_PROFILE_KEY, "") ?? "",
      onConfirm: (raw) => {
        const profile = raw.trim();
        if (!PROFILE_NAME_PATTERN.test(profile) || profile === "." || profile === "..") {
          api.ui.toast({
            variant: "error",
            message: "Invalid profile name. Use 1-64 chars: letters, numbers, dot, underscore, dash.",
          });
          return;
        }

        api.kv?.set(PENDING_PROFILE_KEY, profile);
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
  const authPath = resolveAuthPath();
  const beforeHash = await readProviderHash(authPath, PROVIDER).catch(() => null);

  api.ui.toast({
    variant: "info",
    message: `Opening OpenAI connect. Profile will be saved as "${profile}" after auth changes.`,
  });

  api.command.trigger("provider.connect");

  const changed = await waitForProviderAuthChange(authPath, PROVIDER, beforeHash, api.lifecycle?.signal);
  if (!changed) {
    api.ui.toast({
      variant: "warning",
      message: `OpenAI auth was not detected/changed. After connecting, run: /as add ${profile} --provider openai --current`,
      duration: 10000,
    });
    return;
  }

  const result = await runCli(["add", profile, "--provider", PROVIDER, "--current"]);
  if (result.code === 0) {
    api.ui.toast({
      variant: "success",
      message: `Saved OpenAI profile "${profile}". Use it with: /as use ${profile}`,
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

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), "dist", "src", "cli.js"), ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => resolve({ code: 1, stdout: "", stderr: error.message }));
    child.on("close", (code) =>
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
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
