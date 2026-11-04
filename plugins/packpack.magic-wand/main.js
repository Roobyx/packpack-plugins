// Magic wand: select a contiguous region, then fill or erase it.
//
// The host owns the flood scan, the undo entry and the overlay canvas. This
// script owns the two-step interaction: click to select, Enter to apply.

const TOOL_ID = 'magicWand';
const MAX_WRITE = 1_000_000;
const MAX_PREVIEW = 10_000;

let selection = null;

function activeTileLayer(summary) {
  const layer = summary.layers.find((candidate) => candidate.id === summary.activeLayerId);
  return layer && layer.type === 'tile' ? layer : null;
}

function previewCells(indices, width) {
  const cells = [];
  const count = Math.min(indices.length, MAX_PREVIEW);
  for (let at = 0; at < count; at++) {
    const index = indices[at];
    const x = index % width;
    cells.push([x, (index - x) / width]);
  }
  return cells;
}

async function selectRegion(event) {
  try {
    const summary = await api.document.summary();
    const layer = activeTileLayer(summary);
    if (!layer) {
      api.ui.status('Magic wand: select a tile layer first');
      return;
    }
    if (layer.locked) {
      api.ui.status('Magic wand: the active layer is locked');
      return;
    }
    const gid = await api.map.getCell(layer.id, event.cell.x, event.cell.y);
    if (gid === 0) {
      selection = null;
      await api.tools.overlay([]);
      api.ui.status('Magic wand: empty cell');
      return;
    }
    const indices = await api.map.floodRegion(layer.id, event.cell.x, event.cell.y, {
      maxCells: MAX_WRITE,
    });
    if (indices.length === 0) {
      selection = null;
      await api.tools.overlay([]);
      api.ui.status('Magic wand: nothing to select');
      return;
    }
    selection = { layerId: layer.id, indices, width: summary.width, gid };
    await api.tools.overlay([
      {
        type: 'cells',
        cells: previewCells(indices, summary.width),
        fill: 'rgba(96,165,250,0.22)',
        stroke: 'rgba(96,165,250,0.75)',
      },
    ]);
    const capped = indices.length >= MAX_WRITE ? ' (capped at 1,000,000)' : '';
    api.ui.status(
      `${indices.length} cells of tile ${gid} selected${capped} — Enter fills with tile ${summary.selectedTile}, Shift+Enter erases`,
    );
  } catch (error) {
    api.ui.status('Magic wand: ' + String(error));
  }
}

async function applySelection(erase) {
  if (!selection) {
    api.ui.status('Magic wand: click a region first');
    return;
  }
  try {
    const summary = await api.document.summary();
    const gid = erase ? 0 : summary.selectedTile;
    const gids = new Uint32Array(selection.indices.length);
    gids.fill(gid);
    const written = await api.map.applyCells(
      selection.layerId,
      selection.indices,
      gids,
      erase ? 'Magic wand erase' : 'Magic wand fill',
    );
    api.ui.status(`Magic wand: ${written} cells → tile ${gid}`);
    selection = null;
    await api.tools.overlay([]);
  } catch (error) {
    api.ui.status('Magic wand: ' + String(error));
  }
}

api.tools
  .register(TOOL_ID, {
    onActivate() {
      api.tools.cursor('crosshair');
      api.ui.status('Magic wand: click a region, then Enter to fill it with the armed tile');
    },
    onDeactivate() {
      selection = null;
    },
    onPointer(event) {
      if (event.phase !== 'up') return;
      if (event.button === 0) {
        void selectRegion(event);
        return;
      }
      if (event.button === 2) {
        void applySelection(true);
      }
    },
    onKey(event) {
      if (event.key !== 'Enter') return;
      void applySelection(event.modifiers.shift);
    },
  })
  .catch((error) => api.log('magic wand registration failed: ' + String(error)));
