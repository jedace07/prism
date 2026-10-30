# Prism

A local Electron image viewer. The image itself is drawn by WebGL2: decoded pixels are uploaded as GPU textures, and shaders perform drawing, zoom, pan, rotation and flipping. Image decoding uses CPU codecs in a background worker.

## Run

Bun 1.4.4 or newer is the development runtime and package manager. No separate host Node.js or npm installation is required; Electron retains its own embedded Node.js runtime for the desktop app. On an image-based OS, keep JavaScript tools in Bun and native build dependencies inside Flatpak or a development container.

```bash
bun install --frozen-lockfile
bun run start
```

Or use `./start.sh`. Open a file or folder directly:

```bash
./start.sh /path/to/photo.jxl
./start.sh /path/to/pictures
bun run start /path/to/photo.tiff
```

Opening one image also discovers its siblings. Opening several files keeps the selected set. Folders are scanned without recursion, with natural filename sorting and a limit of 10,000 entries. Drag files or folders into the window to open them. Choose **All files** in the file dialog to try an unrecognized extension.

## Rendering

Prism requests a high-performance WebGL2 context and checks its actual renderer and Chromium's GPU feature status. Normal startup disables Chromium's software rasterizer and rejects known software drivers. A missing or lost hardware context produces an error rather than silently claiming GPU acceleration.

Click the **GPU · WebGL2** badge to see the renderer, texture limit, Chromium feature status and installed decoder formats. No Canvas 2D rendering fallback is used.

For remote desktops or testing, explicitly allow software rendering:

```bash
./start.sh --allow-software-rendering
```

Software renderers are labeled as software. This option does not guarantee software rendering; it permits it when hardware is unavailable. Add `--use-angle=swiftshader` to explicitly select SwiftShader for a test.

## Format support

| Decoder | Formats |
| --- | --- |
| Bundled Sharp / libvips | JPEG, PNG, WebP, GIF, AVIF, TIFF, SVG, Ultra HDR where supported by the bundled codec |
| Optional ImageMagick 7 | BMP, ICO, JPEG XL, JPEG 2000, HEIC/HEIF, PSD/PSB, EXR, Radiance HDR, camera RAW, QOI, TGA, DDS, PNM, FITS, DICOM, PDF/EPS and many more, depending on installed modules and delegates |
| Chromium ImageDecoder | GIF, animated WebP, APNG and AVIF animation where supported |

**Format support** in the app queries the decoders installed on the current machine. The list contains format identifiers and aliases, not a promise that every codec variant or external delegate is available. ImageMagick 7 must be on `PATH` as `magick`; alternatively set `PRISM_MAGICK` to its executable path.

The Flatpak builds and bundles ImageMagick, LibRaw, OpenEXR and Ghostscript against its runtime codecs, including JPEG XL and HEIF. It does not use host ImageMagick packages. HEVC-encoded HEIC requires a compatible codec in the Flatpak runtime. For development outside Flatpak, use the already available ImageMagick or a container; avoid layering codec packages onto an image-based host. Restart Prism after changing decoder availability.

PDF/EPS rasterization needs Ghostscript. RAW support follows the installed LibRaw version. Layered files display the decoder's composite or available layers/pages, not an editable document. Animation originals are capped at 64 MiB; larger or unsupported animations expose available frames through page controls. APNG frame controls require Chromium's decoder.

Display output is 8-bit sRGB, including high bit-depth and HDR inputs; this is not an HDR mastering or scientific intensity viewer. Sharp honors supported embedded ICC profiles and EXIF orientation. ImageMagick handles fallback color conversion. Large images are reduced to a preview fitting both the GPU texture edge and a 32-megapixel output budget. Reduced previews are clearly labeled. Inputs over one gigapixel are rejected. Viewing transforms never write to the source file.

## Controls

| Action | Shortcut |
| --- | --- |
| Open images / folder | Ctrl+O / Ctrl+Shift+O |
| Previous / next image | Left / Right |
| Zoom at cursor | Mouse wheel |
| Pan | Drag |
| Fit / actual size | 0 / 1 |
| Toggle fit and actual size | Double-click |
| Zoom in / out | + / − |
| Rotate clockwise / counterclockwise | R / Shift+R |
| Flip horizontally | H |
| Pixel sampling | P |
| Cycle dark / checkerboard / light | B |
| Previous / next page or frame | Page Up / Page Down |
| Play / pause animation; otherwise 4-second slideshow | Space |
| Information / fullscreen | I / F |
| Stop playback / dismiss error | Escape |

Use Command instead of Ctrl on macOS. Dimensions and zoom use image pixels relative to CSS pixels. Rotation, flipping and panning affect only the view.

## Portable build

```bash
bun run package
./dist/Prism-linux-x64/prism
```

The packager targets the current OS and architecture. The output bundles Electron and Sharp, so it does not require system Bun or Node.js. Keep the entire output directory together. ImageMagick and its delegates remain optional system dependencies. Native bindings are left unpacked. Cross-platform source is included; Linux x64 is the platform validated here.

## Flatpak

```bash
bun run flatpak:check
bun run flatpak:build
bun run flatpak:bundle
flatpak install --user ./dist/Prism-x86_64.flatpak
flatpak run io.github.prismviewer.Prism
```

The local manifest is [flatpak/io.github.prismviewer.Prism.json](flatpak/io.github.prismviewer.Prism.json). The build script prepares the portable app with Bun, then builds codec modules inside the Flatpak SDK. Full Flatpak compilation and sandbox testing are pending Builder availability. See [flatpak/README.md](flatpak/README.md) for isolated builder setup, permissions, limitations and release preparation.

## Verification

```bash
bun run test
# Runs the desktop integration suite with explicit software WebGL:
bun run test:smoke
# Requires a working hardware GPU and desktop display:
PRISM_SMOKE_HARDWARE=1 bun run test:smoke
# Exercise the packaged executable:
PRISM_SMOKE_HARDWARE=1 PRISM_SMOKE_EXECUTABLE="$PWD/dist/Prism-linux-x64/prism" bun run test:smoke
```

Bun runs the existing Node-compatible test suite, including its per-format subtests. Decoder tests cover raster data, alpha, EXIF orientation, representative bundled and system formats, unusual filenames, multipage and mixed-dimension TIFFs, size limits and worker error recovery. Formats unavailable in the local ImageMagick installation are omitted or skipped.

The integration suite opens a real Electron window. It checks WebGL framebuffer pixel colors, shader transforms, pointer panning, thumbnails, navigation, metadata, SVG and specialist rasterization, animation playback, TIFF pages, context isolation and file-token authorization. It records GPU diagnostics and screenshots in `artifacts/`. The hardware suite passed on **NVIDIA GeForce RTX 3080**, using ANGLE / OpenGL ES 3.2, with software fallback disabled.

Electron/Sharp may emit the upstream [Linux GLib compatibility warning](https://sharp.pixelplumbing.com/install/#electron-and-linux). SVG, animated GIF, TIFF and the tested raster formats passed in the actual Electron runtime on this machine.

## Source

- `src/main.cjs`: native window, file dialogs, file authorization and IPC.
- `src/decoder.cjs`, `src/decode-worker.cjs`, `src/decode-service.cjs`: decoding and bounded background work.
- `src/renderer/gpu.js`: WebGL2 texture uploads and image shaders.
- `src/renderer/animation.js`: frame decoding and timed GPU uploads.
- `src/renderer/app.js`: browsing and viewer controls.

The renderer is sandboxed with context isolation, no Node integration, a restrictive CSP, denied navigation/popups and denied network requests. IPC checks the calling frame. ImageMagick receives generated filenames, resource/time limits and a policy blocking URL and instruction coders. System decoder availability and policy still apply.
