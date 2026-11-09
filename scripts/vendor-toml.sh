#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
npm install --prefix "$TMP" --no-audit --no-fund --ignore-scripts smol-toml@1.9.1 esbuild@0.28.2
printf '%s\n' "export {parse,stringify} from 'smol-toml';" > "$TMP/entry.js"
mkdir -p "$ROOT/ui/vendor"
"$TMP/node_modules/.bin/esbuild" "$TMP/entry.js" --bundle --format=iife --global-name=EasyTierTOML --platform=browser --target=safari16 --minify --outfile="$ROOT/ui/vendor/toml.js"
cp "$TMP/node_modules/smol-toml/LICENSE" "$ROOT/ui/vendor/smol-toml.LICENSE"
