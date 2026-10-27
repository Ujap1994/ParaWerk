# Trim and extend

> **Where:** *Sketch* tab → *Modify* group → **Trim** (its arrow offers **Extend**) · **Key:** T ·
> **Needs:** an open sketch with crossing curves

**Trim** removes the piece of a curve between its neighboring crossings. **Extend** lengthens a line or
arc up to the next curve.

![Trim: the piece of the slot's side up to the crossing line is shown in red before it is removed](../../images/screenshots/sketch-trim.png)

## Trim, step by step

1. Press **T** or click **Trim**.
2. Move the cursor over a curve: the piece a click would remove turns red.
3. Click to remove it. A curve that nothing crosses is removed completely.

What stays connected:

- Ends at a crossing stay on the crossing curve (*on curve*).
- When the piece is in the middle of a line, the two remaining parts stay *collinear*; arcs keep an
  *equal* radius.
- A circle trimmed between two crossings becomes an arc.
- A spline is cut exactly: it keeps all its fit points, so its shape does not change.

## Extend, step by step

1. Choose **Extend** in the arrow next to **Trim** (afterwards **T** starts it).
2. Move near the end of a line or arc: a dashed preview shows how far it grows and highlights the curve it
   runs into.
3. Click to extend it.

## Messages

| Message | What to do |
|---|---|
| *Click on a line, circle, arc, ellipse or spline.* | Trim needs a curve under the cursor. |
| *An ellipse that other curves cross cannot be cut into pieces …* | Trim the other curves or delete the ellipse. |
| *There is no curve to extend to in this direction.* | Extend the other end, or draw the target curve first. |
| *This end is connected to other geometry and cannot be extended.* | Only free ends can be extended. |
| *Relations or dimensions hold this end in place …* | Delete them to extend the end. |

## See also

- [Spline](sketch-spline.md) · [User guide: Trim and extend](../sketches.md#trim-and-extend)
