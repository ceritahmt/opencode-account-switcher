# opencode-as

OpenCode auth profile switcher for provider-specific OpenAI auth objects.

## MVP commands

```text
/as-connect
/as-accounts
```

`/as-connect` opens a native TUI prompt for the profile name, then opens OpenCode's native interactive provider login/connect dialog through the TUI plugin. After OpenAI auth changes, it auto-saves that provider object as the chosen profile.

`/as-accounts` opens a native TUI account list. Select a profile first, then choose an action such as `Use` or `Delete`. If the saved provider auth contains an expiry field, it is shown in the list.

After OpenCode login/connect completes, switch profiles with `/as-accounts` or the CLI:

```text
/as-connect
/as-accounts
npm run as -- use work
```

If auto-save times out, save manually:

```text
npm run as -- add work --provider openai --current
```

When run directly in a real terminal, this can also delegate to OpenCode's public providers CLI:

```bash
npm run as -- add work --provider openai --login
```

Interactive login is intentionally not run from the OpenCode markdown command because it is not a reliable TTY prompt environment.
The native interactive path is `/as-connect`, which triggers OpenCode's `provider.connect` TUI command.

## OpenCode command integration

`/as-connect` and `/as-accounts` are native TUI paths and are implemented via `.opencode/plugins/as-tui.ts`.

Public OpenCode plugin APIs currently expose hooks and tools, but not stable slash-command registration for `/as`. The reliable MVP integration is therefore CLI + native `/as-connect`.

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

Logs are written as pino-like JSONL entries with `time`, `level`, `event`, and `details` fields. They store command status, `/as-connect` diagnostic steps, and sanitized errors only; auth tokens are redacted and should never be printed.

Environment overrides for tests/dev:

```bash
OPENCODE_AS_HOME=/tmp/opencode-as-dev
OPENCODE_AUTH_PATH=/tmp/auth.json
```

`profiles/`, `backups/`, and `trash/` contain auth secrets and are written with restrictive permissions where supported. Profiles store only the selected provider object, not the entire auth file.
