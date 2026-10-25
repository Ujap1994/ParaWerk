/**
 * The part's global variables and the equations that use them: variables are evaluated in the order
 * their expressions need (cycles and unknown names are reported per variable), and features and
 * sketch dimensions given as expressions take the new values; changed sketches are solved again.
 */

import { EXPRESSION_FIELDS, type Feature, type Variable, type VariablesFeature } from '../../shared/model/feature.ts';
import { isDimension, type SketchData } from '../../shared/model/sketch.ts';
import { evaluate, variableNames } from './expression.ts';
import { storedAngle } from './sketch/dimensions.ts';

export type VariableError = 'syntax' | 'unknown' | 'cycle' | 'dependency';

export interface VariableValues {
  /** Values by lower-case name. */
  values: Map<string, number>;
  /** Variables that have no value, by lower-case name. */
  errors: Map<string, VariableError>;
}

/** The part's variables feature, if it has one. */
export function variablesFeature(features: readonly Feature[]): VariablesFeature | undefined {
  return features.find((feature): feature is VariablesFeature => feature.type === 'variables');
}

export function evaluateVariables(variables: readonly Variable[]): VariableValues {
  const byName = new Map(variables.map((variable) => [variable.name.toLowerCase(), variable]));
  const values = new Map<string, number>();
  const errors = new Map<string, VariableError>();
  const visiting: string[] = [];

  const resolve = (name: string): boolean => {
    if (values.has(name)) return true;
    if (errors.has(name)) return false;
    const variable = byName.get(name);
    if (!variable) return false;
    const cycleStart = visiting.indexOf(name);
    if (cycleStart >= 0) {
      for (const member of visiting.slice(cycleStart)) errors.set(member, 'cycle');
      return false;
    }
    const names = variableNames(variable.expression);
    if (!names) {
      errors.set(name, 'syntax');
      return false;
    }
    visiting.push(name);
    let ok = true;
    for (const dependency of names) {
      if (!byName.has(dependency)) {
        if (!errors.has(name)) errors.set(name, 'unknown');
        ok = false;
      } else if (!resolve(dependency)) {
        if (!errors.has(name)) errors.set(name, 'dependency');
        ok = false;
      }
    }
    visiting.pop();
    if (!ok || errors.has(name)) return false;
    const value = evaluate(variable.expression, values);
    if (value === null) {
      errors.set(name, 'syntax');
      return false;
    }
    values.set(name, value);
    return true;
  };
  for (const name of byName.keys()) resolve(name);
  return { values, errors };
}

/** Values of the variables of a feature list. */
export function variableValues(features: readonly Feature[]): Map<string, number> {
  return evaluateVariables(variablesFeature(features)?.variables ?? []).values;
}

/** A feature with its parameter expressions evaluated (invalid or non-positive results keep the old value). */
export function withEvaluatedParameters<F extends Feature>(feature: F, values: ReadonlyMap<string, number>): F {
  const expressions = feature.expressions;
  if (!expressions) return feature;
  const allowed = EXPRESSION_FIELDS[feature.type];
  let next = feature;
  for (const [field, text] of Object.entries(expressions)) {
    if (!allowed.includes(field)) continue;
    const value = evaluate(text, values);
    const current = (feature as unknown as Record<string, unknown>)[field];
    if (value === null || !(value > 0) || current === value) continue;
    next = { ...next, [field]: value };
  }
  return next;
}

/** A sketch with its dimension expressions evaluated, or the sketch itself if nothing changes. */
export function withEvaluatedDimensions(sketch: SketchData, values: ReadonlyMap<string, number>): SketchData {
  let changed = false;
  const constraints = sketch.constraints.map((constraint) => {
    if (!isDimension(constraint) || constraint.expression === undefined) return constraint;
    let value = evaluate(constraint.expression, values);
    if (value === null) return constraint;
    // Angles are typed in degrees as seen in the sketch and stored as the solver's signed angle.
    if (constraint.type === 'angle') {
      if (!(value > 0 && value < 180)) return constraint;
      value = storedAngle(sketch, constraint, (value * Math.PI) / 180);
    }
    if (Math.abs(value - constraint.value) <= 1e-12 * Math.max(1, Math.abs(value))) return constraint;
    if (constraint.type !== 'angle' && value < 0) return constraint;
    changed = true;
    return { ...constraint, value };
  });
  return changed ? { ...sketch, constraints } : sketch;
}

/**
 * The features with every expression evaluated against the current variables. Sketches whose
 * dimensions change are solved again with `solve`; a sketch that cannot be solved keeps its previous
 * state and is reported in `failed`.
 */
export async function regenerate(
  features: readonly Feature[],
  solve: (sketch: SketchData) => Promise<SketchData | null>,
): Promise<{ features: Feature[]; failed: string[] }> {
  const values = variableValues(features);
  const failed: string[] = [];
  const result: Feature[] = [];
  for (const feature of features) {
    let next = withEvaluatedParameters(feature, values);
    if (next.type === 'sketch') {
      const sketch = withEvaluatedDimensions(next.sketch, values);
      if (sketch !== next.sketch) {
        const solved = await solve(sketch);
        if (solved) next = { ...next, sketch: solved };
        else failed.push(next.id);
      }
    }
    result.push(next);
  }
  return { features: result, failed };
}
