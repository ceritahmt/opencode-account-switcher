import assert from "node:assert/strict";
import test from "node:test";
import { extractProviderAuth, mergeProviderAuth, parseProviderId } from "../src/provider-auth.js";

test("extracts only selected provider auth object", () => {
  const snapshot = extractProviderAuth(
    JSON.stringify({ "zai-coding-plan": { type: "api", key: "secret-a" }, anthropic: { type: "api", key: "secret-b" } }),
    "zai-coding-plan",
  );

  const parsed = JSON.parse(snapshot.raw) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), ["zai-coding-plan"]);
  assert.match(snapshot.hash, /^sha256:[a-f0-9]{64}$/);
});

test("merges selected provider without removing other providers", () => {
  const merged = mergeProviderAuth(
    JSON.stringify({ "zai-coding-plan": { type: "api", key: "old" }, anthropic: { type: "api", key: "keep" } }),
    JSON.stringify({ "zai-coding-plan": { type: "api", key: "new" } }),
    "zai-coding-plan",
  );

  const parsed = JSON.parse(merged) as { "zai-coding-plan": { key: string }; anthropic: { key: string } };
  assert.equal(parsed["zai-coding-plan"].key, "new");
  assert.equal(parsed.anthropic.key, "keep");
});

test("parses dynamic provider ids and normalizes trailing slashes", () => {
  assert.equal(parseProviderId("zai-coding-plan"), "zai-coding-plan");
  assert.equal(parseProviderId("zai-coding-plan/"), "zai-coding-plan");
});

test("rejects invalid provider ids", () => {
  assert.throws(() => parseProviderId("bad/provider"), /Invalid provider/);
  assert.throws(() => parseProviderId("constructor"), /Invalid provider/);
  assert.throws(() => parseProviderId(""), /Invalid provider/);
});

test("rejects invalid provider auth object", () => {
  assert.throws(() => extractProviderAuth(JSON.stringify({ "zai-coding-plan": { type: "api" } }), "zai-coding-plan"), /Invalid API auth object/);
});
