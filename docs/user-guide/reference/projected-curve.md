# Projected curve

> **Where:** *Surfaces* tab → *Curves* group → **Projected curve**, or *Features* tab → arrow of
> **Plane** · **Needs:** a sketch with curves (and faces, or a second sketch)

A projected curve is a curve in space for a sweep that no single sketch can draw: sketch curves projected
onto faces of the part, or a 3D curve from two views. It does not change the body.

![A circle projected onto the top of a shaft: a saddle-shaped curve, previewed in teal](../../images/screenshots/curve-projected.png)

## Step by step

1. Draw the curves in a sketch (all curves that are not construction geometry are used).
2. Click **Projected curve** (select the faces first, if you like). It takes the newest unused sketch.
3. Choose the *Type*:
   - **Onto faces**: click the faces in the 3D view and choose where the curves *Land*;
   - **Sketch on sketch**: choose the *Second sketch*, with the curve as seen from another direction.
4. Check the length and the number of pieces, and click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Type* | **Onto faces** or **Sketch on sketch** | Onto faces |
| *Sketch with the curves* | The curves to project | newest unused sketch |
| Faces | Onto faces: the faces picked (**Remove all** clears them) | faces selected before |
| *Lands* | **On both sides of the sketch**, **Along the sketch normal** or **Against the sketch normal** | both sides |
| *Second sketch* | Sketch on sketch: the curve seen from another direction, on a plane at an angle | |
| Summary | *Length …, one piece* or *in n pieces* – a sweep needs one piece | |

## Tips

- A curve projected onto a whole shaft lands on its top and its bottom: choose one side with *Lands*.
- **Sketch on sketch**: the 3D curve is where the two sketch curves meet when each is extended along its
  sketch normal – e.g. a line rising along a bent path.

## Messages

| Message | What to do |
|---|---|
| *Draw the curves to project in a sketch first.* | There is no sketch yet. |
| *Pick the faces the curves are projected onto.* | Click faces. |
| *The curves do not land on the chosen faces …* | Check the faces and the side. |
| *The curve has nothing to project or join …* | Choose a sketch with curves. |

## See also

- [Composite curve](composite-curve.md) · [Sweep](sweep.md)
- [User guide: Curves](../features.md#curves)
