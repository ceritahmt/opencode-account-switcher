# OpenCode OpenAI / ChatGPT Account Switcher

Package name: `@ceritahmt/opencode-as`.

CLI name: `opencode-as`.

Repository: https://github.com/ceritahmt/opencode-account-switcher

OpenCode OpenAI account switcher for ChatGPT-style multi-account workflows.

`opencode-as` helps manage multiple OpenAI / ChatGPT accounts in OpenCode by saving provider-specific auth objects as local profiles, switching between accounts from the native TUI, and handling usage-limit or auth-token errors with optional auto-switch.

## MVP commands

```text
/as-connect
/as-accounts
/ac-settings
```

`/as-connect` opens a native TUI prompt for the profile name, then opens OpenCode's native interactive provider login/connect dialog through the TUI plugin. After OpenAI auth changes, it auto-saves that provider object as the chosen profile.

`/as-accounts` opens a native TUI account list. Select a profile first, then choose `Use`, `Reconnect`, or `Delete`. If the saved provider auth contains an expiry field, it is shown in the list.

`/ac-settings` opens account settings. It can enable or disable auto-switch and clear locally remembered limited-account markers.

After OpenCode login/connect completes, switch profiles with `/as-accounts`:

```text
/as-connect
/as-accounts
/ac-settings
```

Interactive login is intentionally not run from the OpenCode markdown command because it is not a reliable TTY prompt environment.
The native interactive path is `/as-connect`, which triggers OpenCode's `provider.connect` TUI command.

## OpenCode command integration

`/as-connect`, `/as-accounts`, and `/ac-settings` are native TUI paths and are implemented via `.opencode/plugins/as-tui.ts`.
Usage/auth error capture is exported from the package root as an OpenCode server plugin, so server-side retry/status events can mark the active profile as limited even when the TUI event bus does not receive the retry banner.

Published OpenCode server plugin config:

```json
{
  "plugin": ["@ceritahmt/opencode-as@latest"]
}
```

It can be used alongside other OpenCode plugins:

```json
{
  "plugin": [
    "@ceritahmt/opencode-as@latest",
    "oh-my-opencode-slim",
    "@tarquinen/opencode-dcp@latest"
  ]
}
```

Public OpenCode plugin APIs currently expose hooks and tools, so the reliable MVP integration is CLI + the native TUI commands listed above.

## Usage/auth error auto-switch

The server/TUI plugins listen for OpenCode `session.next.retried`, `session.error`, `session.next.step.failed`, `session.status`, `message.updated`, and `tui.toast.show` events. If an event message looks like a usage/rate limit (`usage limit`, `rate limit`, `too many requests`, `429`, or quota text) or an auth-token problem (`Could not parse your authentication token`, `Please try signing in again`), the first retry is logged and `attempt #2` marks the active profile as limited in `config.json`.

- If auto-switch is disabled, the TUI asks for confirmation before switching to the next available profile.
- If auto-switch is enabled via `/ac-settings`, it switches to the next available profile automatically.
- Limited markers are local runtime state and can be cleared from `/ac-settings`.

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

Logs are written as pino-like JSONL entries with `time`, `level`, `event`, and `details` fields. They store command status, `/as-connect`, `/as-accounts`, `/ac-settings`, usage-limit detection steps, and sanitized errors only; auth tokens are redacted and should never be printed.

Environment overrides for tests/dev:

```bash
OPENCODE_AS_HOME=/tmp/opencode-as-dev
OPENCODE_AUTH_PATH=/tmp/auth.json
```

`profiles/`, `backups/`, and `trash/` contain auth secrets and are written with restrictive permissions where supported. Profiles store only the selected provider object, not the entire auth file.
