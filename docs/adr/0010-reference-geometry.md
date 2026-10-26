# 0010 – Reference geometry

**Status:** accepted (2026-10-25), Phase 2.

## Context

Parts need planes, axes and points that are not faces of the body: a sketch plane at an angle, an axis
to revolve or pattern around, a point to build a plane through. They must follow the part when earlier
features change, like everything else in the feature list, and must survive in files without the state
of the session that created them.

## Decision

- **Three feature types** – `plane`, `axis`, `point` – that do not change the body. Each has a `method`
  and an ordered list of `references`; the method says which role each reference plays
  (`REFERENCE_ROLES` in `src/shared/model/reference.ts`):

  | Feature | Methods (references) |
  |---|---|
  | Plane | offset (plane), angle (plane, axis), three points, mid-plane (two planes), parallel through a point (plane, point) |
  | Axis | along an edge or face (axis), where two planes meet, through two points, normal to a plane through a point |
  | Point | coordinates, center of an edge or face, where an axis meets a plane |

  The method is chosen explicitly in the side panel; for a new feature it is inferred from what was
  selected before the command (one planar face → offset plane, two points → axis through them, …).
- **References** (`GeometryRef`) are standard planes, the origin, earlier reference features (by id)
  and faces, edges and vertices of the body by persistent name (ADR 0002): a face by its name and where
  it was picked, an edge by its two faces, a vertex by the faces that meet there. A role accepts what can
  provide it: a plane from a standard plane, a planar face or a reference plane; an axis from a straight or
  circular edge, a cylindrical, conical or toroidal face or a reference axis; a point from a vertex, the
  origin or a reference point; a center from any edge or face.
- **The geometry is computed by every rebuild, not stored.** The kernel worker resolves the references
  in the body before the feature (`src/kernel/reference.ts`, with exact face and edge geometry from
  the kernel) and reports the result with the feature (`FeatureResult.reference`); the 3D view draws
  from there. References found only by position are healed into the document like edge references.
- **Sketches on reference planes** store `{ kind: 'feature', feature, frame }`; the frame follows the
  plane on every rebuild (healed, and left out of the rebuild keys like for sketches on faces). A sketch
  whose plane is gone reports `plane-missing` and stays where it was.
- **Display.** Planes are drawn as rectangles covering the part as seen along their normal, axes as
  dash-dot lines as long as the part along them (dimmed where the part hides them), points as symbols of
  constant screen size. The feature being edited is drawn as a preview in its own style; what it is built
  on is highlighted. Vertices became pickable: near the end of an edge, a click picks the vertex.

## Consequences

- Editing a reference feature changes its rebuild key and so rebuilds the features after it, like any
  other edit; reference features themselves are cheap (one naming query and a few geometry queries).
- Part files with reference geometry are format version 6.
- Revolve takes a reference axis (`RevolveFeature.axisRef`) besides a line of its sketch; the axis must
  lie in the sketch plane (`axis-not-in-plane`).
- Patterns and mirror (`pattern`, `mirror`) reuse the reference fields: a direction (an axis or the normal
  of a plane), an axis or a plane, plus the list of features they copy. The kernel resolves the copied
  features as they were built, builds each one's tool once and combines moved (or, for a mirror, copied
  and mirrored) instances with the body in one boolean operation (`combineCopies`); holes are drilled again
  at the transformed centers. Faces of copy *i* of feature *s* are named `<pattern id>:<s>:<i>:<face name>`.
- Coordinate systems (`csys`, 2026-10-26) are reference features too: an origin and three right-handed
  unit axes, either at a position turned around Z or from a point and two directions (Y made
  perpendicular to X). Where a field takes a point, a plane or an axis, they give their origin, their XY
  plane or their Z axis. They are consumed outside the feature list: mass properties are transformed into
  them in the renderer (center and inertia tensor, `src/shared/model/frame.ts`), and exports move a copy of
  the body into them in the kernel (`transformShape`, a location, so faces keep their names). Part files
  with coordinate systems are format version 7.
