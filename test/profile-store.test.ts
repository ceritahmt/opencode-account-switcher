import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { getRuntimePaths } from "../src/paths.js";

test("snapshots current auth and switches back to it", async () => {
  const fixture = await createFixture();
  await fs.writeFile(
    fixture.authPath,
    JSON.stringify({ openai: { type: "api", key: "secret-a" }, anthropic: { type: "api", key: "keep-me" } }),
  );

  const add = await runCli(["add", "work", "--provider", "openai", "--current"], fixture.env);
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /Profile saved: work/);
  assert.doesNotMatch(add.stdout, /secret-a/);

  const paths = getRuntimePaths(fixture.env);
  const storedProfileAuth = JSON.parse(await fs.readFile(path.join(paths.profilesDir, "work", "auth.json"), "utf8")) as Record<string, unknown>;
  assert.deepEqual(Object.keys(storedProfileAuth), ["openai"]);

  await fs.writeFile(
    fixture.authPath,
    JSON.stringify({ openai: { type: "api", key: "secret-b" }, anthropic: { type: "api", key: "keep-me" } }),
  );

  const use = await runCli(["use", "work"], fixture.env);
  assert.equal(use.code, 0, use.stderr);

  const restored = JSON.parse(await fs.readFile(fixture.authPath, "utf8")) as {
    openai: { key: string };
    anthropic: { key: string };
  };
  assert.equal(restored.openai.key, "secret-a");
  assert.equal(restored.anthropic.key, "keep-me");

  const who = await runCli(["who"], fixture.env);
  assert.equal(who.code, 0, who.stderr);
  assert.match(who.stdout, /Status: synced/);
  assert.doesNotMatch(who.stdout, /secret-a/);

  const metadata = await fs.readFile(path.join(paths.profilesDir, "work", "metadata.json"), "utf8");
  assert.doesNotMatch(metadata, /secret-a/);
});

test("reports drift when active auth changes outside /as", async () => {
  const fixture = await createFixture();
  await fs.writeFile(fixture.authPath, JSON.stringify({ openai: { type: "api", key: "secret-a" } }));
  assert.equal((await runCli(["add", "work", "--current"], fixture.env)).code, 0);
  assert.equal((await runCli(["use", "work"], fixture.env)).code, 0);

  await fs.writeFile(fixture.authPath, JSON.stringify({ openai: { type: "api", key: "changed" } }));
  const who = await runCli(["who"], fixture.env);
  assert.equal(who.code, 0, who.stderr);
  assert.match(who.stdout, /Status: changed outside \/as/);
});

test("rejects malformed auth snapshots", async () => {
  const fixture = await createFixture();
  await fs.writeFile(fixture.authPath, "not json");

  const add = await runCli(["add", "work", "--current"], fixture.env);
  assert.equal(add.code, 1);
  assert.match(add.stderr, /Invalid auth\.json/);
});

test("rejects empty auth snapshots", async () => {
  const fixture = await createFixture();
  await fs.writeFile(fixture.authPath, JSON.stringify({}));

  const add = await runCli(["add", "work", "--current"], fixture.env);
  assert.equal(add.code, 1);
  assert.match(add.stderr, /Invalid auth\.json: expected a non-empty auth object\./);
});

test("rejects duplicate profiles", async () => {
  const fixture = await createFixture();
  await fs.writeFile(fixture.authPath, JSON.stringify({ openai: { type: "api", key: "secret-a" } }));

  assert.equal((await runCli(["add", "work", "--current"], fixture.env)).code, 0);
  const duplicate = await runCli(["add", "work", "--current"], fixture.env);
  assert.equal(duplicate.code, 1);
  assert.match(duplicate.stderr, /Profile already exists/);
});

test("rejects tampered profile metadata on use", async () => {
  const fixture = await createFixture();
  await fs.writeFile(fixture.authPath, JSON.stringify({ openai: { type: "api", key: "secret-a" } }));

  assert.equal((await runCli(["add", "work", "--current"], fixture.env)).code, 0);

  const paths = getRuntimePaths(fixture.env);
  const metadataPath = path.join(paths.profilesDir, "work", "metadata.json");

  await fs.writeFile(
    metadataPath,
    JSON.stringify(
      {
        id: "other",
        label: "work",
        provider: "anthropic",
        target: "opencode",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lastSelectedAt: null,
        authHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        authSource: "current-snapshot",
      },
      null,
      2,
    ) + "\n",
  );

  const use = await runCli(["use", "work"], fixture.env);
  assert.equal(use.code, 1);
  assert.match(use.stderr, /Invalid metadata id for profile: work|Invalid metadata provider for profile: work|Invalid metadata auth hash for profile: work/);
});

test("built CLI bin works after build", () => {
  const result = spawnSync(process.execPath, [path.join("dist", "src", "cli.js"), "--help"], {
    cwd: path.resolve(process.cwd()),
    encoding: "utf8",
    env: process.env,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage:/);
});

test("add without --current shows provider login/save next steps", async () => {
  const fixture = await createFixture();
  const add = await runCli(["add", "work"], fixture.env);

  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /Select provider:/);
  assert.match(add.stdout, /\/as add work --provider openai --current/);
});

test("rejects missing selected provider auth", async () => {
  const fixture = await createFixture();
  await fs.writeFile(fixture.authPath, JSON.stringify({ anthropic: { type: "api", key: "secret" } }));

  const add = await runCli(["add", "work", "--provider", "openai", "--current"], fixture.env);
  assert.equal(add.code, 1);
  assert.match(add.stderr, /Provider auth not found: openai/);
});

async function createFixture(): Promise<{ env: NodeJS.ProcessEnv; authPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-as-test-"));
  const authPath = path.join(root, "auth.json");
  return {
    authPath,
    env: {
      ...process.env,
      OPENCODE_AS_HOME: path.join(root, "data"),
      OPENCODE_AUTH_PATH: authPath,
      XDG_DATA_HOME: path.join(root, "xdg-data"),
    },
  };
}
