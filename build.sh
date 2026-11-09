#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/dist/EasyTier.app"
BIN="$APP/Contents/MacOS/EasyTier"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

UNIVERSAL=0
DMG=0
for arg in "$@"; do
  case "$arg" in
    --universal) UNIVERSAL=1 ;;
    --dmg) DMG=1 ;;
  esac
done

echo "▸ Cleaning"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/ui"

echo "▸ Compiling Swift shell"
swiftc -O -target arm64-apple-macos13.0 "$ROOT"/Sources/*.swift -o "$TMP/EasyTier-arm64"
if [[ "$UNIVERSAL" == "1" ]]; then
  swiftc -O -target x86_64-apple-macos13.0 "$ROOT"/Sources/*.swift -o "$TMP/EasyTier-x86_64" 2>/dev/null
  lipo -create "$TMP/EasyTier-arm64" "$TMP/EasyTier-x86_64" -output "$BIN"
else
  cp "$TMP/EasyTier-arm64" "$BIN"
fi

echo "▸ Bundling UI"
cp -R "$ROOT"/ui/. "$APP/Contents/Resources/ui/"
cp "$ROOT"/Resources/Info.plist "$APP/Contents/Info.plist"
cp "$ROOT"/Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

echo "▸ Signing (ad-hoc)"
codesign --force --deep --sign - "$APP"

echo "▸ Done: $APP"

if [[ "$DMG" == "1" ]]; then
  echo "▸ Building DMG"
  STAGE="$(mktemp -d)"
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  rm -f "$ROOT/dist/EasyTier-1.0.0.dmg"
  hdiutil create -volname "EasyTier" -srcfolder "$STAGE" -ov -quiet -format UDZO "$ROOT/dist/EasyTier-1.0.0.dmg"
  rm -rf "$STAGE"
  echo "▸ DMG: $ROOT/dist/EasyTier-1.0.0.dmg"
fi
