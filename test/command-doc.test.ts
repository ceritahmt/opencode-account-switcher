import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("legacy markdown command is removed", async () => {
  const docPath = path.join(process.cwd(), ".opencode", "commands", "as.md");

  await assert.rejects(fs.access(docPath));
});

test("native connect slash command remains registered", async () => {
  const pluginPath = path.join(process.cwd(), "src", "tui-plugin.ts");
  const plugin = await fs.readFile(pluginPath, "utf8");

  assert.match(plugin, /slash:\s*\{[\s\S]*name:\s*"as-connect"/);
});

test("only native account slash commands are registered", async () => {
  const pluginPath = path.join(process.cwd(), "src", "tui-plugin.ts");
  const plugin = await fs.readFile(pluginPath, "utf8");
  const names = [...plugin.matchAll(/name:\s*"((?:as|ac)-[^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(names, ["as-connect", "as-accounts", "ac-settings"]);
});
