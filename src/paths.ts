import os from "node:os";
import path from "node:path";
import type { RuntimePaths } from "./types.js";

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith(`~${path.sep}`)) return path.join(os.homedir(), input.slice(2));
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export function getRuntimePaths(env: NodeJS.ProcessEnv = process.env): RuntimePaths {
  const dataDir = getProjectDataDir(env);
  const authPath = path.resolve(expandHome(env.OPENCODE_AUTH_PATH ?? defaultAuthPath(env)));
  const logPath = getDailyLogPath(env);

  return {
    dataDir,
    configPath: path.join(dataDir, "config.json"),
    profilesDir: path.join(dataDir, "profiles"),
    backupsDir: path.join(dataDir, "backups"),
    trashDir: path.join(dataDir, "trash"),
    lockPath: path.join(dataDir, "lock"),
    authPath,
    logPath,
  };
}

export function getDailyLogPath(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): string {
  return path.join(getProjectDataDir(env), "logs", `log${formatDate(now)}.log`);
}

function defaultAuthPath(env: NodeJS.ProcessEnv): string {
  return path.join(getDataHome(env), "opencode", "auth.json");
}

function getDataHome(env: NodeJS.ProcessEnv): string {
  return env.XDG_DATA_HOME ? path.resolve(expandHome(env.XDG_DATA_HOME)) : path.join(os.homedir(), ".local", "share");
}

function getProjectDataDir(env: NodeJS.ProcessEnv): string {
  return path.resolve(expandHome(env.OPENCODE_AS_HOME ?? path.join(getDataHome(env), "opencode", "opencode-as-account")));
}

function formatDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}${month}${day}`;
}
