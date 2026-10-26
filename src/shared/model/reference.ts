/**
 * Reference geometry: planes, axes, points and coordinate systems that other features are built on (sketches on a plane at
 * an angle, an axis to revolve around, ...). They do not change the body. Their references to faces,
 * edges and vertices of the body use persistent names (docs/adr/0002-persistent-naming.md), so they
 * follow the body when earlier features change.
 */

import type { EdgeNameRef, Vec3 } from './feature.ts';
import type { SketchFrame, StandardPlane } from './sketch.ts';

/** A face of the body by its persistent name; `at` is where it was picked (decides between pieces of a split face). */
export interface FaceNameRef {
  kind: 'face';
  name: string;
  at: Vec3;
}

/** A vertex of the body by the names of the faces that meet there (sorted) and where it was. */
export interface VertexNameRef {
  kind: 'vertex';
  faces: string[];
  at: Vec3;
}

/** What reference geometry is built on. */
export type GeometryRef =
  | { kind: 'standard-plane'; plane: StandardPlane }
  | { kind: 'origin' }
  /** A reference plane, axis or point (by feature id). */
  | { kind: 'feature'; feature: string }
  | FaceNameRef
  | EdgeNameRef
  | VertexNameRef;

/**
 * What a reference has to provide: a plane (a standard plane, a planar face, a reference plane), an axis
 * (a straight or circular edge, a cylindrical or conical face, a reference axis), a point (a vertex, the
 * origin, a reference point), something with a center (an edge or a face), or a direction (an axis, or
 * the normal of a plane).
 */
export type ReferenceRole = 'plane' | 'axis' | 'point' | 'center' | 'direction';

export type PlaneMethod = 'offset' | 'angle' | 'threePoints' | 'midPlane' | 'throughPoint';
export type AxisMethod = 'reference' | 'twoPlanes' | 'twoPoints' | 'normal';
export type PointMethod = 'coordinates' | 'center' | 'intersection';
export type CsysMethod = 'position' | 'references';

export const PLANE_METHODS: readonly PlaneMethod[] = ['offset', 'angle', 'threePoints', 'midPlane', 'throughPoint'];
export const AXIS_METHODS: readonly AxisMethod[] = ['reference', 'twoPlanes', 'twoPoints', 'normal'];
export const POINT_METHODS: readonly PointMethod[] = ['coordinates', 'center', 'intersection'];
export const CSYS_METHODS: readonly CsysMethod[] = ['position', 'references'];

/** The references each method takes, in order. */
export const REFERENCE_ROLES = {
  plane: { offset: ['plane'], angle: ['plane', 'axis'], threePoints: ['point', 'point', 'point'], midPlane: ['plane', 'plane'], throughPoint: ['plane', 'point'] },
  axis: { reference: ['axis'], twoPlanes: ['plane', 'plane'], twoPoints: ['point', 'point'], normal: ['plane', 'point'] },
  point: { coordinates: [], center: ['center'], intersection: ['axis', 'plane'] },
  csys: { position: [], references: ['point', 'direction', 'direction'] },
  pattern: { linear: ['direction'], circular: ['axis'] },
  mirror: { plane: ['plane'] },
  draft: { neutralPlane: ['plane'] },
} as const satisfies {
  plane: Record<PlaneMethod, readonly ReferenceRole[]>;
  axis: Record<AxisMethod, readonly ReferenceRole[]>;
  point: Record<PointMethod, readonly ReferenceRole[]>;
  csys: Record<CsysMethod, readonly ReferenceRole[]>;
  pattern: Record<'linear' | 'circular', readonly ReferenceRole[]>;
  mirror: Record<'plane', readonly ReferenceRole[]>;
  draft: Record<'neutralPlane', readonly ReferenceRole[]>;
};

/** Where a reference feature lies, as the last rebuild computed it. */
export type ReferenceGeometry =
  /** The frame follows the same rules as a sketch on a face (frameOnPlane), so sketches on it get it. */
  | { kind: 'plane'; frame: SketchFrame }
  | { kind: 'axis'; point: Vec3; direction: Vec3 }
  | { kind: 'point'; point: Vec3 }
  /** Unit axes, perpendicular to each other and right-handed. */
  | { kind: 'csys'; origin: Vec3; xDir: Vec3; yDir: Vec3; zDir: Vec3 }
  /** A projected or composite curve: points along its edges for drawing, its length, and whether it is one chain that closes. */
  | { kind: 'curve'; polylines: Vec3[][]; length: number; chains: number; closed: boolean }
  /**
   * A helix around `axis` (unit) through `center`, of `radius`, starting at center + radius · xDir and
   * rising `pitch` per turn along the axis; turning left-handed with `leftHand`.
   */
  | { kind: 'helix'; center: Vec3; axis: Vec3; xDir: Vec3; radius: number; pitch: number; turns: number; leftHand: boolean };
