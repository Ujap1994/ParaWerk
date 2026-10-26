/**
 * Material and appearance of a part: the density turns the exact volume and inertia of the body into
 * its mass and moments of inertia; the color is how the part looks in the 3D view.
 */

import type { Configurations } from './configurations.ts';

export type MaterialCategory = 'metal' | 'plastic' | 'wood' | 'other';

/** A material of the built-in library. Densities are typical values at room temperature. */
export interface MaterialInfo {
  id: string;
  category: MaterialCategory;
  /** kg/m³ */
  density: number;
  /** The look of the material in the 3D view, '#rrggbb'. */
  color: string;
}

/** Id of a material that is not in the library: its name and density are the user's. */
export const CUSTOM_MATERIAL = 'custom';

export const MATERIALS: readonly MaterialInfo[] = [
  { id: 'steel-s235', category: 'metal', density: 7850, color: '#8d959e' },
  { id: 'steel-c45', category: 'metal', density: 7850, color: '#7f878f' },
  { id: 'stainless-steel', category: 'metal', density: 7900, color: '#b9c0c7' },
  { id: 'cast-iron', category: 'metal', density: 7200, color: '#61676d' },
  { id: 'aluminium-6061', category: 'metal', density: 2700, color: '#ccd2d8' },
  { id: 'aluminium-7075', category: 'metal', density: 2810, color: '#c3c9cf' },
  { id: 'brass', category: 'metal', density: 8470, color: '#c9a84f' },
  { id: 'bronze', category: 'metal', density: 8800, color: '#a9834f' },
  { id: 'copper', category: 'metal', density: 8940, color: '#c47b4c' },
  { id: 'titanium', category: 'metal', density: 4430, color: '#9c9fa6' },
  { id: 'pla', category: 'plastic', density: 1240, color: '#e9e5da' },
  { id: 'petg', category: 'plastic', density: 1270, color: '#a3c6da' },
  { id: 'abs', category: 'plastic', density: 1040, color: '#d9d4c9' },
  { id: 'asa', category: 'plastic', density: 1070, color: '#d4cfc3' },
  { id: 'tpu', category: 'plastic', density: 1210, color: '#4d5156' },
  { id: 'pa12', category: 'plastic', density: 1010, color: '#ebe8e1' },
  { id: 'pa6', category: 'plastic', density: 1140, color: '#eee7d5' },
  { id: 'pom', category: 'plastic', density: 1410, color: '#f2f1ec' },
  { id: 'pc', category: 'plastic', density: 1200, color: '#cdd7de' },
  { id: 'pmma', category: 'plastic', density: 1190, color: '#d3e5ee' },
  { id: 'hdpe', category: 'plastic', density: 950, color: '#efefea' },
  { id: 'ptfe', category: 'plastic', density: 2200, color: '#f4f4f0' },
  { id: 'oak', category: 'wood', density: 700, color: '#b48c5e' },
  { id: 'beech', category: 'wood', density: 720, color: '#c99b6c' },
  { id: 'pine', category: 'wood', density: 520, color: '#d8b37f' },
  { id: 'birch-plywood', category: 'wood', density: 680, color: '#d9b98d' },
  { id: 'mdf', category: 'wood', density: 750, color: '#a98b69' },
];

export const MATERIAL_CATEGORIES: readonly MaterialCategory[] = ['metal', 'plastic', 'wood', 'other'];

export function materialInfo(id: string): MaterialInfo | undefined {
  return MATERIALS.find((material) => material.id === id);
}

/** The material of a part: a library material (its density can be changed) or a custom one with a name. */
export interface PartMaterial {
  /** A library id, or CUSTOM_MATERIAL. */
  id: string;
  /** kg/m³ */
  density: number;
  /** Custom materials: the name the user gave it. */
  name?: string;
}

/** Properties of the part as a whole (not features): its material and its color. */
export interface PartProperties {
  material?: PartMaterial;
  /** The color of the part in the 3D view, '#rrggbb'; without it the material's color (or the theme's). */
  color?: string;
  /** Variants of the part (src/shared/model/configurations.ts); without them the part has one. */
  configurations?: Configurations;
}

export const NO_PROPERTIES: PartProperties = {};

/** The color of a part without its own or its material's color (in 3MF files). */
export const DEFAULT_PART_COLOR = '#b7c4d6';

/** Densities ParaWerk accepts (kg/m³): from aerogels to osmium, with room on both sides. */
export const MIN_DENSITY = 0.1;
export const MAX_DENSITY = 30_000;

/** The color the part is shown in: its own, else its material's; null for the theme's default. */
export function partColor(properties: PartProperties): string | null {
  if (properties.color) return properties.color;
  const material = properties.material ? materialInfo(properties.material.id) : undefined;
  return material?.color ?? null;
}

/** Mass in kg of `volume` mm³ at `density` kg/m³. */
export function massOf(volume: number, density: number): number {
  return volume * 1e-9 * density;
}

/** Principal moments of inertia (ascending) of a symmetric tensor xx, yy, zz, xy, xz, yz (Jacobi rotations). */
export function principalMoments(tensor: readonly [number, number, number, number, number, number]): [number, number, number] {
  const [xx, yy, zz, xy, xz, yz] = tensor;
  const a = [
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz],
  ] as number[][];
  const at = (i: number, j: number) => a[i]?.[j] ?? 0;
  const set = (i: number, j: number, value: number) => {
    const row = a[i];
    if (row) row[j] = value;
  };
  const scale = Math.max(Math.abs(xx), Math.abs(yy), Math.abs(zz), 1e-300);
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(at(0, 1)) + Math.abs(at(0, 2)) + Math.abs(at(1, 2));
    if (off <= 1e-15 * scale) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const apq = at(p, q);
      if (Math.abs(apq) <= 1e-300) continue;
      const theta = (at(q, q) - at(p, p)) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = at(k, p);
        const akq = at(k, q);
        set(k, p, c * akp - s * akq);
        set(k, q, s * akp + c * akq);
      }
      for (let k = 0; k < 3; k++) {
        const apk = at(p, k);
        const aqk = at(q, k);
        set(p, k, c * apk - s * aqk);
        set(q, k, s * apk + c * aqk);
      }
    }
  }
  const moments = [at(0, 0), at(1, 1), at(2, 2)].sort((x, y) => x - y);
  return [moments[0] ?? 0, moments[1] ?? 0, moments[2] ?? 0];
}
