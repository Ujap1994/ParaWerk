/** 3MF export: a closed, outward-oriented mesh in millimeters with the part's material. */
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernel } from '../../src/kernel/create.ts';
import type { Kernel } from '../../src/kernel/kernel.ts';
import type { BoxFeature, CylinderFeature, Feature, FilletFeature } from '../../src/shared/model/feature.ts';

let kernel: Kernel;

beforeAll(async () => {
  kernel = await createKernel('parawerk');
});

afterAll(() => {
  kernel[Symbol.dispose]();
});

const box: BoxFeature = { id: 'box', type: 'box', operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
const bore: CylinderFeature = { id: 'bore', type: 'cylinder', operation: 'cut', radius: 12, height: 60, axis: 'z', position: [0, 0, -10] };
const round: FilletFeature = { id: 'round', type: 'fillet', radius: 5, edges: [{ kind: 'edge', faces: ['box:front', 'box:top'], at: [0, -30, 40] }] };

function parse(features: Feature[], material?: { name: string; color: string }) {
  const bytes = kernel.exportModel({ features, format: '3mf', title: 'Plate & bore', application: 'ParaWerk test', ...(material ? { material } : {}) });
  const files = unzipSync(bytes);
  const xml = strFromU8(files['3D/3dmodel.model'] ?? new Uint8Array());
  const vertices = [...xml.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"\/>/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);
  const triangles = [...xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);
  return { files, xml, vertices, triangles };
}

describe('3MF export', () => {
  it('writes a package with content types, relationships and a model in millimeters', () => {
    const { files, xml } = parse([box]);
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    expect(strFromU8(files['_rels/.rels'] ?? new Uint8Array())).toContain('Target="/3D/3dmodel.model"');
    expect(xml).toContain('unit="millimeter"');
    expect(xml).toContain('<metadata name="Title">Plate &amp; bore</metadata>');
    expect(xml).not.toContain('basematerials');
  });

  it('gives a closed mesh: every edge is shared by two triangles running opposite ways, and the volume is right', () => {
    const { vertices, triangles } = parse([box, bore, round]);
    const directed = new Map<string, number>();
    for (const [a, b, c] of triangles) {
      for (const [p, q] of [[a, b], [b, c], [c, a]] as const) directed.set(`${p}>${q}`, (directed.get(`${p}>${q}`) ?? 0) + 1);
    }
    for (const [edge, count] of directed) {
      const [p, q] = edge.split('>');
      expect(count).toBe(1);
      expect(directed.get(`${q}>${p}`)).toBe(1);
    }
    // Signed volume of the outward-oriented mesh (divergence theorem), close to the exact one.
    let volume = 0;
    for (const [a, b, c] of triangles) {
      const [p, q, r] = [vertices[a], vertices[b], vertices[c]];
      if (!p || !q || !r) throw new Error('bad index');
      volume += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6;
    }
    const exact = 100 * 60 * 40 - Math.PI * 144 * 40 - 25 * (1 - Math.PI / 4) * 100;
    expect(volume / exact).toBeCloseTo(1, 2);
  });

  it('names the material and its display color', () => {
    const { xml } = parse([box], { name: 'PLA', color: '#e9e5da' });
    expect(xml).toContain('<basematerials id="1">');
    expect(xml).toContain('<base name="PLA" displaycolor="#E9E5DAFF"/>');
    expect(xml).toContain('pid="1" pindex="0"');
  });
});
