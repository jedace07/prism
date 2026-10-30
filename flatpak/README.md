# Flatpak test artifacts

The supported testing workflow builds on GitHub-hosted runners, with no local Builder or SDK installation. A green workflow run is the evidence that compilation and packaged decoder checks passed. Hardware GPU rendering still needs testing on a desktop.

This manifest packages the app produced by `bun run package`. It targets **Linux x86_64**, Freedesktop **26.08**, and the matching Electron BaseApp. The app, Electron and Sharp are copied from `dist/Prism-linux-x64`; LibRaw, Imath, OpenEXR, Ghostscript and ImageMagick are built from checksum-pinned sources inside the SDK. JPEG XL, HEIF, JPEG, PNG, WebP, TIFF and other libraries come from the SDK/runtime.

## Build on GitHub

After the workflow has been pushed to the repository's default branch:

1. Open [Actions → Build Linux Flatpak](https://github.com/jedace07/prism/actions/workflows/build-flatpak.yml).
2. Select **Run workflow** and the branch to test.
3. Wait for the run to complete, then download its `Prism-linux-flatpak-x86_64-<run number>` artifact.
4. Extract the ZIP before running the installation commands below.

The artifact contains `Prism-x86_64.flatpak`, `SHA256SUMS`, `build-info.json` and `flatpak-capabilities.json`. It is retained for 14 days. The build information records the source commit, runner URL, Bun/Electron/Sharp versions, runtime branch and architecture. No custom secrets are needed to build or upload the artifact.

The workflow is deliberately manual during initial testing: it does not run on every push, publish a GitHub release, or deploy to Flathub. It uses read-only repository permissions, pinned action revisions and the Freedesktop 26.08 container on a disposable privileged Linux runner. The SDK and native build tools are confined to that runner.

The runner installs dependencies from `bun.lock`, runs the existing decoder tests, then executes `bun run package` before building the manifest. A separate check starts Electron's embedded Node.js inside the **Platform runtime**, loads bundled Sharp, checks required ImageMagick readers, and exercises JPEG XL, EXR, PSD, JPEG 2000, QOI and PDF decoding. A missing required reader or broken codec fails the run. HEIC and RAW reader availability is checked, but actual HEVC and camera-file variants still need sample-file testing. GUI and hardware GPU tests do not run on this headless job.

## Install and test the artifact

From the extracted artifact directory:

```sh
sha256sum -c SHA256SUMS
flatpak install --user ./Prism-x86_64.flatpak
flatpak run io.github.prismviewer.Prism
```

Use the in-app GPU badge to verify that your graphics device is active. Open representative images, camera RAW files, animations and multipage files from your own collection. Building an artifact and installing it are separate operations.

## Later Windows/macOS/Linux automation

`build-flatpak.yml` also accepts `workflow_call`, so a future release workflow can call it as a Linux job alongside native Windows and macOS jobs. Keep each native build on its corresponding GitHub runner: install the same pinned Bun version, run `bun install --frozen-lockfile`, test, and run the existing platform-aware `bun run package`. Upload each platform's directory as an archive to preserve its executable permissions and layout. Native codec bundling, Windows signing, macOS signing/notarization, release triggers and release publication need separate configuration before public distribution.

The initial workflow only produces the Linux x86_64 Flatpak. Windows/macOS jobs and automated release publication are not enabled yet.

## Optional local reproduction

Local builds are available only when explicitly wanted; they are not required for downloading and testing GitHub artifacts. Use Bun for JavaScript dependencies:

```sh
bun install --frozen-lockfile
```

Install the builder as a **user Flatpak**, rather than installing native packages into the OS image:

```sh
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user --no-related flathub org.flatpak.Builder org.electronjs.Electron2.BaseApp//26.08
```

The builder brings its Freedesktop SDK dependency. `--no-related` avoids downloading optional graphics extensions just for the build tools; installing Prism later resolves its runtime extensions normally. `flatpak:build` also resolves manifest dependencies from the user Flathub remote. SDKs and build tools remain in user Flatpak storage; project build output stays in `.flatpak-builder`, `.flatpak-build`, `.flatpak-repo` and `dist`. The SDK can be a substantial download. No `sudo`, RPM layering, host compiler installation or global JavaScript packages are needed.

## Build and install

```sh
# Parse and resolve the manifest without compiling it.
bun run flatpak:check
# Prepare the Electron app using Bun, build codecs, and export a local repository.
bun run flatpak:build
# Produce a single installable bundle from that repository.
bun run flatpak:bundle
flatpak install --user ./dist/Prism-x86_64.flatpak
flatpak run io.github.prismviewer.Prism
```

The commands prefer an existing `flatpak-builder`, otherwise invoke the `org.flatpak.Builder` Flatpak with explicit access to this project. Source downloads occur before offline compilation; the manifest does not enable network access during build commands. Installing Prism is a separate explicit command; building does not install or run the application.

To invoke the manifest directly after `bun run package`:

```sh
flatpak run --filesystem="$PWD" --command=flatpak-builder org.flatpak.Builder \
  --user --install-deps-from=flathub --force-clean --repo=.flatpak-repo \
  .flatpak-build flatpak/io.github.prismviewer.Prism.json
```

## Sandbox and rendering

- Zypak launches Electron, retaining its process isolation inside Flatpak. The wrapper does not use `--no-sandbox`.
- `--device=dri` exposes GPU rendering. Wayland and fallback X11 display sockets are enabled, with shared IPC for X11.
- Pictures access is read-only. Other files and folders use the desktop file chooser portal; choose a folder to grant access to its contents for sibling browsing. Drag and drop only works for paths available to the sandbox.
- There is no network permission, host spawn permission, blanket home access, filesystem write access, audio permission or broad D-Bus access.
- ImageMagick is explicitly selected from `/app/bin/magick`. The app's decoder policy and resource limits still apply.
- GPU drivers must be available through Flatpak's GL extensions. The app continues to require hardware WebGL2 by default; `flatpak run io.github.prismviewer.Prism --allow-software-rendering` explicitly permits software rendering.

Open the in-app rendering and format diagnostics to inspect the actual sandbox renderer and codec capabilities. HEIF container support does not guarantee that the runtime provides every HEVC codec variant. Host codec packages cannot add support inside Flatpak.

## Scope of this manifest

This is a **local packaging manifest**, not a Flathub submission. `bun.lock` pins JavaScript dependencies during the preparation step, while Flatpak pins codec source archives. The app source enters the manifest as an already prepared local directory, so the manifest alone does not rebuild JavaScript dependencies from a pristine checkout. Before public distribution, choose an app ID under an owned namespace, add project URLs and screenshots to AppStream metadata, replace the local app directory source with a versioned release artifact or a fully offline source build, and test all target architectures. Keep the runtime and BaseApp branches aligned when updating them.
