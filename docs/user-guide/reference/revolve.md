# Revolve

> **Where:** *Features* tab → **Revolve** · **Needs:** a sketch with closed outlines and an axis (a line
> of the sketch, usually a centerline, or a reference axis in the sketch plane)

Revolve turns the closed outlines of a sketch around an axis: shafts, bushes, pulleys, knobs, and with
**Remove material** grooves and recesses in round parts.

![A flanged bush revolved three quarters of a turn around the orange centerline](../../images/screenshots/revolve-bush.png)

## Step by step

1. Draw a [sketch](sketch.md) with the **half section** of the part and a
   [centerline](sketch-line.md) as the axis. The outlines may touch the axis but must stay on one side.
2. Click **Revolve**. It takes the newest unused sketch and its first centerline (without a centerline,
   the newest reference axis).
3. Check the *Axis* (shown in orange) and the *Angle*.
4. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Sketch* | The sketch whose outlines are revolved | newest unused sketch |
| *Axis* | *Lines of the sketch* (centerlines first, then the other lines) or *Reference axes* of the part that lie in the sketch plane | first centerline |
| *Operation* | **Add material** or **Remove material**; *Merge result* as for [Extrude](extrude.md) | Add material |
| *Angle* | Up to 360° (a full turn) | 360° |
| *Direction* | **Normal** or **Reversed** (one way or the other from the sketch plane), **Symmetric** (half the angle each way) | Normal |
| *Thin feature* | Walls of a *Wall thickness* along the curves (not along the axis line), e.g. a cup from the open outline of its inside | off |

On a part of several bodies, *Feature scope* limits the feature to the bodies you tick (see
[Combine](combine.md#feature-scope)).

## Tips

- A line of the outline itself can be the axis (a shaft whose section touches the axis).
- An axis outside the sketch, such as a [reference axis](axis.md) along an edge of the part, works as
  long as it lies in the sketch plane.
- Lines become planes, cylinders and cones, arcs become spheres and tori, splines become exact surfaces
  of revolution.
- Like every parameter, *Angle* takes equations and variables.

## Messages

| Message | What to do |
|---|---|
| *The axis of this revolution is missing.* | Choose a line of the sketch under *Axis*. |
| *The axis must lie in the plane of the sketch.* | Choose an axis in that plane, or a line of the sketch. |
| *Outlines of the sketch lie on both sides of the axis.* | Keep the outlines on one side; they may touch the axis. |
| *The sketch has no closed outline …* | Close the outline or turn on *Thin feature*. |

## See also

- [Extrude](extrude.md) · [Axis](axis.md) · [Sketch line and centerline](sketch-line.md)
- [User guide: Revolve](../features.md#revolve)
