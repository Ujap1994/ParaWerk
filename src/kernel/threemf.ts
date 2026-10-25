/**
 * 3MF (3D Manufacturing Format) export: a ZIP package with one mesh object in millimeters, the format
 * slicers for 3D printing read best. Unlike STL the mesh must be closed and oriented, so the vertices
 * that neighboring faces share are joined first.
 */

import { strToU8, zipSync } from 'fflate';

export interface ThreeMfOptions {
  /** Name of the part (title and object name). */
  title: string;
  /** e.g. "ParaWerk 0.2.0" */
  application: string;
  /** The part's material and its display color ('#rrggbb'), if it has them. */
  material?: { name: string; color: string };
}

/**
 * Joins vertices at the same position into one (the faces of a body share the points of their edges)
 * and drops triangles that collapse doing so: the result is a closed mesh where each edge belongs to
 * two triangles.
 */
export function weldVertices(positions: Float32Array, indices: Uint32Array): { positions: Float32Array; indices: Uint32Array } {
  const map = new Map<string, number>();
  const remap = new Uint32Array(positions.length / 3);
  const welded: number[] = [];
  for (let v = 0; v < remap.length; v++) {
    const x = positions[3 * v] ?? 0;
    const y = positions[3 * v + 1] ?? 0;
    const z = positions[3 * v + 2] ?? 0;
    const key = `${x},${y},${z}`;
    let index = map.get(key);
    if (index === undefined) {
      index = welded.length / 3;
      map.set(key, index);
      welded.push(x, y, z);
    }
    remap[v] = index;
  }
  const triangles: number[] = [];
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = remap[indices[t] ?? 0] ?? 0;
    const b = remap[indices[t + 1] ?? 0] ?? 0;
    const c = remap[indices[t + 2] ?? 0] ?? 0;
    if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
  }
  return { positions: new Float32Array(welded), indices: new Uint32Array(triangles) };
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}

/** Coordinates with at most 6 decimals (a nanometer), without float32 noise like 12.300000190734863. */
const coordinate = (value: number) => String(Math.round(value * 1e6) / 1e6 + 0);

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

/** The 3D model part of the package (3D/3dmodel.model). */
export function threeMfModel(positions: Float32Array, indices: Uint32Array, options: ThreeMfOptions): string {
  const mesh = weldVertices(positions, indices);
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    `  <metadata name="Title">${escapeXml(options.title)}</metadata>`,
    `  <metadata name="Application">${escapeXml(options.application)}</metadata>`,
    '  <resources>',
  ];
  const material = options.material;
  if (material) {
    lines.push(`    <basematerials id="1">`, `      <base name="${escapeXml(material.name)}" displaycolor="${escapeXml(material.color.toUpperCase())}FF"/>`, '    </basematerials>');
  }
  lines.push(`    <object id="2" type="model" name="${escapeXml(options.title)}"${material ? ' pid="1" pindex="0"' : ''}>`, '      <mesh>', '        <vertices>');
  for (let v = 0; v < mesh.positions.length; v += 3) {
    lines.push(`          <vertex x="${coordinate(mesh.positions[v] ?? 0)}" y="${coordinate(mesh.positions[v + 1] ?? 0)}" z="${coordinate(mesh.positions[v + 2] ?? 0)}"/>`);
  }
  lines.push('        </vertices>', '        <triangles>');
  for (let t = 0; t < mesh.indices.length; t += 3) {
    lines.push(`          <triangle v1="${mesh.indices[t]}" v2="${mesh.indices[t + 1]}" v3="${mesh.indices[t + 2]}"/>`);
  }
  lines.push('        </triangles>', '      </mesh>', '    </object>', '  </resources>', '  <build>', '    <item objectid="2"/>', '  </build>', '</model>', '');
  return lines.join('\n');
}

/** A complete .3mf package. */
export function writeThreeMf(positions: Float32Array, indices: Uint32Array, options: ThreeMfOptions): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(RELATIONSHIPS),
      '3D/3dmodel.model': strToU8(threeMfModel(positions, indices, options)),
    },
    { level: 6 },
  );
}
