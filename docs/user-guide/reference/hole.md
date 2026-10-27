# Hole

> **Where:** *Features* tab → **Hole** · **Needs:** a sketch with points (usually on the face you drill
> into)

Hole drills holes for ISO metric screws (M1.6 to M30) at the points of a sketch: clearance holes,
counterbores for cap screws, countersinks for countersunk screws and tapped holes with cosmetic threads.

![Counterbores for M6 cap screws in the base plate, edited in the side panel](../../images/screenshots/hole-counterbore.png)

## Step by step

1. Start a [sketch](sketch.md) on the face you want to drill into.
2. Place a [Point](sketch-point.md) for every hole and [dimension](sketch-dimension.md) it, for example
   to the edges of the face. Leave the sketch.
3. Click **Hole**. It takes the newest sketch with points; the panel says how many holes it makes.
4. Choose *Type*, *Size* (and *Fit* for clearance holes) and the *End*.
5. Check the *Dimensions* and click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Type* | **Clearance hole**, **Counterbore** (cap screws ISO 4762), **Countersink** (90°, ISO 10642) or **Tapped hole** (coarse thread) | Clearance hole |
| *Size* | M1.6 … M30 | M6 |
| *Fit (ISO 273)* | Clearance holes: **Fine**, **Medium** or **Coarse** | Medium |
| *End* | **Through all**, or **Depth** (blind holes end in a 118° drill point) | Through all |
| *Positions* | The sketch whose points are the hole centers | newest sketch with points |
| *Drill the other way* | Holes go against the sketch normal (into the material); this turns them round | off |
| *Hole diameter* / *Tap drill* | From the standards; can be changed | 6.6 mm (M6, medium) |
| *Depth* | For **Depth** | 12 mm |
| *Counterbore Ø*, *Counterbore depth* | For counterbores | 11 mm, 6.4 mm (M6) |
| *Countersink Ø*, *Angle* | For countersinks | 13.7 mm, 90° (M6) |
| *Thread depth* | For tapped holes; the hole is drilled four turns deeper | 12 mm |

Changing the type, size or fit sets the dimensions from the standards again; afterwards each one can be
changed, also as an equation.

## Tips

- Points that are ends or centers of lines, arcs and circles, and construction points, get **no** hole –
  so construction lines can position the hole points.
- A tapped hole's thread is **cosmetic**: the hole is cut with the tap drill and the thread is drawn as
  dashed circles of its nominal diameter. For a modeled thread (3D printing) use [Thread](thread.md).
- To copy holes, use a [Pattern](pattern.md) or a [Circular pattern](circular-pattern.md), or place more
  points in the sketch (a [sketch pattern](sketch-copy-move.md)).

![Three tapped M4 holes with their threads drawn as dashed circles](../../images/screenshots/hole-threads.png)

> [!NOTE]
> The standard values come from ISO 273, ISO 2306, DIN 974-1 and ISO 10642. Check them against your
> screws and your manufacturing.

## Messages

| Message | What to do |
|---|---|
| *Place points for the holes in a sketch on the face first.* | Draw a sketch with points before clicking **Hole**. |
| *The sketch has no points for holes.* | Add points that are not ends or centers of curves. |
| *The dimensions of the hole do not fit together …* | A counterbore or countersink must be wider than the hole and less deep, a thread no deeper than the hole. |
| *This cut does not touch the part* (yellow) | Turn on *Drill the other way*. |

## See also

- [Thread](thread.md) · [Sketch point](sketch-point.md) · [Pattern](pattern.md)
- [User guide: Hole](../features.md#hole)
