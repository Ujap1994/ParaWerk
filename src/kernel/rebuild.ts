import { hashString } from '../shared/hash.ts';
import { isEdgeFeature, isReferenceFeature, isSketchBased, type Feature, type SketchFeature, type Vec3 } from '../shared/model/feature.ts';
import type { BodyNaming } from '../shared/model/naming.ts';
import type { ReferenceGeometry } from '../shared/model/reference.ts';
import type { SketchFrame, SketchPlaneRef } from '../shared/model/sketch.ts';
import type { GeometryBackend, ResolvedHole, ShapeHandle } from './backend.ts';
import { holeThreads, throughDepth, type CosmeticThread } from '../shared/model/hole.ts';
import { FeatureError } from './feature-error.ts';
import type { FeatureResult } from './protocol.ts';
import { computeReference, type BodyQuery } from './reference.ts';
import { placeSketch, resolveFeature } from './resolve.ts';

interface CacheEntry {
  /** Identifies this feature together with everything before it. */
  key: string;
  /** Key of the entry that produced the shape (suppressed and failed features pass the body through). */
  shapeKey: string;
  shape: ShapeHandle | null;
  ownsShape: boolean;
  /** Sketches: where the sketch lies (a sketch on a face follows its face). */
  frame?: SketchFrame;
  /** Reference planes, axes and points: where they lie. */
  reference?: ReferenceGeometry;
  result: FeatureResult;
}

export const ROOT_KEY = 'root';


function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * What decides where a sketch lies. A sketch on a named face or a reference plane follows it, and the
 * keys cover the features before the sketch already, so the frame the document keeps up to date is left out: taking it over
 * after a rebuild must not rebuild everything again.
 */
function planeSignature(plane: SketchPlaneRef): unknown {
  if (plane.kind === 'feature') return { kind: 'feature', feature: plane.feature };
  return plane.kind === 'face' && plane.name !== undefined ? { kind: 'face', name: plane.name } : plane;
}

/** Everything that influences the geometry of a feature (the display name does not). */
function featureSignature(feature: Feature, sketches: ReadonlyMap<string, SketchFeature>): string {
  // Sketches and variables never change the body, so editing them must not invalidate the features
  // after them (variables reach the body through the values of the features that use them).
  if (feature.type === 'variables') return `${feature.type}:${feature.id}`;
  if (feature.type === 'sketch') return `${feature.type}:${feature.id}:${stableStringify(planeSignature(feature.plane))}`;
  // An imported file is known by its content hash: hashing the whole file at every rebuild would be slow.
  if (feature.type === 'import') return stableStringify({ type: feature.type, id: feature.id, operation: feature.operation, hash: feature.hash, suppressed: feature.suppressed });
  const { name: _name, expressions: _expressions, ...geometry } = feature;
  if (isSketchBased(feature)) {
    // Extrusions and revolutions follow their sketch: its plane and geometry belong to their signature.
    const sketch = sketches.get(feature.sketch);
    return stableStringify({ ...geometry, from: sketch && !sketch.suppressed ? { plane: planeSignature(sketch.plane), entities: sketch.sketch.entities } : null });
  }
  return stableStringify(geometry);
}

/** The cosmetic threads of tapped holes (through holes are threaded all the way through the body). */
function threadsOf(hole: ResolvedHole, box: { min: Vec3; max: Vec3 }): CosmeticThread[] {
  const depth = hole.end === 'throughAll' ? throughDepth(box.min, box.max, hole.placements) : hole.threadDepth;
  return holeThreads(hole, hole.placements, depth);
}

/**
 * A result without the healed references the document has taken over already: a sketch's key leaves
 * its frame out, so its cached result would otherwise report the same plane again and again.
 */
function withoutTakenOver(result: FeatureResult, feature: Feature | undefined): FeatureResult {
  const { healedEdges, healedPlane, healedReferences, healedFaces, ...rest } = result;
  const edgesNew = healedEdges && !(feature && isEdgeFeature(feature) && stableStringify(feature.edges) === stableStringify(healedEdges));
  const planeNew = healedPlane && !(feature?.type === 'sketch' && stableStringify(feature.plane) === stableStringify(healedPlane));
  const referencesNew = healedReferences && !(feature && isReferenceFeature(feature) && stableStringify(feature.references) === stableStringify(healedReferences));
  const facesNew = healedFaces && !(feature?.type === 'shell' && stableStringify(feature.faces) === stableStringify(healedFaces));
  return {
    ...rest,
    ...(edgesNew ? { healedEdges } : {}),
    ...(planeNew ? { healedPlane } : {}),
    ...(referencesNew ? { healedReferences } : {}),
    ...(facesNew ? { healedFaces } : {}),
  };
}

export function featureKeys(features: readonly Feature[]): string[] {
  let previous = ROOT_KEY;
  const sketches = new Map<string, SketchFeature>();
  return features.map((feature) => {
    previous = hashString(`${previous}|${featureSignature(feature, sketches)}`);
    if (feature.type === 'sketch') sketches.set(feature.id, feature);
    return previous;
  });
}

/**
 * Incremental rebuild of the feature list.
 *
 * The body after each feature is cached. A rebuild starts at the first feature
 * whose key (its own parameters plus everything before it) changed, so editing
 * the last feature never recomputes the ones before it.
 */
export class Rebuilder implements Disposable {
  private readonly backend: GeometryBackend;
  private entries: CacheEntry[] = [];

  constructor(backend: GeometryBackend) {
    this.backend = backend;
  }

  get cachedShapes(): number {
    return this.entries.filter((entry) => entry.ownsShape).length;
  }

  rebuild(features: readonly Feature[]): { results: FeatureResult[]; rebuilt: number } {
    const keys = featureKeys(features);
    let firstChanged = features.length;
    for (let i = 0; i < features.length; i++) {
      if (this.entries[i]?.key !== keys[i]) {
        firstChanged = i;
        break;
      }
    }
    this.truncate(firstChanged);
    const frames = new Map<string, SketchFrame>();
    const references = new Map<string, ReferenceGeometry>();
    this.entries.forEach((entry, i) => {
      if (entry.frame) frames.set(features[i]?.id ?? '', entry.frame);
      if (entry.reference) references.set(features[i]?.id ?? '', entry.reference);
    });
    // Several features in a row may ask for the names of the same body.
    const namings = new Map<ShapeHandle, BodyNaming>();
    const naming = (shape: ShapeHandle): BodyNaming => {
      let found = namings.get(shape);
      if (!found) {
        found = this.backend.naming(shape);
        namings.set(shape, found);
      }
      return found;
    };
    const query = (shape: ShapeHandle): BodyQuery => ({
      naming: () => naming(shape),
      face: (index) => this.backend.faceGeometry(shape, index),
      edge: (index) => this.backend.edgeGeometry(shape, index),
    });

    for (let i = firstChanged; i < features.length; i++) {
      const feature = features[i] as Feature;
      const key = keys[i] as string;
      const previous = this.entries[i - 1];
      const input = previous?.shape ?? null;
      const inputKey = previous?.shapeKey ?? ROOT_KEY;
      const start = performance.now();

      // Sketches do not change the body (extrusions consume them); a sketch on a face follows its face.
      if (feature.type === 'sketch' && !feature.suppressed) {
        const placement = placeSketch(feature, input ? () => naming(input) : null, references);
        frames.set(feature.id, placement.frame);
        this.entries.push({
          key,
          shapeKey: inputKey,
          shape: input,
          ownsShape: false,
          frame: placement.frame,
          result: {
            id: feature.id,
            status: placement.missing ? 'error' : 'ok',
            timeMs: performance.now() - start,
            cached: false,
            ...(placement.missing ? { error: { code: feature.plane.kind === 'feature' ? ('plane-missing' as const) : ('face-missing' as const) } } : {}),
            ...(placement.healed ? { healedPlane: placement.healed } : {}),
          },
        });
        continue;
      }

      // Reference planes, axes and points do not change the body either.
      if (isReferenceFeature(feature) && !feature.suppressed) {
        let result: FeatureResult;
        let reference: ReferenceGeometry | undefined;
        try {
          const computed = computeReference(feature, { body: input ? query(input) : null, references });
          reference = computed.geometry;
          references.set(feature.id, reference);
          result = { id: feature.id, status: 'ok', timeMs: 0, cached: false, reference, ...(computed.healed ? { healedReferences: computed.healed } : {}) };
        } catch (error) {
          const failure =
            error instanceof FeatureError
              ? { code: error.code, ...(error.detail === undefined ? {} : { detail: error.detail }) }
              : { code: 'unknown' as const, detail: this.backend.describeError(error) };
          result = { id: feature.id, status: 'error', error: failure, timeMs: 0, cached: false };
        }
        result.timeMs = performance.now() - start;
        this.entries.push({ key, shapeKey: inputKey, shape: input, ownsShape: false, ...(reference ? { reference } : {}), result });
        continue;
      }

      // Variables do not change the body either.
      if (feature.suppressed || feature.type === 'sketch' || feature.type === 'variables' || isReferenceFeature(feature)) {
        this.entries.push({
          key,
          shapeKey: inputKey,
          shape: input,
          ownsShape: false,
          result: { id: feature.id, status: feature.suppressed ? 'suppressed' : 'ok', timeMs: 0, cached: false },
        });
        continue;
      }

      try {
        const resolved = resolveFeature(feature, features.slice(0, i), { body: input ? query(input) : null, frames, references });
        this.backend.takeCutMissed?.();
        const shape = this.backend.applyFeature(input, resolved);
        const missed = this.backend.takeCutMissed?.() ?? false;
        const healed = 'healedEdges' in resolved ? resolved.healedEdges : undefined;
        const healedFaces = 'healedFaces' in resolved ? resolved.healedFaces : undefined;
        const missing = 'missingEdges' in resolved ? resolved.missingEdges : undefined;
        const missingFaces = 'missingFaces' in resolved ? resolved.missingFaces : undefined;
        const threads = resolved.type === 'hole' && input ? threadsOf(resolved, this.backend.boundingBox(input)) : [];
        this.entries.push({
          key,
          shapeKey: key,
          shape,
          ownsShape: true,
          result: {
            id: feature.id,
            status: 'ok',
            timeMs: performance.now() - start,
            cached: false,
            ...(healed ? { healedEdges: healed } : {}),
            ...(missing ? { warning: { code: 'edge-missing' as const, detail: String(missing) } } : {}),
            ...(healedFaces ? { healedFaces } : {}),
            ...(missingFaces ? { warning: { code: 'shell-face-missing' as const, detail: String(missingFaces) } } : {}),
            ...(missed ? { warning: { code: 'cut-nothing' as const } } : {}),
            ...(threads.length > 0 ? { threads } : {}),
          },
        });
      } catch (error) {
        const failure =
          error instanceof FeatureError
            ? { code: error.code, ...(error.detail === undefined ? {} : { detail: error.detail }) }
            : { code: 'unknown' as const, detail: this.backend.describeError(error) };
        this.entries.push({
          key,
          shapeKey: inputKey,
          shape: input,
          ownsShape: false,
          result: { id: feature.id, status: 'error', error: failure, timeMs: performance.now() - start, cached: false },
        });
      }
    }

    const results = this.entries.map((entry, i) => {
      const result = i < firstChanged ? { ...entry.result, timeMs: 0, cached: true } : entry.result;
      return withoutTakenOver(result, features[i]);
    });
    return { results, rebuilt: features.length - firstChanged };
  }

  /** Body after the feature at `index`; index -1 is the empty start state. */
  shapeAfter(index: number): ShapeHandle | null {
    return index < 0 ? null : (this.entries[index]?.shape ?? null);
  }

  shapeKeyAfter(index: number): string {
    return index < 0 ? ROOT_KEY : (this.entries[index]?.shapeKey ?? ROOT_KEY);
  }

  private truncate(from: number): void {
    for (let i = this.entries.length - 1; i >= from; i--) {
      const entry = this.entries[i];
      if (entry?.ownsShape && entry.shape) this.backend.release(entry.shape);
    }
    this.entries.length = Math.min(this.entries.length, from);
  }

  [Symbol.dispose](): void {
    this.truncate(0);
  }
}
