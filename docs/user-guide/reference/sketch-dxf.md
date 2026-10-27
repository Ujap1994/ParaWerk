# DXF import and export

> **Where:** *Sketch* tab → *Exchange* group → **Import** and **Export** · **Needs:** an open sketch

Exchange sketch geometry with 2D CAD, laser cutting and CNC software.

## Export, step by step

1. Open the sketch (double-click it in the tree).
2. Click **Export** in the *Exchange* group of the *Sketch* tab and choose where to save.

The file is DXF R12 in millimeters with the sketch's lines, circles and arcs. Ellipses and splines are
written as polylines within 0.005 mm of the true shape. **Construction geometry and sketch points are left
out**, so only the real outline gets cut.

## Import, step by step

1. Open a sketch.
2. Click **Import** and choose a DXF file. Its geometry is added at its coordinates.

| Imported | Left out (a message lists them) |
|---|---|
| Lines, circles, arcs, points, polylines (also with arc segments), full ellipses, splines given by fit points | Texts, dimensions, splines given only by control points, elliptical arcs, hatches, blocks |

End points that coincide are joined, so imported outlines are connected. Drawings in inches, centimeters
or meters are converted to millimeters from the file's unit setting.

## Messages

| Message | What to do |
|---|---|
| *Imported n entities; not supported and left out: …* | Redraw what was left out, or convert it in the other program. |

## See also

- [Export](export.md) (3D formats) · [User guide: Sketches as DXF](../files.md#sketches-as-dxf)
