import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("as command doc avoids raw $ARGUMENTS shell interpolation", async () => {
  const docPath = path.join(process.cwd(), ".opencode", "commands", "as.md");
  const doc = await fs.readFile(docPath, "utf8");

  assert.doesNotMatch(doc, /^!.*\$ARGUMENTS/m);
  assert.doesNotMatch(doc, /\|[^\n]*\$ARGUMENTS/);
});
