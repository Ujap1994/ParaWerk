# Section view

> **Where:** 3D view toolbar → *Section view* · **Needs:** a body

The section view cuts the part open, so you can look inside at wall thicknesses, bores and pockets. Where
the plane cuts through material, the cut face is filled in a sand color. It is a view only: the part, its
mass properties and its exports do not change.

![A hub cut open along the front plane](../../images/screenshots/section-view.png)

## Step by step

1. Click *Section view* in the toolbar of the 3D view (select a planar face or a plane first to cut along
   it).
2. Choose what to *Cut along* and set the *Offset* with the field or the slider.
3. Click *Section view* again or **✕** in the panel to see the whole part.

## Options

| Field | What it does | Default |
|---|---|---|
| *Cut along* | **Front**, **Top**, **Right**, or **Selection** (a planar face or plane selected in the 3D view or the tree) | the selection, else Front |
| *Cut along the selected face or plane* | Switches to the current selection | |
| *Offset* | Moves the cut along the plane's normal; the slider covers the whole part | through the origin, or the middle of the part |
| *Show the other side* | Keeps the other half | off |

## Tips

- Faces and edges that are cut away cannot be picked, so you can select and [measure](measure.md) what lies
  behind the cut.

## See also

- [View tools](view-tools.md) · [Measure](measure.md)
