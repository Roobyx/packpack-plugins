// Rivers: draw a river from a start cell to one or more end cells.
//
// The tool is click-based. The sidebar panel owns the tile and modifier
// choices; the canvas only collects the start and end cells. On Create river
// the plugin reads collision once, builds a cost surface with a deterministic
// meander noise, asks the host worker for a least-cost path per end, then
// writes the water, optional end caps and optional bridges in one undo entry.

const PANEL_ID = 'rivers';
const TOOL_ID = 'rivers';
const MAX_SEARCH_CELLS = 4_000_000;
const MARGINS = [32, 96, 256];

const state = {
  summary: null,
  tileset: 0,
  waterGid: null,
  riverLayerId: null,
  collisionLayerId: null,
  meander: 35,
  caps: {
    left: { enabled: false, gid: null },
    right: { enabled: false, gid: null },
  },
  bridge: {
    enabled: false,
    gid: null,
    mode: 'fixed',
    count: 2,
    chance: 50,
  },
  start: null,
  ends: [],
  preview: [],
  capPreview: [],
  bridgePreview: [],
  busy: false,
  toolActive: false,
  status: 'Click the start cell.',
  seed: 1,
};

// ---- small helpers ---------------------------------------------------------

function sameCell(a, b) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

function cellIndex(cell, summary) {
  return cell.y * summary.width + cell.x;
}

function riverError(code, message, end) {
  const error = new Error(message);
  error.code = code;
  if (end) error.end = end;
  return error;
}

function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smooth(x - x0);
  const ty = smooth(y - y0);
  const a = hash2(x0, y0);
  const b = hash2(x0 + 1, y0);
  const c = hash2(x0, y0 + 1);
  const d = hash2(x0 + 1, y0 + 1);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return top + (bottom - top) * ty;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function farEnough(chosen, cell) {
  return chosen.every(
    (other) =>
      Math.abs(other.x - cell.x) + Math.abs(other.y - cell.y) > 1 &&
      Math.abs(other.distance - cell.distance) >= 2,
  );
}

// ---- panel ----------------------------------------------------------------

function capNodes(side, label) {
  return [
    {
      type: 'toggle',
      id: `${side}CapEnabled`,
      label: `${label} end cap`,
      checked: state.caps[side].enabled,
    },
    {
      type: 'tileGrid',
      id: `${side}Cap`,
      tileset: state.tileset,
      columns: 8,
      selected: state.caps[side].gid ?? undefined,
    },
  ];
}

function buildPanel(summary) {
  const tileLayers = (summary.layers || []).filter((layer) => layer.type === 'tile');
  const layerOptions = tileLayers.map((layer) => ({
    value: String(layer.id),
    label: layer.name,
  }));
  if (layerOptions.length === 0) {
    return [
      { type: 'text', text: 'This map has no tile layer. Add one, then reactivate Rivers.' },
      { type: 'button', id: 'refreshLayers', label: 'Refresh layers' },
    ];
  }
  if (!tileLayers.some((layer) => layer.id === state.riverLayerId)) {
    state.riverLayerId = tileLayers[0].id;
  }
  if (!tileLayers.some((layer) => layer.id === state.collisionLayerId)) {
    state.collisionLayerId = tileLayers[0].id;
  }
  if (state.waterGid === null && summary.selectedTile > 0) {
    state.waterGid = summary.selectedTile;
  }
  const tilesets = summary.tilesets || [];
  if (!tilesets.some((tileset) => tileset.index === state.tileset)) {
    state.tileset = tilesets[0]?.index ?? 0;
  }
  const tilesetOptions = tilesets.length
    ? tilesets.map((tileset) => ({
        value: String(tileset.index),
        label: tileset.sourceName || `Tileset ${tileset.index + 1}`,
      }))
    : [{ value: '0', label: 'Tileset 1' }];

  return [
    {
      type: 'section',
      title: 'River',
      children: [
        {
          type: 'select',
          id: 'tileset',
          label: 'Tileset',
          options: tilesetOptions,
          value: String(state.tileset),
        },
        { type: 'text', text: 'Water tile' },
        {
          type: 'tileGrid',
          id: 'waterTile',
          tileset: state.tileset,
          columns: 8,
          selected: state.waterGid ?? undefined,
        },
        {
          type: 'select',
          id: 'riverLayer',
          label: 'River layer',
          options: layerOptions,
          value: String(state.riverLayerId),
        },
        {
          type: 'select',
          id: 'collisionLayer',
          label: 'Collision layer',
          options: layerOptions,
          value: String(state.collisionLayerId),
        },
        {
          type: 'slider',
          id: 'meander',
          label: 'Meander',
          min: 0,
          max: 100,
          value: state.meander,
        },
      ],
    },
    {
      type: 'section',
      title: 'End caps (optional)',
      children: [
        {
          type: 'text',
          text: 'Only the cap for the map side the river ends on is used.',
        },
        ...capNodes('left', 'Left'),
        ...capNodes('right', 'Right'),
      ],
    },
    {
      type: 'section',
      title: 'Bridges (optional)',
      children: [
        {
          type: 'toggle',
          id: 'bridgeEnabled',
          label: 'Place bridges',
          checked: state.bridge.enabled,
        },
        {
          type: 'tileGrid',
          id: 'bridgeTile',
          tileset: state.tileset,
          columns: 8,
          selected: state.bridge.gid ?? undefined,
        },
        {
          type: 'select',
          id: 'bridgeMode',
          label: 'Bridge mode',
          options: [
            { value: 'fixed', label: 'Set number' },
            { value: 'random', label: 'Random' },
          ],
          value: state.bridge.mode,
        },
        {
          type: 'number',
          id: 'bridgeCount',
          label: 'Bridges (or maximum)',
          min: 1,
          max: 99,
          value: state.bridge.count,
        },
        {
          type: 'slider',
          id: 'bridgeChance',
          label: 'Random chance %',
          min: 0,
          max: 100,
          value: state.bridge.chance,
        },
        {
          type: 'text',
          text: 'Bridges replace the water tile on the river layer.',
        },
      ],
    },
    {
      type: 'section',
      title: 'Selection',
      children: [
        { type: 'badge', id: 'status', text: state.status, tone: 'muted' },
        {
          type: 'row',
          children: [
            { type: 'button', id: 'confirm', label: 'Create river', tone: 'primary' },
            { type: 'button', id: 'clear', label: 'Clear' },
          ],
        },
      ],
    },
    { type: 'button', id: 'refreshLayers', label: 'Refresh layers' },
  ];
}

async function refreshPanel() {
  const summary = await api.document.summary();
  state.summary = summary;
  await api.ui.set(PANEL_ID, buildPanel(summary));
}

function setStatus(text) {
  state.status = text;
  void api.ui.patch(PANEL_ID, [{ controlId: 'status', text }]).catch(() => {});
}

function updateSelectionStatus() {
  if (!state.start) {
    setStatus('Click the start cell.');
    return;
  }
  const ends = state.ends.length;
  setStatus(
    `Start (${state.start.x}, ${state.start.y}) · ${ends} end${ends === 1 ? '' : 's'}. Click more ends or Create river.`,
  );
}

// ---- overlay --------------------------------------------------------------

function rectNode(cell, tw, th, fill, stroke) {
  return {
    type: 'rect',
    x: cell.x * tw,
    y: cell.y * th,
    w: tw,
    h: th,
    fill,
    stroke,
    width: 1,
  };
}

async function paintOverlay() {
  if (!state.toolActive) return;
  try {
    const summary = state.summary ?? (await api.document.summary());
    state.summary = summary;
    const tw = summary.tileWidth;
    const th = summary.tileHeight;
    const nodes = [];
    if (state.start) {
      nodes.push(rectNode(state.start, tw, th, 'rgba(56,189,248,0.35)', '#38bdf8'));
    }
    for (const end of state.ends) {
      nodes.push(rectNode(end, tw, th, 'rgba(248,113,113,0.35)', '#f87171'));
    }
    const perPath = Math.max(2, Math.floor(4096 / Math.max(1, state.preview.length)));
    for (const path of state.preview) {
      if (path.length < 2) continue;
      const points = path.map((cell) => [(cell.x + 0.5) * tw, (cell.y + 0.5) * th]);
      const step = Math.max(1, Math.ceil(points.length / perPath));
      const sampled = points.filter(
        (_, index) => index % step === 0 || index === points.length - 1,
      );
      nodes.push({
        type: 'polyline',
        points: sampled,
        stroke: '#38bdf8',
        width: Math.max(2, tw * 0.45),
      });
    }
    if (state.capPreview.length > 0) {
      nodes.push({
        type: 'cells',
        cells: state.capPreview.map((cell) => [cell.x, cell.y]),
        fill: 'rgba(74,222,128,0.45)',
        stroke: '#4ade80',
      });
    }
    if (state.bridgePreview.length > 0) {
      nodes.push({
        type: 'cells',
        cells: state.bridgePreview.map((cell) => [cell.x, cell.y]),
        fill: 'rgba(250,204,21,0.55)',
        stroke: '#facc15',
      });
    }
    await api.tools.overlay(nodes);
  } catch {
    // The tool may have been deactivated while the overlay was in flight.
  }
}

// ---- path search ----------------------------------------------------------

function regionFor(start, ends, summary, margin) {
  const xs = [start.x, ...ends.map((end) => end.x)];
  const ys = [start.y, ...ends.map((end) => end.y)];
  const minX = Math.max(0, Math.min(...xs) - margin);
  const maxX = Math.min(summary.width - 1, Math.max(...xs) + margin);
  const minY = Math.max(0, Math.min(...ys) - margin);
  const maxY = Math.min(summary.height - 1, Math.max(...ys) + margin);
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function blockedAt(collision, point) {
  if (
    point.x < 0 ||
    point.y < 0 ||
    point.x >= collision.width ||
    point.y >= collision.height
  ) {
    return true;
  }
  return collision.blocked[point.y * collision.width + point.x] === 1;
}

function buildCost(box, blocked) {
  const cost = new Uint16Array(box.width * box.height);
  const strength = state.meander / 100;
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const index = y * box.width + x;
      if (blocked[index]) {
        cost[index] = 0;
        continue;
      }
      const noise = valueNoise((box.x + x) / 9, (box.y + y) / 9);
      cost[index] = 1 + Math.round(strength * 10 * noise);
    }
  }
  return cost;
}

async function findPaths(summary) {
  const start = state.start;
  const ends = state.ends;
  let lastError = null;
  for (const margin of MARGINS) {
    const box = regionFor(start, ends, summary, margin);
    if (box.width * box.height > MAX_SEARCH_CELLS) {
      lastError = riverError(
        'too-long',
        `The search area is ${box.width}×${box.height} cells; the maximum is ${MAX_SEARCH_CELLS}.`,
      );
      continue;
    }
    const collision = await api.map.readCollision(
      state.collisionLayerId,
      box.x,
      box.y,
      box.width,
      box.height,
    );
    const localStart = { x: start.x - box.x, y: start.y - box.y };
    if (blockedAt(collision, localStart)) {
      throw riverError('blocked-start', 'The start cell is blocked by collision.');
    }
    const cost = buildCost(box, collision.blocked);
    const paths = [];
    for (const end of ends) {
      const localEnd = { x: end.x - box.x, y: end.y - box.y };
      if (blockedAt(collision, localEnd)) {
        throw riverError(
          'blocked-end',
          `The end point (${end.x}, ${end.y}) is blocked by collision.`,
          end,
        );
      }
      const result = await api.compute.pathfind({
        width: box.width,
        height: box.height,
        cost,
        from: localStart,
        to: localEnd,
        diagonal: true,
        cornerCutting: false,
        maxNodes: box.width * box.height,
        heuristic: 'octile',
      });
      if (!result) {
        lastError = riverError(
          'no-path',
          `No route from the start to (${end.x}, ${end.y}) avoids the collision tiles.`,
          end,
        );
        paths.length = 0;
        break;
      }
      paths.push({
        end,
        cells: Array.from(result.path, (index) => ({
          x: box.x + (index % box.width),
          y: box.y + Math.floor(index / box.width),
        })),
      });
    }
    if (paths.length === ends.length) return { box, paths };
  }
  throw lastError ?? riverError('no-path', 'No route avoids the collision tiles.');
}

// ---- end caps -------------------------------------------------------------

function chooseCapSide(end, previous, summary) {
  const onLeft = end.x === 0;
  const onRight = end.x === summary.width - 1;
  const onTop = end.y === 0;
  const onBottom = end.y === summary.height - 1;
  if (!onLeft && !onRight && !onTop && !onBottom) return null;
  const dx = previous ? end.x - previous.x : 0;
  const horizontal = dx < 0 ? 'left' : dx > 0 ? 'right' : null;
  // The left and right columns are the natural exits. A top or bottom row uses
  // the cap the last horizontal step is heading toward; a vertical step there
  // has no left/right end to name, so it keeps the water tile.
  if (onLeft && state.caps.left.enabled && state.caps.left.gid) return 'left';
  if (onRight && state.caps.right.enabled && state.caps.right.gid) return 'right';
  if (horizontal && state.caps[horizontal].enabled && state.caps[horizontal].gid) {
    return horizontal;
  }
  return null;
}

function chooseCaps(paths, summary) {
  const caps = new Map();
  for (const path of paths) {
    if (path.cells.length === 0) continue;
    const end = path.cells[path.cells.length - 1];
    const previous = path.cells.length > 1 ? path.cells[path.cells.length - 2] : null;
    const side = chooseCapSide(end, previous, summary);
    if (!side) continue;
    const cap = state.caps[side];
    if (!cap.enabled || !cap.gid) continue;
    caps.set(cellIndex(end, summary), {
      x: end.x,
      y: end.y,
      gid: cap.gid,
      side,
    });
  }
  return caps;
}

// ---- bridges --------------------------------------------------------------

function isStraight(cells, index) {
  if (index <= 0 || index >= cells.length - 1) return false;
  const a = cells[index - 1];
  const b = cells[index];
  const c = cells[index + 1];
  return b.x - a.x === c.x - b.x && b.y - a.y === c.y - b.y;
}

function fixedBridges(pool) {
  const wanted = Math.min(Math.max(1, state.bridge.count), pool.length);
  const chosen = [];
  for (let k = 0; k < wanted; k++) {
    const at = Math.min(pool.length - 1, Math.floor(((k + 0.5) / wanted) * pool.length));
    const cell = pool[at];
    if (farEnough(chosen, cell)) chosen.push(cell);
  }
  for (const cell of pool) {
    if (chosen.length >= wanted) break;
    if (farEnough(chosen, cell)) chosen.push(cell);
  }
  return chosen;
}

function randomBridges(pool) {
  const maximum = Math.min(Math.max(1, state.bridge.count), pool.length);
  const chance = Math.max(0, Math.min(100, state.bridge.chance));
  const seed = (Math.floor(Math.random() * 0xffffffff) ^ (state.seed++ * 2654435761)) >>> 0;
  api.log(`rivers: random bridge seed ${seed}`);
  const rng = mulberry32(seed);
  const chosen = [];
  for (const cell of pool) {
    if (chosen.length >= maximum) break;
    if (rng() * 100 >= chance) continue;
    if (farEnough(chosen, cell)) chosen.push(cell);
  }
  return chosen;
}

function chooseBridges(paths, summary, caps) {
  if (!state.bridge.enabled || !state.bridge.gid) return [];
  const excluded = new Set(caps.keys());
  if (state.start) excluded.add(cellIndex(state.start, summary));
  const byIndex = new Map();
  for (const path of paths) {
    const cells = path.cells;
    if (cells.length > 0) {
      const end = cells[cells.length - 1];
      excluded.add(cellIndex(end, summary));
    }
    for (let index = 0; index < cells.length; index++) {
      const cell = cells[index];
      const key = cellIndex(cell, summary);
      if (excluded.has(key)) continue;
      const straight = isStraight(cells, index);
      const existing = byIndex.get(key);
      if (existing) {
        existing.distance = Math.min(existing.distance, index);
        existing.straight = existing.straight || straight;
      } else {
        byIndex.set(key, { ...cell, index: key, distance: index, straight });
      }
    }
  }
  const all = [...byIndex.values()].sort(
    (a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x,
  );
  if (all.length === 0) return [];
  const straight = all.filter((cell) => cell.straight);
  const pool = straight.length > 0 ? straight : all;
  return state.bridge.mode === 'random' ? randomBridges(pool) : fixedBridges(pool);
}

// ---- write ----------------------------------------------------------------

async function applyRiver(paths, caps, bridges, summary) {
  const cells = new Map();
  for (const path of paths) {
    for (const cell of path.cells) {
      const index = cellIndex(cell, summary);
      if (!cells.has(index)) cells.set(index, { x: cell.x, y: cell.y, gid: state.waterGid });
    }
  }
  for (const [index, cap] of caps) {
    cells.set(index, { x: cap.x, y: cap.y, gid: cap.gid });
  }
  for (const bridge of bridges) {
    const index = cellIndex(bridge, summary);
    const existing = cells.get(index);
    if (existing) cells.set(index, { ...existing, gid: state.bridge.gid });
  }
  const indices = [...cells.keys()];
  const gids = indices.map((index) => cells.get(index).gid);
  if (indices.length === 0) {
    throw riverError('empty', 'The river has no cells to paint.');
  }
  await api.map.applyCells(state.riverLayerId, indices, gids, 'Rivers');
}

// ---- dialogs --------------------------------------------------------------

async function showMessage(title, text) {
  await api.ui.dialog({
    id: 'river-problem',
    title,
    body: [{ type: 'text', text }],
    actions: [{ id: 'close', label: 'Close' }],
    dismissible: true,
  });
}

function clearSelection() {
  state.start = null;
  state.ends = [];
  state.preview = [];
  state.capPreview = [];
  state.bridgePreview = [];
  updateSelectionStatus();
  void paintOverlay();
}

async function handleError(error) {
  const code = error && error.code ? error.code : 'error';
  const message = error && error.message ? error.message : String(error);
  api.log(`rivers: ${code}: ${message}`);
  if (code === 'no-path' || code === 'blocked-end' || code === 'too-long') {
    const end = error.end;
    const answer = await api.ui.dialog({
      id: 'river-problem',
      title: code === 'too-long' ? 'Search area too large' : 'No river path',
      body: [{ type: 'text', text: message }],
      actions: [
        { id: 'cancel', label: 'Cancel' },
        {
          id: 'reselect',
          label: end ? 'Re-select end point' : 'Re-select',
          tone: 'primary',
        },
      ],
      dismissible: true,
    });
    if (answer.action === 'reselect') {
      if (end) state.ends = state.ends.filter((candidate) => !sameCell(candidate, end));
      else state.ends = [];
      setStatus(end ? 'Click a new end point.' : 'Click the start cell.');
      await paintOverlay();
    } else {
      clearSelection();
    }
    return;
  }
  if (code === 'blocked-start') {
    const answer = await api.ui.dialog({
      id: 'river-problem',
      title: 'Start cell blocked',
      body: [{ type: 'text', text: message }],
      actions: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'reselect', label: 'Pick another start', tone: 'primary' },
      ],
      dismissible: true,
    });
    if (answer.action === 'reselect') {
      clearSelection();
      setStatus('Click a new start cell.');
    } else {
      clearSelection();
    }
    return;
  }
  await showMessage('Rivers', message);
}

// ---- confirm --------------------------------------------------------------

async function confirmRiver() {
  if (state.busy) return;
  if (!state.toolActive) {
    await showMessage(
      'Activate the Rivers tool',
      'Pick the Rivers tool in the toolbar, then click the start and end cells.',
    );
    return;
  }
  if (!state.waterGid) {
    await showMessage('Pick a water tile', 'Select the tile that will be painted as the river.');
    return;
  }
  if (!state.start) {
    await showMessage('Pick a start cell', 'Click the map to set the start of the river.');
    return;
  }
  if (state.ends.length === 0) {
    await showMessage('Pick an end cell', 'Click one or more cells where the river should end.');
    return;
  }
  if (!state.riverLayerId) {
    await showMessage('Pick a river layer', 'Choose the tile layer the river will be painted on.');
    return;
  }
  if (!state.collisionLayerId) {
    await showMessage(
      'Pick a collision layer',
      'Choose the tile layer whose collision the river must avoid.',
    );
    return;
  }
  if (state.caps.left.enabled && !state.caps.left.gid) {
    await showMessage(
      'Pick a left end cap',
      'Choose a tile for the left end cap, or turn the cap off.',
    );
    return;
  }
  if (state.caps.right.enabled && !state.caps.right.gid) {
    await showMessage(
      'Pick a right end cap',
      'Choose a tile for the right end cap, or turn the cap off.',
    );
    return;
  }
  if (state.bridge.enabled && !state.bridge.gid) {
    await showMessage('Pick a bridge tile', 'Choose the bridge tile, or turn bridges off.');
    return;
  }

  state.busy = true;
  setStatus('Searching for a path…');
  try {
    const summary = state.summary ?? (await api.document.summary());
    state.summary = summary;
    const found = await findPaths(summary);
    const caps = chooseCaps(found.paths, summary);
    const bridges = chooseBridges(found.paths, summary, caps);
    state.preview = found.paths.map((path) => path.cells);
    state.capPreview = [...caps.values()];
    state.bridgePreview = bridges;
    await paintOverlay();
    await applyRiver(found.paths, caps, bridges, summary);
    setStatus(
      `River created: ${found.paths.length} path${found.paths.length === 1 ? '' : 's'}, ${caps.size} end cap${caps.size === 1 ? '' : 's'}, ${bridges.length} bridge${bridges.length === 1 ? '' : 's'}.`,
    );
    state.start = null;
    state.ends = [];
    state.preview = [];
    state.capPreview = [];
    state.bridgePreview = [];
    await paintOverlay();
  } catch (error) {
    await handleError(error);
  } finally {
    state.busy = false;
  }
}

// ---- tool -----------------------------------------------------------------

function onPointer(event) {
  if (event.phase !== 'down' || state.busy) return;
  const cell = { x: event.cell.x, y: event.cell.y };
  if (!state.start) {
    state.start = cell;
    state.ends = [];
    state.preview = [];
    state.capPreview = [];
    state.bridgePreview = [];
    updateSelectionStatus();
    void paintOverlay();
    return;
  }
  if (sameCell(cell, state.start) || state.ends.some((end) => sameCell(end, cell))) {
    return;
  }
  state.ends.push(cell);
  updateSelectionStatus();
  void paintOverlay();
}

api.tools
  .register(TOOL_ID, {
    onActivate() {
      state.toolActive = true;
      void api.tools.cursor('crosshair').catch(() => {});
      updateSelectionStatus();
      void refreshPanel().catch((error) => api.log(`rivers: panel failed: ${String(error)}`));
      void paintOverlay();
    },
    onDeactivate() {
      state.toolActive = false;
      void api.tools.overlay([]).catch(() => {});
    },
    onPointer(event) {
      onPointer(event);
    },
  })
  .then(() => api.log('rivers: tool registered'))
  .catch((error) => api.log(`rivers: tool registration failed: ${String(error)}`));

// ---- panel events ---------------------------------------------------------

api.ui.onEvent(PANEL_ID, 'tileset', (value) => {
  state.tileset = Number(value) || 0;
  void refreshPanel().catch((error) => api.log(`rivers: panel failed: ${String(error)}`));
});
api.ui.onEvent(PANEL_ID, 'waterTile', (value) => {
  state.waterGid = typeof value === 'number' ? value : null;
});
api.ui.onEvent(PANEL_ID, 'riverLayer', (value) => {
  state.riverLayerId = Number(value) || null;
});
api.ui.onEvent(PANEL_ID, 'collisionLayer', (value) => {
  state.collisionLayerId = Number(value) || null;
});
api.ui.onEvent(PANEL_ID, 'meander', (value) => {
  state.meander = Math.max(0, Math.min(100, Number(value) || 0));
});
for (const side of ['left', 'right']) {
  api.ui.onEvent(PANEL_ID, `${side}CapEnabled`, (value) => {
    state.caps[side].enabled = Boolean(value);
  });
  api.ui.onEvent(PANEL_ID, `${side}Cap`, (value) => {
    state.caps[side].gid = typeof value === 'number' ? value : null;
  });
}
api.ui.onEvent(PANEL_ID, 'bridgeEnabled', (value) => {
  state.bridge.enabled = Boolean(value);
});
api.ui.onEvent(PANEL_ID, 'bridgeTile', (value) => {
  state.bridge.gid = typeof value === 'number' ? value : null;
});
api.ui.onEvent(PANEL_ID, 'bridgeMode', (value) => {
  state.bridge.mode = value === 'random' ? 'random' : 'fixed';
});
api.ui.onEvent(PANEL_ID, 'bridgeCount', (value) => {
  state.bridge.count = Math.max(1, Math.min(99, Number(value) || 1));
});
api.ui.onEvent(PANEL_ID, 'bridgeChance', (value) => {
  state.bridge.chance = Math.max(0, Math.min(100, Number(value) || 0));
});
api.ui.onEvent(PANEL_ID, 'confirm', () => {
  void confirmRiver();
});
api.ui.onEvent(PANEL_ID, 'clear', () => {
  clearSelection();
});
api.ui.onEvent(PANEL_ID, 'refreshLayers', () => {
  void refreshPanel().catch((error) => api.log(`rivers: refresh failed: ${String(error)}`));
});

void refreshPanel().catch((error) => api.log(`rivers: panel failed: ${String(error)}`));
