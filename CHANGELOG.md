# Changelog

All notable changes to ParaWerk are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Extrude (Phase 2): the closed outlines of a sketch become a solid, or are cut out of the body with
  *Remove material*; a depth (also as an equation) or *through all* of the body, direction along the
  sketch normal, reversed or mid-plane. Outlines inside others become holes; curves that cross each other are reported with their
  position. Lines, arcs, circles, ellipses and splines stay exact B-Rep geometry, and a sketch used by an
  extrusion is hidden in the 3D view. Editing the sketch rebuilds the extrusion
  ([ADR 0009](docs/adr/0009-sketch-based-features.md)). Part files with extrusions are saved as format
  version 4.
- Revolve: the closed outlines of a sketch turn around a line of the sketch (usually a centerline) into a
  solid or a cut; angle up to 360° (also as an equation), one way, the other way or symmetric. The axis is
  chosen in the side panel and shown in orange; outlines on both sides of the axis are reported. Shafts,
  bushes, grooves and tori come out with exact volumes.
- Persistent naming ([ADR 0002](docs/adr/0002-persistent-naming.md)): every face is named after the
  feature that made it (for an extrusion, after the sketch curve that swept it), and fillets and
  chamfers remember their edges by the two faces they lie between. Editing earlier features – a wider
  sketch, a new hole, a cut inserted or suppressed before the fillet – no longer moves fillets to other
  edges; an edge that is really gone is reported. Edge numbers in files of earlier versions are converted
  when the part is opened; part files with named edges are saved as format version 5.
- Sketches on faces follow their face: when an earlier feature moves or turns the face (a thicker
  plate), the sketch and the features built from it move along. A sketch whose face is gone is marked
  and stays where the face was.
- Reference geometry ([ADR 0010](docs/adr/0010-reference-geometry.md)): reference planes (offset, at an
  angle around an axis, through three points, between two planes, parallel through a point), axes (along
  an edge or the axis of a cylinder, where two planes meet, through two points, normal to a plane) and
  points (coordinates, centers of edges and faces, where an axis meets a plane). They are built on
  standard planes, the origin, each other and faces, edges and vertices of the part, follow the part when
  earlier features change, and carry sketches. Vertices can be picked in the 3D view. Part files with
  reference geometry are saved as format version 6.
- Revolve around a reference axis: *Axis* also lists the part's reference axes; the axis must lie in the
  sketch plane.
- Hole: holes for ISO metric screws M1.6–M30 at the free points of a sketch – clearance holes (ISO 273
  fine, medium, coarse), counterbores for ISO 4762, 90° countersinks for ISO 10642 and tapped holes with
  their tap drill; through all or to a depth with a 118° drill point; dimensions from the standards and
  changeable. Threads are shown as dashed circles of their nominal diameter. All holes of a feature are cut
  in one operation (100 holes: 0.3 s instead of 1.2 s as single cuts).
- Patterns and mirror: linear patterns along an edge, axis or plane normal, circular patterns around an
  axis (evenly all round or over an angle) and mirror images through a plane, of extrusions, revolutions,
  holes, boxes and cylinders. The features to copy are picked in the tree (shown below the side panel
  while picking) or by a face in the 3D view; all copies of a feature are combined with the body in one
  operation.
- Extrude up to a surface (a planar face, a reference or standard plane, also at an angle; with an offset
  before or past it) and up to a vertex; the extrusion follows the face or vertex when it moves.
- Shell: hollows the part out to walls of a thickness, open at faces picked in the 3D view, or with a
  closed cavity; the walls can also go outside the part. Walls that are too thick are reported instead of
  silently giving back the unchanged part.
- Lost edges: a fillet or chamfer whose edges are partly gone after an earlier change still rounds the
  others and shows a yellow warning in the tree instead of failing. Editing it lists the lost edges,
  marks where they were in the 3D view and removes them with one click.

### Fixed
- The labels of choice fields in the side panel had no space above them.
- Volume and surface area of bodies with ellipses or splines are now exact; OCCT's default integration
  was off by up to 1e-4 on such faces.

## [0.2.0-alpha.1] - 2026-10-25

Completes the **2D sketcher** (Phase 1): splines with points on them and exact trimming, converting
model edges, scaling, and variables and equations for the whole part. Turning sketches into solids
(extrude, revolve) follows in Phase 2. Not ready for productive use; see the disclaimer in the README.

### Added – sketcher
- Splines (key S): smooth curves through fit points (natural cubic splines), drawn point by point with
  snapping; the fit points are ordinary sketch points that can be dragged, dimensioned and related;
  move, copy, mirror and patterns; DXF export as polylines and import of fit-point splines.
- Points on splines: points snap onto a spline between its fit points and stay on it (*on curve*,
  also offered for a selected point and spline); they slide along the curve until a dimension holds
  them and follow when the fit points move.
- Trimming and extending at splines: lines, arcs and circles are trimmed where a spline crosses them
  and extended up to a spline (or an ellipse); their new ends stay on it. Splines themselves are cut
  exactly: they keep all of their fit points, so their shape does not change, and show only the rest
  between their new ends, which the solver keeps on the curve; the cut-off part is hinted while the
  sketch is open. Part files store the trim ends of splines (format version 3).
- Scale the selection by a factor around the origin or a selected point, in place (dimensions within the
  selection scale along) or as a scaled copy.
- Convert entities: edges of the part become fixed sketch geometry on the sketch plane (lines, circles
  and arcs; tilted circles become ellipses, other curves splines); touching edges stay connected. The
  geometry kernel now reports the exact end points, centers and axes of edges.

### Added – parameters
- Global variables and equations: a list of named values (also as equations over each other, with
  cycles and unknown names explained), used by name in feature parameters and sketch dimensions; when a
  variable changes, every parameter and dimension that uses it follows and changed sketches are solved
  again, in one undo step. Part files that use variables, equations or splines are saved as format
  version 3.
- Calculations in number fields and dimension values: + − × ÷, powers, brackets, π, sqrt, abs and
  sin/cos/tan in degrees, and lengths with units (mm, cm, m, in); evaluated by an own parser, never as
  code.

### Changed
- A sketch point under the cursor now wins over a relation symbol, so points stay easy to grab when
  symbols crowd around them in a zoomed-out view.
- *Line* and *Centerline* share one button with a variant menu (**L** starts the last one used), which
  makes room for *Spline* in the command bar.

## [0.2.0-alpha.0] - 2026-10-19

Second technical preview: the **2D sketcher** (Phase 1). Sketches can be drawn, constrained, fully
defined, edited and exchanged as DXF. Turning them into solids (extrude, revolve) follows in Phase 2.
Not ready for productive use; see the disclaimer in the README.

### Added – sketch mode
- The front, top and right planes in the feature tree and, while choosing a sketch plane, in the 3D view;
  sketches on planar faces of the part, placed exactly on the face's B-Rep plane.
- The **Sketch** command: the view turns normal to the sketch plane; adaptive grid and sketch origin;
  command bar tabs *Features* and *Sketch*.
- Undo and redo step by step inside a sketch; the whole session becomes one step of the part history;
  **✓** keeps, **✕** discards (after asking); existing sketches are edited from the feature tree, with
  later features rolled back.
- Sketch geometry in the 3D view: the open sketch on top of the part with points and dashed construction
  geometry, other sketches on their planes; hover with exact sizes in the status bar, click and
  Shift/Ctrl/⌘-click selection, deleting with dependent relations.
- Dragging under-defined geometry with live solving in a background worker (about 7 ms per step with
  2,000 entities, Apple M3).

### Added – drawing tools
- Line chains and centerlines; corner, center and 3-point rectangles and parallelograms; circles from
  center and radius or through three points; ellipses; center, 3-point and tangent arcs; straight slots;
  regular polygons (3 to 64 sides); points; construction geometry toggle.
- Snapping to end points, midpoints and curves (also where an inference line crosses a curve) and
  inference lines; the matching relations (coincident, midpoint, on curve, horizontal, vertical) are added
  automatically.
- Measurements next to the cursor; drawing by clicking or by press-drag-release; keyboard shortcuts
  (L, R, C, A, P, D, T); tool variants in drop-down menus that remember the last variant.
- Ellipses: center and two axis points, axes kept perpendicular by the solver and dimensioned from the
  center; points on ellipses and lines tangent to them.

### Added – relations and dimensions
- Relations for the selection (horizontal, vertical, coincident, on curve, midpoint, parallel,
  perpendicular, collinear, equal, tangent, concentric, symmetric, fix), offered according to what is
  selected and checked by the solver first: over-defining or contradicting relations are refused with a
  message. The relations of the selection are listed and can be deleted.
- Relation symbols next to the geometry (H, V, ∥, ⊥, =, …), outside closed outlines, one symbol per
  tangent joint, at a constant distance on screen. Pointing at a symbol highlights the related geometry,
  clicking selects the relation, Delete removes it; conflicting relations are red. A view toolbar button,
  the View menu and the settings hide and show them.
- Smart dimension (D): lengths, horizontal and vertical distances, point-to-line and parallel-line
  distances, diameters, radii and angles, inferred from the picked geometry and where the value is
  placed; values typed right at the dimension; double-click to change, drag to move, Delete to remove.
  Dimensions that would over-define the sketch become reference dimensions in parentheses.
- Definition status: under-defined geometry is blue, fully defined dark, over-defined red; the status is
  shown in the side panel, the status bar and the feature tree; conflicting relations and dimensions are
  listed and can be deleted. The solver analyzes every change in the background.
- Own sparse 2D constraint solver in a worker ([ADR 0005](docs/adr/0005-sketch-solver.md)), with
  well-conditioned tangency at shared end points so tangent arcs and fillets count as fully defined.

### Added – editing tools
- Trim (T) removes the piece of a curve between its crossings (red preview under the cursor; middle
  pieces leave collinear lines or equal arcs, circles become arcs); extend lengthens a line or arc up to
  the next curve. New ends stay on the crossing curve.
- Sketch fillet and chamfer round or bevel the corner of two lines; the corner stays as a virtual sharp
  so dimensions to it keep working.
- Offset of lines, arcs and circles: connected chains stay connected, closed outlines grow outwards or
  inwards.
- Mirror (with symmetric relations), linear and circular patterns (equal radii for copies), move (keeping
  relations) and copy of the selection.

### Added – DXF exchange
- DXF import into the open sketch: lines, circles, arcs, full ellipses, points and polylines with arc
  segments; units converted to millimeters; coinciding ends joined; unsupported entities listed.
- DXF export of the sketch (R12, millimeters, without construction geometry); ellipses become closed
  polylines within 0.005 mm.

### Added – interface, quality and documentation
- The command bar adapts to the window width (tighter buttons, then icons only) without changing its
  height; its variant menus are never cut off.
- End-to-end test of the Phase 1 exit criterion: an L-shaped bracket with two holes is drawn and fully
  defined with mouse and keyboard only, in the smallest window, in at most 64 clicks and key presses.
- Sketch benchmarks for dragging and drawing in sketches of 50, 500 and 2,000 entities.
- User guide chapter on sketches with a step-by-step example and screenshots of every tool.

### Changed
- New geometry kernel: Open CASCADE Technology 8.0.1 compiled to WebAssembly with ParaWerk's own C++
  facade. Editing large parts is about twice as fast, the kernel uses half the memory, starts faster,
  and the memory leaks of the previous prebuilt build are gone.
- Curved faces are tessellated with a fast Delaunay triangulator for the 3D view.

### Security
- The content security policy no longer allows `'unsafe-eval'` anywhere (the new kernel does not
  generate code at run time).

## [0.1.0-alpha.0] - 2026-10-19

First technical preview (Phase 0). Not ready for productive use; see the disclaimer in the README.

### Added – Phase 0 preview
- Electron desktop application with secure defaults (sandboxed renderer, context isolation, strict
  content security policy, custom `app://` protocol), single instance and clean shutdown.
- Geometry kernel based on Open CASCADE Technology (WebAssembly) in a background worker: box and
  cylinder (add or remove material), fillet, chamfer, incremental rebuild, exact mass properties,
  automatic recovery after kernel crashes.
- 3D view with view cube, axis indicator, standard views, orthographic and perspective projection,
  rotation around the point under the cursor, zoom to cursor, mouse and trackpad presets, face and edge
  highlighting and picking.
- Feature tree and property panels with live preview, rollback while editing, suppress, delete, undo
  and redo, and readable error messages.
- Native `.pwpart` file format; STEP and binary STL export.
- English and German user interface (switchable at runtime, system language by default); light and
  dark theme; own icon set.
- Automated unit, integration and end-to-end tests; kernel, solver and rendering benchmarks; CI on
  Windows, macOS and Linux; release workflow for all desktop packages.
- User guide with screenshots, architecture decision records and benchmark results.
- The status bar shows the exact type and size of the face or edge under the cursor or selected
  (for example "Face 7 · Cylinder Ø 44 mm · 4,838.1 mm²"), computed from the B-Rep, not from the mesh.
- `--self-test` command-line option that checks an installation (3D graphics, geometry kernel, modeling
  accuracy, STEP export); the release pipeline runs it on every package.

### Added – planning
- Project vision, README with disclaimer and planned feature overview.
- Detailed roadmap with effort estimates, architecture, performance targets, risks and decision gates.
- Project icon (SVG) and roadmap timeline graphic.
- GPL-3.0-or-later license.

### Changed
- The project is now called **ParaWerk** (formerly the working title CADWerk). The repository moved to
  `Ujap1994/ParaWerk`; GitHub redirects the old address.

### Removed
- DWG from the planned formats, because it is a closed, proprietary format. DXF covers 2D exchange.

[Unreleased]: https://github.com/Ujap1994/ParaWerk/compare/v0.2.0-alpha.1...HEAD
[0.2.0-alpha.1]: https://github.com/Ujap1994/ParaWerk/compare/v0.2.0-alpha.0...v0.2.0-alpha.1
[0.2.0-alpha.0]: https://github.com/Ujap1994/ParaWerk/compare/v0.1.0-alpha.0...v0.2.0-alpha.0
[0.1.0-alpha.0]: https://github.com/Ujap1994/ParaWerk/releases/tag/v0.1.0-alpha.0
