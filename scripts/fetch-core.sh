#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
VERSION="2.6.4"
ARCHIVE="easytier-macos-aarch64-v${VERSION}.zip"
URL="https://github.com/EasyTier/EasyTier/releases/download/v${VERSION}/${ARCHIVE}"
EXPECTED="4be1882d1aa36d31c1d6ba0596f2cf8a097e371f8da124212324b2e0f8df7e4b"
curl -fL "$URL" -o "$TMP/$ARCHIVE"
ACTUAL="$(shasum -a 256 "$TMP/$ARCHIVE" | awk '{print $1}')"
if [[ "$ACTUAL" != "$EXPECTED" ]]; then echo "EasyTier archive checksum mismatch" >&2; exit 1; fi
mkdir -p "$ROOT/Resources/bin"
for binary in easytier-core easytier-cli; do
  unzip -p "$TMP/$ARCHIVE" "easytier-macos-aarch64/$binary" > "$ROOT/Resources/bin/$binary"
  chmod 755 "$ROOT/Resources/bin/$binary"
done
curl -fsSL "https://raw.githubusercontent.com/EasyTier/EasyTier/v${VERSION}/LICENSE" -o "$ROOT/Resources/bin/EasyTier-LICENSE.txt"
echo "EasyTier $VERSION arm64 binaries installed into Resources/bin"
