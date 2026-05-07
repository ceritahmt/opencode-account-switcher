import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findNextAvailableProfile, loadAccountSettings, markActiveProfileLimited, resetOpenCodeAuth, setAutoSwitch } from "../src/account-settings.js";
import { loadConfig, saveConfig } from "../src/config.js";
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
      availableAt: null,
    },
  ]);
  assert.match(summaries[0]?.lastSelectedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
});

test("marks active profiles per provider from current auth", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-as-provider-active-test-"));
  const env = {
    ...process.env,
    OPENCODE_AS_HOME: path.join(root, "data"),
    OPENCODE_AUTH_PATH: path.join(root, "auth.json"),
    XDG_DATA_HOME: path.join(root, "xdg-data"),
  } as NodeJS.ProcessEnv;
  const paths = getRuntimePaths(env);
  const store = new ProfileStore(paths);

  await fs.writeFile(
    paths.authPath,
    JSON.stringify({ openai: { type: "api", key: "openai-a" }, "zai-coding-plan": { type: "api", key: "zai-a" } }),
  );
  await store.saveCurrentProfile("openai-a", "openai");
  await store.saveCurrentProfile("zai-a", "zai-coding-plan");

  await fs.writeFile(
    paths.authPath,
    JSON.stringify({ openai: { type: "api", key: "openai-b" }, "zai-coding-plan": { type: "api", key: "zai-a" } }),
  );
  await store.saveCurrentProfile("openai-b", "openai");

  const summaries = await listProfileSummaries(paths);
  assert.equal(summaries.find((profile) => profile.id === "openai-a")?.isActive, false);
  assert.equal(summaries.find((profile) => profile.id === "openai-b")?.isActive, true);
  assert.equal(summaries.find((profile) => profile.id === "zai-a")?.isActive, true);
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
  const limited = summaries.find((profile) => profile.id === "a");
  assert.equal(limited?.isLimited, true);
  assert.equal(limited?.limitedReason, "The usage limit has been reached");
  assert.match(limited?.availableAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Date.parse(limited?.availableAt ?? "") > Date.now());
  assert.equal((await findNextAvailableProfile(paths, "openai"))?.id, "b");
});

test("resets OpenCode auth with backup and clears active profile", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-as-reset-auth-test-"));
  const env = {
    ...process.env,
    OPENCODE_AS_HOME: path.join(root, "data"),
    OPENCODE_AUTH_PATH: path.join(root, "auth.json"),
    XDG_DATA_HOME: path.join(root, "xdg-data"),
  } as NodeJS.ProcessEnv;
  const paths = getRuntimePaths(env);
  const store = new ProfileStore(paths);
  const authRaw = JSON.stringify({ openai: { type: "api", key: "secret-a" } });

  await fs.writeFile(paths.authPath, authRaw);
  await store.saveCurrentProfile("a", "openai");
  await store.useProfile("a");
  const authBeforeReset = await fs.readFile(paths.authPath, "utf8");

  const result = await resetOpenCodeAuth(paths);

  assert.equal(result.authPath, paths.authPath);
  assert.ok(result.backupPath?.endsWith("-reset.auth.json"));
  assert.equal(await fs.readFile(paths.authPath, "utf8"), "{}\n");
  assert.equal(await fs.readFile(result.backupPath ?? "", "utf8"), authBeforeReset);
  assert.equal((await loadConfig(paths)).activeProfile, null);

  await store.useProfile("a");
  assert.deepEqual(JSON.parse(await fs.readFile(paths.authPath, "utf8")), { openai: { type: "api", key: "secret-a" } });
  assert.equal((await loadConfig(paths)).activeProfile, "a");
});

test("finds next available profile within the same provider", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-as-provider-next-test-"));
  const env = {
    ...process.env,
    OPENCODE_AS_HOME: path.join(root, "data"),
    OPENCODE_AUTH_PATH: path.join(root, "auth.json"),
    XDG_DATA_HOME: path.join(root, "xdg-data"),
  } as NodeJS.ProcessEnv;
  const paths = getRuntimePaths(env);
  const store = new ProfileStore(paths);

  await fs.writeFile(
    paths.authPath,
    JSON.stringify({ openai: { type: "api", key: "openai-a" }, "zai-coding-plan": { type: "api", key: "zai-a" } }),
  );
  await store.saveCurrentProfile("openai-a", "openai");
  await store.saveCurrentProfile("zai-a", "zai-coding-plan");

  await fs.writeFile(
    paths.authPath,
    JSON.stringify({ openai: { type: "api", key: "openai-b" }, "zai-coding-plan": { type: "api", key: "zai-a" } }),
  );
  await store.saveCurrentProfile("openai-b", "openai");
  await store.useProfile("openai-b");
  await markActiveProfileLimited(paths, "The usage limit has been reached");

  assert.equal((await findNextAvailableProfile(paths, "openai"))?.id, "openai-a");
  assert.equal(await findNextAvailableProfile(paths, "zai-coding-plan"), null);
});

test("limited marker ignores stale configured active profile", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-as-stale-active-test-"));
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
  await store.useProfile("a");

  await fs.writeFile(paths.authPath, JSON.stringify({ openai: { type: "api", key: "secret-b" } }));
  await store.saveCurrentProfile("b", "openai");

  assert.equal(await markActiveProfileLimited(paths, "The usage limit has been reached"), "b");

  const summaries = await listProfileSummaries(paths);
  assert.equal(summaries.find((profile) => profile.id === "a")?.isLimited, false);
  assert.equal(summaries.find((profile) => profile.id === "b")?.isLimited, true);
});

test("treats expired limited markers as available", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-as-expired-limit-test-"));
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

  await markActiveProfileLimited(paths, "The usage limit has been reached");
  const config = await loadConfig(paths);
  await saveConfig(paths, {
    ...config,
    profileStatus: {
      ...config.profileStatus,
      a: {
        ...(config.profileStatus["a"] ?? {}),
        availableAt: new Date(Date.now() - 60_000).toISOString(),
      },
    },
  });

  const summaries = await listProfileSummaries(paths);
  assert.equal(summaries.find((profile) => profile.id === "a")?.isLimited, false);
  assert.equal(summaries.find((profile) => profile.id === "a")?.limitedReason, null);
});

test("infers active profile from current auth when config has no active profile", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-as-infer-active-test-"));
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

  assert.equal(await markActiveProfileLimited(paths, "The usage limit has been reached"), "b");

  const summaries = await listProfileSummaries(paths);
  assert.equal(summaries.find((profile) => profile.id === "b")?.isActive, true);
  assert.equal(summaries.find((profile) => profile.id === "b")?.isLimited, true);
  assert.match(summaries.find((profile) => profile.id === "b")?.availableAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal((await findNextAvailableProfile(paths, "openai"))?.id, "a");
});
