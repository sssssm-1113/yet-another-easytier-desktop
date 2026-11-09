# Vendored TOML support

- Source: https://github.com/squirrelchat/smol-toml
- Package: `smol-toml@1.9.1`, BSD-3-Clause (see `smol-toml.LICENSE`).
- Bundler: `esbuild@0.28.2`, browser IIFE, Safari 16 target.
- Rebuild from the project root: `./scripts/vendor-toml.sh` (requires npm and network access).
- Normal app builds use the checked-in `toml.js`; no npm/network dependency is added to `build.sh`.

The editor parses integers as BigInt and stringifies Numbers as floats to retain TOML numeric types. Imported source is saved as a string to preserve dates and large integers across JSON state persistence.
