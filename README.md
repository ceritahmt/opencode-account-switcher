# opencode-as

OpenCode auth profile switcher for OpenAI account snapshots.

## MVP commands

```text
/as
/as ls
/as who
/as add <name> --current
/as use <name>
/as <name>
/as rm <name>
/as providers
```

The MVP does not implement a new OpenAI login flow. Profile creation snapshots the current `~/.config/opencode/auth.json`:

```bash
npm run as -- add work --current
npm run as -- use work
```

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
~/.config/opencode/auth.json
```

Environment overrides for tests/dev:

```bash
OPENCODE_AS_HOME=/tmp/opencode-as-dev
OPENCODE_AUTH_PATH=/tmp/auth.json
```

`profiles/`, `backups/`, and `trash/` contain auth secrets and are written with restrictive permissions where supported.
