# 0011 – Multi-body parts

**Status:** accepted (2026-10-26), Phase 3.

## Context

A part may need several solid bodies before it is finished: a mold half and its core, two halves that are
combined or subtracted later, tools that cut one body but not another, or several loose parts kept in one
file. The body of a part has been one shape that every feature modifies as a whole; separate solids only
appeared when regions did not touch. OCCT's Boolean operations do not accept arguments whose solids
overlap each other, so bodies that overlap cannot be kept in one compound and handed to them as before.

## Decision

- **The body of a part is a compound of solids, the bodies.** Bodies may overlap. With one solid nothing
  changes, so all existing parts and files stay as they are.
- **Additive features merge or start a new body.** Extrude, revolve, sweep, loft, box, cylinder and STEP
  import have *Merge result* (the default): their solid is fused with the bodies it overlaps or touches
  – all of them become one body – and the others stay. Without it, their solids become bodies of their
  own (`merge: false`).
- **Every Boolean step works body by body** in the kernel (`combineWithBodies`): a cut is applied to each
  body it overlaps, separately; a merge fuses the tool with the touched bodies one after the other. So no
  OCCT Boolean ever gets overlapping solids in one argument.
- **Bodies are referenced through their faces.** A body is "the solid that contains this face"
  (`FaceNameRef`, ADR 0002), so references follow the part like any face reference, and picking a body
  in the 3D view is picking one of its faces. A body is shown under the name of the feature its first
  face comes from.
- **Combine** (`combine` feature) joins bodies: add (union), subtract (the main body minus the others) or
  common (what they share), with a main body and a list of others. **Delete body** removes bodies from
  the part (to keep only what is needed, e.g. after a split).
- Operations on faces and edges (fillet, chamfer, shell, draft, threads, face fillets, full rounds) act
  on the bodies that hold their faces and edges; the others pass through unchanged.

## Consequences

- Mass properties, exports and the mesh cover all bodies; the tree lists them (*Solid bodies*).
- A file with a separate body or a combine feature needs a newer format version.
- **Split** (`split`) cuts the bodies a plane or a surface crosses into bodies of their own; its cut faces
  are named after the side they are on. **Move body** (`moveBody`) moves or copies bodies by a rigid
  motion; moved bodies keep their face names, copies are named after the feature. Mass properties and
  exports can be limited to one body (`keepBodies` in the kernel).
- Not covered yet: feature scope (cuts limited to chosen bodies) and per-body materials.

## Revisit when

Assemblies (Phase 4) give parts of their own: loose parts in one file should then become an assembly.
