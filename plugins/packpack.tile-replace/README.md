# Tile Replace

Replace every copy of one tile on the active layer with the armed tile.

## Use

1. Enable the plugin and pick **Tile replace** in the tool cluster (shortcut
   `T`).
2. Arm the replacement tile in the **Tiles** palette.
3. Click any cell holding the tile you want to replace.

The whole active layer is scanned and rewritten in one undo entry.

## Limits

- The active layer must be a tile layer and unlocked.
- A locked blueprint still refuses writes outside its area.
- Up to 4,000,000 cells are scanned per click.
- Clicking an empty cell does nothing.

## Capabilities

`map.read`, `map.write`, `tool.canvas`.
