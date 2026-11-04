// Tile replace: click a tile, replace every copy of it on the active layer.
//
// The host scans and rewrites the layer as one undo entry; this script only
// decides which tile is the source and which is the replacement.

const TOOL_ID = 'tileReplace';

function activeTileLayer(summary) {
  const layer = summary.layers.find((candidate) => candidate.id === summary.activeLayerId);
  return layer && layer.type === 'tile' ? layer : null;
}

async function replaceAt(event) {
  try {
    const summary = await api.document.summary();
    const layer = activeTileLayer(summary);
    if (!layer) {
      api.ui.status('Tile replace: select a tile layer first');
      return;
    }
    if (layer.locked) {
      api.ui.status('Tile replace: the active layer is locked');
      return;
    }
    const from = await api.map.getCell(layer.id, event.cell.x, event.cell.y);
    if (from === 0) {
      api.ui.status('Tile replace: empty cell');
      return;
    }
    const to = summary.selectedTile;
    if (to === from) {
      api.ui.status(`Tile replace: the armed tile is already tile ${from}`);
      return;
    }
    const count = await api.map.replaceTiles(from, to, { layerId: layer.id });
    api.ui.status(
      count === 0
        ? `Tile replace: no cells of tile ${from}`
        : `Tile replace: ${count} cells of tile ${from} → tile ${to}`,
    );
  } catch (error) {
    api.ui.status('Tile replace: ' + String(error));
  }
}

api.tools
  .register(TOOL_ID, {
    onActivate() {
      api.tools.cursor('copy');
      api.ui.status('Tile replace: click a tile to replace every copy with the armed tile');
    },
    onDeactivate() {},
    onPointer(event) {
      if (event.phase !== 'up' || event.button !== 0) return;
      void replaceAt(event);
    },
  })
  .catch((error) => api.log('tile replace registration failed: ' + String(error)));
