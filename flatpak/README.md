# Linux Flatpak

## Install a prerelease

Download the versioned `.flatpak` from [GitHub Releases](https://github.com/jedace07/prism/releases), together with `SHA256SUMS` if you want to verify its checksum. The current version is `0.1.0-alpha.2`.

```sh
flatpak install ./Prism-0.1.0-alpha.2-linux-x86_64.flatpak
flatpak run io.github.prismviewer.Prism
```

Installation defaults to system scope and uses its Flathub remote. If it is missing, add it explicitly with `flatpak remote-add --system --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo`. A per-user installation remains possible with `--user`, using that scope's own runtime and remote setup.

## Build and release workflow

Builds run on GitHub-hosted Ubuntu 26.04 runners in the Freedesktop 26.08 container. You do not need a local Builder, SDK, compiler or image-tool installation. The manual, reusable `build-flatpak.yml` workflow packages Electron with Bun and assembles the Flatpak.

A tagged `v<version>` release calls that build alongside Windows. The publisher waits for both builds and publishes the versioned distributions and checksums as a GitHub prerelease. The tag, `package.json`, the newest AppStream release and the changelog must agree. The application also reports its version in GPU diagnostics.

The intermediate `dist-linux` Actions artifact expires after seven days. Installable downloads and `SHA256SUMS` are published as release assets. See the root README for the version/tag procedure.

## Dependencies and formats

All application and development dependencies use Bun. Image decoding uses built-in Bun.Image without Sharp or an external image package. The manifest's single application module copies the prepared Electron app, bundled Bun runtime, licenses and desktop files; it compiles no image libraries.

Freedesktop Platform/SDK and Electron BaseApp provide Flatpak infrastructure, including Zypak. These are prebuilt Flatpak refs rather than Bun packages, with their branches aligned at 26.08.

Linux Bun.Image supports JPEG, PNG, WebP, GIF and BMP. Chromium adds SVG/icons and supported formats such as AVIF. HEIC/TIFF support in Bun.Image depends on macOS/Windows codecs; host codec installs do not add them to this Linux Flatpak. RAW, PSD, EXR, JPEG 2000, PDF and multipage document decoding are not provided.

## Sandbox and optional reproduction

The launcher uses Zypak and Electron isolation. Permissions include GPU devices, Wayland/fallback X11, shared IPC and read-only Pictures access. Other files and folders use the chooser portal; drag and drop requires accessible sandbox paths. There is no network, blanket home, host spawn, audio or filesystem-write permission.

The Bun worker stays in the Flatpak sandbox and receives only paths authorized by Electron's file-token registry. Pixel limits, preview budgets and bounded IPC messages remain enforced.

Optional local reproduction uses `bun run flatpak:build` and `bun run flatpak:bundle` with a preinstalled Flatpak Builder, only when explicitly requested on the image-based development machine. Build dependencies default to system scope; `PRISM_FLATPAK_SCOPE=user` selects user scope. CI does not require host package installs.

This is a local application packaging manifest rather than a Flathub submission. Application code enters as `dist/Prism-linux-x64`, prepared from `bun.lock` on the runner. A future Flathub submission needs an owned app ID, project URLs/screenshots and a source-build or versioned release input.
