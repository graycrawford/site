# Orbital

Static WebGPU build from graycrawford/orbital at cc15a15 (branch density-consolidation: preset schema 2, per-dot sphere fog, visual preset bank). Served at https://graycrawford.com/orbital/. Requires WebGPU in a secure HTTPS context.

The engine files match the upstream web build. Site integration adds a home link, page metadata and the 38 supplied Mac presets, alongside the two original looks and the six built-in atom shapes. All 46 are available in the preset bank and contribute pad reference dots. The last "tri" session is marked `startup`, so a first visit without a saved session opens on it. User-created presets remain in browser storage.

`assets/orbital-presets-mac.json` preserves the supplied export for download/import. `assets/presets.json` marks shipped presets as built-in so they are available to every visitor without being copied repeatedly into local storage. `assets/loops/<preset id>.mp4` are the bank's turntable loops for the built-ins, rendered by the native app; presets saved in the browser draw their loops locally.

To update: rebuild the upstream `web/` folder and copy its `dist/` engine files here (everything except `index.html`, `assets/presets.json` and `assets/loops`). Keep the site metadata and home link in `index.html`. If built-in presets change, re-render their loops from the upstream repo with `web/tools/loops.sh <this folder>/assets/presets.json <this folder>/assets/loops`. No server-side build is needed.
