# Spline

> **Where:** *Sketch* tab → *Draw* group → **Spline** · **Key:** S · **Needs:** an open sketch

A spline is a smooth curve through the points you click (a natural cubic spline): it passes through every
point, bends without kinks and runs straight out at both ends. For free-form outlines, handles, blades.

![A profile with a spline between two lines and a point held on it](../../images/screenshots/sketch-spline.png)

## Step by step

1. Press **S** or click **Spline**.
2. Click the points the curve passes through (each click is one undo step). Points snap, so a spline can
   start at the end of a line.
3. Press **Esc** or click the last point again to end the spline.

## Tips

- The fit points are ordinary sketch points: drag, dimension and relate them; the curve follows. The spline
  is fully defined when all its points are.
- Points snap *onto* the curve between the fit points and stay on it.
- Lines, arcs and circles can be trimmed at a spline and extended up to it; a spline itself is cut
  **exactly** (its shape does not change, the cut-off part stays hinted while the sketch is open).
- Splines can be moved, copied, mirrored, patterned and scaled, but not offset.
- DXF export writes splines as polylines within 0.005 mm; DXF import reads splines defined by fit points.

![Trim at a spline: the piece of the line above the spline turns red before it is removed](../../images/screenshots/sketch-spline-trim.png)

## See also

- [Trim and extend](sketch-trim-extend.md) · [User guide: Splines](../sketches.md#splines)
