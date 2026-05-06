---
description: Manage OpenCode auth profiles
---

Run the local `opencode-as` CLI with the requested arguments and return only the CLI output.

Allowed forms:

- no arguments: `npm run as --`
- `help`: `npm run as -- help`
- `ls`: `npm run as -- ls`
- `who`: `npm run as -- who`
- `providers`: `npm run as -- providers`
- `add <name>`: `npm run as -- add <name>`
- `add <name> --provider openai --current`: `npm run as -- add <name> --provider openai --current`
- `use <name>`: `npm run as -- use <name>`
- `<name>`: `npm run as -- <name>`
- `rm <name>`: `npm run as -- rm <name>`

Before running a shell command, validate profile names with this pattern only: `^[a-zA-Z0-9._-]{1,64}$`.
Do not interpolate raw `$ARGUMENTS` into a shell command.

Security rules:

- Do not print or inspect auth token contents.
- If the command fails, return only the sanitized error output.
- Use `/as add <name> --current` for MVP profile creation.
