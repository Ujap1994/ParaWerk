# Function reference

One page for every function of ParaWerk: where to find it, what it needs, how to use it step by step,
every option with its default, tips, the messages it can show and what to do about them.

The [user guide](../README.md) explains the concepts and walks through whole workflows; this reference
is the place to look up one function. The pages follow the command bar from left to right.

> [!TIP]
> Most functions follow the same pattern: **select first, then act** (what you select before clicking
> the command is taken over), or click the command and pick in the 3D view. The side panel shows the
> parameters with a live preview; **✓** or Enter applies, **✕** or Esc cancels. Every number field takes
> calculations (`120/2+5`), units (`1in`) and [variables](variables.md).

## Features tab

| Function | Button | What it does |
|---|---|---|
| [Sketch](sketch.md) | **Sketch** | Starts a 2D sketch on a plane or a planar face |
| [Extrude](extrude.md) | **Extrude** | Pulls the closed outlines of a sketch into a solid, or cuts them out |
| [Revolve](revolve.md) | **Revolve** | Turns the outlines of a sketch around an axis |
| [Sweep](sweep.md) | arrow of **Revolve** | Moves outlines along a path, a helix or a curve |
| [Loft](loft.md) | arrow of **Revolve** | A solid through the outlines of several sketches |
| [Hole](hole.md) | **Hole** | Holes for metric screws at the points of a sketch |
| [Thread](thread.md) | arrow of **Hole** | A modeled ISO metric thread on a bolt or in a hole |
| [Box](box.md) | **Box** | Adds or removes a box |
| [Cylinder](cylinder.md) | arrow of **Box** | Adds or removes a cylinder |
| [Fillet](fillet.md) | **Fillet** | Rounds edges (constant or variable), face fillets and full rounds |
| [Chamfer](chamfer.md) | arrow of **Fillet** | Bevels edges |
| [Shell](shell.md) | **Shell** | Hollows the part out to thin walls |
| [Draft](draft.md) | arrow of **Shell** | Tilts faces for molding and casting |
| [Rib](rib.md) | arrow of **Shell** | A wall from open sketch curves to the body |
| [Variables](variables.md) | **Variables** | Named values and equations for the whole part |
| [Pattern](pattern.md) | **Pattern** | Copies features in a row |
| [Circular pattern](circular-pattern.md) | arrow of **Pattern** | Copies features around an axis |
| [Mirror](mirror.md) | arrow of **Pattern** | Mirrors features through a plane |
| [Plane](plane.md) | **Plane** | A reference plane to sketch on or build on |
| [Axis](axis.md) | arrow of **Plane** | A reference axis |
| [Point](point.md) | arrow of **Plane** | A reference point |
| [Coordinate system](coordinate-system.md) | arrow of **Plane** | A coordinate system for mass properties and exports |

The arrow of **Plane** also offers the [Helix](helix.md), the [Projected curve](projected-curve.md) and
the [Composite curve](composite-curve.md), which are described with the *Surfaces* tab.

## Surfaces tab

| Function | Group | What it does |
|---|---|---|
| [Offset surface](offset-surface.md) | Surfaces | A surface from faces of the part, offset along their normals or copied |
| [Knit](knit.md) | Surfaces | Joins surfaces where their edges meet |
| [Thicken](thicken.md) | Surfaces | Turns a surface into a solid, or fills a closed surface |
| [Helix](helix.md) | Curves | A helix around the circle of a sketch: the path of springs |
| [Projected curve](projected-curve.md) | Curves | Sketch curves projected onto faces, or a 3D curve from two sketches |
| [Composite curve](composite-curve.md) | Curves | Edges, sketches and curves joined into one path |
| [Combine](combine.md) | Bodies | Fuses bodies, subtracts them from a main body or keeps what they share |
| [Delete body](delete-body.md) | Bodies | Removes bodies from the part |

## Sketch tab

| Function | Group | What it does |
|---|---|---|
| [Sketch and Exit sketch](sketch.md) | Sketch | Starts a sketch; keeps it and returns to the part |
| [Convert](sketch-convert.md) | Sketch | Takes edges of the part into the sketch |
| [Dimension](sketch-dimension.md) | Define | Lengths, distances, angles, radii and diameters |
| [Relations](sketch-relations.md) | side panel | Horizontal, parallel, tangent, equal … |
| [Line and centerline](sketch-line.md) | Draw | Connected lines; construction lines |
| [Rectangles](sketch-rectangle.md) | Draw | Corner, center and 3-point rectangles, parallelograms |
| [Circle, 3-point circle](sketch-circle.md) | Draw | Circles |
| [Ellipse](sketch-ellipse.md) | Draw | Ellipses (in the arrow of *Circle*) |
| [Arcs](sketch-arc.md) | Draw | Center, 3-point and tangent arcs |
| [Spline](sketch-spline.md) | Draw | Smooth curves through points |
| [Slot](sketch-slot.md) | Draw | Straight slots |
| [Polygon](sketch-polygon.md) | Draw | Regular polygons |
| [Point](sketch-point.md) | Draw | Sketch points, e.g. for holes |
| [DXF import and export](sketch-dxf.md) | Exchange | Geometry from and to DXF files |
| [Trim and extend](sketch-trim-extend.md) | Modify | Cut curves at their crossings, lengthen them to the next curve |
| [Sketch fillet and chamfer](sketch-fillet-chamfer.md) | Modify | Round or bevel corners of the sketch |
| [Construction and delete](sketch-construction.md) | Modify | Construction geometry; deleting geometry |
| [Offset, mirror, patterns, move, scale](sketch-copy-move.md) | side panel | Copy and move selected geometry |

## Evaluate tab

| Function | Group | What it does |
|---|---|---|
| [Material](material.md) | Part | Material (density) and color of the part |
| [Configurations](configurations.md) | Part | Variants of the part in one file, with a design table |
| [Measure](measure.md) | Evaluate | Distances, angles, lengths, areas, diameters |
| [Mass properties](mass-properties.md) | Evaluate | Mass, volume, center of mass, moments of inertia |

## File, edit, exchange and view

| Function | Where | What it does |
|---|---|---|
| [New, open and save](new-open-save.md) | *File* group | Part files (`.pwpart`), recovery after a crash |
| [Undo and redo](undo-redo.md) | *Edit* group | Step back and forward through the history |
| [Import STEP](import-step.md) | *Exchange* group | Solids from STEP files as a feature |
| [Export](export.md) | *Exchange* group | STEP, STL and 3MF, in a coordinate system of your choice |
| [Settings](settings.md) | *Settings* | Language, theme, navigation, projection, recovery |
| [Feature tree](feature-tree.md) | left side | Edit, suppress, delete, roll back and reorder features |
| [View tools](view-tools.md) | 3D view | Zoom to fit, standard views, view cube, perspective, navigation |
| [Section view](section-view.md) | 3D view toolbar | Cut the part open to look inside |
