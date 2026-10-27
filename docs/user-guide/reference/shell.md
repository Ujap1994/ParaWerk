# Shell

> **Where:** *Features* tab → **Shell** (the split button that also offers **Draft** and **Rib**) ·
> **Needs:** a body

Shell hollows the part out to walls of one thickness – enclosures, cups, covers – open at the faces you
pick, or closed with a cavity inside.

![An enclosure with rounded corners, shelled to 2.5 mm walls and open at the top](../../images/screenshots/shell.png)

## Step by step

1. Click **Shell** (or select the faces to open first).
2. Click the faces where the shell should be **open**; click again to close one.
3. Set the *Wall thickness*; the 3D view previews the shell.
4. Click **✓**.

## Options

| Field | What it does | Default |
|---|---|---|
| *Wall thickness* | Thickness of all walls | 2 mm |
| *Walls outside the part* | The walls go around the part, so the part's size becomes the inside size | off |
| Open faces | *n faces open*, or *Closed: the part gets a cavity inside*; **Close all** removes them | none |

## Tips

- Rounded and sloped faces get walls that follow them; round the edges *before* shelling for evenly
  rounded walls inside and outside.
- On a part of several bodies, a shell changes the body its open faces belong to; the faces of one shell
  must be on one body.
- Open faces are remembered by name: when an earlier change removes one, the shell leaves it out and
  warns.

## Messages

| Message | What to do |
|---|---|
| *The geometry kernel could not build this feature (…)* (red) | The walls are thicker than half the narrowest place of the part: make them thinner. |
| *n faces to open no longer exist and are left out.* (yellow) | Edit the shell and pick other faces. |
| *The faces to open no longer exist …* | All of them are gone: pick the faces again. |
| *The picked faces belong to different bodies.* | Pick faces of one body, or [combine](combine.md) the bodies first. |

## See also

- [Draft](draft.md) · [Rib](rib.md) · [Fillet](fillet.md)
- [User guide: Shell](../features.md#shell)
