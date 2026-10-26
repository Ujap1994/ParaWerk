import type { ReferenceFeature, Vec3 } from '../shared/model/feature.ts';
import { edgeRefOf, faceRefOf, resolveEdgeRefs, resolveFaceRef, resolveVertexRef, vertexPosition, vertexRefOf, type BodyNaming } from '../shared/model/naming.ts';
import { REFERENCE_ROLES, type GeometryRef, type ReferenceGeometry, type ReferenceRole } from '../shared/model/reference.ts';
import { frameOnPlane, STANDARD_FRAMES } from '../shared/model/sketch.ts';
import { FeatureError } from './feature-error.ts';
import type { EdgeGeometry, FaceGeometry } from './protocol.ts';

/** The body a reference feature is built on, queried lazily. */
export interface BodyQuery {
  naming(): BodyNaming;
  face(index: number): FaceGeometry;
  edge(index: number): EdgeGeometry;
}

export interface ReferenceContext {
  /** The body before the feature; null when there is none. */
  body: BodyQuery | null;
  /** Where the earlier reference features lie, by id. */
  references: ReadonlyMap<string, ReferenceGeometry>;
}

interface Plane {
  point: Vec3;
  normal: Vec3;
}

export interface Line {
  point: Vec3;
  direction: Vec3;
}

/** What a reference provides; which of it a feature uses depends on the role of its slot. */
interface Aspects {
  plane?: Plane;
  axis?: Line;
  point?: Vec3;
  center?: Vec3;
  /** The direction of an axis, or the normal of a plane. */
  direction?: Vec3;
}

/** The direction aspect follows from an axis or a plane. */
function withDirection(aspects: Aspects): Aspects {
  const direction = aspects.axis?.direction ?? aspects.plane?.normal;
  return direction ? { ...aspects, direction } : aspects;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / length(a));

/** Directions closer than this (sine of the angle) count as parallel. */
const PARALLEL = 1e-9;

/** Rotates `v` around the unit axis `k` by `angle` radians (Rodrigues). */
function rotate(v: Vec3, k: Vec3, angle: number): Vec3 {
  const [c, s] = [Math.cos(angle), Math.sin(angle)];
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
}

/** The line where two planes meet; null when they are parallel. */
function intersectPlanes(a: Plane, b: Plane): Line | null {
  const direction = cross(a.normal, b.normal);
  const sine = length(direction);
  if (sine < PARALLEL) return null;
  // The point on the line nearest to the origin: a combination of both normals.
  const [d1, d2] = [dot(a.normal, a.point), dot(b.normal, b.point)];
  const n12 = dot(a.normal, b.normal);
  const det = 1 - n12 * n12;
  const c1 = (d1 - d2 * n12) / det;
  const c2 = (d2 - d1 * n12) / det;
  return { point: add(scale(a.normal, c1), scale(b.normal, c2)), direction: scale(direction, 1 / sine) };
}

/** The finite numbers of a vector, or nothing. */
const finite = (v: Vec3 | undefined): Vec3 | undefined => (v && v.every(Number.isFinite) ? v : undefined);

function faceAspects(face: FaceGeometry): Aspects {
  const aspects: Aspects = {};
  if (face.plane) aspects.plane = { point: face.plane.point, normal: unit(face.plane.normal) };
  if (face.axis) aspects.axis = { point: face.axis.point, direction: unit(face.axis.direction) };
  const center = face.sphereCenter ?? finite(face.center);
  if (center) aspects.center = center;
  return aspects;
}

function edgeAspects(edge: EdgeGeometry): Aspects {
  const aspects: Aspects = {};
  if (edge.kind === 'line' && edge.axis) aspects.axis = { point: edge.start, direction: unit(edge.axis) };
  if ((edge.kind === 'circle' || edge.kind === 'ellipse') && edge.center && edge.axis) {
    aspects.axis = { point: edge.center, direction: unit(edge.axis) };
    aspects.center = edge.center;
  } else if (finite(edge.middle)) {
    aspects.center = edge.middle;
  }
  return aspects;
}

function referenceAspects(geometry: ReferenceGeometry): Aspects {
  switch (geometry.kind) {
    case 'plane':
      return { plane: { point: geometry.frame.origin, normal: geometry.frame.normal } };
    case 'axis':
      return { axis: { point: geometry.point, direction: geometry.direction } };
    case 'point':
      return { point: geometry.point, center: geometry.point };
  }
}

/** What reference `slot` provides, and the up-to-date reference when it was found only by position. */
function aspectsOf(ref: GeometryRef | undefined, slot: number, context: ReferenceContext): { aspects: Aspects; healed?: GeometryRef } {
  const missing = () => new FeatureError('reference-missing', String(slot + 1));
  if (!ref) throw missing();
  const { aspects, healed } = rawAspectsOf(ref, context, missing);
  return { aspects: withDirection(aspects), ...(healed ? { healed } : {}) };
}

function rawAspectsOf(ref: GeometryRef, context: ReferenceContext, missing: () => FeatureError): { aspects: Aspects; healed?: GeometryRef } {
  switch (ref.kind) {
    case 'standard-plane': {
      const frame = STANDARD_FRAMES[ref.plane];
      return { aspects: { plane: { point: frame.origin, normal: frame.normal } } };
    }
    case 'origin':
      return { aspects: { point: [0, 0, 0], center: [0, 0, 0] } };
    case 'feature': {
      const geometry = context.references.get(ref.feature);
      if (!geometry) throw missing();
      return { aspects: referenceAspects(geometry) };
    }
    default:
      break;
  }
  const body = context.body;
  if (!body) throw missing();
  const naming = body.naming();
  switch (ref.kind) {
    case 'face': {
      const match = resolveFaceRef(ref, naming, (face, point) => length(sub(body.face(face).center, point)));
      if (!match) throw missing();
      const healed = match.kind === 'position' ? (faceRefOf(naming, match.index, ref.at) ?? undefined) : undefined;
      return { aspects: faceAspects(body.face(match.index)), ...(healed ? { healed } : {}) };
    }
    case 'edge': {
      const match = resolveEdgeRefs([ref], naming)[0];
      if (!match) throw missing();
      const healed = match.kind === 'name' ? undefined : (edgeRefOf(naming, match.index) ?? undefined);
      return { aspects: edgeAspects(body.edge(match.index)), ...(healed ? { healed } : {}) };
    }
    case 'vertex': {
      const match = resolveVertexRef(ref, naming);
      if (!match) throw missing();
      const point = vertexPosition(naming, match.index);
      const healed = match.kind === 'position' ? (vertexRefOf(naming, match.index) ?? undefined) : undefined;
      return { aspects: { point, center: point }, ...(healed ? { healed } : {}) };
    }
  }
}

/**
 * The face of the body a face reference stands for when it is curved (topological index); null for
 * other references and planar faces (those provide a plane).
 */
export function curvedFaceOfReference(ref: GeometryRef | undefined, slot: number, context: ReferenceContext): number | null {
  if (ref?.kind !== 'face') return null;
  const body = context.body;
  if (!body) throw new FeatureError('reference-missing', String(slot + 1));
  const match = resolveFaceRef(ref, body.naming(), (face, point) => length(sub(body.face(face).center, point)));
  if (!match) throw new FeatureError('reference-missing', String(slot + 1));
  return body.face(match.index).plane ? null : match.index;
}

/** The axis a reference provides (a reference axis, a straight or circular edge, a cylindrical face). */
export function axisOfReference(ref: GeometryRef, context: ReferenceContext): Line {
  const axis = aspectsOf(ref, 0, context).aspects.axis;
  if (!axis) throw new FeatureError('reference-kind', '1');
  return axis;
}

/** The geometry a slot of the given role takes from what its reference provides. */
export type RoleValue = { plane: Plane; axis: Line; point: Vec3; center: Vec3; direction: Vec3 };

/** What reference `ref` (in slot `slot`, counted from 0) provides for a role; throws FeatureError when it is missing or does not fit. */
export function referenceValue<R extends ReferenceRole>(ref: GeometryRef | undefined, role: R, slot: number, context: ReferenceContext): RoleValue[R] {
  const value = aspectsOf(ref, slot, context).aspects[role];
  if (!value) throw new FeatureError('reference-kind', String(slot + 1));
  return value as RoleValue[R];
}

export interface ComputedReference {
  geometry: ReferenceGeometry;
  /** All references, with the ones found only by position brought up to date (only when there are any). */
  healed?: GeometryRef[];
}

/**
 * Where a reference plane, axis or point lies, from its references in the body before it and from
 * earlier reference features. Throws FeatureError when a reference is missing, of the wrong kind
 * (`reference-kind`, detail: the slot number) or the references do not define the geometry.
 */
export function computeReference(feature: ReferenceFeature, context: ReferenceContext): ComputedReference {
  const roles: readonly ReferenceRole[] = (REFERENCE_ROLES[feature.type] as Record<string, readonly ReferenceRole[]>)[feature.method] ?? [];
  let healedAny = false;
  const values = roles.map((role, slot) => {
    const { aspects, healed } = aspectsOf(feature.references[slot], slot, context);
    if (healed) healedAny = true;
    const value = aspects[role];
    if (!value) throw new FeatureError('reference-kind', String(slot + 1));
    return { value, healed };
  });
  const get = <R extends ReferenceRole>(slot: number, _role: R) => values[slot]?.value as RoleValue[R];
  const healed = healedAny ? feature.references.map((ref, slot) => values[slot]?.healed ?? ref) : undefined;
  const result = (geometry: ReferenceGeometry): ComputedReference => ({ geometry, ...(healed ? { healed } : {}) });
  const planeAt = (point: Vec3, normal: Vec3) => result({ kind: 'plane', frame: frameOnPlane(point, feature.type === 'plane' && feature.flip ? scale(normal, -1) : normal) });

  switch (feature.type) {
    case 'plane':
      switch (feature.method) {
        case 'offset': {
          const plane = get(0, 'plane');
          const distance = feature.flip ? -feature.distance : feature.distance;
          // The offset plane faces the same way as its reference; flipping moves it to the other side.
          return result({ kind: 'plane', frame: frameOnPlane(add(plane.point, scale(plane.normal, distance)), plane.normal) });
        }
        case 'angle': {
          const [plane, axis] = [get(0, 'plane'), get(1, 'axis')];
          if (Math.abs(dot(plane.normal, axis.direction)) > 1e-6) throw new FeatureError('reference-not-parallel');
          const angle = ((feature.flip ? -1 : 1) * feature.angle * Math.PI) / 180;
          return result({ kind: 'plane', frame: frameOnPlane(axis.point, rotate(plane.normal, axis.direction, angle)) });
        }
        case 'threePoints': {
          const [a, b, c] = [get(0, 'point'), get(1, 'point'), get(2, 'point')];
          const normal = cross(sub(b, a), sub(c, a));
          const size = Math.max(length(sub(b, a)), length(sub(c, a)), 1e-12);
          if (length(normal) < 1e-9 * size * size) throw new FeatureError('reference-collinear');
          return planeAt(a, unit(normal));
        }
        case 'midPlane': {
          const [first, second] = [get(0, 'plane'), get(1, 'plane')];
          const line = intersectPlanes(first, second);
          if (!line) {
            const gap = dot(sub(second.point, first.point), first.normal);
            return planeAt(add(first.point, scale(first.normal, gap / 2)), first.normal);
          }
          // Between two faces at an angle: the plane that halves the angle inside the material.
          const difference = sub(first.normal, second.normal);
          return planeAt(line.point, length(difference) < PARALLEL ? first.normal : unit(difference));
        }
        case 'throughPoint': {
          const [plane, point] = [get(0, 'plane'), get(1, 'point')];
          return planeAt(point, plane.normal);
        }
      }
      break;
    case 'axis':
      switch (feature.method) {
        case 'reference': {
          const axis = get(0, 'axis');
          return result({ kind: 'axis', point: axis.point, direction: axis.direction });
        }
        case 'twoPlanes': {
          const line = intersectPlanes(get(0, 'plane'), get(1, 'plane'));
          if (!line) throw new FeatureError('reference-parallel');
          return result({ kind: 'axis', point: line.point, direction: line.direction });
        }
        case 'twoPoints': {
          const [a, b] = [get(0, 'point'), get(1, 'point')];
          const direction = sub(b, a);
          if (length(direction) < 1e-9) throw new FeatureError('reference-collinear');
          return result({ kind: 'axis', point: a, direction: unit(direction) });
        }
        case 'normal': {
          const [plane, point] = [get(0, 'plane'), get(1, 'point')];
          return result({ kind: 'axis', point, direction: plane.normal });
        }
      }
      break;
    case 'point':
      switch (feature.method) {
        case 'coordinates':
          return result({ kind: 'point', point: [feature.x, feature.y, feature.z] });
        case 'center':
          return result({ kind: 'point', point: get(0, 'center') });
        case 'intersection': {
          const [axis, plane] = [get(0, 'axis'), get(1, 'plane')];
          const along = dot(axis.direction, plane.normal);
          if (Math.abs(along) < PARALLEL) throw new FeatureError('reference-parallel');
          const t = dot(sub(plane.point, axis.point), plane.normal) / along;
          return result({ kind: 'point', point: add(axis.point, scale(axis.direction, t)) });
        }
      }
      break;
  }
  throw new FeatureError('operation-failed', 'unknown reference method');
}
