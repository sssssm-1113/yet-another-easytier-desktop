#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/dist/EasyTier.app"
BIN="$APP/Contents/MacOS/EasyTier"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

UNIVERSAL=0
DMG=0
BUNDLE_CORE=0
for arg in "$@"; do
  case "$arg" in
    --universal) UNIVERSAL=1 ;;
    --dmg) DMG=1 ;;
    --bundle-core) BUNDLE_CORE=1 ;;
  esac
done

if [[ "$BUNDLE_CORE" == "1" ]]; then
  if [[ "$UNIVERSAL" == "1" ]]; then echo "Bundled core is arm64 only" >&2; exit 1; fi
  for item in easytier-core easytier-cli; do
    if [[ ! -x "$ROOT/Resources/bin/$item" ]]; then echo "Missing $ROOT/Resources/bin/$item" >&2; exit 1; fi
  done
  if [[ ! -f "$ROOT/Resources/bin/EasyTier-LICENSE.txt" ]]; then echo "Missing EasyTier license" >&2; exit 1; fi
fi

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
if [[ "$BUNDLE_CORE" == "1" ]]; then
  mkdir -p "$APP/Contents/Resources/bin"
  cp "$ROOT/Resources/bin/easytier-core" "$ROOT/Resources/bin/easytier-cli" "$ROOT/Resources/bin/EasyTier-LICENSE.txt" "$APP/Contents/Resources/bin/"
fi

echo "▸ Signing (ad-hoc)"
codesign --force --deep --sign - "$APP"

echo "▸ Done: $APP"

if [[ "$DMG" == "1" ]]; then
  echo "▸ Building DMG"
  STAGE="$(mktemp -d)"
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  DMG_NAME="EasyTier-1.0.2.dmg"
  if [[ "$BUNDLE_CORE" == "1" ]]; then DMG_NAME="EasyTier-1.0.2-bundled.dmg"; fi
  rm -f "$ROOT/dist/$DMG_NAME"
  hdiutil create -volname "EasyTier" -srcfolder "$STAGE" -ov -quiet -format UDZO "$ROOT/dist/$DMG_NAME"
  rm -rf "$STAGE"
  echo "▸ DMG: $ROOT/dist/$DMG_NAME"
fi
