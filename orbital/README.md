# Orbital

Static WebGPU build from graycrawford/orbital at e4aa59c. Served at https://graycrawford.com/orbital/. Requires WebGPU in a secure HTTPS context.

The engine files match the upstream web build. Site integration adds a home link, page metadata and the 38 supplied Mac presets, alongside the two original presets. All 40 are available in the preset bank and contribute pad reference dots. User-created presets remain in browser storage.

`assets/orbital-presets-mac.json` preserves the supplied export for download/import. `assets/presets.json` marks shipped presets as built-in so they are available to every visitor without being copied repeatedly into local storage.

To update: rebuild the upstream `web/` folder, copy its `dist/` contents here, and retain the site metadata, home link and additional presets. No server-side build is needed.
