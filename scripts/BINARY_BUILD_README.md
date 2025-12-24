# Binary Packaging for Edge Devices

This directory contains scripts to build self-contained Light Engine binaries for edge device deployment.

## Overview

Uses [pkg](https://github.com/vercel/pkg) to compile Node.js + application code into single executable binaries. No Node.js installation required on target systems.

## Building Binaries

```bash
npm run build:pkg
```

This creates two binaries:
- `install-server/binaries/lightengine-linux-x64` - For x86_64 systems
- `install-server/binaries/lightengine-linux-arm64` - For ARM64 systems (Raspberry Pi, etc.)

Also generates SHA-256 checksums for each binary.

## What's Included

- Node.js v18 runtime (embedded)
- All application code (server-foxtrot.js + dependencies)
- Public assets (HTML, CSS, JS)
- Routes and middleware
- License validation system
- Automation engine
- Database drivers (SQLite)

## Native Modules

Some native modules (canvas, sqlite3) are bundled as .node files and loaded at runtime. The pkg tool automatically handles this.

## Testing Binaries

Test a binary locally:
```bash
npm run build:pkg:test
# or test specific platform
npm run build:pkg:test lightengine-linux-arm64
```

This starts the binary and verifies it runs without errors.

## Binary Size

Expect binaries around 80-120 MB:
- Node.js runtime: ~50 MB
- Application code: ~10 MB
- Dependencies: ~20-40 MB
- Public assets: ~10-20 MB

Compressed with Brotli during build.

## Deployment

1. Build binaries: `npm run build:pkg`
2. Binaries placed in `install-server/binaries/`
3. Start installation server: `cd install-server && npm start`
4. Binaries served at `https://install.greenreach.io/lightengine-{platform}`

## Configuration

Edit `pkg-config.json` to control what's included:
- `assets`: Files to bundle
- `scripts`: Additional JS files to include
- `outputPath`: Where to save binaries

## Troubleshooting

### Binary too large
- Remove unused dependencies
- Minimize public assets
- Use webpack to bundle code first

### Native module errors
- Ensure native modules are in `node_modules/`
- Check pkg compatibility: https://github.com/vercel/pkg#native-addons

### Missing files at runtime
- Add paths to `assets` array in pkg-config.json
- Use `__dirname` for file paths in code

## Platform Support

- ✓ Linux x86_64 (Intel/AMD)
- ✓ Linux ARM64 (Raspberry Pi 4, Orange Pi, etc.)
- ✗ Windows (use desktop Electron app instead)
- ✗ macOS (use desktop Electron app instead)

## Security

Binaries are:
- Code-obfuscated during webpack build
- Compressed with Brotli
- SHA-256 checksums generated
- Will be RSA-signed for verification (future enhancement)

## License Validation

Binaries include public key for license verification but NOT private key. License files must be:
- Signed by GreenReach private key
- Placed at `/etc/lightengine/license.json`
- Hardware-fingerprinted to device
