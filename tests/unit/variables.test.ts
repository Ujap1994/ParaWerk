import { describe, expect, it } from 'vitest';
import { evaluate, isVariableName, variableNames } from '../../src/renderer/src/expression.ts';
import { evaluateVariables, regenerate, withEvaluatedDimensions, withEvaluatedParameters } from '../../src/renderer/src/variables.ts';
import { defaultFeature, type BoxFeature, type ExtrudeFeature, type Feature, type SketchFeature } from '../../src/shared/model/feature.ts';
import { decodePartFile, encodePartFile, formatVersionOf } from '../../src/shared/model/part-file.ts';
import { ORIGIN_ID, type SketchData } from '../../src/shared/model/sketch.ts';
import { parseFeature, ValidationError } from '../../src/shared/model/validate.ts';
import { solveSketch } from '../../src/sketch/solver/index.ts';

const solve = async (sketch: SketchData) => {
  const solution = solveSketch(sketch);
  return solution.converged && solution.unsatisfied.length === 0 ? solution.sketch : null;
};

describe('expressions with variables', () => {
  it('evaluate names case-insensitively and report the names they use', () => {
    const values = new Map([['width', 40], ['wall_2', 3]]);
    expect(evaluate('Width / 2 + wall_2', values)).toBe(23);
    expect(evaluate('width mm', values)).toBe(40);
    expect(evaluate('depth', values)).toBeNull();
    expect(variableNames('2*Width + sqrt(depth) + 3mm + pi')).toEqual(['width', 'depth']);
    expect(variableNames('2 +* 3')).toEqual([]);
    expect(variableNames('2 # 3')).toBeNull();
  });

  it('accept names that do not clash with units, functions and π', () => {
    expect(['width', 'Wall_2', '_r'].every(isVariableName)).toBe(true);
    expect(['2width', 'mm', 'In', 'sqrt', 'pi', 'a-b', ''].some(isVariableName)).toBe(false);
  });
});

describe('variables', () => {
  it('are evaluated in the order their expressions need', () => {
    const { values, errors } = evaluateVariables([
      { name: 'Total', expression: 'Width + 2 * Wall' },
      { name: 'Width', expression: '40' },
      { name: 'Wall', expression: '2,5' },
    ]);
    expect(Object.fromEntries(values)).toEqual({ total: 45, width: 40, wall: 2.5 });
    expect(errors.size).toBe(0);
  });

  it('report cycles, unknown names, syntax errors and what depends on them', () => {
    const { values, errors } = evaluateVariables([
      { name: 'a', expression: 'b + 1' },
      { name: 'b', expression: 'a * 2' },
      { name: 'c', expression: 'missing' },
      { name: 'd', expression: '2 +' },
      { name: 'e', expression: 'c * 2' },
      { name: 'f', expression: '7' },
    ]);
    expect(Object.fromEntries(errors)).toEqual({ a: 'cycle', b: 'cycle', c: 'unknown', d: 'syntax', e: 'dependency' });
    expect(Object.fromEntries(values)).toEqual({ f: 7 });
  });
});

describe('equations', () => {
  const values = new Map([['width', 80], ['hole', 6]]);

  it('set feature parameters, keeping the old value for invalid results', () => {
    const box: BoxFeature = { ...(defaultFeature('box', 'b') as BoxFeature), expressions: { width: 'width', depth: 'width / 2', height: 'width - 100' } };
    const evaluated = withEvaluatedParameters(box, values);
    expect([evaluated.width, evaluated.depth, evaluated.height]).toEqual([80, 40, box.height]);
  });

  it('set sketch dimensions, including angles typed in degrees', () => {
    const sketch: SketchData = {
      entities: [
        { id: 'p1', type: 'point', x: 0, y: 0 },
        { id: 'p2', type: 'point', x: 10, y: 0 },
        { id: 'p3', type: 'point', x: 0, y: 10 },
        { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
        { id: 'l2', type: 'line', p1: 'p1', p2: 'p3' },
      ],
      constraints: [
        { id: 'd', type: 'distance', a: 'p1', b: 'p2', value: 10, driving: true, expression: 'width / 4' },
        { id: 'w', type: 'angle', a: 'l1', b: 'l2', value: Math.PI / 2, driving: true, expression: '60' },
      ],
    };
    const evaluated = withEvaluatedDimensions(sketch, values);
    expect(evaluated.constraints.map((c) => ('value' in c ? c.value : null))).toEqual([20, expect.closeTo(Math.PI / 3, 12)]);
    expect(withEvaluatedDimensions(evaluated, values)).toBe(evaluated);
  });

  it('regenerate parameters and re-solve sketches whose dimensions change', async () => {
    const sketch: SketchFeature = {
      id: 's',
      type: 'sketch',
      plane: { kind: 'standard', plane: 'top' },
      sketch: {
        entities: [{ id: 'p1', type: 'point', x: 30, y: 0 }, { id: 'l', type: 'line', p1: ORIGIN_ID, p2: 'p1' }],
        constraints: [
          { id: 'h', type: 'horizontal', line: 'l' },
          { id: 'd', type: 'distance', a: ORIGIN_ID, b: 'p1', value: 30, driving: true, expression: 'length' },
        ],
      },
    };
    const features: Feature[] = [
      { id: 'v', type: 'variables', variables: [{ name: 'length', expression: '55' }] },
      sketch,
      { id: 'c', type: 'cylinder', operation: 'add', radius: 10, height: 20, axis: 'z', position: [0, 0, 0], expressions: { height: 'length + 5' } },
    ];
    const { features: result, failed } = await regenerate(features, solve);
    expect(failed).toEqual([]);
    const point = (result[1] as SketchFeature).sketch.entities.find((e) => e.id === 'p1');
    expect(point).toMatchObject({ x: expect.closeTo(55, 6), y: expect.closeTo(0, 6) });
    expect(result[2]).toMatchObject({ height: 60 });
    // Nothing changes when the variables already match.
    const again = await regenerate(result, solve);
    expect(again.features[1]).toBe(result[1]);
  });
});

describe('file format', () => {
  it('validates variables and expressions', () => {
    expect(parseFeature({ id: 'v', type: 'variables', variables: [{ name: 'a', expression: '1' }] })).toEqual({ id: 'v', type: 'variables', variables: [{ name: 'a', expression: '1' }] });
    const bad = (raw: unknown, message: string) => {
      expect(() => parseFeature(raw)).toThrow(ValidationError);
      expect(() => parseFeature(raw)).toThrow(message);
    };
    bad({ id: 'v', type: 'variables', variables: [{ name: '1a', expression: '1' }] }, 'variable name');
    bad({ id: 'v', type: 'variables', variables: [{ name: 'a', expression: '1' }, { name: 'A', expression: '2' }] }, 'duplicate variable');
    bad({ id: 'v', type: 'variables', variables: [{ name: 'a', expression: '' }] }, 'expected an expression');
    bad({ ...defaultFeature('box', 'b'), expressions: { operation: 'x' } }, 'no expression allowed');
  });

  it('uses version 3 only when the document needs it', () => {
    const box = defaultFeature('box', 'b');
    expect(formatVersionOf([box])).toBe(1);
    expect(formatVersionOf([defaultFeature('sketch', 's'), box])).toBe(2);
    expect(formatVersionOf([{ ...box, expressions: { width: 'a' } }])).toBe(3);
    expect(formatVersionOf([defaultFeature('sketch', 's'), { ...(defaultFeature('extrude', 'e') as ExtrudeFeature), sketch: 's' }])).toBe(4);
    const features: Feature[] = [{ id: 'v', type: 'variables', variables: [{ name: 'a', expression: '12' }] }, { ...box, expressions: { width: 'a * 2' } } as Feature];
    const bytes = encodePartFile({ units: 'mm', features }, { appVersion: '1', savedAt: '' });
    expect(decodePartFile(bytes).document.features).toEqual(features);
  });
});

describe('pattern counts from equations', () => {
  it('rounds to a whole number of at least 2', async () => {
    const { withEvaluatedParameters } = await import('../../src/renderer/src/variables.ts');
    const pattern = { id: 'p', type: 'pattern' as const, method: 'linear' as const, references: [], features: [], count: 3, spacing: 10, angle: 360, flip: false, expressions: { count: 'length / 10' } };
    expect(withEvaluatedParameters(pattern, new Map([['length', 47]])).count).toBe(5);
    expect(withEvaluatedParameters(pattern, new Map([['length', 5]])).count).toBe(3);
  });
});
