# Feature tree

> **Where:** left side of the window (below the side panel while a feature is edited)

The feature tree lists the part from top to bottom: its material, the origin, the three standard planes,
the variables and every feature in the order it is built, ending in the rollback bar. With more than one
body, *Solid bodies* lists them; with configurations, a switch at the top shows another one.

![The rollback bar above the last two features: they are dimmed and not built](../../images/screenshots/feature-tree-rollback.png)

## What you can do

| Action | How |
|---|---|
| **Edit** a feature | Double-click it, or hover and click the pencil (*Edit feature*). Features below it are rolled back while you edit. |
| **Suppress** / **Unsuppress** | Hover and click the eye: the feature is left out of the part without being deleted. |
| **Delete** | Hover and click the bin. **Undo** brings the feature back. |
| **Roll back** | Drag the rollback bar (or focus it and use the arrow keys) up between two features: everything below is dimmed and not built. New features go in above the bar. **End** or the arrow button on the bar rolls forward to the end. |
| **Reorder** | Drag a feature up or down; a blue line shows where it goes. |
| **Show a plane** | Hover a plane to show it in the 3D view; click it to select it. |
| **Sketch on a plane** | Hover a plane (standard or reference) and click *Sketch on this plane*. |
| **Select a body** | Click it under *Solid bodies* to select all its faces. |
| **Material** | Double-click *Material: …* to open the [material dialog](material.md). |

## Status marks

| Mark | Meaning |
|---|---|
| Red with ⚠ | *Rebuild error*: hover for the reason, edit the feature to fix it. The rest of the part stays intact; the failed feature is skipped. |
| Yellow ⚠ | *Rebuild warning*, e.g. lost edges of a fillet or a cut that removes nothing |
| Blue ring at a sketch | *Sketch is under defined* |
| Red ⚠ at a sketch | *Sketch is over defined* |
| Dimmed | Suppressed, or rolled back |

While a feature is edited, the features before it keep their marks, so you can see when a feature it builds
on has failed.

## Reordering rules

A feature cannot move above a feature it builds on (its sketch, the plane of its sketch, the faces and edges
it uses, the features a pattern copies), nor below a feature that builds on it. The line then turns red,
and dropping explains which feature is in the way. The variables always stay at the top.

## See also

- [Undo and redo](undo-redo.md) · [Configurations](configurations.md) · [User guide: Editing features](../features.md#editing-features)
