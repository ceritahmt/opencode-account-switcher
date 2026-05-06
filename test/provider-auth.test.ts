import assert from "node:assert/strict";
import test from "node:test";
import { extractProviderAuth, mergeProviderAuth, parseProviderId } from "../src/provider-auth.js";

test("extracts only selected provider auth object", () => {
  const snapshot = extractProviderAuth(
    JSON.stringify({ openai: { type: "api", key: "secret-a" }, anthropic: { type: "api", key: "secret-b" } }),
    "openai",
  );

  const parsed = JSON.parse(snapshot.raw) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), ["openai"]);
  assert.match(snapshot.hash, /^sha256:[a-f0-9]{64}$/);
});

test("merges selected provider without removing other providers", () => {
  const merged = mergeProviderAuth(
    JSON.stringify({ openai: { type: "api", key: "old" }, anthropic: { type: "api", key: "keep" } }),
    JSON.stringify({ openai: { type: "api", key: "new" } }),
    "openai",
  );

  const parsed = JSON.parse(merged) as { openai: { key: string }; anthropic: { key: string } };
  assert.equal(parsed.openai.key, "new");
  assert.equal(parsed.anthropic.key, "keep");
});

test("rejects unsupported providers", () => {
  assert.throws(() => parseProviderId("anthropic"), /Unsupported provider/);
});

test("rejects invalid provider auth object", () => {
  assert.throws(() => extractProviderAuth(JSON.stringify({ openai: { type: "api" } }), "openai"), /Invalid API auth object/);
});
