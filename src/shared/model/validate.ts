import { CHAMFER_METHODS, type ChamferMethod, EXPRESSION_FIELDS, EXTRUDE_DIRECTIONS, MAX_DRAFT_ANGLE, REVOLVE_DIRECTIONS, type RevolveDirection, EXTRUDE_ENDS, HOLE_ENDS, type Axis, type BooleanOperation, type EdgeRef, type ExtrudeDirection, type ExtrudeEnd, type Feature, type FeatureType, type HoleEnd, type Variable, type Vec3 } from './feature.ts';
import { HOLE_FITS, HOLE_KINDS } from './hole.ts';
import { CUSTOM_MATERIAL, materialInfo, MAX_DENSITY, MIN_DENSITY, NO_PROPERTIES, type PartProperties } from './material.ts';
import { MAX_PATTERN_COUNT } from './pattern.ts';
import { AXIS_METHODS, PLANE_METHODS, POINT_METHODS, type GeometryRef } from './reference.ts';
import { parseSketchData, parsePlaneRef } from './validate-sketch.ts';

export class ValidationError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${path}: ${message}`);
    this.name = 'ValidationError';
    this.path = path;
  }
}

type Json = Record<string, unknown>;

/** Longest file name of an imported file. */
const MAX_FILE_NAME = 260;
/** Largest imported STEP file kept in a part (characters; STEP is ASCII). */
export const MAX_IMPORT_CHARS = 64 * 1024 * 1024;

/** Largest model dimension accepted, in millimeters (100 m). */
export const MAX_LENGTH = 100_000;

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function positiveLength(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > MAX_LENGTH) {
    throw new ValidationError(`expected a length between 0 and ${MAX_LENGTH} mm`, path);
  }
  return value;
}

export function coordinate(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_LENGTH) {
    throw new ValidationError('expected a finite coordinate', path);
  }
  return value;
}

export function vec3(value: unknown, path: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3) throw new ValidationError('expected [x, y, z]', path);
  return [coordinate(value[0], `${path}[0]`), coordinate(value[1], `${path}[1]`), coordinate(value[2], `${path}[2]`)];
}

function operation(value: unknown, path: string): BooleanOperation {
  if (value !== 'add' && value !== 'cut') throw new ValidationError('expected "add" or "cut"', path);
  return value;
}

function axis(value: unknown, path: string): Axis {
  if (value !== 'x' && value !== 'y' && value !== 'z') throw new ValidationError('expected "x", "y" or "z"', path);
  return value;
}

/** Longest persistent face name accepted (feature id, role and sketch curve id). */
const MAX_FACE_NAME = 256;

function faceName(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > MAX_FACE_NAME) throw new ValidationError('expected a face name', path);
  return value;
}

function edges(value: unknown, path: string): EdgeRef[] {
  if (!Array.isArray(value)) throw new ValidationError('expected a list of edges', path);
  return value.map((ref, i): EdgeRef => {
    const p = `${path}[${i}]`;
    if (isObject(ref) && ref.kind === 'edge') {
      if (!Array.isArray(ref.faces) || ref.faces.length !== 2) throw new ValidationError('expected two face names', `${p}.faces`);
      const faces = [faceName(ref.faces[0], `${p}.faces[0]`), faceName(ref.faces[1], `${p}.faces[1]`)].sort() as [string, string];
      return { kind: 'edge', faces, at: vec3(ref.at, `${p}.at`) };
    }
    if (!isObject(ref) || ref.kind !== 'edge-index') throw new ValidationError('unknown edge reference', p);
    const index = ref.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
      throw new ValidationError('expected a non-negative edge index', `${p}.index`);
    }
    return { kind: 'edge-index', index };
  });
}

/** Most references a reference feature takes (three points). */
const MAX_REFERENCES = 3;

function geometryRef(value: unknown, path: string): GeometryRef {
  if (!isObject(value)) throw new ValidationError('expected a reference', path);
  switch (value.kind) {
    case 'standard-plane':
      if (value.plane !== 'front' && value.plane !== 'top' && value.plane !== 'right') throw new ValidationError('unknown plane', `${path}.plane`);
      return { kind: 'standard-plane', plane: value.plane };
    case 'origin':
      return { kind: 'origin' };
    case 'feature':
      if (typeof value.feature !== 'string' || value.feature.length > 64) throw new ValidationError('expected a feature id', `${path}.feature`);
      return { kind: 'feature', feature: value.feature };
    case 'face':
      return { kind: 'face', name: faceName(value.name, `${path}.name`), at: vec3(value.at, `${path}.at`) };
    case 'edge': {
      const [ref] = edges([value], path);
      if (ref?.kind !== 'edge') throw new ValidationError('expected an edge reference', path);
      return ref;
    }
    case 'vertex': {
      if (!Array.isArray(value.faces) || value.faces.length > 64) throw new ValidationError('expected face names', `${path}.faces`);
      const faces = value.faces.map((name, i) => faceName(name, `${path}.faces[${i}]`)).sort();
      return { kind: 'vertex', faces, at: vec3(value.at, `${path}.at`) };
    }
    default:
      throw new ValidationError('unknown reference', `${path}.kind`);
  }
}

function geometryRefs(value: unknown, path: string): GeometryRef[] {
  if (!Array.isArray(value) || value.length > MAX_REFERENCES) throw new ValidationError(`expected up to ${MAX_REFERENCES} references`, path);
  return value.map((ref, i) => geometryRef(ref, `${path}[${i}]`));
}

function nonNegative(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_LENGTH) throw new ValidationError('expected a length of 0 or more', path);
  return value;
}

function flag(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ValidationError('expected true or false', path);
  return value;
}

/** Ids of the features a pattern or mirror copies; unknown ids are kept and reported by the rebuild. */
function featureIds(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 200) throw new ValidationError('expected a list of feature ids', path);
  return value.map((id, i) => {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64) throw new ValidationError('expected a feature id', `${path}[${i}]`);
    return id;
  });
}

function method<T extends string>(value: unknown, methods: readonly T[], path: string): T {
  if (!(methods as readonly unknown[]).includes(value)) throw new ValidationError(`expected one of ${methods.join(', ')}`, path);
  return value as T;
}

function finiteNumber(value: unknown, path: string, limit = MAX_LENGTH): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit) throw new ValidationError('expected a number', path);
  return value;
}

function base(raw: Json, path: string): { id: string; name?: string; suppressed?: boolean } {
  if (typeof raw.id !== 'string' || raw.id.length === 0 || raw.id.length > 64) {
    throw new ValidationError('expected a feature id', `${path}.id`);
  }
  const result: { id: string; name?: string; suppressed?: boolean } = { id: raw.id };
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string' || raw.name.length > 200) throw new ValidationError('invalid name', `${path}.name`);
    result.name = raw.name;
  }
  if (raw.suppressed !== undefined) {
    if (typeof raw.suppressed !== 'boolean') throw new ValidationError('expected true or false', `${path}.suppressed`);
    result.suppressed = raw.suppressed;
  }
  return result;
}

/** Parses untrusted data (e.g. from a file) into a feature, or throws a ValidationError. */
/** Longest expression text; longer ones are damaged or hostile data. */
const MAX_EXPRESSION_LENGTH = 500;
const MAX_VARIABLES = 1000;

export function expressionText(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_EXPRESSION_LENGTH) throw new ValidationError('expected an expression', path);
  return value;
}

function variables(value: unknown, path: string): Variable[] {
  if (!Array.isArray(value) || value.length > MAX_VARIABLES) throw new ValidationError('expected a list of variables', path);
  const names = new Set<string>();
  return value.map((item, i) => {
    const p = `${path}[${i}]`;
    if (!isObject(item) || typeof item.name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(item.name)) throw new ValidationError('expected a variable name', `${p}.name`);
    if (names.has(item.name.toLowerCase())) throw new ValidationError(`duplicate variable ${item.name}`, `${p}.name`);
    names.add(item.name.toLowerCase());
    return { name: item.name, expression: expressionText(item.expression, `${p}.expression`) };
  });
}

/** Expressions of a feature's parameters: only the fields of its type that take them. */
function expressions(value: unknown, type: FeatureType, path: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!isObject(value)) throw new ValidationError('expected expressions', path);
  const allowed = EXPRESSION_FIELDS[type];
  const result: Record<string, string> = {};
  for (const [field, text] of Object.entries(value)) {
    if (!allowed.includes(field)) throw new ValidationError(`no expression allowed for ${field}`, `${path}.${field}`);
    result[field] = expressionText(text, `${path}.${field}`);
  }
  return result;
}

/** The end condition of an extrusion (or, with `ends`, of a hole); absent means blind (a given depth). */
function extrudeEnd<T extends string>(value: unknown, path: string, ends: readonly T[] = EXTRUDE_ENDS as readonly string[] as readonly T[]): T {
  if (value === undefined) return 'blind' as T;
  if (!(ends as readonly unknown[]).includes(value)) throw new ValidationError(`expected ${ends.join(', ')}`, path);
  return value as T;
}

export function parseFeature(raw: unknown, path = 'feature'): Feature {
  if (!isObject(raw)) throw new ValidationError('expected an object', path);
  const feature = parseFeatureFields(raw, path);
  const parsed = expressions(raw.expressions, feature.type, `${path}.expressions`);
  return parsed && Object.keys(parsed).length > 0 ? { ...feature, expressions: parsed } : feature;
}

function parseFeatureFields(raw: Json, path: string): Feature {
  const common = base(raw, path);
  switch (raw.type) {
    case 'variables':
      return { ...common, type: 'variables', variables: variables(raw.variables, `${path}.variables`) };
    case 'sketch':
      return {
        ...common,
        type: 'sketch',
        plane: parsePlaneRef(raw.plane, `${path}.plane`),
        sketch: parseSketchData(raw.sketch, `${path}.sketch`),
      };
    case 'plane':
      if (typeof raw.flip !== 'boolean') throw new ValidationError('expected true or false', `${path}.flip`);
      return {
        ...common,
        type: 'plane',
        method: method(raw.method, PLANE_METHODS, `${path}.method`),
        references: geometryRefs(raw.references, `${path}.references`),
        distance: finiteNumber(raw.distance, `${path}.distance`),
        angle: finiteNumber(raw.angle, `${path}.angle`, 360),
        flip: raw.flip,
      };
    case 'axis':
      return { ...common, type: 'axis', method: method(raw.method, AXIS_METHODS, `${path}.method`), references: geometryRefs(raw.references, `${path}.references`) };
    case 'point':
      return {
        ...common,
        type: 'point',
        method: method(raw.method, POINT_METHODS, `${path}.method`),
        references: geometryRefs(raw.references, `${path}.references`),
        x: coordinate(raw.x, `${path}.x`),
        y: coordinate(raw.y, `${path}.y`),
        z: coordinate(raw.z, `${path}.z`),
      };
    case 'extrude': {
      // An empty or unknown sketch id is kept: the rebuild reports the missing sketch at the feature.
      if (typeof raw.sketch !== 'string' || raw.sketch.length > 200) throw new ValidationError('expected a sketch id', `${path}.sketch`);
      if (!(EXTRUDE_DIRECTIONS as readonly unknown[]).includes(raw.direction)) throw new ValidationError('expected normal, reverse, both or two', `${path}.direction`);
      if (raw.draft !== undefined && (typeof raw.draft !== 'number' || !(raw.draft >= 0 && raw.draft <= MAX_DRAFT_ANGLE))) {
        throw new ValidationError(`expected a draft angle from 0° to ${MAX_DRAFT_ANGLE}°`, `${path}.draft`);
      }
      return {
        ...common,
        type: 'extrude',
        operation: operation(raw.operation, `${path}.operation`),
        sketch: raw.sketch,
        depth: positiveLength(raw.depth, `${path}.depth`),
        direction: raw.direction as ExtrudeDirection,
        end: extrudeEnd<ExtrudeEnd>(raw.end, `${path}.end`),
        ...(raw.endRef === undefined ? {} : { endRef: geometryRef(raw.endRef, `${path}.endRef`) }),
        ...(raw.endOffset === undefined ? {} : { endOffset: nonNegative(raw.endOffset, `${path}.endOffset`) }),
        ...(raw.endBeyond === undefined ? {} : { endBeyond: flag(raw.endBeyond, `${path}.endBeyond`) }),
        ...(raw.depth2 === undefined ? {} : { depth2: positiveLength(raw.depth2, `${path}.depth2`) }),
        ...(raw.draft === undefined ? {} : { draft: raw.draft as number }),
        ...(raw.draftOutward === undefined ? {} : { draftOutward: flag(raw.draftOutward, `${path}.draftOutward`) }),
      };
    }
    case 'revolve': {
      // Empty or unknown references are kept: the rebuild reports them at the feature.
      if (typeof raw.sketch !== 'string' || raw.sketch.length > 200) throw new ValidationError('expected a sketch id', `${path}.sketch`);
      if (typeof raw.axis !== 'string' || raw.axis.length > 200) throw new ValidationError('expected a line id', `${path}.axis`);
      if (!(REVOLVE_DIRECTIONS as readonly unknown[]).includes(raw.direction)) throw new ValidationError('expected normal, reverse or both', `${path}.direction`);
      if (typeof raw.angle !== 'number' || !(raw.angle > 0 && raw.angle <= 360)) throw new ValidationError('expected an angle above 0 and up to 360 degrees', `${path}.angle`);
      return {
        ...common,
        type: 'revolve',
        operation: operation(raw.operation, `${path}.operation`),
        sketch: raw.sketch,
        axis: raw.axis,
        ...(raw.axisRef === undefined ? {} : { axisRef: geometryRef(raw.axisRef, `${path}.axisRef`) }),
        angle: raw.angle,
        direction: raw.direction as RevolveDirection,
      };
    }
    case 'hole': {
      if (typeof raw.sketch !== 'string' || raw.sketch.length > 200) throw new ValidationError('expected a sketch id', `${path}.sketch`);
      if (typeof raw.size !== 'string' || raw.size.length > 20) throw new ValidationError('expected a size', `${path}.size`);
      if (typeof raw.reverse !== 'boolean') throw new ValidationError('expected true or false', `${path}.reverse`);
      if (typeof raw.countersinkAngle !== 'number' || !(raw.countersinkAngle > 0 && raw.countersinkAngle < 180)) {
        throw new ValidationError('expected an angle between 0 and 180 degrees', `${path}.countersinkAngle`);
      }
      return {
        ...common,
        type: 'hole',
        kind: method(raw.kind, HOLE_KINDS, `${path}.kind`),
        size: raw.size,
        fit: method(raw.fit, HOLE_FITS, `${path}.fit`),
        sketch: raw.sketch,
        end: extrudeEnd<HoleEnd>(raw.end, `${path}.end`, HOLE_ENDS),
        reverse: raw.reverse,
        diameter: positiveLength(raw.diameter, `${path}.diameter`),
        depth: positiveLength(raw.depth, `${path}.depth`),
        counterboreDiameter: positiveLength(raw.counterboreDiameter, `${path}.counterboreDiameter`),
        counterboreDepth: positiveLength(raw.counterboreDepth, `${path}.counterboreDepth`),
        countersinkDiameter: positiveLength(raw.countersinkDiameter, `${path}.countersinkDiameter`),
        countersinkAngle: raw.countersinkAngle,
        threadDepth: positiveLength(raw.threadDepth, `${path}.threadDepth`),
      };
    }
    case 'pattern': {
      if (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 2 || raw.count > MAX_PATTERN_COUNT) {
        throw new ValidationError(`expected a whole number from 2 to ${MAX_PATTERN_COUNT}`, `${path}.count`);
      }
      if (typeof raw.angle !== 'number' || !(raw.angle > 0 && raw.angle <= 360)) throw new ValidationError('expected an angle above 0 and up to 360 degrees', `${path}.angle`);
      if (typeof raw.flip !== 'boolean') throw new ValidationError('expected true or false', `${path}.flip`);
      return {
        ...common,
        type: 'pattern',
        method: method(raw.method, ['linear', 'circular'] as const, `${path}.method`),
        references: geometryRefs(raw.references, `${path}.references`),
        features: featureIds(raw.features, `${path}.features`),
        count: raw.count,
        spacing: positiveLength(raw.spacing, `${path}.spacing`),
        angle: raw.angle,
        flip: raw.flip,
      };
    }
    case 'mirror':
      return {
        ...common,
        type: 'mirror',
        method: method(raw.method, ['plane'] as const, `${path}.method`),
        references: geometryRefs(raw.references, `${path}.references`),
        features: featureIds(raw.features, `${path}.features`),
      };
    case 'box':
      return {
        ...common,
        type: 'box',
        operation: operation(raw.operation, `${path}.operation`),
        width: positiveLength(raw.width, `${path}.width`),
        depth: positiveLength(raw.depth, `${path}.depth`),
        height: positiveLength(raw.height, `${path}.height`),
        position: vec3(raw.position, `${path}.position`),
      };
    case 'import': {
      if (typeof raw.file !== 'string' || raw.file.length > MAX_FILE_NAME) throw new ValidationError('expected a file name', `${path}.file`);
      if (typeof raw.hash !== 'string' || raw.hash.length > 64) throw new ValidationError('expected a content hash', `${path}.hash`);
      if (typeof raw.data !== 'string' || raw.data.length === 0 || raw.data.length > MAX_IMPORT_CHARS) throw new ValidationError('expected the imported STEP file', `${path}.data`);
      return { ...common, type: 'import', operation: operation(raw.operation, `${path}.operation`), file: raw.file, hash: raw.hash, data: raw.data };
    }
    case 'cylinder':
      return {
        ...common,
        type: 'cylinder',
        operation: operation(raw.operation, `${path}.operation`),
        radius: positiveLength(raw.radius, `${path}.radius`),
        height: positiveLength(raw.height, `${path}.height`),
        axis: axis(raw.axis, `${path}.axis`),
        position: vec3(raw.position, `${path}.position`),
      };
    case 'fillet':
      return {
        ...common,
        type: 'fillet',
        radius: positiveLength(raw.radius, `${path}.radius`),
        edges: edges(raw.edges, `${path}.edges`),
      };
    case 'chamfer': {
      const chamfer: Feature = {
        ...common,
        type: 'chamfer',
        distance: positiveLength(raw.distance, `${path}.distance`),
        edges: edges(raw.edges, `${path}.edges`),
      };
      if (raw.method !== undefined) {
        if (!CHAMFER_METHODS.includes(raw.method as ChamferMethod)) throw new ValidationError(`expected one of ${CHAMFER_METHODS.join(', ')}`, `${path}.method`);
        chamfer.method = raw.method as ChamferMethod;
      }
      if (raw.distance2 !== undefined) chamfer.distance2 = positiveLength(raw.distance2, `${path}.distance2`);
      if (raw.angle !== undefined) {
        if (typeof raw.angle !== 'number' || !(raw.angle > 0 && raw.angle < 90)) throw new ValidationError('expected an angle between 0° and 90°', `${path}.angle`);
        chamfer.angle = raw.angle;
      }
      if (raw.flip !== undefined) {
        if (typeof raw.flip !== 'boolean') throw new ValidationError('expected true or false', `${path}.flip`);
        chamfer.flip = raw.flip;
      }
      return chamfer;
    }
    case 'shell': {
      if (!Array.isArray(raw.faces) || raw.faces.length > 1000) throw new ValidationError('expected a list of faces', `${path}.faces`);
      if (typeof raw.outward !== 'boolean') throw new ValidationError('expected true or false', `${path}.outward`);
      const faces = raw.faces.map((face, i) => {
        const ref = geometryRef(face, `${path}.faces[${i}]`);
        if (ref.kind !== 'face') throw new ValidationError('expected a face', `${path}.faces[${i}]`);
        return ref;
      });
      return { ...common, type: 'shell', thickness: positiveLength(raw.thickness, `${path}.thickness`), faces, outward: raw.outward };
    }
    default:
      throw new ValidationError(`unknown feature type ${JSON.stringify(raw.type)}`, `${path}.type`);
  }
}

export function parseFeatures(raw: unknown, path = 'features'): Feature[] {
  if (!Array.isArray(raw)) throw new ValidationError('expected a list of features', path);
  const features = raw.map((item, i) => parseFeature(item, `${path}[${i}]`));
  const ids = new Set<string>();
  for (const feature of features) {
    if (ids.has(feature.id)) throw new ValidationError(`duplicate feature id ${feature.id}`, path);
    ids.add(feature.id);
  }
  return features;
}

const COLOR = /^#[0-9a-f]{6}$/i;
/** Longest name of a custom material. */
const MAX_MATERIAL_NAME = 120;

/** The part's material and color (document.json `properties`); a missing value is no properties. */
export function parsePartProperties(raw: unknown, path = 'properties'): PartProperties {
  if (raw === undefined) return NO_PROPERTIES;
  if (!isObject(raw)) throw new ValidationError('expected an object', path);
  const properties: PartProperties = {};
  if (raw.material !== undefined) {
    const material = raw.material;
    if (!isObject(material)) throw new ValidationError('expected an object', `${path}.material`);
    if (typeof material.id !== 'string' || (material.id !== CUSTOM_MATERIAL && !materialInfo(material.id))) {
      throw new ValidationError('expected a material of the library or "custom"', `${path}.material.id`);
    }
    const density = material.density;
    if (typeof density !== 'number' || !Number.isFinite(density) || density < MIN_DENSITY || density > MAX_DENSITY) {
      throw new ValidationError(`expected a density between ${MIN_DENSITY} and ${MAX_DENSITY} kg/m³`, `${path}.material.density`);
    }
    properties.material = { id: material.id, density };
    if (material.name !== undefined) {
      if (typeof material.name !== 'string' || material.name.length > MAX_MATERIAL_NAME) throw new ValidationError('expected a name', `${path}.material.name`);
      properties.material.name = material.name;
    }
  }
  if (raw.color !== undefined) {
    if (typeof raw.color !== 'string' || !COLOR.test(raw.color)) throw new ValidationError('expected a color "#rrggbb"', `${path}.color`);
    properties.color = raw.color.toLowerCase();
  }
  return properties;
}
