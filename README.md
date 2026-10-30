# Prism

A local Electron image viewer. Bun.Image decodes and resizes previews in the bundled Bun subprocess; Chromium turns the encoded PNG into a bitmap and uploads it to WebGL2. Drawing, zoom, pan, rotation, flipping and sampling use GPU shaders. There are no external image packages or image-tool executables.

## Development

The source, preload, renderer, decoder, scripts and tests are written in **TypeScript**, with strict type checking and shared IPC contracts. Use **Bun 1.4.4+** for dependencies and scripts. No separate host Node.js, compiler, Sharp or ImageMagick installation is required.

```sh
bun install --frozen-lockfile
bun run check
bun run test
bun run start
bun run start /path/to/photo.png
```

`./start.sh` also starts the app through Bun. Opening a single image discovers its siblings; opening several files keeps the selected set. Folders are scanned without recursion, with natural sorting and a 10,000-entry limit. Drag images or folders into the window, or choose **All files** to try an unrecognized extension.

Build/package the application on GitHub runners, as described below. Unit tests and type checking execute TypeScript directly without building the app. `bun run start` explicitly compiles into `.build/app` before launching Electron; GitHub packaging uses that same compilation step. No host OS packages are required. `AGENTS.md` records this workflow.

## Rendering and formats

Hardware WebGL2 is required by default. The app disables Chromium's software rasterizer, checks its active renderer, and reports context loss. Click the GPU badge for device and format diagnostics. To explicitly permit software rendering for a remote desktop or test, pass `--allow-software-rendering`.

| Decoder                    | Supported inputs                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Bun.Image on Linux         | JPEG, PNG, WebP, GIF, BMP                                                                 |
| Bun.Image on macOS/Windows | The common formats above, plus TIFF/HEIC/AVIF when the OS backend and codecs provide them |
| Chromium fallback          | SVG, icons, AVIF and other formats supported by that Chromium build                       |
| Chromium animation         | GIF, animated WebP, APNG and AVIF where supported                                         |

See [Bun.Image's platform matrix](https://bun.com/docs/runtime/image#platform-backends). The in-app diagnostics distinguish Bun's portable formats, optional system formats, and queried browser formats. Unsupported files show an error; there is no suggestion to install host codecs.

**ImageMagick and Sharp have been removed.** Specialist formats such as camera RAW, PSD, EXR, JPEG 2000 and PDF are no longer provided. Bun.Image decodes the first image only; multipage TIFF/PDF navigation is not supported. Animation frame controls use Chromium.

Bun applies JPEG EXIF orientation before sizing. Input images are limited to 268,435,456 pixels. Previews fit both the GPU texture limit and a 32-megapixel budget; reduced previews are labeled. Bun emits an encoded PNG, and Chromium manages color when creating the GPU bitmap. The inspector reports output depth rather than implying that Bun exposes source color-profile metadata. This is an 8-bit viewer, not an HDR mastering tool. Browser-only inputs and animation originals are limited to 64 MiB. Viewing never writes to source files.

## Controls

| Action                                     | Shortcut              |
| ------------------------------------------ | --------------------- |
| Open images / folder                       | Ctrl+O / Ctrl+Shift+O |
| Previous / next image                      | Left / Right          |
| Zoom at cursor / pan                       | Wheel / drag          |
| Fit / actual size                          | 0 / 1                 |
| Toggle fit and actual size                 | Double-click          |
| Zoom in / out                              | + / −                 |
| Rotate clockwise / counterclockwise        | R / Shift+R           |
| Flip horizontally                          | H                     |
| Pixel sampling / background                | P / B                 |
| Previous / next animation frame            | Page Up / Page Down   |
| Play/pause animation or 4-second slideshow | Space                 |
| Information / fullscreen                   | I / F                 |
| Stop playback / dismiss error              | Escape                |

Use Command in place of Ctrl on macOS.

## Downloads

Download versioned builds from [GitHub Releases](https://github.com/jedace07/prism/releases). The first release is **0.1.0-alpha.1**, published as a prerelease while Prism is early in development.

- **Windows x64:** extract `Prism-0.1.0-alpha.1-windows-x64.zip` and open `Prism-win32-x64/prism.exe`. Keep the entire application folder together. Electron and Bun are bundled; no runtime installation is required. This is an unsigned portable build.
- **Linux x86_64:** download `Prism-0.1.0-alpha.1-linux-x86_64.flatpak` and install it:

```sh
flatpak install --system ./Prism-0.1.0-alpha.1-linux-x86_64.flatpak
flatpak run --system io.github.prismviewer.Prism
```

The release includes `SHA256SUMS` and platform build information. Download all listed assets to check the complete set with `sha256sum -c SHA256SUMS`, or check the relevant line for a single download. System Flatpak installs use the system Flathub remote; an explicit `--user` installation needs its own runtime/remote setup. Hardware rendering should be checked on your own desktop using the GPU diagnostics.

## CI and prereleases

[CI](.github/workflows/ci.yml) runs on pushes to `main` and pull requests. Linux and Windows both check Biome linting, Prettier formatting, strict TypeScript, version consistency and unit tests. Use `bun run format` to format source and `bun run lint:fix` for safe lint fixes. All control-flow bodies use braces; TypeScript strings use single quotes where appropriate. Your ES2025 target is retained.

The [prerelease workflow](.github/workflows/release.yml) starts when a `v<version>` tag is pushed. It validates the tag against `package.json`, AppStream and the changelog, then calls the reusable [Linux](.github/workflows/build-flatpak.yml) and [Windows](.github/workflows/build-windows.yml) build workflows. Each build repeats the quality checks, packages the app, and verifies the bundled decoder and software WebGL renderer on its native runner. Windows uses Server 2025; Linux uses Ubuntu 26.04 with Freedesktop 26.08 for Flatpak.

Publication waits for both platforms. It checks asset names, versions and source commits, generates SHA-256 checksums, uploads everything to a draft, then publishes a **prerelease**. Published releases are never overwritten. Only the publication job has repository write permission. No custom secrets are needed; artifact actions use GitHub's supported Node 24 LTS runtime, while project tooling uses Bun.

For the next release, update `package.json` with a new semantic version (for example `0.1.0-alpha.2`), add the matching newest AppStream release and a `## <version> - YYYY-MM-DD` changelog section, then run checks and commit/push the changes. Tag that commit:

```sh
prism_version=$(bun -p "require('./package.json').version")
git tag -s "v$prism_version" -m "Prism $prism_version"
git push origin "v$prism_version"
```

Both platform build workflows can also be run manually for development checks. Actions artifacts hold intermediate distributions and test evidence for seven days; user downloads are published under Releases. macOS packaging and stable-release promotion remain future work. See [Flatpak details](flatpak/README.md).

## Verification and source

```sh
bun run test
# Optional desktop tests compile the app and open a window:
bun run test:smoke
PRISM_SMOKE_HARDWARE=1 bun run test:smoke
```

Tests cover Bun.Image pixel colors, alpha, EXIF orientation, JPEG/WebP/GIF/BMP decoding, literal filenames, size limits, unsupported formats, and the subprocess protocol. Desktop tests exercise WebGL pixels and transforms, thumbnails, SVG fallback, GIF playback, file navigation and renderer isolation. CI uses Xvfb and explicit SwiftShader; only its disposable root smoke test disables Chromium's root-user sandbox check. Normal launches retain sandboxing and use Zypak inside Flatpak.

- `src/decoder.ts`: Bun.Image previews and capabilities.
- `src/decode-service.ts`, `src/decode-worker.ts`, `src/decoder-protocol.ts`: bounded subprocess work and binary PNG transport.
- `src/renderer/gpu.ts`: WebGL2 texture uploads and shaders.
- `src/renderer/browser-images.ts`: bitmap creation and browser-only formats.
- `src/renderer/animation.ts`: Chromium frame decoding and timed texture uploads.

The renderer uses context isolation, no Node integration, a restrictive CSP, denied navigation/popups and denied network requests. IPC checks the calling frame and authorizes image access using file tokens. Bun and its upstream license notices are bundled, so installed artifacts need neither host Bun nor Node.js.

## License

Prism is licensed under [Apache-2.0](LICENSE); see [NOTICE](NOTICE). Bundled third-party components retain their own license notices.
