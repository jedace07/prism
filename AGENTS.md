# Project workflow

- Use Bun for dependency installation, scripts, tests and packaging. Commit `bun.lock`; do not add npm, Yarn or pnpm lockfiles.
- The host is an image-based OS. Do not layer native development packages onto it or install a separate host Node.js for this project. Use user-scoped Flatpaks, the Flatpak SDK or a development container when native tooling is needed.
- Electron's embedded Node.js runtime is intentional. Keep the desktop process on Electron; Bun runs the development tooling.
- Build Flatpak with `bun run flatpak:build`. Its native dependencies belong inside the SDK and application bundle. Installation or publishing of Prism is separate from building it.
