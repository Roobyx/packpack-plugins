# Map Stats

Shows the number of cells in the current map and refreshes it from the toolbar.

## What it adds

- A **Map Stats** section in the right sidebar.
- A **Refresh stats** command in the plugin toolbar cluster.

## How it works

The panel is declared in `manifest.json`; the host renders it, so the plugin
never touches the DOM. The script subscribes to the panel's **Refresh** button
and registers the same handler as a command. Both read `api.document.summary()`
and send one `api.ui.patch` update.

```js
async function refreshStats() {
  const summary = await api.document.summary();
  const cells = summary.width * summary.height;
  await api.ui.patch('stats', [{ controlId: 'cellCount', text: String(cells) }]);
}
```

The plugin asks for `map.read`, `ui.sidebar` and `ui.toolbar`. It cannot write
to the map, and the host refuses a call to any method it did not grant.
