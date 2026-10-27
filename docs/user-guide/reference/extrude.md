# Extrude

> **Where:** *Features* tab → **Extrude** · **Needs:** a sketch with closed outlines (or open curves for
> a thin feature)

Extrude pulls the closed outlines of a sketch into a solid along the sketch normal – plates, blocks,
brackets – or, with **Remove material**, cuts them out of the body: pockets, slots, cut-outs.

![Extruding a plate with two holes: the side panel with sketch, depth and direction](../../images/screenshots/extrude-plate.png)

## Step by step

1. Draw a [sketch](sketch.md) with closed outlines and leave it with **✓**.
2. Click **Extrude**. It takes the newest sketch that no extrusion or revolution uses yet; *Sketch*
   chooses another one. The preview appears right away.
3. Choose the *Operation*: **Add material** or **Remove material** (the first feature of a part always
   adds).
4. Choose the *End* and enter the depth, or pick what the extrusion goes up to.
5. Choose the *Direction*, and optionally a draft or a thin feature.
6. Click **✓** (Enter).

## Options

| Field | What it does | Default |
|---|---|---|
| *Sketch* | The sketch whose outlines are extruded | newest unused sketch |
| *Operation* | **Add material** or **Remove material** | Add material |
| *Merge result (with the bodies it touches)* | Only when adding: cleared, the new material stays a [body of its own](combine.md) | on |
| *End* → **Depth** | A fixed distance (*Depth*) | 20 mm |
| *End* → **Through all** | Past the whole body in the chosen direction, also when the body grows later (needs a body) | |
| *End* → **Up to next** | Until the outline meets the body; a cut goes through the first material each outline meets | |
| *End* → **Up to surface** | Until a face (planar or curved), a standard plane or a reference plane you pick | |
| *End* → **Up to vertex** | Until the height of a vertex or reference point you pick | |
| *Offset* | Up to surface: stops this far before the surface (past it with **Past the surface**) | 0 |
| *Direction* | **Normal** (along the sketch normal), **Reversed**, **Mid-plane** (half the depth each way), **Two directions** (*Depth* one way, *Depth 2* the other) | Normal |
| *Depth 2 (other side)* | With **Two directions**: the depth against the normal | the depth |
| *Draft while extruding* | Tapers the side faces towards the far end by the *Draft angle* (up to 60°) | off (5° when turned on) |
| *Draft outward* | Widens the side faces instead | off |
| *Thin feature* | Walls of a *Wall thickness* along the curves instead of filled areas | off (2 mm) |
| *Walls* | **One side** (outside a closed outline), **Other side**, **Both sides** (half each way) | One side |

Up to next, surface and vertex go one way only (**Normal** or **Reversed**).

## Tips

- **Outlines inside outlines** become holes; an outline inside a hole is material again. Construction
  geometry, open curves and lines that only divide an outline from within are ignored.
- **A sketch on a face:** **Remove material** turns the direction into the part (**Reversed**), **Add
  material** back out of it.
- **Through all** is the usual choice for cut-outs through a plate: it still cuts through when the plate
  gets thicker.
- **Up to surface** follows the face when it moves later; a plane at an angle gives a sloped end, a curved
  face a curved end.
- A sketch of **open curves only** starts as a thin feature right away – a bracket from a bent line, a rib
  from a single line.
- Every curve stays exact: lines, arcs, circles, ellipses and splines become exact faces, so volumes and
  areas are exact.

| A pocket cut from a sketch on the top face | A rib extruded up to the curved face of a shaft |
|---|---|
| ![Pocket](../../images/screenshots/extrude-pocket.png) | ![Up to surface](../../images/screenshots/extrude-up-to-surface.png) |

![A bracket extruded as a thin feature from an open profile](../../images/screenshots/extrude-thin.png)

## Messages

| Message | What to do |
|---|---|
| *Draw a sketch with a closed outline first.* | There is no sketch yet: draw one. |
| *The sketch has no closed outline …* | Close the outline (the end points must meet), turn on *Thin feature*, or choose another sketch. |
| *Curves of the sketch cross each other near (x, y) mm.* | Trim the crossing curves in the sketch ([Trim](sketch-trim-extend.md)). |
| *This cut does not touch the part, so it removes nothing.* (yellow) | Choose the other *Direction* (for a sketch on a face: **Reversed**). |
| *The end lies behind the sketch in this direction.* | Choose the other direction or another end. |
| *The extrusion runs along this plane and never reaches it.* | Pick a plane at an angle to the extrusion. |
| *The body or surface does not stop the whole outline …* | Part of the outline would go on without end: move the outline or choose another end. |
| *Walls along ellipses and splines are not possible yet.* | Use lines and arcs for thin features. |
| *More than two curves meet at …* / *The walls are too thick for the curves* | Thin features need chains without branches; make the walls thinner or put them on the other side. |
| *The sketch of this feature is missing or suppressed.* | Choose a sketch under *Sketch*. |

## See also

- [Revolve](revolve.md) · [Hole](hole.md) · [Rib](rib.md)
- [User guide: Extrude](../features.md#extrude) and [Thin features](../features.md#thin-features)
