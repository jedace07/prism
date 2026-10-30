# Project workflow

- Use Bun for dependency installation, scripts, tests and packaging. Commit `bun.lock`; do not add npm, Yarn or pnpm lockfiles.
- Keep the desktop process on Electron. Image decoding uses Bun.Image in an isolated bundled Bun subprocess. Manage all application dependencies with Bun; do not reintroduce Sharp, ImageMagick or native codec build modules.
- Prefer single quotes.
- Prefer braces for all control flow statements (if, else, for, while) — never use single-line braceless forms.
- Use Biome for linting.
- Use Prettier for code formatting.
- Write application code, scripts and tests in strict TypeScript.
- Avoid over-engineering. No abstractions for one-time operations.
- License project-owned code under Apache-2.0; preserve bundled third-party notices.
