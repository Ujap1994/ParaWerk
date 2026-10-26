import { describe, expect, it } from 'vitest';
import { evaluate, isVariableName, variableNames } from '../../src/renderer/src/expression.ts';

describe('expressions', () => {
  it('rounds and takes the smaller or larger of values', () => {
    expect(evaluate('round(2.5)')).toBe(3);
    expect(evaluate('floor(7 / 2)')).toBe(3);
    expect(evaluate('ceil(7 / 2)')).toBe(4);
    expect(evaluate('min(4; 2; 9)')).toBe(2);
    expect(evaluate('max(4, 2, 9)')).toBe(9);
    // A comma between digits stays a decimal separator.
    expect(evaluate('max(2,5; 2)')).toBe(2.5);
    expect(evaluate('min(1)')).toBe(1);
  });

  it('computes inverse trigonometric functions in degrees', () => {
    expect(evaluate('asin(0.5)')).toBeCloseTo(30, 12);
    expect(evaluate('acos(0)')).toBeCloseTo(90, 12);
    expect(evaluate('atan(1)')).toBeCloseTo(45, 12);
  });

  it('chooses with if() and comparisons', () => {
    const values = new Map([['length', 40]]);
    expect(evaluate('if(length > 30; 8; 5)', values)).toBe(8);
    expect(evaluate('if(length <= 30; 8; 5)', values)).toBe(5);
    expect(evaluate('if(length = 40; 1; 0)', values)).toBe(1);
    expect(evaluate('if(length <> 40; 1; 0)', values)).toBe(0);
    expect(evaluate('if(length ≥ 40; 2 mm; 1 cm)', values)).toBe(2);
    // A plain number as a condition: anything but 0 is true.
    expect(evaluate('if(0; 1; 2)')).toBe(2);
  });

  it('rejects wrong argument counts and comparisons outside conditions', () => {
    expect(evaluate('round(1; 2)')).toBeNull();
    expect(evaluate('if(1; 2)')).toBeNull();
    expect(evaluate('min()')).toBeNull();
    expect(evaluate('3 > 2')).toBeNull();
  });

  it('keeps the new function names away from variables', () => {
    for (const name of ['min', 'max', 'round', 'if', 'floor', 'ceil', 'atan']) expect(isVariableName(name)).toBe(false);
    expect(variableNames('if(a > b; max(a; c); 0)')?.sort()).toEqual(['a', 'b', 'c']);
  });
});
