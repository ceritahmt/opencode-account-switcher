#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSafeErrorMessage, UserFacingError } from "./errors.js";
import { formatAddProviderSelection, formatHelp, formatList, formatMenu, formatProviders, formatRemovedProfile, formatSavedProfile, formatUsingProfile, formatWho } from "./format.js";
import { getRuntimePaths } from "./paths.js";
import { ProfileStore } from "./profile-store.js";
import { parseProviderId } from "./provider-auth.js";
import { validateProfileName } from "./validation.js";

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<CliResult> {
  const store = new ProfileStore(getRuntimePaths(env));
  const [command, ...args] = argv;

  try {
    if (!command) {
      const [status, profiles] = await Promise.all([store.getActiveStatus(), store.listProfiles()]);
      return ok(formatMenu(status, profiles));
    }

    if (command === "help" || command === "--help" || command === "-h") return ok(formatHelp());
    if (command === "providers") return ok(formatProviders());

    if (command === "ls" || command === "list") {
      const [status, profiles] = await Promise.all([store.getActiveStatus(), store.listProfiles()]);
      return ok(formatList(profiles, status.activeProfile));
    }

    if (command === "who") return ok(formatWho(await store.getActiveStatus()));

    if (command === "add") {
      const name = args[0] ? validateProfileName(args[0]) : undefined;
      if (!name) throw new UserFacingError("Missing profile name. Usage: /as add <name>");
      const provider = getOption(args, "--provider") ?? "openai";
      parseProviderId(provider);

      if (args.includes("--login")) {
        await runOpenCodeLogin(provider, getOption(args, "--method"));
        return ok(formatSavedProfile(await store.saveCurrentProfile(name, provider)));
      }

      if (!args.includes("--current")) {
        return ok(formatAddProviderSelection(name, provider));
      }

      return ok(formatSavedProfile(await store.saveCurrentProfile(name, provider)));
    }

    if (command === "use") {
      const name = args[0];
      if (!name) throw new UserFacingError("Missing profile name. Usage: /as use <name>");
      return ok(formatUsingProfile(await store.useProfile(name)));
    }

    if (command === "rm" || command === "remove") {
      const name = args[0];
      if (!name) throw new UserFacingError("Missing profile name. Usage: /as rm <name>");
      return ok(formatRemovedProfile(await store.removeProfile(name)));
    }

    if (args.length === 0) return ok(formatUsingProfile(await store.useProfile(command)));
    throw new UserFacingError(`Unknown command: ${command}`);
  } catch (error) {
    return { code: 1, stdout: "", stderr: toSafeErrorMessage(error) };
  }
}

function getOption(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new UserFacingError(`Missing value for ${option}`);
  return value;
}

async function runOpenCodeLogin(provider: string, method?: string): Promise<void> {
  if (!process.stdin.isTTY) {
    throw new UserFacingError(
      [
        "Interactive login cannot run from this OpenCode markdown command.",
        `Use /connect in OpenCode, or run in a terminal: opencode auth login --provider ${provider}`,
        `Then save it with: /as add <name> --provider ${provider} --current`,
      ].join("\n"),
    );
  }

  const loginArgs = ["auth", "login", "--provider", provider];
  if (method) loginArgs.push("--method", method);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn("opencode", loginArgs, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) throw new UserFacingError(`opencode auth login failed with exit code ${exitCode}`);
}

function ok(stdout: string): CliResult {
  return { code: 0, stdout, stderr: "" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const result = await runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.code;
}
