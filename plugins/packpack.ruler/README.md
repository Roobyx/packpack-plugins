# Ruler

Measure distances on the map.

## Use

1. Enable the plugin and pick **Ruler** in the tool cluster (shortcut `M`).
2. Drag from one point to another. Release to keep the measurement.
3. Start a new drag to measure again.

The overlay shows the cell delta and the world-pixel distance. The label is
sized in screen pixels, so it stays readable at every zoom.

## Limits

- The ruler only reads pointer and viewport data; it never edits the map.
- The overlay is cleared when the tool is deactivated or another tool is
  selected.

## Capabilities

`tool.canvas`.
