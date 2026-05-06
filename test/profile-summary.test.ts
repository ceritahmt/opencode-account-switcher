import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findNextAvailableProfile, loadAccountSettings, markActiveProfileLimited, setAutoSwitch } from "../src/account-settings.js";
import { getRuntimePaths } from "../src/paths.js";
import { ProfileStore } from "../src/profile-store.js";
import { extractProviderExpiry, listProfileSummaries } from "../src/profile-summary.js";

test("extracts provider expiry from common auth fields", () => {
  assert.equal(
    extractProviderExpiry(JSON.stringify({ openai: { type: "oauth", refresh: "r", expires_at: 1_778_083_200 } }), "openai"),
    "2026-05-06T16:00:00.000Z",
  );
  assert.equal(
    extractProviderExpiry(JSON.stringify({ openai: { type: "oauth", refresh: "r", nested: { expiresAt: "2026-05-06T16:00:00Z" } } }), "openai"),
    "2026-05-06T16:00:00.000Z",
  );
});

test("lists profile summaries with active and expiry information", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-as-summary-test-"));
  const env = {
    ...process.env,
    OPENCODE_AS_HOME: path.join(root, "data"),
    OPENCODE_AUTH_PATH: path.join(root, "auth.json"),
    XDG_DATA_HOME: path.join(root, "xdg-data"),
  } as NodeJS.ProcessEnv;
  const paths = getRuntimePaths(env);
  const store = new ProfileStore(paths);

  await fs.writeFile(paths.authPath, JSON.stringify({ openai: { type: "oauth", refresh: "refresh", expires_at: 1_778_083_200 } }));
  await store.saveCurrentProfile("work", "openai");
  await store.useProfile("work");

  const summaries = await listProfileSummaries(paths);

  assert.deepEqual(summaries, [
    {
      id: "work",
      provider: "openai",
      isActive: true,
      lastSelectedAt: summaries[0]?.lastSelectedAt,
      expiresAt: "2026-05-06T16:00:00.000Z",
      isLimited: false,
      limitedAt: null,
      limitedReason: null,
    },
  ]);
  assert.match(summaries[0]?.lastSelectedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("stores auto-switch setting and limited profile state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-as-settings-test-"));
  const env = {
    ...process.env,
    OPENCODE_AS_HOME: path.join(root, "data"),
    OPENCODE_AUTH_PATH: path.join(root, "auth.json"),
    XDG_DATA_HOME: path.join(root, "xdg-data"),
  } as NodeJS.ProcessEnv;
  const paths = getRuntimePaths(env);
  const store = new ProfileStore(paths);

  await fs.writeFile(paths.authPath, JSON.stringify({ openai: { type: "api", key: "secret-a" } }));
  await store.saveCurrentProfile("a", "openai");
  await fs.writeFile(paths.authPath, JSON.stringify({ openai: { type: "api", key: "secret-b" } }));
  await store.saveCurrentProfile("b", "openai");
  await store.useProfile("a");

  assert.deepEqual(await loadAccountSettings(paths), { autoSwitch: false });
  assert.deepEqual(await setAutoSwitch(paths, true), { autoSwitch: true });
  assert.equal(await markActiveProfileLimited(paths, "The usage limit has been reached"), "a");

  const summaries = await listProfileSummaries(paths);
  assert.equal(summaries.find((profile) => profile.id === "a")?.isLimited, true);
  assert.equal(summaries.find((profile) => profile.id === "a")?.limitedReason, "The usage limit has been reached");
  assert.equal((await findNextAvailableProfile(paths))?.id, "b");
});
