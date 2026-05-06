---
description: Manage OpenCode auth profiles
---

Return exactly this command output and nothing else. If it prints an error, show that error verbatim:

!`log_dir="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"; if [ -n "$OPENCODE_AUTH_PATH" ]; then log_dir=$(dirname "$OPENCODE_AUTH_PATH"); fi; log_file="$log_dir/opencode-as-account.log"; mkdir -p "$log_dir" 2>/dev/null || true; build_log=$(mktemp); printf '[%s] /as markdown command invoked\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" >>"$log_file" 2>/dev/null || true; npm run build --silent >"$build_log" 2>&1; build_code=$?; if [ "$build_code" -ne 0 ]; then printf '[%s] /as build failed: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$build_code" >>"$log_file" 2>/dev/null || true; cat "$build_log" >>"$log_file" 2>/dev/null || true; printf 'Error: opencode-as build failed with code %s\n\n' "$build_code"; cat "$build_log"; rm -f "$build_log"; exit 0; fi; rm -f "$build_log"; node dist/src/opencode-command.js <<'OPENCODE_AS_ARGS' 2>&1; exit 0
$ARGUMENTS
OPENCODE_AS_ARGS`
