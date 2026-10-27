# Offset, mirror, patterns, move and scale in a sketch

> **Where:** side panel → *Copy and move* section (in sketch mode, with geometry selected) · **Needs:**
> selected sketch geometry

Select geometry in an open sketch, and the *Copy and move* section of the side panel offers six
operations. Choose one in its row of buttons, set its values and click the action button.

![A row of four holes made with a linear pattern](../../images/screenshots/sketch-pattern.png)

| Operation | Values | Action | What it does |
|---|---|---|---|
| **Offset** | *Distance*, *Other side* | *Offset* | Copies the selected lines, arcs and circles at the distance. Connected curves stay connected; closed outlines grow outwards (inwards with *Other side*), open chains move to the left of their direction. Lines stay *parallel*, arcs keep their centers, the first line gets the distance as a dimension. |
| **Mirror** | – | *Mirror* | Mirrors the selection about a line: select a construction line along with the geometry (or the axis line last). Mirrored points stay *symmetric*, points on the axis are shared. |
| **Linear** | *Instances*, *Step X*, *Step Y* | *Create pattern* | Repeats the selection, shifted by the steps each time. Copies of circles and arcs keep an *equal* radius, so one diameter sizes a whole row. |
| **Circular** | *Instances*, *Total angle* | *Create pattern* | Repeats the selection evenly around the sketch origin, or around a point selected along with it (360° for all round). |
| **Move** | *Shift X*, *Shift Y*, *Rotation* | *Move* / *Copy* | *Move* shifts and rotates like a drag (relations and dimensions are kept); *Copy* places a shifted and rotated copy. |
| **Scale** | *Factor* | *Scale* / *Scaled copy* | Resizes around the sketch origin (or a selected point); dimensions within the selection scale along. |

## Tips

- Ellipses and splines cannot be offset.
- For copies of solid features, use the [Pattern](pattern.md) and [Mirror](mirror.md) features instead.

## Messages

| Message | What to do |
|---|---|
| *Select geometry first.* | Select what to copy or move. |
| *Select a line as mirror axis as well …* | Add a construction line to the selection, or select the axis last. |
| *The selection cannot move there …* / *… cannot be scaled …* | Relations or dimensions to other geometry hold it: delete them first. |
| *The distance is too large for the selected curves.* | Use a smaller offset. |

## See also

- [Pattern](pattern.md) · [User guide: Offset, mirror, patterns, move, copy and scale](../sketches.md#offset-mirror-patterns-move-copy-and-scale)
