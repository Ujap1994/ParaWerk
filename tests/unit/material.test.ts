/** Material library, mass, principal moments, and material and color in part files and the undo history. */
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { commit, emptyHistory, redo, undo } from '../../src/renderer/src/state/document.ts';
import { defaultFeature } from '../../src/shared/model/feature.ts';
import { CUSTOM_MATERIAL, massOf, MATERIALS, materialInfo, NO_PROPERTIES, partColor, principalMoments } from '../../src/shared/model/material.ts';
import { decodePartFile, encodePartFile, formatVersionOf, PartFileError } from '../../src/shared/model/part-file.ts';
import { parsePartProperties } from '../../src/shared/model/validate.ts';
import en from '../../src/shared/locales/en.json';
import de from '../../src/shared/locales/de.json';

const meta = { appVersion: 'test', savedAt: '2026-10-25T00:00:00Z' };

describe('material library', () => {
  it('has unique ids, plausible densities and names in both languages', () => {
    expect(new Set(MATERIALS.map((material) => material.id)).size).toBe(MATERIALS.length);
    for (const material of MATERIALS) {
      expect(material.density).toBeGreaterThan(400);
      expect(material.density).toBeLessThan(10_000);
      expect(material.color).toMatch(/^#[0-9a-f]{6}$/);
      // Ids are i18n keys: no dots.
      expect(material.id).not.toContain('.');
      expect((en.material.names as Record<string, string>)[material.id]).toBeTruthy();
      expect((de.material.names as Record<string, string>)[material.id]).toBeTruthy();
    }
    expect(materialInfo(CUSTOM_MATERIAL)).toBeUndefined();
  });

  it('computes the mass and the color', () => {
    expect(massOf(240_000, 7850)).toBeCloseTo(1.884, 9);
    expect(partColor(NO_PROPERTIES)).toBeNull();
    expect(partColor({ material: { id: 'brass', density: 8470 } })).toBe(materialInfo('brass')?.color);
    expect(partColor({ material: { id: 'brass', density: 8470 }, color: '#123456' })).toBe('#123456');
    expect(partColor({ material: { id: CUSTOM_MATERIAL, density: 1000, name: 'Resin' } })).toBeNull();
  });

  it('finds the principal moments of a turned tensor', () => {
    // diag(1, 2, 3) turned by 30° about z.
    const [c, s] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    const xx = c * c * 1 + s * s * 2;
    const yy = s * s * 1 + c * c * 2;
    const xy = c * s * (2 - 1);
    const moments = principalMoments([xx, yy, 3, xy, 0, 0]);
    expect(moments[0]).toBeCloseTo(1, 12);
    expect(moments[1]).toBeCloseTo(2, 12);
    expect(moments[2]).toBeCloseTo(3, 12);
    expect(principalMoments([5, 5, 5, 0, 0, 0])).toEqual([5, 5, 5]);
  });
});

describe('material in part files', () => {
  const box = defaultFeature('box', 'box');

  it('saves material and color as format version 7, and leaves them out when there are none', () => {
    const properties = { material: { id: 'aluminium-6061', density: 2700 }, color: '#d64545' };
    expect(formatVersionOf([box])).toBe(1);
    expect(formatVersionOf([box], properties)).toBe(7);
    const { document } = decodePartFile(encodePartFile({ units: 'mm', features: [box], properties }, meta));
    expect(document.properties).toEqual(properties);
    const plain = decodePartFile(encodePartFile({ units: 'mm', features: [box] }, meta));
    expect(plain.document.properties).toEqual(NO_PROPERTIES);
  });

  it('rejects unknown materials, impossible densities and bad colors', () => {
    expect(parsePartProperties(undefined)).toBe(NO_PROPERTIES);
    expect(parsePartProperties({ material: { id: 'custom', density: 1000, name: 'Resin' }, color: '#AABBCC' })).toEqual({
      material: { id: 'custom', density: 1000, name: 'Resin' },
      color: '#aabbcc',
    });
    expect(() => parsePartProperties({ material: { id: 'unobtainium', density: 1000 } })).toThrow(/material/);
    expect(() => parsePartProperties({ material: { id: 'pla', density: -1 } })).toThrow(/density/);
    expect(() => parsePartProperties({ material: { id: 'pla', density: 1e9 } })).toThrow(/density/);
    expect(() => parsePartProperties({ color: 'red' })).toThrow(/color/);
    const bytes = encodePartFile({ units: 'mm', features: [box], properties: { color: 'red' } }, meta);
    expect(() => decodePartFile(bytes)).toThrow(PartFileError);
  });
});

describe('material in the undo history', () => {
  it('undoes and redoes material changes together with features', () => {
    const box = defaultFeature('box', 'box');
    let history = commit(emptyHistory(), [box]);
    history = commit(history, history.features, { material: { id: 'pla', density: 1240 } });
    expect(history.features).toEqual([box]);
    history = undo(history);
    expect(history.properties).toEqual(NO_PROPERTIES);
    expect(history.features).toEqual([box]);
    history = redo(history);
    expect(history.properties).toEqual({ material: { id: 'pla', density: 1240 } });
    // A feature change keeps the material.
    history = commit(history, [box, defaultFeature('cylinder', 'cyl')]);
    expect(history.properties).toEqual({ material: { id: 'pla', density: 1240 } });
  });
});

describe('imported files in part files', () => {
  it('keeps the STEP file as its own entry and brings it back', () => {
    const data = 'ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n';
    const feature = { id: 'imp', type: 'import' as const, operation: 'add' as const, file: 'bracket.step', hash: 'abc', data };
    const bytes = encodePartFile({ units: 'mm', features: [feature] }, meta);
    const files = unzipSync(bytes);
    expect(strFromU8(files['imports/imp.step'] ?? new Uint8Array())).toBe(data);
    // The document itself stays small: the file is not in it.
    expect(strFromU8(files['document.json'] ?? new Uint8Array())).not.toContain('ISO-10303-21');
    expect(formatVersionOf([feature])).toBe(7);
    expect(decodePartFile(bytes).document.features).toEqual([feature]);
  });

  it('rejects an import whose file entry is missing', () => {
    const feature = { id: 'imp', type: 'import' as const, operation: 'add' as const, file: 'bracket.step', hash: 'abc', data: 'ISO-10303-21;' };
    const files = unzipSync(encodePartFile({ units: 'mm', features: [feature] }, meta));
    delete files['imports/imp.step'];
    expect(() => decodePartFile(zipSync(files))).toThrow(PartFileError);
  });
});
