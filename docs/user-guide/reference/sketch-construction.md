# Construction and delete

> **Where:** *Sketch* tab → *Modify* group → **Construction** and **Delete** · **Needs:** selected sketch
> geometry

**Construction** turns the selected geometry into construction geometry (dashed) or back. Construction
geometry helps to define the sketch – symmetry axes, circles for polygon corners, lines that position
points – but does not become part of profiles, and DXF export leaves it out.

**Delete** (or the **Delete** / **Backspace** key) removes the selected geometry, together with the
relations and dimensions that refer to it.

## Step by step

1. Select the geometry (click, **Shift**/**Ctrl**/**⌘**-click for more).
2. Click **Construction** or **Delete**.

## Tips

- A deleted line takes its own end points with it; corners it shares with other lines stay.
- Points of construction geometry get no [holes](hole.md).
- [Centerline](sketch-line.md) draws construction lines directly.

## See also

- [Line and centerline](sketch-line.md) · [User guide: Working with sketch geometry](../sketches.md#working-with-sketch-geometry)
