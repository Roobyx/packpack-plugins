// A tiny example plugin: it reads the map summary and writes one badge.
//
// The plugin never sees the DOM. The host renders the panel from the manifest
// and applies `api.ui.patch` to the control with the matching id.

async function refreshStats() {
  const summary = await api.document.summary();
  const cells = summary.width * summary.height;
  await api.ui.patch('stats', [{ controlId: 'cellCount', text: String(cells) }]);
  api.ui.status('Map stats refreshed: ' + cells + ' cells');
}

api.ui.onEvent('stats', 'refresh', refreshStats);
api.commands.register('refreshStats', 'Refresh map stats', refreshStats);

void refreshStats();
