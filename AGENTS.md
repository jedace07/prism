# Project workflow

- Use Bun for dependency installation, scripts, tests and packaging. Commit `bun.lock`; do not add npm, Yarn or pnpm lockfiles.
- The host is an image-based OS. Do not layer native development packages onto it or install a separate host Node.js for this project. Use system-scoped Flatpaks by default (with an explicit user-scope override), the Flatpak SDK or a development container when native tooling is needed.
- Keep the desktop process on Electron. Image decoding uses Bun.Image in an isolated bundled Bun subprocess. Manage all application dependencies with Bun; do not reintroduce Sharp, ImageMagick or native codec build modules.
- Build test artifacts on GitHub-hosted runners using `.github/workflows/build-flatpak.yml` and `.github/workflows/build-windows.yml`. Do not install build tooling or build/package the application on the user's machine unless explicitly requested.
- The Flatpak workflow is manually triggered and reusable by a future release workflow. Keep Windows builds on `windows-2025` and future macOS builds on macOS runners. The Flatpak manifest packages the Bun-built app without compiling image dependencies. Installation or publishing of Prism is separate from building it.

- Write application code, scripts and tests in TypeScript. Keep strict type checking in CI; Electron runs emitted JavaScript from `.build/app`, while Bun runs development scripts and unit tests directly.
- License project-owned code under Apache-2.0; preserve bundled third-party notices.
