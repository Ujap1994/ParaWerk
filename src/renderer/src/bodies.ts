/**
 * The bodies of the shown part (docs/adr/0011-multi-body-parts.md): the solids of its body, each with its
 * faces and the feature its first face comes from.
 */

import { faceRefOf, vertexPosition, type BodyNaming } from '../../shared/model/naming.ts';
import type { FaceNameRef } from '../../shared/model/reference.ts';
import { referencePicks, type ReferenceState } from './references.ts';

export interface BodyInfo {
  /** The body's number, from 0 (solids in kernel order). */
  index: number;
  faces: number[];
  /** Id of the feature the body's first face is named after ('' for unnamed faces). */
  feature: string;
}

export function bodiesOf(naming: BodyNaming): BodyInfo[] {
  const bodies = new Map<number, BodyInfo>();
  naming.faces.forEach((name, face) => {
    const index = naming.faceBodies?.[face] ?? 0;
    const body = bodies.get(index) ?? { index, faces: [], feature: name.split(':')[0] ?? '' };
    body.faces.push(face);
    bodies.set(index, body);
  });
  return [...bodies.values()].sort((a, b) => a.index - b.index);
}

/** The body that holds a face, or null. */
export function bodyOfFace(naming: BodyNaming, face: number): number | null {
  if (face < 0 || face >= naming.faces.length) return null;
  return naming.faceBodies?.[face] ?? 0;
}

/** The bodies that faces picked for a combine or delete-body feature stand for (null where a face is gone). */
export function bodiesOfRefs(refs: readonly FaceNameRef[], state: ReferenceState): (number | null)[] {
  const naming = state.display.body?.naming;
  return refs.map((ref) => {
    const face = referencePicks([ref], state)[0];
    return naming && face?.kind === 'face' ? bodyOfFace(naming, face.index) : null;
  });
}

/** A reference to a body: one of its named faces, at one of its corners; null when it has no such face. */
export function bodyRef(naming: BodyNaming, body: BodyInfo): FaceNameRef | null {
  for (const face of body.faces) {
    if (!naming.faces[face]) continue;
    for (let vertex = 0; vertex + 1 < naming.vertexFaceOffsets.length; vertex++) {
      const from = naming.vertexFaceOffsets[vertex] ?? 0;
      const to = naming.vertexFaceOffsets[vertex + 1] ?? 0;
      for (let k = from; k < to; k++) {
        if (naming.vertexFaces[k] !== face) continue;
        const ref = faceRefOf(naming, face, vertexPosition(naming, vertex));
        if (ref) return ref;
      }
    }
  }
  return null;
}

/** The body of the face a reference names (by name), or null. */
export function bodyOfRef(naming: BodyNaming, ref: FaceNameRef): number | null {
  const face = naming.faces.indexOf(ref.name);
  return face >= 0 ? (naming.faceBodies?.[face] ?? 0) : null;
}
