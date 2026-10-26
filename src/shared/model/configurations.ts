/**
 * Configurations: variants of one part in one file – a screw in several lengths, a bracket with and
 * without a hole. Each configuration remembers the expressions of the part's variables and which
 * features are suppressed; the part shows the active one. A design table lists the variables of all
 * configurations side by side.
 *
 * Switching takes over what the part looks like now into the active configuration first, so changes
 * made while it is active belong to it, then applies the other one.
 */

import type { Feature, VariablesFeature } from './feature.ts';

export interface Configuration {
  id: string;
  name: string;
  /** The expression of each variable, by its name. */
  variables: Record<string, string>;
  /** Ids of the features suppressed in this configuration. */
  suppressed: string[];
}

export interface Configurations {
  /** The id of the configuration the part shows. */
  active: string;
  list: Configuration[];
}

export const MAX_CONFIGURATIONS = 500;
export const MAX_CONFIGURATION_NAME = 80;

function variablesOf(features: readonly Feature[]): VariablesFeature | undefined {
  return features.find((feature): feature is VariablesFeature => feature.type === 'variables');
}

/** What the part looks like now, as the content of a configuration. */
export function captureConfiguration(features: readonly Feature[]): Pick<Configuration, 'variables' | 'suppressed'> {
  const variables = Object.fromEntries((variablesOf(features)?.variables ?? []).map((variable) => [variable.name, variable.expression]));
  return { variables, suppressed: features.filter((feature) => feature.suppressed).map((feature) => feature.id) };
}

/** The value of a variable in a configuration (names match without regard to case). */
export function configurationValue(configuration: Configuration, name: string): string | undefined {
  const key = Object.keys(configuration.variables).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : configuration.variables[key];
}

/**
 * The features with a configuration's variable expressions and suppression applied. Variables the
 * configuration does not know keep their expression; the caller evaluates the expressions again.
 */
export function applyConfiguration(features: readonly Feature[], configuration: Configuration): Feature[] {
  const suppressed = new Set(configuration.suppressed);
  return features.map((feature): Feature => {
    if (feature.type === 'variables') {
      return { ...feature, variables: feature.variables.map((variable) => ({ ...variable, expression: configurationValue(configuration, variable.name) ?? variable.expression })) };
    }
    const off = suppressed.has(feature.id);
    if (Boolean(feature.suppressed) === off) return feature;
    if (off) return { ...feature, suppressed: true };
    const { suppressed: _suppressed, ...rest } = feature;
    return rest as Feature;
  });
}

/** The configurations with the active one taking over what the part looks like now. */
export function withCurrentState(features: readonly Feature[], configurations: Configurations): Configurations {
  const current = captureConfiguration(features);
  return { ...configurations, list: configurations.list.map((configuration) => (configuration.id === configurations.active ? { ...configuration, ...current } : configuration)) };
}

/** Switches to configuration `id`; null when there is no such configuration. */
export function switchConfiguration(features: readonly Feature[], configurations: Configurations, id: string): { features: Feature[]; configurations: Configurations } | null {
  const saved = withCurrentState(features, configurations);
  const target = saved.list.find((configuration) => configuration.id === id);
  if (!target) return null;
  return { features: applyConfiguration(features, target), configurations: { ...saved, active: id } };
}

/**
 * Adds a configuration as a copy of what the part looks like now and makes it the active one. The first
 * configuration of a part also keeps the state before as `defaultName`.
 */
export function addConfiguration(features: readonly Feature[], configurations: Configurations | undefined, configuration: { id: string; name: string }, first: { id: string; name: string }): Configurations {
  const current = captureConfiguration(features);
  const base = configurations ? withCurrentState(features, configurations) : { active: first.id, list: [{ ...first, ...current }] };
  return { active: configuration.id, list: [...base.list, { ...configuration, ...current }] };
}

/** A name for a new configuration that no other one has: "Configuration 1", "Configuration 2", ... */
export function freeConfigurationName(configurations: Configurations | undefined, prefix: string): string {
  const taken = new Set((configurations?.list ?? []).map((configuration) => configuration.name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = `${prefix} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}
