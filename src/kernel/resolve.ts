import { COPYABLE_TYPES, isCopyFeature, isEdgeFeature, type CopyFeature, type EdgeFeature, type EdgeRef, type ExtrudeFeature, type Feature, type HoleFeature, type ShellFeature, type SketchFeature, type SolidModelingFeature, type Vec3 } from '../shared/model/feature.ts';
import { circularTransforms, linearTransforms, mirrorTransform, type Transform } from '../shared/model/pattern.ts';
import { holePositions, holeProblem } from '../shared/model/hole.ts';
import { edgeFaceNames, edgeRefOf, faceRefOf, resolveEdgeRefs, resolveFaceRef, resolveFacePlane, type BodyNaming } from '../shared/model/naming.ts';
import { sketchProfile, type Profile } from '../shared/model/profile.ts';
import type { GeometryRef, ReferenceGeometry } from '../shared/model/reference.ts';
import { frameOf, frameOnPlane, ORIGIN_ID, toModel, toSketch, type SketchFrame, type SketchPlaneRef } from '../shared/model/sketch.ts';
import type { Point2 } from '../shared/model/spline.ts';
import { hashString } from '../shared/hash.ts';
import type { KernelFeature, ResolvedCopy, ResolvedEdgeFeature, ResolvedExtrude, ResolvedHole, ResolvedShell } from './backend.ts';
import { FeatureError } from './feature-error.ts';
import { axisOfReference, curvedFaceOfReference, referenceValue, type ReferenceContext } from './reference.ts';

const coordinate = (value: number) => String(Math.round(value * 100) / 100);

/** The closed outlines of a sketch; throws FeatureError when there are none or curves cross. */
function profileOf(sketch: SketchFeature): Profile {
  const profile = sketchProfile(sketch.sketch);
  const crossing = profile.problems[0];
  if (crossing) throw new FeatureError('profile-crossing', `${coordinate(crossing.at[0])}, ${coordinate(crossing.at[1])}`);
  if (profile.regions.length === 0) throw new FeatureError('profile-empty');
  return profile;
}

/** The axis line of a revolution in sketch coordinates: a line of its sketch. */
function sketchAxis(sketch: SketchFeature, axis: string): [Point2, Point2] {
  const line = sketch.sketch.entities.find((entity) => entity.id === axis);
  if (line?.type !== 'line') throw new FeatureError('axis-missing');
  const position = (id: string): [number, number] | null => {
    if (id === ORIGIN_ID) return [0, 0];
    const point = sketch.sketch.entities.find((entity) => entity.id === id);
    return point?.type === 'point' ? [point.x, point.y] : null;
  };
  const [a, b] = [position(line.p1), position(line.p2)];
  if (!a || !b) throw new FeatureError('axis-missing');
  return [a, b];
}

/** An axis outside the sketch in sketch coordinates; it must lie in the sketch plane. */
function referenceAxis(ref: GeometryRef, frame: SketchFrame, context: ReferenceContext): [Point2, Point2] {
  const axis = axisOfReference(ref, context);
  const along = (v: Vec3, n: Vec3) => v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  const offset = along([axis.point[0] - frame.origin[0], axis.point[1] - frame.origin[1], axis.point[2] - frame.origin[2]], frame.normal);
  if (Math.abs(along(axis.direction, frame.normal)) > 1e-6 || Math.abs(offset) > 1e-6 * Math.max(1, Math.hypot(...axis.point))) {
    throw new FeatureError('axis-not-in-plane');
  }
  const end: Vec3 = [axis.point[0] + axis.direction[0], axis.point[1] + axis.direction[1], axis.point[2] + axis.direction[2]];
  return [toSketch(frame, axis.point), toSketch(frame, end)];
}

/** The axis line as x0 y0 x1 y1; the outlines must stay on one side of it (they may touch it). */
function checkedAxis([a, b]: [Point2, Point2], profile: Profile): [number, number, number, number] {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length = Math.hypot(dx, dy);
  if (length === 0) throw new FeatureError('axis-missing');
  // Signed distances of the outlines from the axis: touching is fine, both sides are not.
  let [left, right] = [0, 0];
  for (const region of profile.regions) {
    for (const [x, y] of region.outer.polygon) {
      const distance = (dx * (y - a[1]) - dy * (x - a[0])) / length;
      left = Math.max(left, distance);
      right = Math.max(right, -distance);
    }
  }
  const tolerance = 1e-6 * Math.max(1, length, left, right);
  if (left > tolerance && right > tolerance) throw new FeatureError('profile-crosses-axis');
  return [a[0], a[1], b[0], b[1]];
}

/**
 * The edges a fillet or chamfer means in the body it modifies. Edges that are gone are left out (and
 * counted); when all are gone, the feature fails. The faces made for an edge are named after the faces
 * it lies between, so they keep their names when other edges join or leave the feature.
 */
function resolveEdges(feature: EdgeFeature, naming: BodyNaming): ResolvedEdgeFeature {
  if (feature.edges.length === 0) throw new FeatureError('no-edges');
  const matches = resolveEdgeRefs(feature.edges, naming);
  const missing = matches.filter((match) => match === null).length;
  if (missing === matches.length) throw new FeatureError('edge-missing', String(missing));
  const edgeIndices: number[] = [];
  const edgeNames: string[] = [];
  let healed = false;
  const healedEdges: EdgeRef[] = feature.edges.map((ref, i) => {
    const match = matches[i];
    if (!match) return ref;
    if (!edgeIndices.includes(match.index)) {
      edgeIndices.push(match.index);
      const faces = ref.kind === 'edge' ? ref.faces : edgeFaceNames(naming, match.index);
      edgeNames.push(`${feature.id}:${hashString(faces.join('|'))}`);
    }
    if (match.kind === 'name') return ref;
    const current = edgeRefOf(naming, match.index);
    if (!current) return ref;
    healed = true;
    return current;
  });
  return { ...feature, edgeIndices, edgeNames, ...(healed ? { healedEdges } : {}), ...(missing > 0 ? { missingEdges: missing } : {}) };
}

function sameFrame(a: SketchFrame, b: SketchFrame): boolean {
  const close = (u: readonly number[], v: readonly number[]) => u.every((value, k) => Math.abs(value - (v[k] ?? NaN)) <= 1e-7);
  return close(a.origin, b.origin) && close(a.xDir, b.xDir) && close(a.yDir, b.yDir) && close(a.normal, b.normal);
}

/** Where a sketch lies now, and the plane reference the document should take over when it changed. */
export interface SketchPlacement {
  frame: SketchFrame;
  healed?: SketchPlaneRef;
  /** The face or reference plane of the sketch is gone; the sketch stays where it was. */
  missing?: boolean;
}

/**
 * Places a sketch: a sketch on a face follows the face in `body` (the body before the sketch), found by
 * its persistent name or, in older files, by its plane (docs/adr/0002-persistent-naming.md); a sketch on
 * a reference plane follows that plane (`references`: where the reference features before it lie).
 */
export function placeSketch(sketch: SketchFeature, body: (() => BodyNaming) | null, references: ReadonlyMap<string, ReferenceGeometry> = new Map()): SketchPlacement {
  const plane = sketch.plane;
  if (plane.kind === 'feature') {
    const geometry = references.get(plane.feature);
    if (geometry?.kind !== 'plane') return { frame: plane.frame, missing: true };
    if (sameFrame(geometry.frame, plane.frame)) return { frame: plane.frame };
    return { frame: geometry.frame, healed: { ...plane, frame: geometry.frame } };
  }
  if (plane.kind !== 'face') return { frame: frameOf(plane) };
  const face = body ? resolveFacePlane(plane.name, plane.frame, body()) : null;
  if (!face) return { frame: plane.frame, missing: true };
  const frame = frameOnPlane(face.point, face.normal);
  const name = face.name || plane.name;
  if (sameFrame(frame, plane.frame) && face.index === plane.face && name === plane.name) return { frame: plane.frame };
  return { frame, healed: { kind: 'face', face: face.index, frame, ...(name ? { name } : {}) } };
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/**
 * Where an extrusion up to a surface or vertex ends: a range along the sketch normal, and for a plane at
 * an angle to the sketch also the plane to cut it off at. Up to the next face and up to a curved face the
 * backend finds the end in the body (`limit`). Blind and through-all extrusions need none of it.
 */
function extrudeEnd(feature: ExtrudeFeature, profile: Profile, frame: SketchFrame, context: ResolveContext): Pick<ResolvedExtrude, 'range' | 'trim' | 'limit'> {
  if (feature.end === 'upToNext') {
    if (!context.body) throw new FeatureError('no-body');
    return { limit: { kind: 'next' } };
  }
  if (feature.end !== 'upToSurface' && feature.end !== 'upToVertex') return {};
  // Up to something goes one way: along the normal, or against it when reversed.
  const sign = feature.direction === 'reverse' ? -1 : 1;
  const d: Vec3 = [sign * frame.normal[0], sign * frame.normal[1], sign * frame.normal[2]];
  const range = (depth: number): [number, number] => {
    if (!(depth > 1e-9)) throw new FeatureError('end-behind');
    return sign > 0 ? [0, depth] : [-depth, 0];
  };
  if (feature.end === 'upToVertex') {
    const point = referenceValue(feature.endRef, 'point', 0, context);
    return { range: range(dot3(minus(point, frame.origin), d)) };
  }
  const curved = curvedFaceOfReference(feature.endRef, 0, context);
  if (curved !== null) return { limit: { kind: 'face', face: curved, offset: (feature.endBeyond ? -1 : 1) * (feature.endOffset ?? 0) } };
  const plane = referenceValue(feature.endRef, 'plane', 0, context);
  const along = dot3(d, plane.normal);
  if (Math.abs(along) < 1e-9) throw new FeatureError('end-parallel');
  // The plane's normal turned away from the sketch; the offset moves the plane towards the sketch (or past it).
  const away: Vec3 = along > 0 ? plane.normal : [-plane.normal[0], -plane.normal[1], -plane.normal[2]];
  const offset = (feature.endBeyond ? 1 : -1) * (feature.endOffset ?? 0);
  const point: Vec3 = [plane.point[0] + away[0] * offset, plane.point[1] + away[1] * offset, plane.point[2] + away[2] * offset];
  // How far each point of the outlines travels to reach the plane.
  const reach = profile.regions.flatMap((region) => region.outer.polygon).map(([x, y]) => dot3(minus(point, toModel(frame, x, y)), away) / Math.abs(along));
  const [near, far] = [Math.min(...reach), Math.max(...reach)];
  if (!(near > 1e-9)) throw new FeatureError('end-behind');
  // A parallel plane is a depth; at an angle the extrusion goes past it and is cut off there.
  if (far - near < 1e-9) return { range: range(near) };
  return { range: range(far + 1 + 0.01 * far), trim: [...point, ...away] };
}

/** Holes go into the material from the sketch plane: against its normal (which points out of a face), or along it. */
function resolveHole(feature: HoleFeature, sketch: SketchFeature, frame: SketchFrame): ResolvedHole {
  const positions = holePositions(sketch.sketch);
  if (positions.length === 0) throw new FeatureError('hole-no-points');
  const problem = holeProblem(feature);
  if (problem) throw new FeatureError('hole-invalid', problem);
  const direction = feature.reverse ? frame.normal : ([-frame.normal[0], -frame.normal[1], -frame.normal[2]] as Vec3);
  const placements = positions.flatMap(([x, y]) => [...toModel(frame, x, y), ...direction]);
  return { ...feature, placements };
}

/**
 * A pattern or mirror: the features it copies, each resolved as it was built, and where the copies go.
 * Only features that add or cut material with a tool of their own can be copied.
 */
function resolveCopy(feature: CopyFeature, before: readonly Feature[], context: ResolveContext): ResolvedCopy {
  if (feature.features.length === 0) throw new FeatureError('pattern-empty');
  const indices = feature.features.map((id) => before.findIndex((candidate) => candidate.id === id));
  const missing = indices.filter((index) => index < 0 || before[index]?.suppressed).length;
  if (missing > 0) throw new FeatureError('pattern-seed-missing', String(missing));
  const seeds = indices
    .sort((a, b) => a - b)
    .map((index) => {
      const seed = before[index] as Feature;
      if (!COPYABLE_TYPES.has(seed.type)) throw new FeatureError('pattern-unsupported');
      return resolveFeature(seed as SolidModelingFeature, before.slice(0, index), context);
    });
  let transforms: Transform[];
  if (feature.type === 'mirror') {
    const plane = referenceValue(feature.references[0], 'plane', 0, context);
    transforms = [mirrorTransform(plane.point, plane.normal)];
  } else if (feature.method === 'linear') {
    const direction = referenceValue(feature.references[0], 'direction', 0, context);
    transforms = linearTransforms(feature.flip ? ([-direction[0], -direction[1], -direction[2]] as Vec3) : direction, feature.spacing, feature.count);
  } else {
    const axis = referenceValue(feature.references[0], 'axis', 0, context);
    const direction = feature.flip ? ([-axis.direction[0], -axis.direction[1], -axis.direction[2]] as Vec3) : axis.direction;
    transforms = circularTransforms(axis.point, direction, feature.angle, feature.count);
  }
  return { ...feature, seeds, transforms: transforms.flat() };
}

/**
 * The open faces of a shell in the body it hollows out. Faces that are gone are left out (and counted);
 * when all are gone, the shell fails. Faces found only by position are brought up to date.
 */
function resolveShell(feature: ShellFeature, context: ResolveContext): ResolvedShell {
  const body = context.body;
  if (!body) throw new FeatureError('no-body');
  const naming = body.naming();
  const faceIndices: number[] = [];
  let missing = 0;
  let healed = false;
  const healedFaces = feature.faces.map((ref) => {
    const match = resolveFaceRef(ref, naming, (face, point) => {
      const center = body.face(face).center;
      return Math.hypot(center[0] - point[0], center[1] - point[1], center[2] - point[2]);
    });
    if (!match) {
      missing++;
      return ref;
    }
    if (!faceIndices.includes(match.index)) faceIndices.push(match.index);
    if (match.kind === 'name') return ref;
    healed = true;
    return faceRefOf(naming, match.index, ref.at) ?? ref;
  });
  if (missing > 0 && missing === feature.faces.length) throw new FeatureError('shell-face-missing', String(missing));
  return { ...feature, faceIndices, ...(missing > 0 ? { missingFaces: missing } : {}), ...(healed ? { healedFaces } : {}) };
}

/** What features are resolved against: the body before them, where sketches lie and where reference features lie. */
export interface ResolveContext extends ReferenceContext {
  frames: ReadonlyMap<string, SketchFrame>;
}

/**
 * Gives a feature what it needs from earlier features: extrusions and revolutions get the closed
 * outlines and the plane of their sketch (a revolution also its axis), fillets and chamfers the edges
 * of the body they modify that their references mean. Throws FeatureError when the sketch is missing or
 * has no usable outline, or when an edge or the axis is gone.
 */
export function resolveFeature(feature: SolidModelingFeature, before: readonly Feature[], context: ResolveContext): KernelFeature {
  if (isCopyFeature(feature)) return resolveCopy(feature, before, context);
  if (feature.type === 'shell') return resolveShell(feature, context);
  if (isEdgeFeature(feature)) {
    if (!context.body) throw new FeatureError('no-body');
    return resolveEdges(feature, context.body.naming());
  }
  if (feature.type !== 'extrude' && feature.type !== 'revolve' && feature.type !== 'hole') return feature;
  const sketch = before.find((candidate): candidate is SketchFeature => candidate.type === 'sketch' && candidate.id === feature.sketch);
  if (!sketch || sketch.suppressed) throw new FeatureError('sketch-missing');
  if (feature.type === 'hole') return resolveHole(feature, sketch, context.frames.get(sketch.id) ?? frameOf(sketch.plane));
  const profile = profileOf(sketch);
  const frame = context.frames.get(sketch.id) ?? frameOf(sketch.plane);
  if (feature.type === 'extrude') return { ...feature, profile, frame, ...extrudeEnd(feature, profile, frame, context) };
  const axis = feature.axisRef ? referenceAxis(feature.axisRef, frame, context) : sketchAxis(sketch, feature.axis);
  return { ...feature, profile, frame, line: checkedAxis(axis, profile) };
}
