# Rivers

Draw a river from one start cell to one or more end cells. The path is a
least-cost search over the map, so it goes around collision tiles instead of
through them. A small deterministic meander cost keeps the result from looking
like a ruler line.

## Use

1. Pick **Rivers** in the map editor toolbar (shortcut `n`).
2. In the **Rivers** panel, choose the tileset, water tile, river layer and the
   layer whose collision the river must avoid.
3. Click the start cell on the map.
4. Click one or more end cells. Each click adds another end.
5. Set **Meander** if you want a straighter or more wandering river.
6. Optionally choose end caps and bridges (below).
7. Click **Create river**.

The river is written in one undo entry. If no route exists, a dialog offers
**Cancel** or **Re-select end point**; the failed end is removed and the tool
stays armed for a new one.

## End caps

End caps are optional. Each side has its own toggle and tile picker; a cap is
used only when its toggle is on and a tile is selected.

- A river ending on the left edge uses the left cap; one ending on the right
  edge uses the right cap.
- At a corner, exactly one cap is chosen, never both: the left or right edge of
  the corner wins when its cap is enabled; otherwise the last horizontal step
  names the cap.
- A cap is written on the end cell itself, so it can never be placed outside the
  map. A side the river does not touch is never used.
- If no cap is enabled for the touched side, the end cell keeps the water tile.
- A river ending on the top or bottom row uses the cap its last horizontal step
  is heading toward. A vertical step there has no left/right end to name, so it
  keeps the water tile.

Only left and right caps are exposed in this version.

## Bridges

Bridges are optional and replace the water tile on the river layer at the
chosen cells. A bridge tile that includes water is therefore the simplest
choice; a transparent overlay tile is not supported yet.

- **Set number** places the requested number of bridges, spread along the
  eligible part of the path.
- **Random** gives each eligible cell a chance to become a bridge, up to the
  number in **Bridges (or maximum)**. The random seed is logged so a result can
  be reproduced.
- Bridges are never placed on the start, an end, an end cap, or directly next to
  another bridge.
- Straight path segments are preferred, so a bridge crosses the river cleanly.
  If the path has no straight interior, any interior cell is eligible.

## Limits

- The search covers at most 4,000,000 cells. A very long river across a large
  map can exceed that; move the endpoints closer or split the river.
- One water tile, one end-cap pair and one bridge tile are used per run.
- Bridges are placed on the river layer, not a separate decoration layer.
- The meander is a deterministic value-noise cost, not terrain elevation.

## Capabilities

`map.read`, `map.read.collision`, `map.write`, `ui.sidebar`, `ui.dialog`,
`tool.canvas`, `compute.pathfind`.

API version 4. Requires PackPack 0.51.0 or newer.
