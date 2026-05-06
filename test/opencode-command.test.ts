import assert from "node:assert/strict";
import test from "node:test";
import { parseArgumentLine } from "../src/opencode-command.js";

test("parses empty opencode command arguments", () => {
  assert.deepEqual(parseArgumentLine(""), []);
  assert.deepEqual(parseArgumentLine("   \n"), []);
});

test("parses common /as argument forms", () => {
  assert.deepEqual(parseArgumentLine("ls"), ["ls"]);
  assert.deepEqual(parseArgumentLine("add work --provider openai --current"), ["add", "work", "--provider", "openai", "--current"]);
  assert.deepEqual(parseArgumentLine("use 'work.profile'"), ["use", "work.profile"]);
});

test("rejects unclosed quotes", () => {
  assert.throws(() => parseArgumentLine("use 'work"), /Unclosed quote/);
});
