/**
 * Document model of a part: an ordered list of features.
 *
 * All lengths are millimeters. The coordinate system is right-handed with Z up
 * (see docs/adr/0004-coordinate-system-and-units.md).
 */

import type { AxisMethod, GeometryRef, PlaneMethod, PointMethod } from './reference.ts';
import type { SketchData, SketchPlaneRef } from './sketch.ts';

export type Vec3 = [number, number, number];

export type FeatureType = 'variables' | 'sketch' | 'plane' | 'axis' | 'point' | 'extrude' | 'revolve' | 'hole' | 'box' | 'cylinder' | 'fillet' | 'chamfer';

/** How a solid-creating feature combines with the existing body. */
export type BooleanOperation = 'add' | 'cut';

export type Axis = 'x' | 'y' | 'z';

/**
 * Reference to an edge by its topological index in the input body. Files of ParaWerk 0.2 and earlier
 * use it; it breaks when earlier features change the topology, so it is converted to an EdgeNameRef
 * as soon as the body is known (docs/adr/0002-persistent-naming.md).
 */
export interface EdgeIndexRef {
  kind: 'edge-index';
  index: number;
}

/**
 * Reference to an edge by the persistent names of the two faces it lies between (the same name twice
 * for a seam), e.g. the edge between the top face of a box and the side face that sketch line l3
 * swept. Names survive changes of earlier features; `at` decides between edges with the same faces
 * and finds an edge again whose faces were renamed (docs/adr/0002-persistent-naming.md).
 */
export interface EdgeNameRef {
  kind: 'edge';
  /** Sorted. */
  faces: [string, string];
  /** The middle of the edge when it was chosen. */
  at: Vec3;
}

export type EdgeRef = EdgeIndexRef | EdgeNameRef;

interface FeatureBase {
  id: string;
  /** User-defined name; when absent the UI shows a localized default name. */
  name?: string;
  suppressed?: boolean;
  /**
   * Parameters given as expressions over the part's variables (field name → text, e.g.
   * `{ width: "length * 2" }`); the numeric field holds the current value.
   */
  expressions?: Record<string, string>;
}

/** Numeric parameters that can be given as expressions, per feature type. */
export const EXPRESSION_FIELDS: Readonly<Record<FeatureType, readonly string[]>> = {
  variables: [],
  sketch: [],
  plane: ['distance', 'angle'],
  axis: [],
  point: ['x', 'y', 'z'],
  extrude: ['depth'],
  revolve: ['angle'],
  hole: ['diameter', 'depth', 'counterboreDiameter', 'counterboreDepth', 'countersinkDiameter', 'countersinkAngle', 'threadDepth'],
  box: ['width', 'depth', 'height'],
  cylinder: ['radius', 'height'],
  fillet: ['radius'],
  chamfer: ['distance'],
};

/** A named value of the part; its expression may use other variables. */
export interface Variable {
  name: string;
  expression: string;
}

/** The part's global variables (at most one per part, at the top of the feature list). */
export interface VariablesFeature extends FeatureBase {
  type: 'variables';
  variables: Variable[];
}

export interface BoxFeature extends FeatureBase {
  type: 'box';
  operation: BooleanOperation;
  width: number;
  depth: number;
  height: number;
  /** Center of the bottom face. */
  position: Vec3;
}

export interface CylinderFeature extends FeatureBase {
  type: 'cylinder';
  operation: BooleanOperation;
  radius: number;
  height: number;
  axis: Axis;
  /** Center of the base circle. */
  position: Vec3;
}

export interface FilletFeature extends FeatureBase {
  type: 'fillet';
  radius: number;
  edges: EdgeRef[];
}

export interface ChamferFeature extends FeatureBase {
  type: 'chamfer';
  distance: number;
  edges: EdgeRef[];
}

/** A 2D sketch on a plane; it does not change the body by itself (extrudes use it later). */
export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: SketchPlaneRef;
  sketch: SketchData;
}

/** A reference plane (see src/shared/model/reference.ts); it does not change the body. */
export interface PlaneFeature extends FeatureBase {
  type: 'plane';
  method: PlaneMethod;
  references: GeometryRef[];
  /** Offset: the distance from the reference plane, in mm. */
  distance: number;
  /** At an angle: degrees from the reference plane, around the axis. */
  angle: number;
  /** Offset to the other side; the angle the other way round; for the other methods the normal reversed. */
  flip: boolean;
}

/** A reference axis. */
export interface AxisFeature extends FeatureBase {
  type: 'axis';
  method: AxisMethod;
  references: GeometryRef[];
}

/** A reference point; `x`, `y` and `z` are its coordinates for the coordinates method. */
export interface PointFeature extends FeatureBase {
  type: 'point';
  method: PointMethod;
  references: GeometryRef[];
  x: number;
  y: number;
  z: number;
}

export type ReferenceFeature = PlaneFeature | AxisFeature | PointFeature;

export function isReferenceFeature(feature: Feature): feature is ReferenceFeature {
  return feature.type === 'plane' || feature.type === 'axis' || feature.type === 'point';
}

/** Which way an extrusion goes from its sketch plane: along the plane normal, against it, or half each way. */
export type ExtrudeDirection = 'normal' | 'reverse' | 'both';

export const EXTRUDE_DIRECTIONS: readonly ExtrudeDirection[] = ['normal', 'reverse', 'both'];

/** How far an extrusion goes: a given depth, or through the whole body in its direction. */
export type ExtrudeEnd = 'blind' | 'throughAll';

export const EXTRUDE_ENDS: readonly ExtrudeEnd[] = ['blind', 'throughAll'];

/** Extrudes the closed outlines of a sketch (adding material) or cuts them out of the body. */
export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  operation: BooleanOperation;
  /** Id of the sketch feature (before this one) whose outlines are extruded. */
  sketch: string;
  /** Used when `end` is blind. */
  depth: number;
  direction: ExtrudeDirection;
  end: ExtrudeEnd;
}

/**
 * Where an extrusion starts and ends along the sketch plane normal. Through all needs `extent`, how far
 * the body reaches along the normal (from the sketch plane); the extrusion then passes it with a margin.
 */
export function extrudeRange(feature: Pick<ExtrudeFeature, 'depth' | 'direction' | 'end'>, extent?: readonly [number, number]): [number, number] {
  if (feature.end === 'throughAll' && extent) {
    const margin = 1 + 0.01 * (extent[1] - extent[0]);
    const [below, above] = [Math.min(extent[0], 0) - margin, Math.max(extent[1], 0) + margin];
    return feature.direction === 'normal' ? [0, above] : feature.direction === 'reverse' ? [below, 0] : [below, above];
  }
  switch (feature.direction) {
    case 'normal':
      return [0, feature.depth];
    case 'reverse':
      return [-feature.depth, 0];
    case 'both':
      return [-feature.depth / 2, feature.depth / 2];
  }
}

/** Revolves the closed outlines of a sketch around a line of the same sketch (adding material) or cuts them out. */
export interface RevolveFeature extends FeatureBase {
  type: 'revolve';
  operation: BooleanOperation;
  /** Id of the sketch feature (before this one) whose outlines are revolved. */
  sketch: string;
  /** Id of the line (often a centerline) of that sketch that is the axis (unused when `axisRef` is set). */
  axis: string;
  /** An axis outside the sketch, such as a reference axis; it must lie in the sketch plane. */
  axisRef?: GeometryRef;
  /** Degrees, up to 360. */
  angle: number;
  /** One way around the axis, the other way, or half the angle each way. */
  direction: ExtrudeDirection;
}

/** Where a revolution starts and ends around its axis, in radians. */
export function revolveRange(feature: Pick<RevolveFeature, 'angle' | 'direction'>): [number, number] {
  const angle = (feature.angle * Math.PI) / 180;
  switch (feature.direction) {
    case 'normal':
      return [0, angle];
    case 'reverse':
      return [-angle, 0];
    case 'both':
      return [-angle / 2, angle / 2];
  }
}

export type HoleKind = 'simple' | 'counterbore' | 'countersink' | 'tapped';

/** Clearance hole series of ISO 273: fine, medium, coarse. */
export type HoleFit = 'close' | 'normal' | 'loose';

/**
 * Holes for ISO metric screws at the free points of a sketch (see src/shared/model/hole.ts): drilled
 * into the material from the sketch plane, against its normal (or along it when `reverse`). The
 * dimensions come from the standard tables when the kind, size or fit changes, and can be changed.
 */
export interface HoleFeature extends FeatureBase {
  type: 'hole';
  kind: HoleKind;
  /** ISO metric size, e.g. "M6". */
  size: string;
  fit: HoleFit;
  /** Id of the sketch whose free points are the hole centers. */
  sketch: string;
  end: ExtrudeEnd;
  reverse: boolean;
  /** Clearance hole, or the tap drill of a tapped hole. */
  diameter: number;
  /** Blind holes: depth of the full diameter (the drill point comes on top). */
  depth: number;
  counterboreDiameter: number;
  counterboreDepth: number;
  countersinkDiameter: number;
  /** Degrees. */
  countersinkAngle: number;
  /** Tapped holes: how deep the thread goes (through holes: all the way). */
  threadDepth: number;
}

/** Features built from a sketch: its outlines (extrude, revolve) or its points (hole). */
export type SketchBasedFeature = ExtrudeFeature | RevolveFeature | HoleFeature;

export function isSketchBased(feature: Feature): feature is SketchBasedFeature {
  return feature.type === 'extrude' || feature.type === 'revolve' || feature.type === 'hole';
}

export type Feature =
  | VariablesFeature
  | SketchFeature
  | PlaneFeature
  | AxisFeature
  | PointFeature
  | ExtrudeFeature
  | RevolveFeature
  | HoleFeature
  | BoxFeature
  | CylinderFeature
  | FilletFeature
  | ChamferFeature;

/** Features that build or modify the solid body (everything except variables, sketches and reference geometry). */
export type SolidModelingFeature = Exclude<Feature, SketchFeature | VariablesFeature | ReferenceFeature>;

export type EdgeFeature = FilletFeature | ChamferFeature;

export function isEdgeFeature(feature: Feature): feature is EdgeFeature {
  return feature.type === 'fillet' || feature.type === 'chamfer';
}

export function isSolidFeature(feature: Feature): feature is BoxFeature | CylinderFeature {
  return feature.type === 'box' || feature.type === 'cylinder';
}

export const FEATURE_TYPES: readonly FeatureType[] = ['variables', 'sketch', 'plane', 'axis', 'point', 'extrude', 'revolve', 'hole', 'box', 'cylinder', 'fillet', 'chamfer'];

let idCounter = 0;

/** Creates a document-unique feature id. */
export function createFeatureId(): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `f${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

export function defaultFeature(type: FeatureType, id: string = createFeatureId()): Feature {
  switch (type) {
    case 'variables':
      return { id, type, variables: [] };
    case 'sketch':
      return { id, type, plane: { kind: 'standard', plane: 'top' }, sketch: { entities: [], constraints: [] } };
    case 'plane':
      return { id, type, method: 'offset', references: [], distance: 10, angle: 45, flip: false };
    case 'axis':
      return { id, type, method: 'reference', references: [] };
    case 'point':
      return { id, type, method: 'coordinates', references: [], x: 0, y: 0, z: 0 };
    case 'extrude':
      return { id, type, operation: 'add', sketch: '', depth: 20, direction: 'normal', end: 'blind' };
    case 'revolve':
      return { id, type, operation: 'add', sketch: '', axis: '', angle: 360, direction: 'normal' };
    case 'hole':
      return {
        id,
        type,
        kind: 'simple',
        size: 'M6',
        fit: 'normal',
        sketch: '',
        end: 'throughAll',
        reverse: false,
        diameter: 6.6,
        depth: 12,
        counterboreDiameter: 11,
        counterboreDepth: 6.4,
        countersinkDiameter: 13.7,
        countersinkAngle: 90,
        threadDepth: 12,
      };
    case 'box':
      return { id, type, operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
    case 'cylinder':
      return { id, type, operation: 'add', radius: 20, height: 50, axis: 'z', position: [0, 0, 0] };
    case 'fillet':
      return { id, type, radius: 5, edges: [] };
    case 'chamfer':
      return { id, type, distance: 3, edges: [] };
  }
}
