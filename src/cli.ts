#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { toSafeErrorMessage, UserFacingError } from "./errors.js";
import { formatAddProviderSelection, formatHelp, formatList, formatMenu, formatProviders, formatRemovedProfile, formatSavedProfile, formatUpdatedProfile, formatUsingProfile, formatWho } from "./format.js";
import { appendProjectLog } from "./log.js";
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
  const paths = getRuntimePaths(env);
  const store = new ProfileStore(paths);
  const [command, ...args] = argv;

  await appendProjectLog(paths, {
    event: "cli command started",
    details: [`command: ${command ?? "menu"}`, `args: ${summarizeArgs(args)}`],
  });

  try {
    const result = await runCliCommand(command, args, store);
    await appendProjectLog(paths, {
      event: "cli command completed",
      details: [`command: ${command ?? "menu"}`, `exitCode: ${result.code}`, `stdout: ${result.stdout ? "present" : "empty"}`],
    });
    return result;
  } catch (error) {
    const message = toSafeErrorMessage(error);
    await appendProjectLog(paths, {
      level: "error",
      event: "cli command failed",
      details: [`command: ${command ?? "menu"}`, `error: ${message}`],
    });
    return { code: 1, stdout: "", stderr: message };
  }
}

async function runCliCommand(command: string | undefined, args: string[], store: ProfileStore): Promise<CliResult> {
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
    if (!name) throw new UserFacingError("Missing profile name. Usage: npm run as -- add <name>");
    const provider = getOption(args, "--provider") ?? "openai";
    parseProviderId(provider);

    if (args.includes("--login")) {
      await runOpenCodeLogin(provider, getOption(args, "--method"));
      return ok(formatSavedProfile(await store.saveCurrentProfile(name, provider)));
    }

    if (!args.includes("--current")) return ok(formatAddProviderSelection(name, provider));

    return ok(formatSavedProfile(await store.saveCurrentProfile(name, provider)));
  }

  if (command === "use") {
    const name = args[0];
    if (!name) throw new UserFacingError("Missing profile name. Usage: npm run as -- use <name>");
    return ok(formatUsingProfile(await store.useProfile(name)));
  }

  if (command === "update") {
    const name = args[0] ? validateProfileName(args[0]) : undefined;
    if (!name) throw new UserFacingError("Missing profile name. Usage: npm run as -- update <name> --provider openai --current");
    const provider = getOption(args, "--provider") ?? "openai";
    parseProviderId(provider);
    if (!args.includes("--current")) {
      throw new UserFacingError("Missing --current. Usage: npm run as -- update <name> --provider openai --current");
    }
    return ok(formatUpdatedProfile(await store.updateCurrentProfile(name, provider)));
  }

  if (command === "rm" || command === "remove") {
    const name = args[0];
    if (!name) throw new UserFacingError("Missing profile name. Usage: npm run as -- rm <name>");
    return ok(formatRemovedProfile(await store.removeProfile(name)));
  }

  if (args.length === 0) return ok(formatUsingProfile(await store.useProfile(command)));
  throw new UserFacingError(`Unknown command: ${command}`);
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
        `Use /connect in OpenCode, or run in a terminal: opencode providers login --provider ${provider}`,
        `Then save it with: npm run as -- add <name> --provider ${provider} --current`,
      ].join("\n"),
    );
  }

  const loginArgs = ["providers", "login", "--provider", provider];
  if (method) loginArgs.push("--method", method);
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn("opencode", loginArgs, { stdio: "inherit", env: process.env });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) throw new UserFacingError(`opencode providers login failed with exit code ${exitCode}`);
}

function summarizeArgs(args: string[]): string {
  if (args.length === 0) return "<none>";
  const value = args.join(" ");
  return value.length > 200 ? `${value.slice(0, 200)}...` : value;
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
