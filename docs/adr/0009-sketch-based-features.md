# 0009 – Sketch-based features: profiles and exact geometry

**Status:** accepted (2026-10-25), first used by *Extrude* in Phase 2.

## Context

Extrude, revolve and later features turn sketches into solids. They need to know which regions of a
sketch are material, and the kernel needs the sketch curves as B-Rep geometry. Sketches are edited all the
time, so the result must follow the sketch, and files must rebuild without the application state that
existed when the feature was created.

## Decision

- **The feature stores a reference, not geometry.** An `extrude` feature holds the id of its sketch
  feature, which comes before it. The rebuild resolves the reference (`src/kernel/resolve.ts`): it reads
  the solved sketch from the document, computes the profile and passes outlines and plane to the backend.
  The sketch's plane and entities are part of the extrusion's rebuild key, so editing the sketch rebuilds
  the extrusion and everything after it, while unrelated sketches keep the cache.
- **Profiles are computed in shared TypeScript** (`src/shared/model/profile.ts`), so the kernel worker and
  the UI agree. End points are merged into vertices; curves with a free end are dropped; the outer
  boundary of each connected group of curves is found by walking the faces of the planar graph (sharpest
  left turn, ties broken by curvature); closed curves are outlines of their own. Outlines nest by the
  even-odd rule: inside an outline is material, inside that a hole, inside the hole material again. Lines
  that only divide an outline from within are ignored. Curves that cross each other are reported instead of
  guessed (`profile-crossing`, with the position).
- **Exact geometry.** Lines, arcs, circles and ellipses are passed by their parameters. Splines, which are
  natural cubic splines in their chord-length parameter, are passed as cubic Bézier spans in that same
  parameter; the kernel makes one B-spline curve from them and reduces the inner knots to simple ones (the
  spline is C2 there). Trimmed splines pass only their shown stretch. The kernel builds every edge from its
  2D curve on the sketch plane (sketch coordinates are the plane's own parameters) and derives the 3D curve
  from it, so no curve on the plane is approximated.
- **Exact mass properties.** OCCT's fixed Gauss rule is exact for planes, cylinders, cones, spheres and tori
  bounded by lines and circles, and those bodies keep the fast path. Bodies with ellipses, splines or other
  surfaces are integrated adaptively (relative error 1e-9) on a copy whose surfaces of extrusion and
  revolution are converted to exact B-spline surfaces: OCCT integrates surfaces of extrusion over spline
  curves inaccurately in every mode (off by up to 2e-3 for a spline profile). The body keeps its analytic
  surfaces.

## Consequences

- An extruded spline outline is one smooth B-Rep face per spline, not one face per span.
- A 100-hole plate as one sketch and one extrusion rebuilds in about 140 ms (Apple M3), against about
  1,170 ms as 101 box and cylinder features.
- A sketch that an extrusion uses is hidden in the 3D view; editing the extrusion shows it.
- The reference by sketch id is not yet a persistent name for faces of the result
  ([ADR 0002](0002-persistent-naming.md)); fillets on extruded edges still use edge indices.

## Revisit when

- Users need to pick individual regions of a sketch (SolidWorks-style contour selection): the profile
  already knows every bounded face of the planar graph and can offer them.
- Open profiles are needed (thin features, surfaces).
