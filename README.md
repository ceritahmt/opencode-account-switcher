# OpenCode OpenAI / ChatGPT Account Switcher

Package name: `@ceritahmt/opencode-as`.

CLI name: `opencode-as`.

Repository: https://github.com/ceritahmt/opencode-account-switcher

OpenCode OpenAI account switcher for ChatGPT-style multi-account workflows.

`opencode-as` helps manage multiple OpenAI / ChatGPT accounts in OpenCode by saving provider-specific auth objects as local profiles, switching between accounts from the native TUI, and handling usage-limit events with optional auto-switch.

## Installation

Recommended install:

```bash
opencode plugin @ceritahmt/opencode-as@latest --global
```

If OpenCode has a stale cached `@latest` package, clear the package cache and reinstall with `--force`:

```bash
rm -rf ~/.cache/opencode/packages/@ceritahmt/opencode-as@latest
opencode plugin @ceritahmt/opencode-as@latest --global --force
```

This uses OpenCode's plugin installer. Because the package exposes both `./server` and `./tui` entrypoints, the installer can add the server plugin and the TUI slash-command plugin to the correct OpenCode config files.

Use the same command without `--global` if you only want to install it for the current project.

If OpenCode says only `Detected server target`, it is using an older cached `@latest` package. Either clear the cache with the command above or install an exact version, then restart OpenCode:

```bash
opencode plugin @ceritahmt/opencode-as@<version> --global --force
```

## Uninstall

OpenCode currently installs plugins by writing them into config files. To uninstall globally, remove `@ceritahmt/opencode-as` from both global plugin config files and clear the cached package:

```bash
node - <<'NODE'
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const packageName = "@ceritahmt/opencode-as";
const files = [
  path.join(os.homedir(), ".config/opencode/opencode.json"),
  path.join(os.homedir(), ".config/opencode/tui.json"),
];

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  config.plugin = (config.plugin ?? []).filter((plugin) => !String(plugin).startsWith(packageName));
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
}
NODE

rm -rf ~/.cache/opencode/packages/@ceritahmt/opencode-as@latest
```

This does not delete saved account profiles. If you also want to remove local profile data, delete it manually after making sure you do not need the saved auth snapshots:

```bash
rm -rf ~/.local/share/opencode/opencode-as-account
```

Manual setup is also possible: add `@ceritahmt/opencode-as@latest` to both OpenCode plugin config files.

`.opencode/opencode.json` loads the server plugin:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@ceritahmt/opencode-as@latest"]
}
```

`.opencode/tui.json` loads the TUI slash commands:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@ceritahmt/opencode-as@latest"]
}
```

If you already have plugins, keep them and add `@ceritahmt/opencode-as@latest` to the same `plugin` array. Restart OpenCode after installing or changing config.

## MVP commands

```text
/as-connect
/as-accounts
/as-settings
```

`/as-connect` opens a native TUI prompt for the profile name, then opens OpenCode's native interactive provider login/connect dialog through the TUI plugin. After OpenAI auth changes, it auto-saves that provider object as the chosen profile.

`/as-accounts` opens a native TUI account list. Select a profile first, then choose `Use`, `Reconnect`, or `Delete`. If the saved provider auth contains an expiry field, it is shown in the list.

`/as-settings` opens account settings. It can enable or disable auto-switch, clear locally remembered limited-account markers, and show the installed package version.

After OpenCode login/connect completes, switch profiles with `/as-accounts`:

```text
/as-connect
/as-accounts
/as-settings
```

Interactive login is intentionally not run from the OpenCode markdown command because it is not a reliable TTY prompt environment.
The native interactive path is `/as-connect`, which triggers OpenCode's `provider.connect` TUI command.

## OpenCode usage

1. Add the package to both OpenCode config files:
   - `.opencode/opencode.json` for the server plugin
   - `.opencode/tui.json` for the TUI slash commands
2. Restart OpenCode so plugin config is reloaded.
3. In the OpenCode TUI, run `/as-connect` and enter a profile name.
4. Complete OpenCode's native OpenAI connect/login flow.
5. Open `/as-accounts` to view saved profiles, switch accounts, reconnect expired auth, or delete a profile.
6. Open `/as-settings` to enable/disable auto-switch, clear limited markers, and see the installed package version.

When OpenCode reports a usage-limit message, the plugin marks the current profile as limited for 5 hours. If auto-switch is disabled it asks before switching; if auto-switch is enabled it switches to the next available profile automatically.

## OpenCode command integration

`/as-connect`, `/as-accounts`, and `/as-settings` are native TUI paths and are implemented by the package TUI plugin (`./tui`).
Usage/auth error capture is exported as the package server plugin (`./server`), so server-side retry/status events can mark the active profile as limited even when the TUI event bus does not receive the retry banner.

Published setup needs both OpenCode config files:

The easiest way is OpenCode's plugin installer:

```bash
opencode plugin @ceritahmt/opencode-as@latest --global
```

This is different from manually adding the package only to `opencode.json`: `opencode.json` loads server hooks, while `tui.json` loads `/as-connect`, `/as-accounts`, and `/as-settings`.

`.opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@ceritahmt/opencode-as@latest"]
}
```

`.opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["@ceritahmt/opencode-as@latest"]
}
```

`opencode.json` loads the server plugin. `tui.json` loads the native slash commands. If only `opencode.json` is configured, usage-limit detection may work but `/as-connect`, `/as-accounts`, and `/as-settings` will not appear.

It can be used alongside other OpenCode plugins:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "@ceritahmt/opencode-as@latest",
    "oh-my-opencode-slim",
    "@tarquinen/opencode-dcp@latest"
  ]
}
```

Keep `.opencode/tui.json` with `@ceritahmt/opencode-as@latest` as shown above for the TUI commands.

For local development from this repository, use the checked-in local shims instead:

`.opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["./plugins/as-server.ts"]
}
```

`.opencode/tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["./plugins/as-tui.ts"]
}
```

Run `npm run build`, then restart OpenCode so the shims load `dist/src/server-plugin.js` and `dist/src/tui-plugin.js`.

Public OpenCode plugin APIs currently expose hooks and tools, so the reliable MVP integration is CLI + the native TUI commands listed above.

## Usage/auth error auto-switch

The server/TUI plugins listen for OpenCode `session.next.retried`, `session.error`, `session.next.step.failed`, `session.status`, `message.updated`, and `tui.toast.show` events. If an event message contains `usage limit` or `limit has been reached`, the first retry is logged and `attempt #2` marks the active profile as limited in `config.json` for 5 hours.

- If auto-switch is disabled, the TUI asks for confirmation before switching to the next available profile.
- If auto-switch is enabled via `/as-settings`, it switches to the next available profile automatically.
- `/as-accounts` shows limited profiles with remaining time, for example `available in: 4h 59m`.
- Limited markers are local runtime state and can be cleared from `/as-settings`.

## Storage

Default data directory:

```text
~/.local/share/opencode/opencode-as-account/
```

Profile snapshots:

```text
~/.local/share/opencode/opencode-as-account/profiles/<profile-name>/auth.json
```

Default auth target:

```text
~/.local/share/opencode/auth.json
```

You can override with `OPENCODE_AUTH_PATH`.

Debug log:

```text
~/.local/share/opencode/opencode-as-account/logs/logYYYYMMDD.log
```

Example:

```text
~/.local/share/opencode/opencode-as-account/logs/log20260506.log
```

Logs are written as pino-like JSONL entries with `time`, `level`, `event`, and `details` fields. They store command status, `/as-connect`, `/as-accounts`, `/as-settings`, usage-limit detection steps, and sanitized errors only; auth tokens are redacted and should never be printed.

Environment overrides for tests/dev:

```bash
OPENCODE_AS_HOME=/tmp/opencode-as-dev
OPENCODE_AUTH_PATH=/tmp/auth.json
```

`profiles/`, `backups/`, and `trash/` contain auth secrets and are written with restrictive permissions where supported. Profiles store only the selected provider object, not the entire auth file.
