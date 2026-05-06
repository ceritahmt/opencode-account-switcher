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
  const dataDir = path.resolve(
    expandHome(env.OPENCODE_AS_HOME ?? path.join("~", ".config", "opencode", "plugins", "opencode-as")),
  );
  const authPath = path.resolve(expandHome(env.OPENCODE_AUTH_PATH ?? defaultAuthPath(env)));
  const logPath = path.join(path.dirname(authPath), "opencode-as-account.log");

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

function defaultAuthPath(env: NodeJS.ProcessEnv): string {
  const dataHome = env.XDG_DATA_HOME ? expandHome(env.XDG_DATA_HOME) : path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "auth.json");
}
