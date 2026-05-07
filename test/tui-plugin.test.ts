import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("tui plugin registers native connect command", async () => {
  const pluginPath = path.join(process.cwd(), "src", "tui-plugin.ts");
  const source = await fs.readFile(pluginPath, "utf8");

  assert.match(source, /name:\s*"as-connect"/);
  assert.match(source, /provider\.connect/);
  assert.match(source, /DialogPrompt/);
  assert.match(source, /title:\s*"Profile Name"/);
  assert.match(source, /value:\s*""/);
  assert.doesNotMatch(source, /opencode-as\.pendingProfile/);
  assert.match(source, /Saved \$\{detectedProvider\} profile/);
  assert.match(source, /waitForChangedProviderAuth/);
  assert.match(source, /readProviderHashes/);
  assert.match(source, /detectChangedProvider/);
  assert.match(source, /newlyAddedProviders/);
  assert.match(source, /Multiple provider auth changes were detected/);
  assert.match(source, /showConnectProviderFallbackDialog/);
  assert.match(source, /Select Auth Provider/);
  assert.match(source, /No provider auth change was detected/);
  assert.match(source, /Save current \$\{provider\} auth as/);
  assert.match(source, /saveConnectedProviderProfile/);
});

test("tui plugin registers accounts command with action selection", async () => {
  const pluginPath = path.join(process.cwd(), "src", "tui-plugin.ts");
  const source = await fs.readFile(pluginPath, "utf8");

  assert.match(source, /name:\s*"as-accounts"/);
  assert.match(source, /DialogSelect/);
  assert.match(source, /Select provider account/);
  assert.match(source, /sortProfilesForAccounts/);
  assert.match(source, /Provider: \$\{profile\.provider\}/);
  assert.match(source, /active for provider/);
  assert.match(source, /Select action/);
  assert.match(source, /value:\s*"use"/);
  assert.match(source, /value:\s*"reconnect"/);
  assert.match(source, /value:\s*"delete"/);
  assert.match(source, /DialogConfirm/);
  assert.match(source, /runCli\(\["use", profile\.id\]\)/);
  assert.match(source, /runCli\(\["update", profile\.id, "--provider", profile\.provider, "--current"\]\)/);
  assert.match(source, /runCli\(\["rm", profile\]\)/);
  assert.match(source, /Activated \$\{profile\.id\} for \$\{profile\.provider\}/);
});

test("tui plugin registers settings and usage-limit auto-switch hooks", async () => {
  const pluginPath = path.join(process.cwd(), "src", "tui-plugin.ts");
  const source = await fs.readFile(pluginPath, "utf8");

  assert.match(source, /name:\s*"as-settings"/);
  assert.match(source, /Account Settings/);
  assert.match(source, /value:\s*"auto-on"/);
  assert.match(source, /value:\s*"auto-off"/);
  assert.match(source, /Version: \$\{packageVersion\}/);
  assert.match(source, /value:\s*"version"/);
  assert.match(source, /loadPackageVersion/);
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
  assert.doesNotMatch(source, /summarizeEventForLog/);
  assert.doesNotMatch(source, /summary: \$\{summarizeEventForLog/);
  assert.doesNotMatch(source, /responseBody/);
  assert.match(source, /extractRetryAttempt/);
  assert.match(source, /extractPropertyNumber/);
  assert.match(source, /isInternalLimitToast/);
  assert.match(source, /extractSafeLimitText/);
  assert.match(source, /usage limit\|limit has been reached/);
  assert.match(source, /available in:/);
  assert.match(source, /formatAvailableIn/);
  assert.match(source, /account limit retry pending/);
  assert.match(source, /retryAttempt < 2/);
  assert.match(source, /account limit observed by tui/);
  assert.doesNotMatch(source, /project\.markActiveProfileLimited/);
  assert.match(source, /findNextAvailableProfile\(limitedProfile\.provider\)/);
  assert.match(source, /runCli\(\["use", nextProfile\.id\]\)/);
  assert.match(source, /Auto-switched" : "Switched"\} \$\{limitedProfile\.provider\}/);
});

test("tui plugin registers encrypted account export and import commands", async () => {
  const pluginPath = path.join(process.cwd(), "src", "tui-plugin.ts");
  const source = await fs.readFile(pluginPath, "utf8");

  assert.match(source, /name:\s*"as-export"/);
  assert.match(source, /name:\s*"as-import"/);
  assert.match(source, /Export Passphrase/);
  assert.match(source, /Import File Path/);
  assert.match(source, /Import Passphrase/);
  assert.match(source, /as-account-exported\.json\.enc/);
  assert.match(source, /exportAccountsEncrypted/);
  assert.match(source, /importAccountsEncrypted/);
});

test("tui plugin renders active profile in home footer", async () => {
  const pluginPath = path.join(process.cwd(), "src", "tui-plugin.ts");
  const source = await fs.readFile(pluginPath, "utf8");

  assert.match(source, /registerHomeFooter\(api\)/);
  assert.match(source, /slots:\s*\{[\s\S]*home_footer\(\)/);
  assert.match(source, /refreshHomeFooterStatus/);
  assert.match(source, /formatHomeFooterStatus/);
  assert.match(source, /AS: \$\{profile\.id\}/);
  assert.match(source, /profile\.provider/);
  assert.match(source, /expires: \$\{formatFooterDate\(profile\.expiresAt\)\}/);
  assert.match(source, /api\.renderer\?\.requestRender\?\.\(\)/);
});

test("server plugin handles usage-limit events", async () => {
  const pluginPath = path.join(process.cwd(), "src", "server-plugin.ts");
  const source = await fs.readFile(pluginPath, "utf8");

  assert.match(source, /event:\s*async \(\{ event \}\)/);
  assert.match(source, /server limit plugin registered/);
  assert.match(source, /session\.status/);
  assert.match(source, /message\.updated/);
  assert.match(source, /server account limit retry pending/);
  assert.match(source, /server account limit detected/);
  assert.match(source, /extractSafeLimitText/);
  assert.match(source, /properties\.info/);
  assert.doesNotMatch(source, /responseBody/);
  assert.match(source, /usage limit\|limit has been reached/);
  assert.match(source, /markActiveProfileLimited/);
});

test("tui plugin loads opencode-as CLI module directly", async () => {
  const pluginPath = path.join(process.cwd(), "src", "tui-plugin.ts");
  const source = await fs.readFile(pluginPath, "utf8");

  assert.match(source, /import\("\.\/index\.js"\)/);
  assert.doesNotMatch(source, /pathToFileURL/);
  assert.doesNotMatch(source, /spawn\(process\.execPath/);
});

test("local tui config loads built tui plugin shim", async () => {
  const configPath = path.join(process.cwd(), ".opencode", "tui.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8")) as { plugin: string[] };

  assert.deepEqual(config.plugin, ["./plugins/as-tui.ts"]);
});

test("local opencode config loads built server plugin shim", async () => {
  const configPath = path.join(process.cwd(), ".opencode", "opencode.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8")) as { plugin: string[] };

  assert.deepEqual(config.plugin, ["./plugins/as-server.ts"]);
});

test("local plugin shims load built package outputs", async () => {
  const tuiShimPath = path.join(process.cwd(), ".opencode", "plugins", "as-tui.ts");
  const serverShimPath = path.join(process.cwd(), ".opencode", "plugins", "as-server.ts");

  assert.match(await fs.readFile(tuiShimPath, "utf8"), /dist\/src\/tui-plugin\.js/);
  assert.match(await fs.readFile(serverShimPath, "utf8"), /dist\/src\/server-plugin\.js/);
});

test("package exposes separate server and tui plugin targets", async () => {
  const packagePath = path.join(process.cwd(), "package.json");
  const manifest = JSON.parse(await fs.readFile(packagePath, "utf8")) as {
    exports: Record<string, string>;
    "oc-plugin": [string, Record<string, unknown>][];
  };

  assert.equal(manifest.exports["./server"], "./dist/src/server-plugin.js");
  assert.equal(manifest.exports["./tui"], "./dist/src/tui-plugin.js");
  assert.deepEqual(manifest["oc-plugin"].map(([target]) => target), ["server", "tui"]);
});
