#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$ROOT"
node --check ui/app.js
node --check ui/config.js
node --check ui/bridge.js
node --test Tests/ui.test.cjs
swiftc -target arm64-apple-macos13.0 -typecheck Sources/*.swift
swiftc Sources/PrivilegeSession.swift Sources/CoreRuntime.swift Sources/Shell.swift Sources/LogReader.swift Tests/native-tests.swift -o "$TMP/native-tests"
"$TMP/native-tests" "$(command -v python3)"
swiftc -D PRIVILEGE_TESTING Sources/PrivilegeSession.swift Sources/CoreRuntime.swift Sources/Shell.swift Tests/privilege-session-tests.swift -o "$TMP/privilege-session-tests"
"$TMP/privilege-session-tests"
if [[ "${1:-}" == "--webkit" ]]; then
  swiftc -parse-as-library Tests/webkit-tests.swift -o "$TMP/webkit-tests"
  "$TMP/webkit-tests" "$ROOT/ui"
fi
