# Line and centerline

> **Where:** *Sketch* tab → *Draw* group → **Line** (its arrow offers **Centerline**) · **Key:** L ·
> **Needs:** an open sketch

**Line** draws connected straight lines – the outline of a plate, a profile. **Centerline** draws the
same as construction geometry (dashed): symmetry axes, the axis of a revolution, helper lines that do not
become part of the profile.

![Drawing a line from a corner: preview, measurement and a horizontal relation](../../images/screenshots/sketch-drawing.png)

## Step by step

1. Press **L** or click **Line** (the arrow switches to **Centerline**; **L** starts the variant used
   last).
2. Click the start point, then each next point: the lines form a connected chain.
3. Click the chain's start point to close it, or press **Esc** (or click the last point again) to end it.
4. **Esc** again leaves the tool.

Pressing, dragging and releasing draws a single line.

## While you draw

- Next to the cursor: the length and angle of the line, and the relations it will get.
- Points **snap** to end points, midpoints, curves and the origin; the matching relation is added
  (coincident, midpoint, on curve).
- Lines close to horizontal or vertical snap there and get the *horizontal* or *vertical* relation (**H**
  and **V** symbols).
- Dashed guide lines line the point up with other points (no relation).

## Tips

- Draw roughly, then [dimension](sketch-dimension.md): the geometry follows the values.
- A centerline in a sketch is what [Revolve](revolve.md) takes as its axis first.
- Turn existing lines into construction geometry and back with [Construction](sketch-construction.md).

## See also

- [Rectangles](sketch-rectangle.md) · [Arcs](sketch-arc.md) · [Relations](sketch-relations.md)
- [User guide: Drawing](../sketches.md#drawing)
