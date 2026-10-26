/**
 * Document model of a part: an ordered list of features.
 *
 * All lengths are millimeters. The coordinate system is right-handed with Z up
 * (see docs/adr/0004-coordinate-system-and-units.md).
 */

import type { AxisMethod, CsysMethod, FaceNameRef, GeometryRef, PlaneMethod, PointMethod } from './reference.ts';
import type { SketchData, SketchPlaneRef } from './sketch.ts';
import type { ThinSide } from './thin.ts';

export type Vec3 = [number, number, number];

export type FeatureType = 'variables' | 'sketch' | 'plane' | 'axis' | 'point' | 'csys' | 'extrude' | 'revolve' | 'hole' | 'pattern' | 'mirror' | 'box' | 'cylinder' | 'import' | 'fillet' | 'chamfer' | 'shell' | 'draft' | 'sweep' | 'loft' | 'rib' | 'thread' | 'helix' | 'projectedCurve' | 'compositeCurve' | 'combine' | 'deleteBody' | 'offsetSurface' | 'knit' | 'thicken';

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
  csys: ['x', 'y', 'z', 'angle'],
  extrude: ['depth', 'depth2', 'draft', 'endOffset', 'thickness'],
  revolve: ['angle', 'thickness'],
  hole: ['diameter', 'depth', 'counterboreDiameter', 'counterboreDepth', 'countersinkDiameter', 'countersinkAngle', 'threadDepth'],
  pattern: ['spacing', 'angle', 'count'],
  mirror: [],
  box: ['width', 'depth', 'height'],
  cylinder: ['radius', 'height'],
  import: [],
  fillet: ['radius', 'radius2'],
  chamfer: ['distance', 'distance2', 'angle'],
  shell: ['thickness'],
  draft: ['angle'],
  sweep: ['twist'],
  loft: [],
  rib: ['thickness'],
  thread: ['pitch', 'length'],
  helix: ['pitch', 'turns', 'startAngle'],
  projectedCurve: [],
  compositeCurve: [],
  combine: [],
  deleteBody: [],
  offsetSurface: ['distance'],
  knit: [],
  thicken: ['thickness'],
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
  /** Added material stays a body of its own instead of being fused with the bodies it touches (docs/adr/0011-multi-body-parts.md). */
  merge?: boolean;
  width: number;
  depth: number;
  height: number;
  /** Center of the bottom face. */
  position: Vec3;
}

export interface CylinderFeature extends FeatureBase {
  type: 'cylinder';
  operation: BooleanOperation;
  /** Added material stays a body of its own instead of being fused with the bodies it touches (docs/adr/0011-multi-body-parts.md). */
  merge?: boolean;
  radius: number;
  height: number;
  axis: Axis;
  /** Center of the base circle. */
  position: Vec3;
}

/**
 * The solids of a STEP file as a body of their own (operation add) or cut out of the body. The file is
 * kept in the part (in part files as its own entry, imports/<id>.step), so the part does not depend on
 * it any more.
 */
export interface ImportFeature extends FeatureBase {
  type: 'import';
  operation: BooleanOperation;
  /** Added material stays a body of its own instead of being fused with the bodies it touches (docs/adr/0011-multi-body-parts.md). */
  merge?: boolean;
  /** The name of the imported file. */
  file: string;
  /** Content hash of `data`: rebuilds compare it instead of the whole file. */
  hash: string;
  /** The STEP file (ISO 10303-21 text). */
  data: string;
}

/**
 * How a fillet rounds: edges with a constant radius or one changing evenly along them, a round of the
 * radius between two planar faces (also where they share no edge), or a full round between two side faces.
 */
export type FilletMethod = 'constant' | 'variable' | 'faces' | 'fullRound';

export const FILLET_METHODS: readonly FilletMethod[] = ['constant', 'variable', 'faces', 'fullRound'];

/** How many faces a fillet of a method picks in order (face fillet: two, full round: three). */
export function roundFaceCount(method: FilletMethod | undefined): number {
  return method === 'faces' ? 2 : method === 'fullRound' ? 3 : 0;
}

export interface FilletFeature extends FeatureBase {
  type: 'fillet';
  radius: number;
  edges: EdgeRef[];
  /** Faces whose edges are all rounded too, also edges they get later (a hole cut into the face). */
  faces?: FaceNameRef[];
  /** Absent: constant. */
  method?: FilletMethod;
  /** Variable radius: the radius at the end of each edge (`radius` is the one at its start). */
  radius2?: number;
  /** Variable radius: the start is the end of an edge with the larger coordinates instead of the smaller ones. */
  swap?: boolean;
  /**
   * Face fillet: the two faces; full round: side face 1, the center face and side face 2 (as far as
   * picked). The center face of a full round is replaced by half a cylinder tangent to all three; the
   * sides must be parallel planes.
   */
  round?: FaceNameRef[];
}

/** How a chamfer is sized: the same distance on both faces, two distances, or a distance and an angle. */
export type ChamferMethod = 'equal' | 'distances' | 'angle';

export const CHAMFER_METHODS: readonly ChamferMethod[] = ['equal', 'distances', 'angle'];

export interface ChamferFeature extends FeatureBase {
  type: 'chamfer';
  /** Along both faces (equal), or along the first face of each edge (the other one with `flip`). */
  distance: number;
  edges: EdgeRef[];
  /** Absent: equal. */
  method?: ChamferMethod;
  /** Two distances: along the other face. */
  distance2?: number;
  /** Distance and angle: degrees from the first face (45°: as far on both faces). */
  angle?: number;
  /** Measures `distance` on the other face of each edge. */
  flip?: boolean;
  /** Faces whose edges are all beveled too, also edges they get later. */
  faces?: FaceNameRef[];
}

/**
 * Tilts faces of the body by `angle` (degrees) for molding and casting: they turn about the line where
 * they cross the neutral plane, so the part gets narrower along the pull direction (the plane's normal,
 * or against it with `flip`).
 */
export interface DraftFeature extends FeatureBase {
  type: 'draft';
  method: 'neutralPlane';
  /** The neutral plane. */
  references: GeometryRef[];
  faces: FaceNameRef[];
  angle: number;
  flip: boolean;
}

/**
 * Hollows the body out to walls of `thickness`, inside it or (`outward`) around it. The faces in `faces`
 * are removed, so the shell is open there; without any, the body gets a closed cavity.
 */
export interface ShellFeature extends FeatureBase {
  type: 'shell';
  thickness: number;
  faces: FaceNameRef[];
  outward: boolean;
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

/**
 * A coordinate system: an origin and three perpendicular axes, at a position turned around Z by `angle`
 * (degrees), or at a point with its X axis along a direction and its Y axis towards a second one.
 * Mass properties can be given and exports written relative to it.
 */
export interface CsysFeature extends FeatureBase {
  type: 'csys';
  method: CsysMethod;
  references: GeometryRef[];
  x: number;
  y: number;
  z: number;
  angle: number;
  /** The X axis, or the Y axis, the other way round (Z follows from both). */
  flipX: boolean;
  flipY: boolean;
}

export type ReferenceFeature = PlaneFeature | AxisFeature | PointFeature | CsysFeature;

export function isReferenceFeature(feature: Feature): feature is ReferenceFeature {
  return feature.type === 'plane' || feature.type === 'axis' || feature.type === 'point' || feature.type === 'csys';
}

/** Features shown as reference geometry, which do not change the body: reference geometry and curves. */
export function hasReferenceGeometry(feature: Feature): feature is ReferenceFeature | HelixFeature | CurveFeature | SurfaceFeature {
  return isReferenceFeature(feature) || feature.type === 'helix' || isCurveFeature(feature) || isSurfaceFeature(feature);
}

/** Which way an extrusion goes from its sketch plane: along the plane normal, against it, or half each way. */
/**
 * Which way an extrusion goes from its sketch plane: along the plane normal, against it, half each way
 * (mid-plane), or `depth` along it and `depth2` against it (two directions).
 */
export type ExtrudeDirection = 'normal' | 'reverse' | 'both' | 'two';

export const EXTRUDE_DIRECTIONS: readonly ExtrudeDirection[] = ['normal', 'reverse', 'both', 'two'];

/** Which way a revolution turns: one way, the other way, or half the angle each way. */
export type RevolveDirection = 'normal' | 'reverse' | 'both';

export const REVOLVE_DIRECTIONS: readonly RevolveDirection[] = ['normal', 'reverse', 'both'];

/** Steepest draft angle while extruding, in degrees. */
export const MAX_DRAFT_ANGLE = 60;

/** How deep a hole goes: a given depth, or through the whole body. */
export type HoleEnd = 'blind' | 'throughAll';

export const HOLE_ENDS: readonly HoleEnd[] = ['blind', 'throughAll'];

/**
 * How far an extrusion goes: a given depth, through the whole body in its direction, up to the next
 * face of the body (adding: until it meets the body; cutting: through the first material), up to a
 * surface (a face, planar or curved, or a reference or standard plane; at an angle too) or up to a
 * point (a vertex).
 */
export type ExtrudeEnd = HoleEnd | 'upToNext' | 'upToSurface' | 'upToVertex';

export const EXTRUDE_ENDS: readonly ExtrudeEnd[] = ['blind', 'throughAll', 'upToNext', 'upToSurface', 'upToVertex'];

/** End conditions that go one way from the sketch plane (along its normal or, reversed, against it). */
export function extrudesOneWay(end: ExtrudeEnd): boolean {
  return end === 'upToNext' || end === 'upToSurface' || end === 'upToVertex';
}

/** Extrudes the closed outlines of a sketch (adding material) or cuts them out of the body. */
export interface ExtrudeFeature extends FeatureBase {
  type: 'extrude';
  operation: BooleanOperation;
  /** Added material stays a body of its own instead of being fused with the bodies it touches (docs/adr/0011-multi-body-parts.md). */
  merge?: boolean;
  /** Id of the sketch feature (before this one) whose outlines are extruded. */
  sketch: string;
  /** Used when `end` is blind. */
  depth: number;
  direction: ExtrudeDirection;
  /** Two directions: the depth against the normal. */
  depth2?: number;
  /** Draft angle of the side faces in degrees (absent or 0: straight); they taper towards the far end. */
  draft?: number;
  /** The side faces widen towards the far end instead. */
  draftOutward?: boolean;
  end: ExtrudeEnd;
  /** Up to surface: the plane or face; up to vertex: the point. */
  endRef?: GeometryRef;
  /** Up to surface: how far before the surface the extrusion stops (after it, with `endBeyond`). */
  endOffset?: number;
  endBeyond?: boolean;
  /** Thin feature: walls of `thickness` along the sketch curves (open ones too) instead of the areas they enclose. */
  thin?: ThinSide;
  thickness?: number;
}

/**
 * Where an extrusion starts and ends along the sketch plane normal. Through all needs `extent`, how far
 * the body reaches along the normal (from the sketch plane); the extrusion then passes it with a margin.
 */
export function extrudeRange(feature: Pick<ExtrudeFeature, 'depth' | 'depth2' | 'direction' | 'end'>, extent?: readonly [number, number]): [number, number] {
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
    case 'two':
      return [-(feature.depth2 ?? feature.depth), feature.depth];
  }
}

/** Revolves the closed outlines of a sketch around a line of the same sketch (adding material) or cuts them out. */
export interface RevolveFeature extends FeatureBase {
  type: 'revolve';
  operation: BooleanOperation;
  /** Added material stays a body of its own instead of being fused with the bodies it touches (docs/adr/0011-multi-body-parts.md). */
  merge?: boolean;
  /** Id of the sketch feature (before this one) whose outlines are revolved. */
  sketch: string;
  /** Id of the line (often a centerline) of that sketch that is the axis (unused when `axisRef` is set). */
  axis: string;
  /** An axis outside the sketch, such as a reference axis; it must lie in the sketch plane. */
  axisRef?: GeometryRef;
  /** Degrees, up to 360. */
  angle: number;
  /** One way around the axis, the other way, or half the angle each way. */
  direction: RevolveDirection;
  /** Thin feature: walls of `thickness` along the sketch curves (open ones too) instead of the areas they enclose. */
  thin?: ThinSide;
  thickness?: number;
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
  end: HoleEnd;
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

export type PatternMethod = 'linear' | 'circular';

/** Copies of earlier features in a row or around an axis (see src/shared/model/pattern.ts). */
export interface PatternFeature extends FeatureBase {
  type: 'pattern';
  method: PatternMethod;
  /** Linear: the direction (an edge, an axis or the normal of a plane); circular: the axis. */
  references: GeometryRef[];
  /** Ids of the features before the pattern that it copies. */
  features: string[];
  /** How many there are in the end, the originals included. */
  count: number;
  /** Linear: the distance between neighbors, in mm. */
  spacing: number;
  /** Circular: degrees the copies spread over (360: evenly all round). */
  angle: number;
  /** The other way along the direction, or round the axis. */
  flip: boolean;
}

/** Mirror images of earlier features through a plane. */
export interface MirrorFeature extends FeatureBase {
  type: 'mirror';
  method: 'plane';
  references: GeometryRef[];
  features: string[];
}

/** Features that copy other features. */
export type CopyFeature = PatternFeature | MirrorFeature;

export function isCopyFeature(feature: Feature): feature is CopyFeature {
  return feature.type === 'pattern' || feature.type === 'mirror';
}

/** Features whose references are chosen in fields of the side panel (reference geometry, patterns, mirror, draft). */
export type SlotFeature = ReferenceFeature | CopyFeature | DraftFeature;

export function hasReferenceSlots(feature: Feature): feature is SlotFeature {
  return isReferenceFeature(feature) || isCopyFeature(feature) || feature.type === 'draft';
}

/** The feature types a pattern or mirror can copy: those that add or cut material with a tool of their own. */
/** Features a pattern or mirror can copy; patterns and mirror images copy what they copy, and its copies. */
export const COPYABLE_TYPES: ReadonlySet<FeatureType> = new Set(['extrude', 'revolve', 'hole', 'box', 'cylinder', 'sweep', 'loft', 'pattern', 'mirror']);

/** Features built from a sketch: its outlines (extrude, revolve) or its points (hole). */
export type SketchBasedFeature = ExtrudeFeature | RevolveFeature | HoleFeature;

export function isSketchBased(feature: Feature): feature is SketchBasedFeature {
  return feature.type === 'extrude' || feature.type === 'revolve' || feature.type === 'hole';
}

/**
 * Sweeps the closed outlines of a sketch along a path, the curves of another sketch (lines, arcs, ellipses
 * and splines in one chain, open or closed), a helix or a curve. The outlines are swept as they lie,
 * usually across the start of the path; the path runs from its end nearer to them. Along a sketch path or
 * a curve, the outlines can turn about the path by `twist` degrees from start to end, or follow a `guide`
 * curve (a sketch or curve id) they keep touching, growing and shrinking with its distance from the path.
 */
export interface SweepFeature extends FeatureBase {
  type: 'sweep';
  operation: BooleanOperation;
  /** Added material stays a body of its own instead of being fused with the bodies it touches (docs/adr/0011-multi-body-parts.md). */
  merge?: boolean;
  sketch: string;
  path: string;
  twist?: number;
  guide?: string;
}

/** The most a sweep can twist, in degrees (100 turns). */
export const MAX_TWIST = 36_000;

/** A solid through the closed outlines of several sketches, one outline each, in their order. */
export interface LoftFeature extends FeatureBase {
  type: 'loft';
  operation: BooleanOperation;
  /** Added material stays a body of its own instead of being fused with the bodies it touches (docs/adr/0011-multi-body-parts.md). */
  merge?: boolean;
  sketches: string[];
  /** Flat faces between the outlines instead of smooth ones. */
  ruled?: boolean;
  /** A centerline the loft follows (a sketch or curve id); the outlines stay where they are drawn. */
  centerline?: string;
}

/** Which way a rib grows from its curves: within the sketch plane, or along its normal. */
export type RibDirection = 'parallel' | 'normal';

export const RIB_DIRECTIONS: readonly RibDirection[] = ['parallel', 'normal'];

/**
 * A rib: a wall of `thickness` from the open curves of a sketch to the body – within the sketch plane
 * (parallel: a gusset between a line and the walls it leans against) or along the sketch normal. It grows
 * towards the material; `flip` tries the other side first.
 */
export interface RibFeature extends FeatureBase {
  type: 'rib';
  sketch: string;
  thickness: number;
  direction: RibDirection;
  flip: boolean;
}

/**
 * A modeled ISO metric thread on a cylindrical face – a bolt or a hole (`faces`: that face): the groove of
 * the basic profile cut along a helix. It starts at one end of the face (the other with `reverse`), runs
 * out of it there and goes `length` into the face. `size` names the ISO size the pitch came from.
 */
export interface ThreadFeature extends FeatureBase {
  type: 'thread';
  faces: FaceNameRef[];
  size: string;
  pitch: number;
  length: number;
  reverse: boolean;
  leftHand: boolean;
}

/** The most turns a helix can have. */
export const MAX_HELIX_TURNS = 1000;

/**
 * A helix: a curve winding around the axis of a circle of a sketch (its first circle), starting on the
 * circle at `startAngle` (degrees from the sketch's x axis) and rising `pitch` per turn along the sketch
 * normal (against it with `reverse`). A path for sweeps, for springs and coils. It does not change the body.
 */
export interface HelixFeature extends FeatureBase {
  type: 'helix';
  sketch: string;
  pitch: number;
  turns: number;
  startAngle: number;
  leftHand: boolean;
  reverse: boolean;
}

/** How a projected curve is made: projected onto faces of the body, or where two sketches meet. */
export type ProjectionMethod = 'faces' | 'sketch';
export const PROJECTION_METHODS: readonly ProjectionMethod[] = ['faces', 'sketch'];

/** Where a curve projected onto faces lands: on both sides of its sketch, along its normal or against it. */
export type ProjectionSide = 'both' | 'normal' | 'reverse';
export const PROJECTION_SIDES: readonly ProjectionSide[] = ['both', 'normal', 'reverse'];

/**
 * A projected curve: the curves of a sketch projected along its normal (both ways) onto faces of the
 * body (`faces`), or (`sketch`) where they meet the curves of a second sketch extended along its normal –
 * a 3D curve drawn in two views. A path for sweeps; it does not change the body.
 */
export interface ProjectedCurveFeature extends FeatureBase {
  type: 'projectedCurve';
  method: ProjectionMethod;
  sketch: string;
  /** Onto faces: the faces the curves land on, and on which side of the sketch. */
  faces: FaceNameRef[];
  side: ProjectionSide;
  /** Sketch on sketch: the second sketch. */
  sketch2: string;
}

/**
 * A composite curve: edges of the body and curves (sketch paths, projected and composite curves) joined
 * end to end into one chain, as the path of a sweep. It does not change the body.
 */
export interface CompositeCurveFeature extends FeatureBase {
  type: 'compositeCurve';
  edges: EdgeRef[];
  /** Ids of sketches and curve features. */
  curves: string[];
}

export type CurveFeature = ProjectedCurveFeature | CompositeCurveFeature;

/** A surface offset from faces of the body by `distance` along their normals (0: a copy of them). It does not change the body. */
export interface OffsetSurfaceFeature extends FeatureBase {
  type: 'offsetSurface';
  faces: FaceNameRef[];
  distance: number;
}

/** Surfaces knit together where their edges meet, into one surface. It does not change the body. */
export interface KnitFeature extends FeatureBase {
  type: 'knit';
  /** Ids of surface features. */
  surfaces: string[];
}

/** Which way a surface is thickened: along its normal, against it, or half each way. */
export type ThickenSide = 'normal' | 'reverse' | 'both';
export const THICKEN_SIDES: readonly ThickenSide[] = ['normal', 'reverse', 'both'];

/** A surface thickened into a solid (or, with `fill`, a closed surface filled), added to the body. */
export interface ThickenFeature extends FeatureBase {
  type: 'thicken';
  surface: string;
  thickness: number;
  side: ThickenSide;
  fill: boolean;
  /** Added material stays a body of its own instead of being fused with the bodies it touches (docs/adr/0011-multi-body-parts.md). */
  merge?: boolean;
}

export type SurfaceFeature = OffsetSurfaceFeature | KnitFeature;

export function isSurfaceFeature(feature: Feature): feature is SurfaceFeature {
  return feature.type === 'offsetSurface' || feature.type === 'knit';
}

/** How bodies are combined: fused, the others subtracted from the main body, or only what they share kept. */
export type CombineOperation = 'add' | 'subtract' | 'common';
export const COMBINE_OPERATIONS: readonly CombineOperation[] = ['add', 'subtract', 'common'];

/**
 * Combines bodies of the part (docs/adr/0011-multi-body-parts.md): each is picked by one of its faces; the
 * first is the main body. The bodies not picked stay as they are.
 */
export interface CombineFeature extends FeatureBase {
  type: 'combine';
  operation: CombineOperation;
  bodies: FaceNameRef[];
}

/** Removes bodies from the part, each picked by one of its faces. */
export interface DeleteBodyFeature extends FeatureBase {
  type: 'deleteBody';
  bodies: FaceNameRef[];
}

export function isCurveFeature(feature: Feature): feature is CurveFeature {
  return feature.type === 'projectedCurve' || feature.type === 'compositeCurve';
}

/** The sketches (and curves) a feature is built from (their curves belong to its geometry). */
export function sketchesUsedBy(feature: Feature): string[] {
  if (isSketchBased(feature) || feature.type === 'rib' || feature.type === 'helix') return [feature.sketch];
  if (feature.type === 'sweep') return feature.guide ? [feature.sketch, feature.path, feature.guide] : [feature.sketch, feature.path];
  if (feature.type === 'loft') return feature.centerline ? [...feature.sketches, feature.centerline] : feature.sketches;
  if (feature.type === 'projectedCurve') return feature.method === 'sketch' ? [feature.sketch, feature.sketch2] : [feature.sketch];
  if (feature.type === 'compositeCurve') return feature.curves;
  if (feature.type === 'knit') return feature.surfaces;
  if (feature.type === 'thicken') return [feature.surface];
  return [];
}

export type Feature =
  | VariablesFeature
  | SketchFeature
  | PlaneFeature
  | AxisFeature
  | PointFeature
  | CsysFeature
  | ExtrudeFeature
  | RevolveFeature
  | HoleFeature
  | PatternFeature
  | MirrorFeature
  | BoxFeature
  | CylinderFeature
  | ImportFeature
  | FilletFeature
  | ChamferFeature
  | ShellFeature
  | DraftFeature
  | SweepFeature
  | LoftFeature
  | RibFeature
  | ThreadFeature
  | HelixFeature
  | ProjectedCurveFeature
  | CompositeCurveFeature
  | CombineFeature
  | DeleteBodyFeature
  | OffsetSurfaceFeature
  | KnitFeature
  | ThickenFeature;

/** Features that build or modify the solid body (everything except variables, sketches, reference geometry and curves). */
export type SolidModelingFeature = Exclude<Feature, SketchFeature | VariablesFeature | ReferenceFeature | HelixFeature | CurveFeature | SurfaceFeature>;

export type EdgeFeature = FilletFeature | ChamferFeature;

export function isEdgeFeature(feature: Feature): feature is EdgeFeature {
  return feature.type === 'fillet' || feature.type === 'chamfer';
}

export function isSolidFeature(feature: Feature): feature is BoxFeature | CylinderFeature {
  return feature.type === 'box' || feature.type === 'cylinder';
}

export const FEATURE_TYPES: readonly FeatureType[] = ['variables', 'sketch', 'plane', 'axis', 'point', 'csys', 'extrude', 'revolve', 'hole', 'pattern', 'mirror', 'box', 'cylinder', 'import', 'fillet', 'chamfer', 'shell', 'draft', 'sweep', 'loft', 'rib', 'thread', 'helix', 'projectedCurve', 'compositeCurve', 'combine', 'deleteBody', 'offsetSurface', 'knit', 'thicken'];

/** Features that make a body from nothing (the first feature with material must be one of them, adding). */
export const BODY_TYPES: ReadonlySet<FeatureType> = new Set(['box', 'cylinder', 'extrude', 'revolve', 'import', 'sweep', 'loft']);

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
    case 'csys':
      return { id, type, method: 'position', references: [], x: 0, y: 0, z: 0, angle: 0, flipX: false, flipY: false };
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
    case 'pattern':
      return { id, type, method: 'linear', references: [], features: [], count: 3, spacing: 20, angle: 360, flip: false };
    case 'mirror':
      return { id, type, method: 'plane', references: [], features: [] };
    case 'box':
      return { id, type, operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
    case 'cylinder':
      return { id, type, operation: 'add', radius: 20, height: 50, axis: 'z', position: [0, 0, 0] };
    case 'import':
      return { id, type, operation: 'add', file: '', hash: '', data: '' };
    case 'fillet':
      return { id, type, radius: 5, edges: [] };
    case 'chamfer':
      return { id, type, distance: 3, edges: [] };
    case 'shell':
      return { id, type, thickness: 2, faces: [], outward: false };
    case 'draft':
      return { id, type, method: 'neutralPlane', references: [], faces: [], angle: 3, flip: false };
    case 'sweep':
      return { id, type, operation: 'add', sketch: '', path: '' };
    case 'loft':
      return { id, type, operation: 'add', sketches: [] };
    case 'rib':
      return { id, type, sketch: '', thickness: 3, direction: 'parallel', flip: false };
    case 'thread':
      return { id, type, faces: [], size: 'M6', pitch: 1, length: 10, reverse: false, leftHand: false };
    case 'helix':
      return { id, type, sketch: '', pitch: 5, turns: 5, startAngle: 0, leftHand: false, reverse: false };
    case 'projectedCurve':
      return { id, type, method: 'faces', sketch: '', faces: [], side: 'both', sketch2: '' };
    case 'compositeCurve':
      return { id, type, edges: [], curves: [] };
    case 'combine':
      return { id, type, operation: 'add', bodies: [] };
    case 'deleteBody':
      return { id, type, bodies: [] };
    case 'offsetSurface':
      return { id, type, faces: [], distance: 5 };
    case 'knit':
      return { id, type, surfaces: [] };
    case 'thicken':
      return { id, type, surface: '', thickness: 2, side: 'normal', fill: false };
  }
}
