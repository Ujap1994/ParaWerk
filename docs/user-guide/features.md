# Modeling features

A part is a list of features applied from top to bottom. Every feature can be edited later; the part is
rebuilt automatically and only from the first changed feature onwards.

## Extrude

**Extrude** (in the *Features* tab) turns the closed outlines of a sketch into a solid, or cuts them out
of the body with **Remove material**. Draw and close the outlines in a [sketch](sketches.md) first, then
choose **Extrude**: it takes the newest sketch that no extrusion or revolution uses yet; *Sketch* in the side panel
chooses another one.

- *End*: **Depth** extrudes a given distance in millimeters; like every parameter it takes a calculation
  or a [variable](#variables-and-equations). **Through all** goes past the whole body in the chosen
  direction – the usual choice for holes and cut-outs through a plate – and still does when the body
  grows later. It needs a body to go through.
- *Direction*: **Normal** extrudes along the normal of the sketch plane (out of the face for a sketch on a
  face), **Reversed** the other way (into the body, as a pocket usually needs), **Mid-plane** half the
  depth to each side.
- Every closed outline of the sketch is extruded. An outline inside another one becomes a hole, an outline
  inside that hole is material again. Construction geometry and open curves are ignored, and so are lines
  that only divide an outline from within.
- Curves that cross each other make the outlines ambiguous: the feature then reports where they cross, so
  you can trim them. A sketch without a closed outline is reported too.
- All sketch curves stay exact in the solid: lines, arcs, circles, ellipses and splines become exact B-Rep
  edges and faces, and volumes and areas are computed exactly.

Once an extrusion uses a sketch, the sketch is hidden in the 3D view; editing the extrusion shows it again,
and editing the sketch (double-click it in the feature tree) rebuilds the extrusion.

![Extruding a plate with two holes: the side panel with sketch, depth and direction](../images/screenshots/extrude-plate.png)

![A pocket cut from a sketch on the top face of the plate](../images/screenshots/extrude-pocket.png)

## Revolve

**Revolve** turns the closed outlines of a sketch around an axis into a solid – shafts, bushes, pulleys,
knobs – or cuts them out of the body (grooves, recesses) with **Remove material**. Draw a half section and
a **centerline** as the axis in the sketch; the outlines may touch the axis but must stay on one side of
it.

- *Sketch* and *Axis*: Revolve takes the newest sketch that no extrusion or revolution uses yet and its
  first centerline. *Axis* lists the centerlines and the other lines of the sketch; the chosen one is shown
  in orange. A line of the outline itself can be the axis too.
- *Angle* in degrees, up to 360 (a full turn, the default); like every parameter it takes a calculation or
  a variable.
- *Direction*: **Normal** and **Reversed** turn one way or the other from the sketch plane, **Symmetric**
  half the angle to each side.
- Outlines inside others become holes, as for extrusions, and every sketch curve stays exact: lines become
  planes, cylinders and cones, arcs become spheres and tori, splines become exact surfaces of revolution.

![A flanged bush revolved three quarters of a turn around the orange centerline](../images/screenshots/revolve-bush.png)

## Box

Adds or removes a box. *Width* (X), *Depth* (Y) and *Height* (Z) are in millimeters; *Position* is the
center of the bottom face. The first feature of a part always adds material.

## Cylinder

Adds or removes a cylinder with *Radius*, *Height* and *Axis* (X, Y or Z). *Position* is the center of
the base circle. Use **Remove material** to drill holes; make the cylinder longer than the part so it
cuts through.

## Fillet

Rounds edges with a constant *Radius*. Click edges in the 3D view to add or remove them (selected edges
are orange). While you edit, the 3D view shows the result and draws the original edges as thin blue lines,
so you can keep picking.

![Fillet preview](../images/screenshots/fillet-preview.png)

## Chamfer

Bevels edges with an equal *Distance* on both faces. Edge selection works like for fillets.

## How features remember their edges

A fillet or chamfer remembers each edge by the two faces it lies between – for example "the top face of
Box1 and the side face that line l3 of Sketch1 swept" – not by a number. Every face is named after the
feature that made it, and keeps its name when later features cut, add or round the body. So when you
change an earlier feature – make a sketch wider, add a hole to it, insert or suppress a cut – the fillet
stays on the edge you picked, even though the body now has more or fewer edges.

When a face was only made anew (a sketch line deleted and drawn again in the same place), ParaWerk
finds the edge by its position and updates what the feature remembers.

### When edges are gone

If an edge is really gone – a cut that made it was suppressed, or a corner of the sketch was rounded so
the two side faces no longer meet – the fillet or chamfer leaves it out and still rounds the other
edges. The feature gets a yellow warning sign in the tree; hovering over it tells how many edges are
missing. Only when none of its edges exist any more does the feature fail (red).

![A fillet whose slot edges are gone after the slot was suppressed: it still rounds the plate corner and shows a warning](../images/screenshots/fillet-warning.png)

Edit the feature to fix it: the side panel says how many edges no longer exist, and the 3D view marks
with a red ⊗ where each of them was, so you can see what was meant. Pick the edges that should be
rounded now, and click **Remove** to drop the lost ones. With **✓** the warning goes away.

![Editing the fillet: the panel reports the lost edges, the 3D view marks where they were](../images/screenshots/fillet-missing-edges.png)

## Variables and equations

**Variables** (in the *Features* tab) holds named values for the whole part – a width, a wall thickness,
a hole diameter. Each one has a *Value or equation*: a number such as `120`, or a calculation that uses
other variables, such as `width / 2` or `thickness * 1.2`. The *Result* column shows what it comes to;
a name that is not allowed, a name used twice, an unknown name or a variable that depends on itself is
explained right in the row, and **✓** stays disabled until everything is valid.

![The variables of a part: values and equations with their results](../images/screenshots/variables.png)

To use a variable, type its name – or an equation with it – into a parameter field instead of a number:
`width`, `depth - 2*thickness`. The field keeps the equation and shows its result below. When you change
a variable later, every parameter and every sketch dimension that uses it follows, and the part is
rebuilt – all in one step that **Undo** reverts. Typing a plain number turns the parameter back into a
fixed value.

![A box whose width, depth and height follow variables](../images/screenshots/variables-parameters.png)

Names start with a letter or `_` and may contain letters, digits and `_`; upper and lower case do not
matter. Units and functions (`mm`, `in`, `sin`, `sqrt`, `pi`, …) cannot be used as names.

## Editing features

- **Edit:** double-click a feature in the tree or use the pencil icon. Features below it are rolled back
  (dimmed) while you edit.
- **Suppress:** the eye icon temporarily removes a feature from the part without deleting it.
- **Delete:** the trash icon removes the feature.
- **Undo / Redo:** every change can be undone (up to 200 steps).

## When a feature fails

If the kernel cannot build a feature, for example because a fillet radius is larger than the adjacent
faces allow, the feature is marked in red in the tree and the property panel explains why. The rest of
the part stays intact: the failed feature is skipped until you fix it.
