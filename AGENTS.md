# Project workflow

- Use Bun for dependency installation, scripts, tests and packaging. Commit `bun.lock`; do not add npm, Yarn or pnpm lockfiles.
- The host is an image-based OS. Do not layer native development packages onto it or install a separate host Node.js for this project. Use user-scoped Flatpaks, the Flatpak SDK or a development container when native tooling is needed.
- Keep the desktop process on Electron. Native codecs run in an isolated bundled Bun subprocess to avoid Electron/Sharp GLib conflicts; Bun also runs development tooling. Do not load Sharp into the Electron main process.
- Build test artifacts on GitHub-hosted runners using `.github/workflows/build-flatpak.yml`. Do not install build tooling or build/package the application on the user's machine unless explicitly requested.
- The Flatpak workflow is manually triggered and reusable by a future release workflow. Keep Windows/macOS packaging on their respective runners when those targets are added. Native Flatpak dependencies belong inside the SDK and application bundle. Installation or publishing of Prism is separate from building it.
