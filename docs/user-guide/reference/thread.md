# Thread

> **Where:** *Features* tab → arrow of **Hole** → **Thread** · **Needs:** a cylindrical face – the
> outside of a bolt or the wall of a hole

Thread cuts a **modeled** ISO metric thread into a bolt or into the wall of a hole: the groove is real
geometry, as 3D printing needs. For parts that are drilled and tapped, a [tapped hole](hole.md) with its
cosmetic thread is lighter and enough.

![A screw with a head and a modeled M10 thread over 20 mm](../../images/screenshots/thread.png)

## Step by step

1. Model the bolt with its nominal diameter (an M10 bolt: Ø 10 mm), or the hole with the **tap drill**
   diameter (M10: Ø 8.5 mm).
2. Click **Thread**, then click the cylindrical face (or select the face first). *Size* and *Pitch*
   follow the face.
3. Set the *Length* and, if needed, the end it starts at and the hand.
4. Click **✓**. Computing takes a second or two; it runs in the background.

## Options

| Field | What it does | Default |
|---|---|---|
| *Cylindrical face* | The face of the bolt or the hole, picked in the 3D view | the face selected before |
| *Size* | ISO metric size; set from the face's diameter (a bolt of that diameter, a hole of that tap drill) | M6 |
| *Pitch* | The coarse pitch of ISO 261 for the size; can be changed (fine threads) | from the size |
| *Length* | How far the thread goes into the face from the end it starts at, at most to the other end | 10 mm |
| *Start at the other end* | Starts the thread at the other end of the face | off |
| *Left-hand thread* | Winds the thread the other way | off (right-hand) |

## Tips

- A bolt keeps its diameter as the outside of the thread; the groove goes in by the depth of the ISO basic
  profile. A hole keeps its diameter as the minor diameter; the groove goes out into the wall.
- The thread runs out of the face at its start.
- Add threads late in the history: they make the part's mesh and files larger and take longer to rebuild.

## Messages

| Message | What to do |
|---|---|
| *Pick the cylindrical face of a bolt or a hole for the thread.* | Click a cylindrical face (not a plane or a cone). |
| *Pitch and length of the thread must be above 0.* | Enter positive values. |

## See also

- [Hole](hole.md) (tapped holes with cosmetic threads) · [Helix](helix.md) and [Sweep](sweep.md) for
  other helical shapes
- [User guide: Thread](../features.md#thread)
