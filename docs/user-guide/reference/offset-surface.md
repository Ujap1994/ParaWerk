# Offset surface

> **Where:** *Surfaces* tab → *Surfaces* group → **Offset surface** · **Needs:** a body

Offset surface makes a surface from faces of the part, offset along their normals – a skin over part of
the model, the start of a lid or a cover – or, at distance 0, a copy of the faces. Surfaces do not change
the part; they are drawn translucent and listed in the tree.

![The top and front faces of a block offset 8 mm outwards: the surface rounds over their common edge](../../images/screenshots/surface-offset.png)

## Step by step

1. Click **Offset surface** (or select faces first – they are taken over).
2. Click the faces of the part in the 3D view; click again to take one out.
3. Set the *Distance*: positive outward, negative inward, 0 for a copy.
4. Check the area and face count in the panel, and click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| Faces | *n faces* picked; **Remove all** clears them | faces selected before |
| *Distance* | Along the face normals: outward (+), inward (−), a copy (0); takes equations | 5 mm |
| Summary | *Area …, n faces* (and *encloses a volume* for closed surfaces) | |

## Tips

- Where faces meet at an edge, the offset rounds over it.
- Turn a surface into a solid with [Thicken](thicken.md); join several with [Knit](knit.md).
- The faces are remembered by name, so the surface follows the part when earlier features change.

## Messages

| Message | What to do |
|---|---|
| *Pick the faces of the surface, or choose the surfaces to join.* | Click faces. |
| *The faces cannot be offset by this distance …* | A curved face may be smaller than the distance inwards: use a smaller distance. |

## See also

- [Knit](knit.md) · [Thicken](thicken.md)
- [User guide: Surfaces](../features.md#surfaces)
