# Mass properties

> **Where:** *Evaluate* tab → *Evaluate* group → **Mass properties** · **Needs:** a body (and a
> [material](material.md) for mass and inertia)

A panel over the 3D view with mass, volume, surface area, center of mass and moments of inertia; it
follows every change of the part.

![Mass properties of an aluminium flange](../../images/screenshots/mass-properties.png)

## Step by step

1. Click **Mass properties**. The panel opens at the bottom right of the 3D view.
2. Without a material, click *Choose material…* for mass and inertia.
3. With several [bodies](combine.md) in the part, choose one under *Body* for its values alone.
4. With [coordinate systems](coordinate-system.md) in the part, choose one under *Relative to*.
5. Click **Mass properties** again or **✕** to close the panel.

## Values

| Value | Meaning |
|---|---|
| *Material*, *Density* | Click the material to change it |
| *Mass* | Volume × density (g below 1 kg, else kg); also in the status bar |
| *Volume*, *Surface area* | Exact, over the B-Rep faces |
| *Center of mass* | In model coordinates (or in the chosen coordinate system), mm |
| *Bounding box* | Size along X, Y and Z (always along the model axes) |
| *Principal moments of inertia* | I₁ ≤ I₂ ≤ I₃ about the principal axes through the center of mass, kg·mm² |
| *Inertia tensor at the center of mass* | Axes through the center of mass, parallel to the model axes (or the coordinate system's); off-diagonal terms are the negative products of inertia |

## Tips

- While the part is rolled back, the values are for the features above the rollback bar.
- While a feature or sketch is edited, the panel keeps the last values until the edit is finished.
- On a part of several bodies, the values cover all bodies unless *Body* names one.

## See also

- [Material](material.md) · [Coordinate system](coordinate-system.md) · [User guide: Mass properties](../evaluate.md#mass-properties)
