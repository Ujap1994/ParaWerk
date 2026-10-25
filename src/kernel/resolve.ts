import type { Feature, SketchFeature, SolidModelingFeature } from '../shared/model/feature.ts';
import { sketchProfile } from '../shared/model/profile.ts';
import { frameOf } from '../shared/model/sketch.ts';
import type { KernelFeature } from './backend.ts';
import { FeatureError } from './feature-error.ts';

const coordinate = (value: number) => String(Math.round(value * 100) / 100);

/**
 * Gives a feature what it needs from earlier features: an extrude gets the closed outlines and the
 * plane of its sketch. Throws FeatureError when the sketch is missing or has no usable outline.
 */
export function resolveFeature(feature: SolidModelingFeature, before: readonly Feature[]): KernelFeature {
  if (feature.type !== 'extrude') return feature;
  const sketch = before.find((candidate): candidate is SketchFeature => candidate.type === 'sketch' && candidate.id === feature.sketch);
  if (!sketch || sketch.suppressed) throw new FeatureError('sketch-missing');
  const profile = sketchProfile(sketch.sketch);
  const crossing = profile.problems[0];
  if (crossing) throw new FeatureError('profile-crossing', `${coordinate(crossing.at[0])}, ${coordinate(crossing.at[1])}`);
  if (profile.regions.length === 0) throw new FeatureError('profile-empty');
  return { ...feature, profile, frame: frameOf(sketch.plane) };
}
