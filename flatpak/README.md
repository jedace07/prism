# Flatpak test artifacts

Builds run on GitHub-hosted runners. You do not need a local Builder, SDK, compiler or image-tool installation to test an artifact.

## Build and download

1. Open [Actions → Build Linux Flatpak](https://github.com/jedace07/prism/actions/workflows/build-flatpak.yml).
2. Select **Run workflow** and a branch.
3. Download `Prism-linux-flatpak-x86_64-<run number>` from the successful run and extract it.

The ZIP contains `Prism-x86_64.flatpak`, `SHA256SUMS`, `build-info.json` and `flatpak-capabilities.json`, plus test evidence where generated. Artifacts remain available for 14 days. Build information records the source commit, workflow URL, Bun/Electron versions, runtime and architecture. No custom secrets are required.

The workflow is manual and reusable through `workflow_call`. It uses pinned action revisions, read-only repository permissions and the Freedesktop 26.08 container on a disposable privileged runner. It does not publish releases or deploy to Flathub.

## Dependencies and verification

All application and development dependencies are managed by **Bun**. Image decoding uses the built-in **Bun.Image** API, with no Sharp or other image package. The manifest has a single application module: it copies the Bun-prepared Electron app, bundled Bun runtime, licenses and desktop files. It does not download or compile ImageMagick, LibRaw, Imath, OpenEXR, Ghostscript, or codec libraries.

Freedesktop Platform/SDK and Electron BaseApp provide Flatpak infrastructure, including Zypak; those prebuilt refs are not Bun packages. Keep their branches aligned at 26.08. The build only targets Linux x86_64 at present.

The runner performs unit tests, then a software-WebGL desktop smoke test under Xvfb. It checks PNG texture colors, transformations, SVG fallback, thumbnails and GIF playback. SwiftShader is explicitly enabled for this test. Because the disposable CI container runs as root, the smoke runner passes `--no-sandbox` only in that environment; the shipped launcher does not pass it.

After Flatpak packaging, a separate check starts Electron's embedded Node inside the **Platform runtime**, communicates with the bundled Bun decoder, and checks JPEG/PNG/WebP/GIF/BMP pixels, alpha, orientation and PNG transport. Failed checks block artifact upload. The in-app GPU badge must still be checked on a real desktop to validate hardware rendering.

## Install and test

From the extracted artifact directory:

```sh
sha256sum -c SHA256SUMS
flatpak install --user ./Prism-x86_64.flatpak
flatpak run io.github.prismviewer.Prism
```

Linux Bun.Image supports JPEG, PNG, WebP, GIF and BMP. Chromium adds SVG/icons and formats such as AVIF when supported by its build. HEIC/TIFF support in Bun.Image is OS-dependent on macOS/Windows, not available in Linux Flatpak through host codec installs. RAW, PSD, EXR, JPEG 2000, PDF and multipage document support were removed with the previous decoder stack. The UI reports actual backend/platform capabilities rather than advertising those formats.

## Sandbox

The launcher uses Zypak and keeps Electron process isolation. Permissions include GPU devices, Wayland/fallback X11, shared IPC, and read-only Pictures access. Other files/folders use the desktop chooser portal; selecting a folder grants sibling browsing access. Drag and drop requires paths accessible to the sandbox. There is no network, blanket home, host spawn, audio or filesystem-write permission.

The Bun worker runs within the same Flatpak sandbox and only receives paths authorized by Electron's file-token registry. Constructor pixel limits, preview budgets and bounded IPC messages remain enforced. No native image-tool executables are invoked.

## Later targets and optional reproduction

A future release workflow can call `build-flatpak.yml` alongside Windows and macOS jobs. Build each native target on its corresponding runner using `bun install --frozen-lockfile`, tests and `bun run package`; the packager bundles the current platform's Bun runtime. Native codec availability, signing/notarization and release triggers need separate target-specific work.

Local builds are optional and must be explicitly requested on the image-based development machine. Existing `bun run flatpak:build` and `bun run flatpak:bundle` scripts remain available for reproduction with a preinstalled user-scoped Flatpak Builder. No local build is required for the GitHub workflow.

This remains a local-artifact packaging manifest rather than a Flathub submission: application code enters as `dist/Prism-linux-x64`, prepared from `bun.lock` on the runner. Before public distribution, use an owned app ID, add project URLs/screenshots, and use a versioned release artifact or an offline source build.
