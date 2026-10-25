import type { Vec3 } from '../../shared/model/feature.ts';
import { STANDARD_FRAMES, type StandardPlane } from '../../shared/model/sketch.ts';
import type { SectionCut } from './viewport/section-view.ts';

/** The plane a section view cuts along: a standard plane, or a planar face or reference plane picked for it. */
export type SectionPlane = { kind: 'standard'; plane: StandardPlane } | { kind: 'custom'; point: Vec3; normal: Vec3 };

/** A section view of the part (a view setting; the part does not change). */
export interface SectionSettings {
  plane: SectionPlane;
  /** How far the cut lies from the plane along its normal, in mm. */
  offset: number;
  /** Cut away the other side. */
  flip: boolean;
}

/** Where the view cuts and which side goes: the side the plane's normal points to (the other with `flip`). */
export function sectionCut(settings: SectionSettings): SectionCut {
  const { point, normal } = settings.plane.kind === 'standard' ? { point: STANDARD_FRAMES[settings.plane.plane].origin, normal: STANDARD_FRAMES[settings.plane.plane].normal } : settings.plane;
  const length = Math.hypot(...normal) || 1;
  const unit: Vec3 = [normal[0] / length, normal[1] / length, normal[2] / length];
  const at: Vec3 = [point[0] + unit[0] * settings.offset, point[1] + unit[1] * settings.offset, point[2] + unit[2] * settings.offset];
  return { point: at, normal: settings.flip ? [-unit[0], -unit[1], -unit[2]] : unit };
}

/** The offsets at which the plane passes through a box (the part's bounding box): from where it enters to where it leaves. */
export function offsetRange(plane: SectionPlane, min: Vec3, max: Vec3): [number, number] {
  const cut = sectionCut({ plane, offset: 0, flip: false });
  let low = Infinity;
  let high = -Infinity;
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const d = (x - cut.point[0]) * cut.normal[0] + (y - cut.point[1]) * cut.normal[1] + (z - cut.point[2]) * cut.normal[2];
        low = Math.min(low, d);
        high = Math.max(high, d);
      }
    }
  }
  return [low, high];
}
