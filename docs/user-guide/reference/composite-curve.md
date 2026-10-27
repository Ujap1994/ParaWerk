# Composite curve

> **Where:** *Surfaces* tab → *Curves* group → **Composite curve**, or *Features* tab → arrow of
> **Plane** · **Needs:** edges, sketches or curves that join end to end

A composite curve joins edges of the part, sketches and other curves into one chain – a path for a sweep
along the outline of the part. It does not change the body.

![Three top edges of a block and a line in a sketch beyond them, joined into one path](../../images/screenshots/curve-composite.png)

## Step by step

1. Click **Composite curve** (select edges first, if you like).
2. Click edges in the 3D view; click again to take one out.
3. Add sketches and curves with *Add a sketch or curve*.
4. Check the summary (one piece) and click **✓**.

## Options

| Field | What it does |
|---|---|
| Edges | *n edges* picked; **Remove all** clears them |
| *Sketches and curves* | The sketches and curves added (with **✕**) |
| *Add a sketch or curve* | Adds one more |
| Summary | *Length …, one piece* |

## Tips

- Together, the pieces must form one chain without branches or gaps.
- Edges are remembered by name like the edges of a fillet, so the curve follows the part.

## Messages

| Message | What to do |
|---|---|
| *The curve has nothing to project or join …* | Pick edges or add sketches and curves. |
| *n edge(s) of the curve no longer exist …* | Edit the curve and pick the edges again. |

## See also

- [Projected curve](projected-curve.md) · [Sweep](sweep.md)
