# Loft

> **Where:** *Features* tab → arrow of **Revolve** → **Loft** · **Needs:** at least two sketches with one
> closed outline each (without holes)

Loft makes a solid through the outlines of several sketches, in order: a transition from a square duct to
a round one, bottles, blades. With a centerline it bends between the profiles.

![A transition from a square to a circle 60 mm above it](../../images/screenshots/loft.png)

## Step by step

1. Create the planes for the profiles, usually [reference planes](plane.md) at offsets above each other.
2. Draw one closed outline in each sketch.
3. Click **Loft**. It takes the sketches with closed outlines that no feature uses yet (at least the
   last two).
4. Check the order under *Profiles, in order*: **↑** moves a sketch up, **✕** takes it out, *Add a
   profile* adds one at the end.
5. Optionally choose a *Centerline* or turn on *Flat faces between the profiles*.
6. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Profiles, in order* | The sketches the solid goes through, in this order | unused sketches with outlines |
| *Add a profile* | Adds another sketch at the end | |
| *Centerline* | A sketch or curve through the profiles: between them the loft follows it (bent transitions, elbows) | None (straight between the profiles) |
| *Flat faces between the profiles* | Straight faces between neighboring outlines instead of a smooth surface (not with a centerline) | off |
| *Operation* | **Add material** or **Remove material**; *Merge result* as for [Extrude](extrude.md) | Add material |

## Tips

- Outlines with different numbers of edges (a square and a circle) are joined too; the side faces are
  named after the edges of the first outline.
- The profiles stay where they are drawn; a centerline only shapes the loft between them.
- Twisted profiles (corners that do not line up) can make the loft fail: draw the outlines so that their
  start points line up.

![A square duct bent around a corner: a loft along a quarter-circle centerline](../../images/screenshots/loft-centerline.png)

## Messages

| Message | What to do |
|---|---|
| *A loft needs at least two sketches with a closed outline each.* | Draw the profiles first. |
| *A loft needs at least two profiles.* | Add a profile to the list. |
| *Profile n must be one closed outline without holes.* | Remove extra or inner outlines from that sketch. |
| *The profiles could not be joined.* | Check that they lie one after the other and are not twisted against each other. |
| *The centerline of the loft no longer exists.* / *The centerline must be one chain …* | Choose another centerline or none. |

## See also

- [Sweep](sweep.md) · [Plane](plane.md)
- [User guide: Loft](../features.md#loft)
