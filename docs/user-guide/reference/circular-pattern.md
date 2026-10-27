# Circular pattern

> **Where:** *Features* tab → arrow of **Pattern** → **Circular pattern** · **Needs:** a feature that adds
> or cuts material, and an axis

Circular pattern copies features around an axis: holes on a bolt circle, spokes, teeth.

![Six holes around the center axis of a disk](../../images/screenshots/pattern-circular.png)

## Step by step

1. Choose **Circular pattern** in the arrow of **Pattern**.
2. Click the features to copy in the tree or one of their faces in the 3D view.
3. Pick the *Axis*: a [reference axis](axis.md) in the tree or the 3D view, a cylindrical face (for a face,
   click the *Axis* field first) or a circular edge.
4. Set *Count* and *Total angle*.
5. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Features to copy* | As for [Pattern](pattern.md) | |
| *Type* | **Circular** (or **Linear**) | Circular |
| *Axis* | A reference axis, a helix, a cylindrical face or a circular edge (its axis) | |
| *Count* | How many in all, the original included | 3 |
| *Total angle* | 360° spreads the copies evenly all round; a smaller angle puts the last copy at its end | 360° |
| *Other way round* | Turns the copies the other way | off |

## Tips

- The axis through the middle of a disk is quickest as a reference axis **Where two planes meet** (front
  and right plane), or **Along an edge or face** on the round face of the disk.
- A circular pattern of a linear pattern turns a whole row around the axis.

![A row of three holes turned four times around the center of a disk](../../images/screenshots/pattern-of-pattern.png)

## Messages

The messages are those of [Pattern](pattern.md#messages).

## See also

- [Pattern](pattern.md) · [Mirror](mirror.md) · [Axis](axis.md)
