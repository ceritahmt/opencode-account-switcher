# opencode-as

OpenCode auth profile switcher for provider-specific OpenAI auth objects.

## MVP commands

```text
/as
/as ls
/as who
/as add <name>
/as add <name> --provider openai --current
/as use <name>
/as <name>
/as rm <name>
/as providers
/as-connect
```

`/as-connect` opens a native TUI prompt for the profile name, then opens OpenCode's native interactive provider login/connect dialog through the TUI plugin. After OpenAI auth changes, it auto-saves that provider object as the chosen profile.

After OpenCode login/connect completes, save only the selected provider object from OpenCode auth:

```text
/as-connect
/as use work
```

If auto-save times out, save manually:

```text
/as add work --provider openai --current
```

When run directly in a real terminal, this can also delegate to OpenCode's public providers CLI:

```bash
npm run as -- add work --provider openai --login
```

Interactive login is intentionally not run from the OpenCode markdown command because it is not a reliable TTY prompt environment.
The native interactive path is `/as-connect`, which triggers OpenCode's `provider.connect` TUI command.

## OpenCode command integration

This repository includes `.opencode/commands/as.md`, which exposes `/as` as an OpenCode markdown command that runs the local CLI.

Public OpenCode plugin APIs currently expose hooks and tools, but not stable slash-command registration from plugins. The reliable MVP integration is therefore CLI + markdown command.

## Storage

Default data directory:

```text
~/.config/opencode/plugins/opencode-as/
```

Default auth target:

```text
~/.local/share/opencode/auth.json
```

You can override with `OPENCODE_AUTH_PATH`.

Debug log:

```text
~/.local/share/opencode/opencode-as-account.log
```

The log stores command status and sanitized errors only; auth tokens are redacted and should never be printed.

Environment overrides for tests/dev:

```bash
OPENCODE_AS_HOME=/tmp/opencode-as-dev
OPENCODE_AUTH_PATH=/tmp/auth.json
```

`profiles/`, `backups/`, and `trash/` contain auth secrets and are written with restrictive permissions where supported. Profiles store only the selected provider object, not the entire auth file.
