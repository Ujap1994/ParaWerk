# Measure

> **Where:** *Evaluate* tab → *Evaluate* group → **Measure** · **Needs:** a body

Measure distances, angles, lengths, areas and diameters on the exact geometry of the part.

![The distance between two bores and of their axes](../../images/screenshots/measure.png)

## Step by step

1. Click **Measure**. A panel opens at the top left of the 3D view.
2. Click a face, edge or vertex (no Ctrl needed): the panel describes it.
3. Click a second one: the two are measured against each other.
4. A third click starts a new measurement; click a pick again to remove it.
5. Click **Measure** again or **✕** in the panel to turn the tool off.

## What is measured

| Picks | Result |
|---|---|
| One face | Kind of surface, diameter of cylinders and spheres, area |
| One edge | Kind of curve, length, diameter and center of circles and arcs |
| One vertex | Position |
| Any two | **Shortest distance** (solid line) with dX, dY, dZ |
| Two planes or straight edges, or one of each | **Angle** (0° to 90°); for parallel planes also the **distance of the planes** |
| Circles, arcs, cylinders, spheres (with each other or a vertex) | **Center distance** between centers or axes (dashed line) |

## Tips

- All values come from the exact B-Rep geometry, not from the display mesh.
- Hovering also tells about a face or edge: the status bar shows its type and size.
- Measuring is not available while a feature or sketch is edited.

## Messages

| Message | What to do |
|---|---|
| *Planes and reference geometry cannot be measured yet.* | Pick faces, edges or vertices of the part. |
| *Finish the edit to measure.* | Apply or cancel the edit first. |

## See also

- [Mass properties](mass-properties.md) · [User guide: Measure](../evaluate.md#measure)
