# Changelog

## 0.1.0-alpha.2 - 2026-10-30

- Replace the Windows portable ZIP with an offline NSIS installation wizard, with installation folder selection, Start menu and desktop shortcuts, and Windows uninstall support.
- Verify installation, the installed decoder and renderer, and uninstallation on the Windows runner before publication.
- Keep Linux Flatpak packaging unchanged. Windows installers remain unsigned.

## 0.1.0-alpha.1 - 2026-10-30

First versioned alpha release of Prism for Windows x64 and Linux x86_64.

- Browse local images and folders with hardware WebGL2 rendering, zoom, pan, rotation and flipping.
- Decode JPEG, PNG, WebP, GIF and BMP with the bundled Bun runtime; use Chromium for supported browser formats and animation.
- Provide a portable Windows ZIP and a Linux Flatpak, with build information and SHA-256 checksums.
- Enforce strict TypeScript, Biome linting and Prettier formatting in CI. Both platform builds must pass decoder and renderer checks before publication.
- License Prism under Apache 2.0, preserving third-party notices.

This is an early prerelease. Windows builds are unsigned and portable. Linux Flatpak installations use system scope by default. Hardware rendering must be checked on your own desktop; runner rendering tests use SwiftShader. Format support depends on Bun and Chromium, as described in the README.
