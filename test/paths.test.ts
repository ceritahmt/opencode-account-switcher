import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { getDailyLogPath, getRuntimePaths } from "../src/paths.js";

test("uses daily diagnostic log file under opencode data directory", () => {
  const env = { XDG_DATA_HOME: "/tmp/opencode-data" } as NodeJS.ProcessEnv;
  const date = new Date("2026-05-06T10:20:30.000Z");

  assert.equal(
    getDailyLogPath(env, date),
    path.join("/tmp/opencode-data", "opencode", "opencode-as-account", "logs", "log20260506.log"),
  );
});

test("runtime paths use opencode-as-account data directories", () => {
  const env = { XDG_DATA_HOME: "/tmp/opencode-data" } as NodeJS.ProcessEnv;
  const paths = getRuntimePaths(env);

  assert.equal(paths.dataDir, path.join("/tmp/opencode-data", "opencode", "opencode-as-account"));
  assert.equal(paths.profilesDir, path.join(paths.dataDir, "profiles"));
  assert.match(paths.logPath, /\/tmp\/opencode-data\/opencode\/opencode-as-account\/logs\/log\d{8}\.log$/);
});

test("OPENCODE_AS_HOME overrides project data directory and logs", () => {
  const env = { OPENCODE_AS_HOME: "/tmp/custom-opencode-as" } as NodeJS.ProcessEnv;
  const date = new Date("2026-05-06T10:20:30.000Z");
  const paths = getRuntimePaths(env);

  assert.equal(paths.dataDir, "/tmp/custom-opencode-as");
  assert.equal(paths.profilesDir, "/tmp/custom-opencode-as/profiles");
  assert.equal(getDailyLogPath(env, date), "/tmp/custom-opencode-as/logs/log20260506.log");
});
