#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
if ! command -v bun >/dev/null; then
  echo 'Install Bun 1.4.4 or newer, then run bun install.' >&2
  exit 1
fi
if [ ! -f node_modules/electron/path.txt ]; then
  echo 'Run bun install first.' >&2
  exit 1
fi
unset ELECTRON_RUN_AS_NODE
exec bun run start "$@"
