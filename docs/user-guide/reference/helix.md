# Helix

> **Where:** *Surfaces* tab → *Curves* group → **Helix**, or *Features* tab → arrow of **Plane** →
> **Helix** · **Needs:** a sketch with a circle

A helix is a curve that winds around the axis of a circle: the path for springs, coils and spiral grooves.
It does not change the body; it is drawn as a line and listed in the tree.

![A helix of 6 turns around a circle of radius 15, previewed in teal while it is edited](../../images/screenshots/helix.png)

## Step by step

1. Draw a circle in a sketch: its center and the sketch normal give the axis, its radius the radius of the
   helix.
2. Click **Helix**. It takes the newest unused sketch with a circle.
3. Set *Pitch* and *Turns* (the panel shows the height, pitch × turns) and the *Start angle*.
4. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Sketch with the circle* | The helix takes the first circle of the sketch (not a construction circle) | newest unused sketch with a circle |
| *Pitch* | How far it rises in one turn | 5 mm |
| *Turns* | How many turns, also parts of a turn (0.25 is a quarter); up to 1000 | 5 |
| *Start angle* | Where on the circle it starts, from the sketch X axis | 0° |
| *Wind to the other side of the sketch* | Rises against the sketch normal | off |
| *Left-hand (counterclockwise)* | Winds the other way round | off (right-hand) |

## A spring in three steps

1. A helix around a circle of radius 15 on the top plane, start angle 0.
2. A sketch on the front plane with a circle of Ø 3 centered at (15, 0): the wire, at the start of the helix,
   in a plane through its axis.
3. [Sweep](sweep.md) the circle along the helix.

![A compression spring: a wire of Ø3 swept along the helix](../../images/screenshots/sweep-spring.png)

## Messages

| Message | What to do |
|---|---|
| *Draw a circle in a sketch first: the helix winds around it.* | There is no sketch with a circle. |
| *The sketch of the helix needs a circle …* | Add a (non-construction) circle to the sketch. |

## See also

- [Sweep](sweep.md) · [Thread](thread.md)
- [User guide: Helix and springs](../features.md#helix-and-springs)
