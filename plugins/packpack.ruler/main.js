// Ruler: drag to measure, release to keep the measurement.
//
// The host coalesces pointer samples to one per frame and repaints the retained
// overlay. The label is sized in screen pixels by dividing by the zoom, so it
// stays readable at every scale.

const TOOL_ID = 'ruler';

let start = null;
let end = null;
let dragging = false;
let zoom = 1;

function label() {
  const dxCells = end.cell.x - start.cell.x;
  const dyCells = end.cell.y - start.cell.y;
  const dx = end.world.x - start.world.x;
  const dy = end.world.y - start.world.y;
  return `${dxCells} × ${dyCells} cells · ${Math.round(Math.hypot(dx, dy))} px`;
}

async function paint() {
  if (!start || !end) {
    await api.tools.overlay([]);
    return;
  }
  try {
    const safeZoom = Math.max(zoom, 0.01);
    const text = label();
    const size = 12 / safeZoom;
    const pad = 4 / safeZoom;
    const dot = 4 / safeZoom;
    const midX = (start.world.x + end.world.x) / 2;
    const midY = (start.world.y + end.world.y) / 2;
    const width = text.length * size * 0.55;
    const labelY = midY - size - pad * 2;
    await api.tools.overlay([
      {
        type: 'line',
        x1: start.world.x,
        y1: start.world.y,
        x2: end.world.x,
        y2: end.world.y,
        stroke: '#f8fafc',
        width: 2,
        dash: [6, 4],
      },
      { type: 'circle', cx: start.world.x, cy: start.world.y, r: dot, fill: '#f8fafc' },
      { type: 'circle', cx: end.world.x, cy: end.world.y, r: dot, fill: '#f8fafc' },
      {
        type: 'rect',
        x: midX - width / 2 - pad,
        y: labelY - size,
        w: width + pad * 2,
        h: size + pad * 2,
        fill: 'rgba(15,23,42,0.82)',
        stroke: 'rgba(248,250,252,0.35)',
        width: 1,
      },
      {
        type: 'text',
        x: midX,
        y: labelY,
        text,
        color: '#f8fafc',
        size,
        align: 'center',
      },
    ]);
  } catch {
    // The tool may have been deactivated while the overlay was in flight.
  }
}

api.tools
  .register(TOOL_ID, {
    onActivate(context) {
      zoom = context.viewport.zoom || 1;
      api.tools.cursor('crosshair');
      api.ui.status('Ruler: drag to measure, release to keep');
    },
    onDeactivate() {
      start = null;
      end = null;
      dragging = false;
    },
    onPointer(event) {
      zoom = event.viewport.zoom || zoom;
      if (event.phase === 'down') {
        start = { world: { ...event.world }, cell: { ...event.cell } };
        end = { world: { ...event.world }, cell: { ...event.cell } };
        dragging = true;
        void paint();
        return;
      }
      if (event.phase === 'move' && dragging) {
        end = { world: { ...event.world }, cell: { ...event.cell } };
        void paint();
        return;
      }
      if (event.phase === 'up' && dragging) {
        end = { world: { ...event.world }, cell: { ...event.cell } };
        dragging = false;
        void paint();
      }
    },
  })
  .catch((error) => api.log('ruler registration failed: ' + String(error)));

api.events.on('viewport', (viewport) => {
  zoom = viewport.zoom || zoom;
  if (start && end) void paint();
});
