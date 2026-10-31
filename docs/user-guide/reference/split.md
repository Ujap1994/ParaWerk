# Split

> **Where:** *Surfaces* tab → *Bodies* group → **Split** · **Needs:** a body, and a plane or a surface that
> crosses it

Split cuts every body that a plane or a surface crosses into bodies of their own: the two halves of a
mold, a part cut in two so it fits a print bed, a slab cut off to be deleted. The volume stays the same;
the part just has more bodies afterwards.

![A plate with a boss split along the front plane, shown while it is edited](../../images/screenshots/split.png)

## Step by step

1. Click **Split** (or select a plane or a planar face first – it becomes the splitting plane).
2. *Type* **With a plane**: pick the *Splitting plane* in the 3D view or the tree – a standard plane, a
   planar face or a [reference plane](plane.md). **With a surface**: choose the *Surface*, for example an
   [offset surface](offset-surface.md) inside the part.
3. With a plane, choose what to *Keep*.
4. Click **✓**. The feature tree lists the new bodies under *Solid bodies*.

## Options

| Field | What it does | Default |
|---|---|---|
| *Type* | **With a plane** or **With a surface** | With a plane |
| *Splitting plane* | A standard plane, a planar face or a reference plane; the plane goes on beyond the face | |
| *Surface* | With a surface: a surface feature before the split | |
| *Keep* | **All pieces, as bodies of their own**, **The pieces on the side of the normal**, or **The pieces on the other side** | All pieces |

## Tips

- Only bodies the plane or surface crosses are split; the others stay as they are.
- The cut faces are named after the split and their side (`…:cut:normal`, `…:cut:reverse`), so fillets,
  chamfers and sketches on them follow the part when earlier features change.
- [Combine](combine.md) joins pieces again, [Delete body](delete-body.md) removes the ones you do not need;
  *Keep* does the latter in one step for one side of a plane.
- Mass properties and exports cover all bodies.

## Messages

| Message | What to do |
|---|---|
| *The plane or surface does not cross any body.* | Move the plane, or choose another one. |
| *The surface no longer exists. Choose another one.* | Choose a surface under *Surface*. |
| *Reference 1 of this feature is missing …* | The splitting plane is gone: pick it again. |

## See also

- [Combine](combine.md) · [Delete body](delete-body.md) · [Offset surface](offset-surface.md)
- [User guide: Bodies](../features.md#bodies)
