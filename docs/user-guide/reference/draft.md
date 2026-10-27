# Draft

> **Where:** *Features* tab → arrow of **Shell** → **Draft** · **Needs:** a body, and a plane to tilt the
> faces about

Draft tilts faces by an angle, as molded and cast parts need to come out of their mold.

![A block whose four sides are drafted by 6° about the top plane](../../images/screenshots/draft.png)

## Step by step

1. Choose **Draft** in the arrow of **Shell**. The *Neutral plane* field is active.
2. Pick the **neutral plane**: a standard plane, a planar face or a [reference plane](plane.md).
3. The *Faces to draft* field becomes active: click the faces to tilt; click again to take one out.
4. Set the *Draft angle*; the preview shows the tilted faces and the original edges in blue.
5. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Neutral plane* | Each face turns about the line where it crosses this plane | |
| *Faces to draft* | The faces to tilt; **✕** removes all | |
| *Draft angle* | 0.01° to 89° | 3° |
| *Pull the other way* | The pull direction is the normal of the neutral plane; this reverses it | off |

## Tips

- The part gets narrower along the pull direction.
- Faces across the pull direction (the top of a block pulled upwards) cannot be tilted.
- For extrusions, *Draft while extruding* in the [extrusion](extrude.md) is often simpler.
- Drafted faces keep their names, so fillets on them stay put.

## Messages

| Message | What to do |
|---|---|
| *Pick the faces to draft.* | Click the faces after the neutral plane. |
| *Face n cannot be drafted: it must run along the pull direction.* | Take that face out. |
| *n faces to draft no longer exist and are left out.* (yellow) | Edit the draft and pick other faces. |
| *Reference 1 of this feature is missing …* | The neutral plane is gone: pick it again. |

## See also

- [Shell](shell.md) · [Extrude](extrude.md)
- [User guide: Draft](../features.md#draft)
