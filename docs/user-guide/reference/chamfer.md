# Chamfer

> **Where:** *Features* tab → arrow of **Fillet** → **Chamfer** · **Needs:** a body with edges

Chamfer bevels edges: with one distance (45°), two distances or a distance and an angle.

![All edges of the top face beveled by 6 and 3 mm](../../images/screenshots/chamfer.png)

## Step by step

1. Open the arrow next to **Fillet** and choose **Chamfer** (or select edges and faces first).
2. Click the edges in the 3D view, or a face to bevel all of its edges.
3. Choose the *Size* and enter the distances or the angle.
4. For uneven chamfers, check in the preview on which face *Distance 1* is measured.
5. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Size* | **Distance** (the same on both faces), **Two distances** or **Distance and angle** | Distance |
| *Distance* / *Distance 1* | Along one face of the edge | 3 mm |
| *Distance 2* | Two distances: along the other face | Distance 1 |
| *Angle* | Distance and angle: the bevel's angle to the face of *Distance 1* (1° to 89°; 45° is the same as equal distances) | 45° |
| *Measure distance 1 on the other face* | Swaps the faces of uneven chamfers | off |
| *Edges* | How many edges and faces are picked; **Clear** removes all | |

## Tips

- Picking works exactly like for [fillets](fillet.md): edges by click, faces for all their edges, edges
  remembered by name.
- Smaller angles make a flatter bevel.

## Messages

| Message | What to do |
|---|---|
| *Select at least one edge.* | Pick edges or a face. |
| *n edges no longer exist …* | See [Fillet](fillet.md#messages). |
| *The geometry kernel could not build this feature (…)* | The chamfer is too large for the faces: make it smaller. |

## See also

- [Fillet](fillet.md)
- [User guide: Chamfer](../features.md#chamfer)
