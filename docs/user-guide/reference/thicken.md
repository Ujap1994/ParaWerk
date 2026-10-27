# Thicken

> **Where:** *Surfaces* tab → *Surfaces* group → **Thicken** · **Needs:** a surface

Thicken turns a surface into a solid: a *Thickness* along its normal, against it or half each way – or,
for a closed surface, the solid it encloses. The solid is added like other features that add material.

![The top face offset 12 mm upwards and thickened into a 4 mm lid of its own](../../images/screenshots/thicken.png)

## Step by step

1. Create a surface with [Offset surface](offset-surface.md) or [Knit](knit.md).
2. Click **Thicken**. It takes the newest surface that no feature uses yet.
3. Set the *Thickness* and the side it *Grows* to, or turn on *Fill the enclosed volume*.
4. Decide whether to *Merge result* with the bodies it touches.
5. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Surface* | The surface to thicken | newest unused surface |
| *Fill the enclosed volume (closed surfaces)* | The solid a closed surface encloses, instead of a thickness | off |
| *Thickness* | How thick the solid is | 2 mm |
| *Grows* | **Along the normal**, **Against the normal** or **Half each way** | Along the normal |
| *Merge result (with the bodies it touches)* | Cleared, the solid stays a body of its own | on |

## Messages

| Message | What to do |
|---|---|
| *Make a surface first, for example with Offset surface.* | There is no surface yet. |
| *Only a surface that encloses a volume can be filled.* | Knit its faces together first, or give it a thickness. |
| *The surface cannot be thickened like this …* | Try a smaller thickness or the other side. |
| *The surface no longer exists.* | Choose another surface. |

## See also

- [Offset surface](offset-surface.md) · [Knit](knit.md) · [Combine](combine.md)
