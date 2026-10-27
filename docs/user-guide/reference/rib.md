# Rib

> **Where:** *Features* tab → arrow of **Shell** → **Rib** · **Needs:** a body and a sketch of open curves

Rib adds a wall from the open curves of a sketch to the body: a gusset in the corner of an angle bracket,
a stiffening rib across the inside of a housing.

![A gusset in the corner of an angle bracket, 6 mm thick](../../images/screenshots/rib.png)

## Step by step

1. Sketch open lines where the rib should **end** – for a gusset, on the front plane, a line across the
   corner from the wall to the floor.
2. Choose **Rib** in the arrow of **Shell**. It takes the newest unused sketch of open curves.
3. Set the *Thickness* and the *Direction*.
4. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Sketch* | The sketch with the open curves | newest unused open sketch |
| *Thickness* | Half to each side of the sketch | 3 mm |
| *Direction* | **Within the sketch plane**: fills the space between each line and the body, in the sketch plane (lines only). **Normal to the sketch**: grows from the curves along the sketch normal until it meets the body | Within the sketch plane |
| *Try the other side first* | The rib grows towards the material by itself; where both sides would work, this prefers the other one | off |

## Messages

| Message | What to do |
|---|---|
| *A rib within its sketch plane follows lines only; … is another curve.* | Use lines, or choose **Normal to the sketch**. |
| *The geometry kernel could not build this feature (…)* | A line's rib meets nothing: move the line so the rib reaches the body. |

## See also

- [Extrude](extrude.md) (thin features) · [Shell](shell.md)
- [User guide: Rib](../features.md#rib)
