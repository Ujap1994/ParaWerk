# Pattern

> **Where:** *Features* tab → **Pattern** (the split button that also offers **Circular pattern** and
> **Mirror**) · **Needs:** a feature that adds or cuts material

Pattern copies features in a row along a direction: a row of holes, ribs at equal spacing. It copies
extrusions, revolutions, sweeps, lofts, holes, boxes and cylinders – and other patterns and mirror images
with all their copies (a row copied into a grid).

![Two holes copied twice along the front edge of the plate, 22 mm apart; the arrow shows which way the copies go](../../images/screenshots/pattern-linear.png)

## Step by step

1. Click **Pattern** (or select a face of the feature to copy first). The field *Features to copy* is
   active.
2. Click the features to copy in the feature tree (shown below the side panel), or one of their faces in
   the 3D view; click again to take one out. Their faces are highlighted.
3. Pick the *Direction*: click a straight edge, an axis, or a plane in the tree. An edge, vertex, plane or
   axis goes into the *Direction* field right away. For a **planar face** as direction (its normal), click
   the *Direction* field first – while *Features to copy* is active, a face names a feature to copy.
4. Check the **arrow** in the 3D view: it starts at the features you copy and points the way the copies
   go. When you pick a direction, ParaWerk turns it towards the rest of the part, so the copies go into
   the part – the top and the bottom edge of a plate both give a row across it.
5. Set *Count* (the original included) and *Spacing*; **Other direction** turns the row round.
6. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Features to copy* | The features (chips with **✕**) | the features of faces selected before |
| *Type* | **Linear** or **Circular** (see [Circular pattern](circular-pattern.md)) | Linear |
| *Direction (edge, axis or plane)* | A straight edge, a reference axis, a helix (its axis), or a plane or planar face (its normal) | |
| *Count* | How many in all, the original included (2 to 1000) | 3 |
| *Spacing* | The distance from one copy to the next | 20 mm |
| *Other direction* | The copies go the other way; set when you pick a direction so that they go into the part | towards the part |

## Patterns of patterns

Pick another pattern or mirror as a feature to copy, and its original **and** all its copies are copied: a
row of holes copied into a grid, a row turned around an axis. A feature that ends up at the same place
twice is made only once; a pattern of patterns makes at most 10,000 copies. The pattern you copy is taken
as it was built, with the direction it had, even if its edge was rounded later.

## Tips

- All copies of a feature are added or cut in one operation, so long patterns rebuild quickly.
- Copies have faces with names of their own, so fillets on them stay put when the pattern changes.
- *Count* and *Spacing* take equations: `floor(length / 30)` fills a length.
- Fillets and chamfers are not copied: round the copies with one fillet afterwards (pick the faces of the
  copies to round all their edges).
- While you edit, the 3D view shows the copies; they cannot be the pattern's own direction – pick the
  original geometry.

## Messages

| Message | What to do |
|---|---|
| *Choose the features to copy …* | Click features in the tree or their faces. |
| *Only features that add or cut material can be copied …* | You clicked something that is no such feature (a fillet, a face of a fillet). Pick the feature itself. |
| *A feature to copy is missing or suppressed.* | Edit the pattern and choose the features again, or unsuppress the feature. |
| *A feature this pattern or mirror copies has failed itself.* | Fix that feature first (it is red in the tree); the pattern follows. |
| *Reference 1 of this feature is missing …* | The direction is gone: pick a new one. |
| *That belongs to a copy this feature makes itself …* | Pick an edge, face or plane of the original part as direction. |
| *The pattern would make n copies; at most 10,000 are possible.* | Reduce the counts. |
| *The copies do not touch the part, so they remove nothing …* (yellow) | The copies of a cut lie beside the part: turn on **Other direction**, or check the spacing. |

## See also

- [Circular pattern](circular-pattern.md) · [Mirror](mirror.md) · [Sketch patterns](sketch-copy-move.md)
- [User guide: Patterns and mirror](../features.md#patterns-and-mirror)
