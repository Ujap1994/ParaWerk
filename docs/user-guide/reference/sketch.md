# Sketch

> **Where:** *Features* tab → **Sketch**, or *Sketch* tab → *Sketch* group → **Sketch** ·
> **Needs:** nothing (a plane or a planar face to sketch on)

A sketch is a 2D drawing on a plane: the outline of a plate, the half section of a shaft, the points of
holes. Most features are built from sketches. While a sketch is open, the command bar shows the
*Sketch* tab with the drawing tools.

![Sketch mode on the front plane: the view looks straight at the plane, the side panel shows the sketch](../../images/screenshots/sketch-mode.png)

## Step by step

1. Click **Sketch**. The three standard planes appear in the 3D view and the side panel asks *Choose a
   plane*.
2. Pick the plane:
   - a standard plane in the 3D view, in the feature tree or with the buttons of the panel
     (*Front plane*, *Top plane*, *Right plane*);
   - a **planar face** of the part in the 3D view (curved faces cannot carry a sketch);
   - a [reference plane](plane.md) in the 3D view or the tree.

   What is under the cursor is highlighted in orange and named in the status bar.
3. The view turns to look straight at the plane, with the sketch's X axis to the right and its Y axis up.
   Draw with the tools of the *Sketch* tab (see the [sketch tools](README.md#sketch-tab)).
4. Add [relations](sketch-relations.md) and [dimensions](sketch-dimension.md) until the sketch is fully
   defined (all geometry dark instead of blue).
5. Click **✓** in the side panel or **Exit sketch** in the command bar to keep the sketch, or **✕** to
   discard your changes.

**Faster:** select a plane in the tree or a planar face in the 3D view first, then click **Sketch** – the
sketch opens there at once. In the feature tree, a plane also has a **Sketch on this plane** button.

![Choosing a planar face of the part: the face under the cursor is highlighted](../../images/screenshots/sketch-choose-face.png)

## The side panel in sketch mode

| Section | Shows |
|---|---|
| Title | *New Sketch1* or *Edit Sketch1*, with **✓** *Keep sketch* and **✕** *Discard changes* |
| *Plane* | The plane or face the sketch lies on |
| *Definition* | *Under defined*, *Fully defined* or *Over defined*, with conflicting relations to delete |
| *Tool* | How to use the active drawing tool (and its settings, e.g. polygon sides, fillet radius) |
| *Selection* | The selected geometry, the relations that fit it and the ones it has; *Copy and move* |
| *Contents* | How many entities, relations and dimensions the sketch has |

## Planes and their axes

| Plane | Contains | Looks along |
|---|---|---|
| Front plane | X and Z | +Y |
| Top plane | X and Y | −Z |
| Right plane | Y and Z | −X |

On a **face**, the sketch origin is the part origin projected onto the face; the axes are chosen like the
standard views (a face parallel to the top plane gets the axes of the top plane; on other faces the
sketch's Y axis points as close to +Z as the face allows).

## Tips

- **A sketch follows its face or plane.** It remembers the face by name, not by position: when an
  earlier feature moves the face (a thicker plate), the sketch and everything built from it move along.
- While you edit a sketch, the part is shown as it was before the sketch; the features after it are
  rebuilt when you leave sketch mode.
- **Undo** and **Redo** inside a sketch go step by step through the sketch; after you leave it, the whole
  sketch session is one step of the part's history.
- A new sketch that is still empty is not added to the tree.
- Saving (Ctrl/⌘ + S) while a sketch is open stores the sketch and keeps you in sketch mode.
- Once a feature uses a sketch, the sketch is hidden in the 3D view; double-click it in the tree to edit
  it, and the features built from it follow.
- Esc or **✕** cancels the plane choice.

## Messages

| Message | What to do |
|---|---|
| *The face this sketch was drawn on no longer exists. The sketch stays where the face was.* (tree, red) | An earlier change removed the face. The features built from the sketch keep working where it is. Undo the change that removed the face, or draw the sketch again on the face you want. |
| *The reference plane this sketch was drawn on no longer exists …* | The plane failed or was deleted: fix or restore the plane. |
| *Discard your changes to the sketch?* | Shown by **✕** when the sketch has changes. **Discard** returns the sketch to how it was. |

## See also

- [User guide: Sketches](../sketches.md) – grid, snapping, fully defined sketches and a complete example
- [Extrude](extrude.md), [Revolve](revolve.md), [Hole](hole.md) – what is built from sketches
