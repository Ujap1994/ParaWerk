import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { isCopyFeature, isEdgeFeature, isReferenceFeature, type Feature } from './feature.ts';
import { NO_PROPERTIES, type PartProperties } from './material.ts';
import { parseFeatures, parsePartProperties, ValidationError } from './validate.ts';

/**
 * Native part file (.pwpart): a ZIP container (docs/adr/0003-native-file-format.md).
 *
 *   document.json  the feature list (source of truth)
 *   meta.json      application version and timestamps
 *
 * Later versions add cached B-Rep data and a thumbnail; readers ignore unknown entries.
 */

export const PART_FORMAT = 'parawerk-part';
/**
 * 2: sketch features. 3: variables, parameter and dimension expressions, splines. 4: extrusions and
 * revolutions. 5: edges and sketch faces referenced by persistent names (docs/adr/0002-persistent-naming.md).
 * 6: reference planes, axes and points, sketches on reference planes, revolutions around reference axes, holes,
 * patterns and mirror images, shells, extrusions up to a surface or vertex. 7: the part's material and color,
 * STEP imports, coordinate systems, extrusions in two directions, with a draft or up to the next face, thin
 * features, uneven chamfers (ParaWerk 0.3). 8: drafts, sweeps, lofts, ribs, modeled threads, helices,
 * variable radius fillets, configurations (ParaWerk 0.4). 9: projected and composite curves, patterns and
 * mirror images of patterns (0.4.0-alpha.1). 10: twisted and guided sweeps, lofts along a centerline,
 * separate bodies, combined and deleted bodies, surfaces. 11: split bodies.
 * Older versions are read unchanged.
 */
export const PART_FORMAT_VERSION = 11;

/** The oldest format version that can hold the document, so older ParaWerk versions can still open it. */
export function formatVersionOf(features: readonly Feature[], properties: PartProperties = NO_PROPERTIES): number {
  if (features.some((feature) => feature.type === 'split')) return 11;
  const tenth = (feature: Feature) =>
    (feature.type === 'sweep' && ((feature.twist ?? 0) !== 0 || feature.guide !== undefined)) ||
    (feature.type === 'loft' && feature.centerline !== undefined) ||
    ('merge' in feature && feature.merge === false) ||
    feature.type === 'combine' ||
    feature.type === 'deleteBody' ||
    feature.type === 'offsetSurface' ||
    feature.type === 'knit' ||
    feature.type === 'thicken';
  if (features.some(tenth)) return 10;
  const copies = new Set(features.filter(isCopyFeature).map((feature) => feature.id));
  const ninth = (feature: Feature) =>
    feature.type === 'projectedCurve' || feature.type === 'compositeCurve' || (isCopyFeature(feature) && feature.features.some((id) => copies.has(id)));
  if (features.some(ninth)) return 9;
  const eighth = (feature: Feature) =>
    feature.type === 'draft' ||
    feature.type === 'sweep' ||
    feature.type === 'loft' ||
    feature.type === 'rib' ||
    feature.type === 'thread' ||
    feature.type === 'helix' ||
    (feature.type === 'fillet' && feature.method === 'variable');
  if (features.some(eighth) || properties.configurations !== undefined) return 8;
  const seventh = (feature: Feature) =>
    feature.type === 'import' ||
    feature.type === 'csys' ||
    (feature.type === 'extrude' && (feature.end === 'upToNext' || feature.direction === 'two' || (feature.draft ?? 0) > 0)) ||
    ((feature.type === 'extrude' || feature.type === 'revolve') && feature.thin !== undefined) ||
    (feature.type === 'chamfer' && feature.method !== undefined && feature.method !== 'equal') ||
    (isEdgeFeature(feature) && feature.faces !== undefined && feature.faces.length > 0) ||
    (feature.type === 'fillet' && feature.method !== undefined && feature.method !== 'constant');
  if (properties.material !== undefined || properties.color !== undefined || features.some(seventh)) return 7;
  const reference = (feature: Feature) =>
    isReferenceFeature(feature) ||
    isCopyFeature(feature) ||
    feature.type === 'hole' ||
    feature.type === 'shell' ||
    (feature.type === 'extrude' && (feature.end === 'upToSurface' || feature.end === 'upToVertex')) ||
    (feature.type === 'sketch' && feature.plane.kind === 'feature') ||
    (feature.type === 'revolve' && feature.axisRef !== undefined);
  if (features.some(reference)) return 6;
  const named = features.some(
    (feature) =>
      (isEdgeFeature(feature) && feature.edges.some((ref) => ref.kind === 'edge')) || (feature.type === 'sketch' && feature.plane.kind === 'face' && feature.plane.name !== undefined),
  );
  if (named) return 5;
  if (features.some((feature) => feature.type === 'extrude' || feature.type === 'revolve')) return 4;
  const needsThree = features.some(
    (feature) =>
      feature.type === 'variables' ||
      (feature.expressions !== undefined && Object.keys(feature.expressions).length > 0) ||
      (feature.type === 'sketch' &&
        (feature.sketch.entities.some((entity) => entity.type === 'spline') || feature.sketch.constraints.some((constraint) => 'expression' in constraint && constraint.expression !== undefined))),
  );
  if (needsThree) return 3;
  return features.some((feature) => feature.type === 'sketch') ? 2 : 1;
}

/** Upper bound for the uncompressed size of one entry, to reject zip bombs. */
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

export interface PartDocument {
  units: 'mm';
  features: Feature[];
  /** Material and color of the part (format version 7). */
  properties?: PartProperties;
}

export interface PartFileMeta {
  appVersion: string;
  savedAt: string;
}

export type PartFileErrorCode = 'not-a-zip' | 'missing-document' | 'wrong-format' | 'newer-version' | 'invalid-content';

export class PartFileError extends Error {
  readonly code: PartFileErrorCode;

  constructor(code: PartFileErrorCode, message: string) {
    super(message);
    this.name = 'PartFileError';
    this.code = code;
  }
}

/** Where the STEP file of an import feature is kept in the package. */
const importEntry = (id: string) => `imports/${id}.step`;

export function encodePartFile(document: PartDocument, meta: PartFileMeta): Uint8Array {
  // Imported files are entries of their own: the document stays small and readable, and STEP compresses well.
  const imports: Record<string, Uint8Array> = {};
  const features = document.features.map((feature) => {
    if (feature.type !== 'import') return feature;
    imports[importEntry(feature.id)] = strToU8(feature.data);
    const { data: _data, ...rest } = feature;
    return rest;
  });
  const documentJson = {
    format: PART_FORMAT,
    // Files without new content stay readable by older ParaWerk versions.
    version: formatVersionOf(document.features, document.properties),
    units: document.units,
    features,
    ...(document.properties && (document.properties.material || document.properties.color || document.properties.configurations) ? { properties: document.properties } : {}),
  };
  return zipSync(
    {
      'document.json': strToU8(JSON.stringify(documentJson, null, 2)),
      'meta.json': strToU8(JSON.stringify(meta, null, 2)),
      ...imports,
    },
    { level: 6 },
  );
}

export function decodePartFile(bytes: Uint8Array): { document: PartDocument; meta: Partial<PartFileMeta> } {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        if (file.originalSize > MAX_ENTRY_BYTES) {
          throw new PartFileError('invalid-content', `entry ${file.name} is too large`);
        }
        return file.name === 'document.json' || file.name === 'meta.json' || /^imports\/[\w-]+\.step$/.test(file.name);
      },
    });
  } catch (error) {
    if (error instanceof PartFileError) throw error;
    throw new PartFileError('not-a-zip', 'the file is not a ParaWerk part file');
  }

  const documentBytes = entries['document.json'];
  if (!documentBytes) throw new PartFileError('missing-document', 'document.json is missing');

  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(documentBytes));
  } catch {
    throw new PartFileError('invalid-content', 'document.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null) throw new PartFileError('invalid-content', 'document.json is empty');
  const json = raw as Record<string, unknown>;
  if (json.format !== PART_FORMAT) throw new PartFileError('wrong-format', 'the file is not a ParaWerk part file');
  if (typeof json.version !== 'number' || json.version > PART_FORMAT_VERSION) {
    throw new PartFileError('newer-version', 'the file was saved by a newer ParaWerk version');
  }
  if (json.units !== 'mm') throw new PartFileError('invalid-content', 'unsupported units');

  let features: Feature[];
  let properties: PartProperties;
  try {
    // Imported files come back from their entries.
    const rawFeatures = Array.isArray(json.features)
      ? json.features.map((raw: unknown) => {
          if (typeof raw !== 'object' || raw === null || (raw as Record<string, unknown>).type !== 'import') return raw;
          const entry = entries[importEntry(String((raw as Record<string, unknown>).id))];
          return entry ? { ...raw, data: strFromU8(entry) } : raw;
        })
      : json.features;
    features = parseFeatures(rawFeatures);
    properties = parsePartProperties(json.properties);
  } catch (error) {
    if (error instanceof ValidationError) throw new PartFileError('invalid-content', error.message);
    throw error;
  }

  let meta: Partial<PartFileMeta> = {};
  const metaBytes = entries['meta.json'];
  if (metaBytes) {
    try {
      const parsed: unknown = JSON.parse(strFromU8(metaBytes));
      if (typeof parsed === 'object' && parsed !== null) meta = parsed as Partial<PartFileMeta>;
    } catch {
      // Metadata is informational; a damaged meta.json must not prevent opening the part.
    }
  }

  return { document: { units: 'mm', features, properties }, meta };
}
