import { isEdgeFeature, type EdgeFeature, type EdgeRef, type Feature, type HoleFeature, type SketchFeature, type SolidModelingFeature, type Vec3 } from '../shared/model/feature.ts';
import { holePositions, holeProblem } from '../shared/model/hole.ts';
import { edgeFaceNames, edgeRefOf, resolveEdgeRefs, resolveFacePlane, type BodyNaming } from '../shared/model/naming.ts';
import { sketchProfile, type Profile } from '../shared/model/profile.ts';
import type { GeometryRef, ReferenceGeometry } from '../shared/model/reference.ts';
import { frameOf, frameOnPlane, ORIGIN_ID, toModel, toSketch, type SketchFrame, type SketchPlaneRef } from '../shared/model/sketch.ts';
import type { Point2 } from '../shared/model/spline.ts';
import { hashString } from '../shared/hash.ts';
import type { KernelFeature, ResolvedEdgeFeature, ResolvedHole } from './backend.ts';
import { FeatureError } from './feature-error.ts';
import { axisOfReference, type ReferenceContext } from './reference.ts';

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
  if (feature.type === 'extrude') return { ...feature, profile, frame };
  const axis = feature.axisRef ? referenceAxis(feature.axisRef, frame, context) : sketchAxis(sketch, feature.axis);
  return { ...feature, profile, frame, line: checkedAxis(axis, profile) };
}
