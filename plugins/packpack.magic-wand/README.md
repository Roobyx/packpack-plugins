# Magic Wand

Select a contiguous region of one tile and fill it with the armed tile.

## Use

1. Enable the plugin and pick **Magic wand** in the tool cluster (shortcut `W`).
2. Click a painted cell. Every contiguous cell holding the same tile is
   highlighted.
3. Press **Enter** to fill the selection with the tile currently armed in the
   **Tiles** palette, or **Shift+Enter** to erase it. Right-click also applies
   an erase to the current selection.

The selection is a preview only; nothing is written until you press Enter. The
fill is one undo entry.

## Limits

- 1,000,000 cells per selection and write; a larger region is capped and the
  status line says so.
- The preview highlights at most 10,000 cells.
- The active layer must be a tile layer and unlocked.
- A locked blueprint still refuses writes outside its area.
- Clicking an empty cell clears the selection instead of selecting the void.

## Capabilities

`map.read`, `map.write`, `tool.canvas`.
