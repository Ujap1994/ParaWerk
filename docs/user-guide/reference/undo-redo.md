# Undo and redo

> **Where:** command bar → *Edit* group → **Undo**, **Redo** · **Keys:** Ctrl/⌘ + Z, Ctrl + Y / ⌘ + Shift + Z

Every change of the part can be undone, up to 200 steps.

| Situation | What one step is |
|---|---|
| A feature applied with **✓** | The whole feature (all its parameter changes) |
| A sketch session | Inside the sketch: each drawing, drag, relation or dimension. After leaving the sketch: the whole session |
| Variables applied | All parameters and sketches that follow the variables |
| Material and color | One step |
| Reordering, suppressing, deleting features | One step each |
| Switching the configuration | One step |

## Tips

- Undo inside a sketch only steps through the sketch; leave the sketch to undo earlier features.
- References that ParaWerk brings up to date by itself (edges found again after a change) are no undo step.

## See also

- [Feature tree](feature-tree.md) · [Sketch](sketch.md)
