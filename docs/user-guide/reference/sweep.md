# Sweep

> **Where:** *Features* tab → arrow of **Revolve** → **Sweep** · **Needs:** a sketch with closed outlines
> (the profile) and a path: a sketch with one chain of curves, a [helix](helix.md) or a
> [curve](projected-curve.md)

Sweep moves the closed outlines of a profile sketch along a path: handles, tubes, wires, springs, and with
**Remove material** grooves along a curve. It can twist the profile or let it follow a guide curve.

![A handle: a circle swept along a path of lines and two arcs](../../images/screenshots/sweep.png)

## Step by step

1. Draw the **path**: a sketch with one chain of lines, arcs, ellipses or splines (open or closed), or
   create a [helix](helix.md) or a [projected](projected-curve.md) or [composite curve](composite-curve.md).
2. Draw the **profile** in another sketch, across the start of the path – usually on a plane at a right
   angle to the path, through its first point.
3. Click **Sweep**. It takes the newest unused sketch with closed outlines as *Profile* and the newest
   unused helix, curve or sketch without closed outlines as *Path*.
4. Optionally set a *Twist* or a *Guide curve*.
5. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Profile (closed outlines)* | The sketch that is swept | newest unused sketch with outlines |
| *Path* | A sketch, helix or curve: one chain without branches or gaps | newest unused path |
| *Guide curve* | A sketch or curve that starts on the outlines; the outlines turn towards it and grow or shrink with its distance from the path (not along a helix) | None |
| *Twist* | Turns the outlines about the path, evenly from start to end; several turns are possible (720°, 1080° …), negative angles turn the other way (not with a guide, not along a helix) | 0° |
| *Operation* | **Add material** or **Remove material**; *Merge result* as for [Extrude](extrude.md) | Add material |

On a part of several bodies, *Feature scope* limits the feature to the bodies you tick (see
[Combine](combine.md#feature-scope)).

## Tips

- The outlines are swept **as they lie**; the path runs from its end nearer to the outlines, so the
  direction in which it was drawn does not matter.
- The profile keeps its angle to the path as it follows it.
- **Springs:** create a [helix](helix.md), draw the wire's cross-section on a plane through the helix axis
  at its start point, and sweep it along the helix.
- A guide at a constant distance from the path keeps the outlines as they are.
- Twisted and guided sweeps, and sweeps along a helix, take outlines **without holes** (for a tube, sweep
  the outer outline and cut the inner one).

![A flat bar twisted half a turn along a straight path](../../images/screenshots/sweep-twist.png)

## Messages

| Message | What to do |
|---|---|
| *A sweep needs two sketches: one with a closed outline and one with the path.* | Draw both first. |
| *The path sketch has no curves.* / *The path branches at …* / *… do not form one connected chain.* | The path must be one chain: close gaps, remove branches, or move other curves into another sketch. |
| *The profile cannot follow the path …* | Where the path bends tighter than the profile is wide, the sweep crosses itself: widen the bend or make the profile smaller. |
| *Along a helix, with a twist or with a guide curve, the profile takes outlines without holes.* | Remove the inner outline and cut it separately. |
| *The guide curve of the sweep no longer exists.* / *The guide curve must be one chain …* | Choose another guide or none; make the guide one chain. |

## See also

- [Helix](helix.md) · [Loft](loft.md) · [Composite curve](composite-curve.md)
- [User guide: Sweep](../features.md#sweep) and [Helix and springs](../features.md#helix-and-springs)
