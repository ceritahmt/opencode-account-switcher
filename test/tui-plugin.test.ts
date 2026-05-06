import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("tui plugin registers native connect command", async () => {
  const pluginPath = path.join(process.cwd(), ".opencode", "plugins", "as-tui.ts");
  const source = await fs.readFile(pluginPath, "utf8");

  assert.match(source, /name:\s*"as-connect"/);
  assert.match(source, /provider\.connect/);
  assert.match(source, /DialogPrompt/);
  assert.match(source, /title:\s*"Profile Name"/);
  assert.match(source, /value:\s*""/);
  assert.doesNotMatch(source, /opencode-as\.pendingProfile/);
  assert.match(source, /Saved OpenAI profile/);
});

test("tui plugin registers accounts command with action selection", async () => {
  const pluginPath = path.join(process.cwd(), ".opencode", "plugins", "as-tui.ts");
  const source = await fs.readFile(pluginPath, "utf8");

  assert.match(source, /name:\s*"as-accounts"/);
  assert.match(source, /DialogSelect/);
  assert.match(source, /Select action/);
  assert.match(source, /value:\s*"use"/);
  assert.match(source, /value:\s*"reconnect"/);
  assert.match(source, /value:\s*"delete"/);
  assert.match(source, /DialogConfirm/);
  assert.match(source, /runCli\(\["use", profile\]\)/);
  assert.match(source, /runCli\(\["update", profile, "--provider", PROVIDER, "--current"\]\)/);
  assert.match(source, /runCli\(\["rm", profile\]\)/);
});

test("tui plugin registers settings and usage-limit auto-switch hooks", async () => {
  const pluginPath = path.join(process.cwd(), ".opencode", "plugins", "as-tui.ts");
  const source = await fs.readFile(pluginPath, "utf8");

  assert.match(source, /name:\s*"ac-settings"/);
  assert.match(source, /Account Settings/);
  assert.match(source, /value:\s*"auto-on"/);
  assert.match(source, /value:\s*"auto-off"/);
  assert.match(source, /value:\s*"clear-limits"/);
  assert.match(source, /api\.event\?\.on\("session\.next\.retried"/);
  assert.match(source, /api\.event\?\.on\("session\.error"/);
  assert.match(source, /api\.event\?\.on\("session\.next\.step\.failed"/);
  assert.match(source, /api\.event\?\.on\("session\.status"/);
  assert.match(source, /api\.event\?\.on\("message\.updated"/);
  assert.match(source, /api\.event\?\.on\("tui\.toast\.show"/);
  assert.match(source, /limit detection registration/);
  assert.match(source, /limit event received/);
  assert.match(source, /limit event ignored/);
  assert.match(source, /extractRetryAttempt/);
  assert.match(source, /extractPropertyNumber/);
  assert.match(source, /isInternalLimitToast/);
  assert.match(source, /could not parse your authentication token/);
  assert.match(source, /account limit retry pending/);
  assert.match(source, /retryAttempt < 2/);
  assert.match(source, /markActiveProfileLimited/);
  assert.match(source, /findNextAvailableProfile/);
  assert.match(source, /runCli\(\["use", nextProfile\]\)/);
});

test("server plugin handles usage-limit events", async () => {
  const pluginPath = path.join(process.cwd(), ".opencode", "plugins", "as-server.ts");
  const source = await fs.readFile(pluginPath, "utf8");

  assert.match(source, /event:\s*async \(\{ event \}\)/);
  assert.match(source, /server limit plugin registered/);
  assert.match(source, /session\.status/);
  assert.match(source, /message\.updated/);
  assert.match(source, /server account limit retry pending/);
  assert.match(source, /server account limit detected/);
  assert.match(source, /could not parse your authentication token/);
  assert.match(source, /markActiveProfileLimited/);
});

test("tui plugin loads opencode-as CLI module directly", async () => {
  const pluginPath = path.join(process.cwd(), ".opencode", "plugins", "as-tui.ts");
  const source = await fs.readFile(pluginPath, "utf8");

  assert.match(source, /import\(pathToFileURL\(modulePath\)\.href\)/);
  assert.doesNotMatch(source, /spawn\(process\.execPath/);
});

test("tui config loads as-tui plugin", async () => {
  const configPath = path.join(process.cwd(), ".opencode", "tui.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8")) as { plugin: string[] };

  assert.deepEqual(config.plugin, ["./plugins/as-tui.ts"]);
});

test("opencode config loads server plugin", async () => {
  const configPath = path.join(process.cwd(), ".opencode", "opencode.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8")) as { plugin: string[] };

  assert.deepEqual(config.plugin, ["./plugins/as-server.ts"]);
});
