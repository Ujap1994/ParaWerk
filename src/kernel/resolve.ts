import { isEdgeFeature, type EdgeFeature, type EdgeRef, type Feature, type SketchFeature, type SolidModelingFeature } from '../shared/model/feature.ts';
import { edgeFaceNames, edgeRefOf, resolveEdgeRefs, type BodyNaming } from '../shared/model/naming.ts';
import { sketchProfile, type Profile } from '../shared/model/profile.ts';
import { frameOf, ORIGIN_ID } from '../shared/model/sketch.ts';
import { hashString } from '../shared/hash.ts';
import type { KernelFeature, ResolvedEdgeFeature } from './backend.ts';
import { FeatureError } from './feature-error.ts';

const coordinate = (value: number) => String(Math.round(value * 100) / 100);

/** The closed outlines of a sketch; throws FeatureError when there are none or curves cross. */
function profileOf(sketch: SketchFeature): Profile {
  const profile = sketchProfile(sketch.sketch);
  const crossing = profile.problems[0];
  if (crossing) throw new FeatureError('profile-crossing', `${coordinate(crossing.at[0])}, ${coordinate(crossing.at[1])}`);
  if (profile.regions.length === 0) throw new FeatureError('profile-empty');
  return profile;
}

/** The axis line of a revolution in sketch coordinates; the outlines must stay on one side of it. */
function axisOf(sketch: SketchFeature, axis: string, profile: Profile): [number, number, number, number] {
  const line = sketch.sketch.entities.find((entity) => entity.id === axis);
  if (line?.type !== 'line') throw new FeatureError('axis-missing');
  const position = (id: string): [number, number] | null => {
    if (id === ORIGIN_ID) return [0, 0];
    const point = sketch.sketch.entities.find((entity) => entity.id === id);
    return point?.type === 'point' ? [point.x, point.y] : null;
  };
  const [a, b] = [position(line.p1), position(line.p2)];
  if (!a || !b) throw new FeatureError('axis-missing');
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
 * The edges a fillet or chamfer means in the body it modifies. The faces made for an edge are named
 * after the faces it lies between, so they keep their names when other edges join or leave the feature.
 */
function resolveEdges(feature: EdgeFeature, naming: BodyNaming): ResolvedEdgeFeature {
  if (feature.edges.length === 0) throw new FeatureError('no-edges');
  const matches = resolveEdgeRefs(feature.edges, naming);
  const missing = matches.filter((match) => match === null).length;
  if (missing > 0) throw new FeatureError('edge-missing', `${missing}/${matches.length}`);
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
  return { ...feature, edgeIndices, edgeNames, ...(healed ? { healedEdges } : {}) };
}

/**
 * Gives a feature what it needs from earlier features: extrusions and revolutions get the closed
 * outlines and the plane of their sketch (a revolution also its axis), fillets and chamfers the edges
 * of `body` (the body they modify, null when there is none) that their references mean. Throws
 * FeatureError when the sketch is missing or has no usable outline, or when an edge is gone.
 */
export function resolveFeature(feature: SolidModelingFeature, before: readonly Feature[], body: (() => BodyNaming) | null): KernelFeature {
  if (isEdgeFeature(feature)) {
    if (!body) throw new FeatureError('no-body');
    return resolveEdges(feature, body());
  }
  if (feature.type !== 'extrude' && feature.type !== 'revolve') return feature;
  const sketch = before.find((candidate): candidate is SketchFeature => candidate.type === 'sketch' && candidate.id === feature.sketch);
  if (!sketch || sketch.suppressed) throw new FeatureError('sketch-missing');
  const profile = profileOf(sketch);
  const frame = frameOf(sketch.plane);
  if (feature.type === 'extrude') return { ...feature, profile, frame };
  return { ...feature, profile, frame, line: axisOf(sketch, feature.axis, profile) };
}
