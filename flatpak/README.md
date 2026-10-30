# Local Flatpak build

Status: the manifest and desktop metadata are prepared. Full SDK compilation and sandbox runtime checks are pending Flatpak Builder availability; they have not passed yet.

This manifest packages the app produced by `bun run package`. It targets **Linux x86_64**, Freedesktop **26.08**, and the matching Electron BaseApp. The app, Electron and Sharp are copied from `dist/Prism-linux-x64`; LibRaw, Imath, OpenEXR, Ghostscript and ImageMagick are built from checksum-pinned sources inside the SDK. JPEG XL, HEIF, JPEG, PNG, WebP, TIFF and other libraries come from the SDK/runtime.

## Tools without host package layering

JavaScript dependencies use Bun:

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
