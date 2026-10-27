# Fillet

> **Where:** *Features* tab → **Fillet** (the split button that also offers **Chamfer**) · **Needs:** a
> body with edges

Fillet rounds edges with a constant or a variable radius. Two more types round between faces: a **face
fillet** between two planar faces, and a **full round** that replaces a face by half a cylinder.

![Rounding three vertical edges: the preview, the picked edges in orange, the original edges in blue](../../images/screenshots/fillet-preview.png)

## Step by step (edges)

1. Click **Fillet** (or select edges and faces first – they are taken over).
2. Click the edges to round in the 3D view; click again to take one out. Picked edges are orange.
3. Or click a **face** to round all of its edges at once – also edges the face gets later.
4. Enter the *Radius* and check the preview: the original edges stay visible as thin blue lines, so you
   can keep picking.
5. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Type* | **Constant radius**, **Variable radius**, **Face fillet** or **Full round** | Constant radius |
| *Radius* | The radius of the round | 5 mm |
| *Radius at the start*, *Radius at the end* | Variable radius: changes evenly along each edge | radius, radius |
| *Swap start and end* | Variable radius: the start is the end of an edge with the smaller coordinates (left, front, bottom); this turns it round | off |
| *Edges* | How many edges and faces are picked; **Clear** removes all | |

### Face fillet

Pick *Face 1* and *Face 2*: two planar faces that meet at a corner. The round runs between them, also where
they share no edge – faces between them (a chamfer, a small step) are rounded over, an inner corner is
filled.

![A face fillet filling the inner corner of an angle bracket](../../images/screenshots/fillet-faces.png)

### Full round

Pick *Side face 1*, the *Center face* and *Side face 2*. The center face becomes half a cylinder touching
all three; the side faces must be parallel planes – the sides of a rib, the top and bottom of a tab. The
round follows the sides when the rib changes.

![A full round on the top of a rib](../../images/screenshots/fillet-full-round.png)

For both, the fields are filled in order; **✕** clears a field and the ones after it.

## Tips

- Fillets **remember their edges by name** (the two faces an edge lies between), so they stay on the right
  edges when earlier features change.
- A click near an edge picks the edge; seams of round faces are left out when you pick a face.
- Edges and faces selected before you click **Fillet** are taken over.
- On a part of several bodies, a face fillet or full round changes the body its faces belong to.

## Messages

| Message | What to do |
|---|---|
| *Select at least one edge.* | Pick edges or a face. |
| *n edges no longer exist …* (panel, yellow; tree warning) | An earlier change removed them; their places are marked with ⊗. Pick new edges and click **Remove** to drop the lost ones. |
| *The geometry kernel could not build this feature (…)* | The radius is usually too large for the neighboring faces: make it smaller. |
| *A face fillet needs two planar faces that meet at a corner.* | Pick two planar faces that are not parallel. |
| *The radius is too large: the round would start beyond the faces.* | Make the radius smaller. |
| *The side faces of a full round must be parallel planes …* / *The center face must lie between the two side faces.* | Pick the faces in the right order. |

![A fillet whose slot edges are gone: it still rounds the plate corner and warns](../../images/screenshots/fillet-warning.png)

## See also

- [Chamfer](chamfer.md) · [Feature tree](feature-tree.md)
- [User guide: Fillet](../features.md#fillet) and [How features remember their edges](../features.md#how-features-remember-their-edges)
