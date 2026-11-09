#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CORE="${1:?Provide the absolute path to easytier-core}"
CLI="${2:?Provide the absolute path to easytier-cli}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
node "$ROOT/Tests/real-core-config.cjs" "$TMP"
"$CORE" -c "$TMP/vpn-false.toml" --check-config
"$CORE" -c "$TMP/vpn-true.toml" --check-config
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')"
swiftc "$ROOT/Sources/CoreRuntime.swift" "$ROOT/Sources/Shell.swift" "$ROOT/Tests/real-core-smoke.swift" -o "$TMP/smoke-test"
"$TMP/smoke-test" "$CORE" "$CLI" "$TMP" "$PORT"
