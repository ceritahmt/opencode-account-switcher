import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { appendProjectLog } from "../src/log.js";
import { getRuntimePaths } from "../src/paths.js";

test("runCli writes command lifecycle logs", async () => {
  const fixture = await createFixture();
  const result = await runCli(["providers"], fixture.env);

  assert.equal(result.code, 0, result.stderr);

  const log = await fs.readFile(getRuntimePaths(fixture.env).logPath, "utf8");
  const entries = parseLogEntries(log);

  assert.deepEqual(entries.map((entry) => entry.event), ["cli command started", "cli command completed"]);
  assert.equal(entries[0]?.level, "info");
  assert.deepEqual(entries[0]?.details, ["command: providers", "args: <none>"]);
  assert.equal(entries[1]?.level, "info");
  assert.deepEqual(entries[1]?.details, ["command: providers", "exitCode: 0", "stdout: present"]);
});

test("runCli writes failed command logs", async () => {
  const fixture = await createFixture();
  const result = await runCli(["unknown", "extra"], fixture.env);

  assert.equal(result.code, 1);

  const log = await fs.readFile(getRuntimePaths(fixture.env).logPath, "utf8");
  const entries = parseLogEntries(log);

  assert.equal(entries.at(-1)?.level, "error");
  assert.equal(entries.at(-1)?.event, "cli command failed");
  assert.deepEqual(entries.at(-1)?.details, ["command: unknown", "error: Unknown command: unknown"]);
});

test("project logger redacts common secrets", async () => {
  const fixture = await createFixture();
  const paths = getRuntimePaths(fixture.env);

  await appendProjectLog(paths, {
    event: "test sk-abcdefghijklmnopqrstuvwxyz",
    details: ['authorization: Bearer secret-token', '{"key":"plain-secret","nested":{"token":"nested-secret"}}'],
  });

  const log = await fs.readFile(paths.logPath, "utf8");
  assert.doesNotMatch(log, /sk-abcdefghijklmnopqrstuvwxyz/);
  assert.doesNotMatch(log, /secret-token/);
  assert.doesNotMatch(log, /plain-secret/);
  assert.doesNotMatch(log, /nested-secret/);
  assert.match(log, /\[redacted-openai-key\]/);
  assert.match(log, /Bearer \[redacted-token\]/);
});

async function createFixture(): Promise<{ env: NodeJS.ProcessEnv }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-as-log-test-"));
  return {
    env: {
      ...process.env,
      OPENCODE_AS_HOME: path.join(root, "data"),
      OPENCODE_AUTH_PATH: path.join(root, "auth.json"),
      XDG_DATA_HOME: path.join(root, "xdg-data"),
    },
  };
}

function parseLogEntries(raw: string): Array<{ level: string; event: string; details: string[] }> {
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { level: string; event: string; details: string[] });
}
