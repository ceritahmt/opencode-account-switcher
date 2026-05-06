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
  assert.match(source, /Saved OpenAI profile/);
});

test("tui config loads as-tui plugin", async () => {
  const configPath = path.join(process.cwd(), ".opencode", "tui.json");
  const config = JSON.parse(await fs.readFile(configPath, "utf8")) as { plugin: string[] };

  assert.deepEqual(config.plugin, ["./plugins/as-tui.ts"]);
});
