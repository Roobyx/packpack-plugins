# PackPack plugins

The official plugin marketplace for [PackPack](https://github.com/Roobyx/packpack).

This repository is public on purpose: the PackPack app fetches the index and
plugin bundles from it at runtime, so a plugin can be updated without rebuilding
the app. The app's map-editor guide has the full authoring walkthrough.

## Layout

```
plugins/
  index.json                 generated; do not edit by hand
  example.stats/
    manifest.json
    README.md
    icon.svg
    main.js
```

The folder name must equal the manifest `id`.

## Add or update a plugin

1. Create `plugins/<id>/manifest.json` using manifest v2. Declare only the
   capabilities you need: `map.read`, `map.write`, `ui.sidebar`, `ui.toolbar`.
2. Add `main.js` (runs in a sandboxed iframe with no DOM, storage or network),
   `README.md` and an `icon.svg`.
3. Generate the index against an immutable commit:

   ```bash
   npm run index -- --ref <commit-sha>
   npm run check
   ```

4. Commit the plugin files and the regenerated `plugins/index.json`.

The index records the SHA-256 of `manifest.json`, `main.js`, `README.md` and
`icon.svg`. The app verifies every file before storing a plugin, so a stale or
tampered index is rejected at install.

## How the app fetches it

```
https://raw.githubusercontent.com/Roobyx/packpack-plugins/main/plugins/index.json
```

Each entry then names its own `ref` and file paths. A released index should use
a commit SHA rather than `main`, so the bundle is immutable; the check warns when
the index still points at `main`.

## Rules

- One panel per plugin per side; `panels` needs `ui.sidebar`, `toolbar` needs
  `ui.toolbar`.
- Icons are a constrained SVG subset with numeric attributes; scripts, styles
  and event handlers are refused.
- Source cap 1 MiB, README 256 KiB, icon 64 KiB.
- Nothing here is gated; PackPack is MIT.
