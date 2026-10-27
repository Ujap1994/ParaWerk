# Axis

> **Where:** *Features* tab → arrow of **Plane** → **Axis** · **Needs:** what the axis is built on

A reference axis is a straight line in space: the axis of a revolution outside the sketch, the axis of a
circular pattern, the axis a plane turns about. It does not change the body.

![Reference geometry of a part: an axis through the bore, a plane through it and a point](../../images/screenshots/reference-geometry.png)

## Step by step

1. Choose **Axis** in the arrow of **Plane** (or select an edge, a cylindrical face or two vertices
   first).
2. Choose the *Type* and fill its fields in the 3D view or the tree.
3. Click **✓**.

## Types

| Type | Fields |
|---|---|
| **Along an edge or face** | A straight edge, a circular edge (its axis), a cylindrical, conical or toroidal face (its axis), or another axis |
| **Where two planes meet** | Two planes that are not parallel |
| **Through two points** | Two vertices or points |
| **Normal to a plane through a point** | A plane and a point |

## Tips

- An axis follows the part like a [plane](plane.md) does.
- Where a field takes an axis, a [helix](helix.md) gives its axis and a [coordinate system](coordinate-system.md)
  its Z axis.
- The center axis of a part built around the origin: **Where two planes meet** with the front and the right
  plane.

## Messages

As for [Plane](plane.md#messages).

## See also

- [Plane](plane.md) · [Revolve](revolve.md) · [Circular pattern](circular-pattern.md)
