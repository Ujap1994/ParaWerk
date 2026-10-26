import { describe, expect, it } from 'vitest';
import { addConfiguration, applyConfiguration, captureConfiguration, freeConfigurationName, switchConfiguration, type Configurations } from '../../src/shared/model/configurations.ts';
import type { Feature } from '../../src/shared/model/feature.ts';
import { decodePartFile, encodePartFile, formatVersionOf } from '../../src/shared/model/part-file.ts';
import { parsePartProperties } from '../../src/shared/model/validate.ts';

const features: Feature[] = [
  { id: 'vars', type: 'variables', variables: [{ name: 'length', expression: '20' }, { name: 'width', expression: 'length / 2' }] },
  { id: 'box', type: 'box', operation: 'add', width: 10, depth: 10, height: 20, position: [0, 0, 0], expressions: { height: 'length' } },
  { id: 'hole', type: 'cylinder', operation: 'cut', radius: 2, height: 30, axis: 'z', position: [0, 0, -5] },
];
const expressionOf = (list: Feature[], name: string) => (list[0]?.type === 'variables' ? list[0].variables.find((variable) => variable.name === name)?.expression : undefined);

describe('configurations', () => {
  it('captures the variables and the suppressed features of the part', () => {
    expect(captureConfiguration([...features.slice(0, 2), { ...(features[2] as Feature), suppressed: true }])).toEqual({ variables: { length: '20', width: 'length / 2' }, suppressed: ['hole'] });
  });

  it('adds a copy of the current state and keeps the state before as the first one', () => {
    const configurations = addConfiguration(features, undefined, { id: 'long', name: 'Long' }, { id: 'default', name: 'Default' });
    expect(configurations.active).toBe('long');
    expect(configurations.list.map((configuration) => configuration.name)).toEqual(['Default', 'Long']);
    expect(configurations.list[1]?.variables).toEqual({ length: '20', width: 'length / 2' });
  });

  it('switches: the active one takes over the current state, the other one is applied', () => {
    const start: Configurations = {
      active: 'short',
      list: [
        { id: 'short', name: 'Short', variables: { length: '20', width: 'length / 2' }, suppressed: [] },
        { id: 'long', name: 'Long', variables: { LENGTH: '50' }, suppressed: ['hole'] },
      ],
    };
    // While Short was active, the length became 25: switching away keeps that in Short.
    const edited = applyConfiguration(features, { id: 'x', name: 'x', variables: { length: '25' }, suppressed: [] });
    const switched = switchConfiguration(edited, start, 'long');
    expect(switched?.configurations.active).toBe('long');
    expect(switched?.configurations.list[0]?.variables.length).toBe('25');
    // Long's length applies (names match without regard to case), its width is not set and stays.
    expect(expressionOf(switched?.features ?? [], 'length')).toBe('50');
    expect(expressionOf(switched?.features ?? [], 'width')).toBe('length / 2');
    expect(switched?.features[2]?.suppressed).toBe(true);
    // And back: the hole comes back.
    const back = switchConfiguration(switched?.features ?? [], switched?.configurations as Configurations, 'short');
    expect(back?.features[2]?.suppressed).toBeUndefined();
    expect(expressionOf(back?.features ?? [], 'length')).toBe('25');
    expect(switchConfiguration(features, start, 'nothing')).toBeNull();
  });

  it('finds a free name', () => {
    const configurations = addConfiguration(features, undefined, { id: 'b', name: 'Configuration 1' }, { id: 'a', name: 'Default' });
    expect(freeConfigurationName(configurations, 'Configuration')).toBe('Configuration 2');
    expect(freeConfigurationName(undefined, 'Configuration')).toBe('Configuration 1');
  });

  it('is saved in part files of format version 8 and checked when read', () => {
    const configurations = addConfiguration(features, undefined, { id: 'long', name: 'Long' }, { id: 'default', name: 'Default' });
    expect(formatVersionOf(features, { configurations })).toBe(8);
    const bytes = encodePartFile({ units: 'mm', features, properties: { configurations } }, { appVersion: '1', savedAt: '' });
    expect(decodePartFile(bytes).document.properties?.configurations).toEqual(configurations);
    expect(() => parsePartProperties({ configurations: { active: 'x', list: configurations.list } })).toThrow('active');
    expect(() => parsePartProperties({ configurations: { active: 'long', list: [...configurations.list, { ...configurations.list[0], id: 'other' }] } })).toThrow('name');
    expect(() => parsePartProperties({ configurations: { active: 'long', list: [] } })).toThrow('configurations');
  });
});
