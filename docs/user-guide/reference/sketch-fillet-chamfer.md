# Sketch fillet and chamfer

> **Where:** *Sketch* tab → *Modify* group → **Fillet** (its arrow offers **Chamfer**) · **Needs:** two
> lines that meet at a corner

Round or bevel the corner where two lines meet, inside the sketch.

## Step by step

1. Click **Fillet** (or **Chamfer** in its arrow).
2. Set the *Radius* (or *Distance*) in the side panel.
3. Click corners. The lines are shortened and joined by a tangent arc with a radius dimension (or by a
   line, with both distances dimensioned).

## Tips

- The old corner stays as a *virtual sharp* on both lines, so dimensions and relations to the corner keep
  working and a fully defined sketch stays fully defined.
- To round edges of the solid instead, use the [Fillet](fillet.md) feature: it keeps the sketch simple.

## Messages

| Message | What to do |
|---|---|
| *Click a corner where exactly two lines meet.* | Click the corner point itself. |
| *The radius or distance is too large for the lines at this corner.* | Use a smaller value. |
| *The two lines continue each other in a straight line; there is no corner.* | Pick a real corner. |

## See also

- [Fillet](fillet.md) · [Chamfer](chamfer.md) · [User guide: Fillets and chamfers in a sketch](../sketches.md#fillets-and-chamfers-in-a-sketch)
