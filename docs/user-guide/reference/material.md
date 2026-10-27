# Material

> **Where:** *Evaluate* tab → *Part* group → **Material**, or double-click *Material* at the top of the
> feature tree · **Needs:** nothing

The material gives the part its density – and with it its mass and moments of inertia – and its color.

![The material dialog with the library on the left and density and appearance on the right](../../images/screenshots/material-dialog.png)

## Step by step

1. Click **Material**. The dialog shows the library on the left.
2. Choose a material, or **Custom material** (a name and a density of your own), or **No material**.
3. Adjust the *Density* if your data sheet differs (*Library value* goes back).
4. Under *Appearance*, keep the *Color of the material* or pick a color of your own.
5. Click **OK**. Material and color are one step that **Undo** reverts; **Cancel** or **Esc** keeps the
   part as it was.

## The library

| Group | Materials |
|---|---|
| Metals | Structural steel S235JR, steel C45, stainless steel 1.4301, grey cast iron EN-GJL-250, aluminium EN AW-6061 and 7075, brass CuZn39Pb3, tin bronze CuSn8, copper Cu-ETP, titanium Ti-6Al-4V |
| Plastics | PLA, PETG, ABS, ASA, TPU (95A), PA12, PA6, POM-C, PC, PMMA, HDPE, PTFE |
| Wood | Oak, beech, pine, birch plywood, MDF |

The densities are typical values at room temperature.

## Tips

- For 3D-printed parts with infill, lower the density to match the printed mass.
- Without a material, the part has a volume but no mass.
- The material and color are saved in the part file and written into [3MF exports](export.md).

## See also

- [Mass properties](mass-properties.md) · [User guide: Material and appearance](../evaluate.md#material-and-appearance)
