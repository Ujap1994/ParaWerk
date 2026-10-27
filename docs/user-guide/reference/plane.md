# Plane

> **Where:** *Features* tab → **Plane** (the split button that also offers **Axis**, **Point**,
> **Coordinate system**, **Helix** and the curves) · **Needs:** what the plane is built on

A reference plane is a plane that is not a face of the part: a plane at an angle to sketch on, a plane at
an offset for the profiles of a loft, a mirror plane in the middle of a part. It does not change the body.

![A plane at 30° to the front plane through the axis of the bore](../../images/screenshots/reference-plane.png)

## Step by step

1. Click **Plane** (or select what it is built on first – a planar face gives an offset plane, three
   vertices a plane through them).
2. Choose the *Type*.
3. Fill the fields one after the other: the active field has a blue frame; pick in the 3D view or the
   tree. A field only takes what fits.
4. Set *Distance* or *Angle* where the type has one. The new plane is previewed in teal, what it is built on
   is orange.
5. Click **✓** (available when all fields are filled).

## Types

| Type | Fields | Parameters |
|---|---|---|
| **Offset from a plane** | *Plane* | *Distance* (10 mm); *Other side* |
| **At an angle to a plane** | *Plane*, *Axis* (parallel to the plane) | *Angle* (45°); *Other way round* |
| **Through three points** | *Point*, *Point*, *Point* | *Reverse normal* |
| **Between two planes** | *Plane*, *Plane* | the plane in the middle (parallel planes) or halving the angle; *Reverse normal* |
| **Parallel through a point** | *Plane*, *Point* | *Reverse normal* |

A *Plane* field takes a standard plane, a planar face, a reference plane or the XY plane of a coordinate
system; an *Axis* field a straight or circular edge, a cylindrical face, a reference axis or a helix; a
*Point* field a vertex, a reference point, a coordinate system's origin or – with **Use origin** – the
origin. A click near the end of an edge picks the vertex there.

## Tips

- The plane **follows the part**: it remembers faces, edges and vertices by name, so a plane offset from
  the top face moves up when the part gets taller.
- In the tree, a reference plane has a **Sketch on this plane** button; sketches on it follow it.
- **✕** in a field clears it and the fields after it.

## Messages

| Message | What to do |
|---|---|
| *Reference n of this feature is missing …* | Something it was built on is gone: pick it again. |
| *Reference n does not fit …* | Pick what the field asks for (plane, axis or point). |
| *The references are parallel, so they do not meet.* | Choose references that cross. |
| *The axis must lie parallel to the plane: the new plane turns around it.* | For *At an angle*, choose an axis parallel to the plane. |
| *The points lie on one line or on each other …* | Choose three points that span a plane. |
| *Choose a plane here: …* (toast) | The pick does not fit the active field. |

## See also

- [Axis](axis.md) · [Point](point.md) · [Coordinate system](coordinate-system.md) · [Sketch](sketch.md)
- [User guide: Reference geometry](../features.md#reference-geometry)
