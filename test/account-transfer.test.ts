import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { exportAccountsEncrypted, importAccountsEncrypted } from "../src/account-transfer.js";
import { getRuntimePaths } from "../src/paths.js";
import { ProfileStore } from "../src/profile-store.js";

test("exports and imports all profiles as encrypted account backup", async () => {
  const source = await createFixture();
  const sourcePaths = getRuntimePaths(source.env);
  const sourceStore = new ProfileStore(sourcePaths);

  await fs.writeFile(source.authPath, JSON.stringify({ openai: { type: "api", key: "secret-a" } }));
  await sourceStore.saveCurrentProfile("alpha");
  await fs.writeFile(source.authPath, JSON.stringify({ openai: { type: "api", key: "secret-b" } }));
  await sourceStore.saveCurrentProfile("beta");

  const outputPath = path.join(source.root, "as-account-exported.json.enc");
  const exported = await exportAccountsEncrypted(sourcePaths, { outputPath, passphrase: "test-passphrase" });
  assert.equal(exported.profileCount, 2);

  const encryptedRaw = await fs.readFile(outputPath, "utf8");
  assert.match(encryptedRaw, /aes-256-gcm/);
  assert.doesNotMatch(encryptedRaw, /secret-a/);
  assert.doesNotMatch(encryptedRaw, /secret-b/);

  const target = await createFixture();
  const targetPaths = getRuntimePaths(target.env);
  const imported = await importAccountsEncrypted(targetPaths, { inputPath: outputPath, passphrase: "test-passphrase" });
  assert.equal(imported.importedProfileCount, 2);

  const targetStore = new ProfileStore(targetPaths);
  const profiles = await targetStore.listProfiles();
  assert.deepEqual(profiles.map((profile) => profile.id), ["alpha", "beta"]);

  const betaAuth = await fs.readFile(path.join(targetPaths.profilesDir, "beta", "auth.json"), "utf8");
  assert.match(betaAuth, /secret-b/);
});

test("refuses to overwrite an existing export file", async () => {
  const fixture = await createFixture();
  const paths = getRuntimePaths(fixture.env);
  const outputPath = path.join(fixture.root, "as-account-exported.json.enc");
  await fs.writeFile(outputPath, "existing");

  await assert.rejects(
    exportAccountsEncrypted(paths, { outputPath, passphrase: "test-passphrase" }),
    /Export file already exists/,
  );
});

async function createFixture(): Promise<{ root: string; env: NodeJS.ProcessEnv; authPath: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-as-transfer-test-"));
  const authPath = path.join(root, "auth.json");
  return {
    root,
    authPath,
    env: {
      ...process.env,
      OPENCODE_AS_HOME: path.join(root, "data"),
      OPENCODE_AUTH_PATH: authPath,
      XDG_DATA_HOME: path.join(root, "xdg-data"),
    },
  };
}
