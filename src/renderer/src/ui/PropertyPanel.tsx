import { useTranslation } from 'react-i18next';
import type { Axis, BooleanOperation, EdgeFeature, ExtrudeDirection, ExtrudeEnd, Feature, Vec3 } from '../../../shared/model/feature.ts';
import { resolveEdgeRefs } from '../../../shared/model/naming.ts';
import * as commands from '../commands.ts';
import { hasBodyBefore } from '../state/document.ts';
import { useAppState } from '../state/store.ts';
import { useFeatureName } from './FeatureTree.tsx';
import { CheckIcon, CloseIcon, FEATURE_ICONS } from './icons.tsx';
import { NumberField } from './NumberField.tsx';
import { VariablesEditor, variablesValid } from './VariablesPanel.tsx';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="panel-section">
      <legend className="panel-section-title">{title}</legend>
      {children}
    </fieldset>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            className={`segmented-option${value === option.value ? ' is-selected' : ''}`}
            disabled={disabled && value !== option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function PositionFields({ value, onChange }: { value: Vec3; onChange(value: Vec3): void }) {
  return (
    <div className="field-row">
      {(['X', 'Y', 'Z'] as const).map((axis, i) => (
        <NumberField
          key={axis}
          label={axis}
          signed
          value={value[i] as number}
          testId={`position-${axis.toLowerCase()}`}
          onChange={(next) => {
            const updated: Vec3 = [...value];
            updated[i] = next;
            onChange(updated);
          }}
        />
      ))}
    </div>
  );
}

function OperationField({ value, firstFeature }: { value: BooleanOperation; firstFeature: boolean }) {
  const { t } = useTranslation();
  return (
    <Segmented
      label={t('panel.operation')}
      value={value}
      disabled={firstFeature}
      options={[
        { value: 'add', label: t('panel.add') },
        { value: 'cut', label: t('panel.cut') },
      ]}
      onChange={(operation) => commands.updateDraft({ operation })}
    />
  );
}

/** The sketches before the feature, to choose the one an extrusion uses. */
function SketchField({ value, index }: { value: string; index: number }) {
  const { t } = useTranslation();
  const features = useAppState((state) => state.history.features);
  const nameOf = useFeatureName();
  const sketches = features.slice(0, index).flatMap((feature, i) => (feature.type === 'sketch' ? [{ id: feature.id, name: nameOf(features, i) }] : []));
  return (
    <label className="field">
      <span className="field-label">{t('panel.sketch')}</span>
      <select className="field-select" value={value} data-testid="feature-sketch" onChange={(event) => commands.chooseFeatureSketch(event.target.value)}>
        {sketches.some((sketch) => sketch.id === value) ? null : <option value={value}>{t('panel.noSketch')}</option>}
        {sketches.map((sketch) => (
          <option key={sketch.id} value={sketch.id}>
            {sketch.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The lines of the revolution's sketch, to choose the axis: centerlines first, numbered as they were drawn. */
function AxisField({ sketch, value }: { sketch: string; value: string }) {
  const { t } = useTranslation();
  const data = useAppState((state) => state.history.features.find((feature) => feature.type === 'sketch' && feature.id === sketch));
  const lines = data?.type === 'sketch' ? data.sketch.entities.filter((entity) => entity.type === 'line') : [];
  const centerlines = lines.filter((line) => line.construction);
  const others = lines.filter((line) => !line.construction);
  const options = [
    ...centerlines.map((line, i) => ({ id: line.id, label: t('panel.centerline', { n: i + 1 }) })),
    ...others.map((line, i) => ({ id: line.id, label: t('panel.line', { n: i + 1 }) })),
  ];
  return (
    <label className="field">
      <span className="field-label">{t('panel.axis')}</span>
      <select className="field-select" value={value} data-testid="revolve-axis" onChange={(event) => commands.updateDraft({ axis: event.target.value })}>
        {options.some((option) => option.id === value) ? null : <option value={value}>{t('panel.noAxis')}</option>}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FeatureFields({ draft, index }: { draft: Feature; index: number }) {
  const { t } = useTranslation();
  const features = useAppState((state) => state.history.features);
  const firstFeature = !hasBodyBefore(features, index);

  switch (draft.type) {
    case 'extrude':
      return (
        <Section title={t('panel.parameters')}>
          <SketchField value={draft.sketch} index={index} />
          <OperationField value={draft.operation} firstFeature={firstFeature} />
          <Segmented<ExtrudeEnd>
            label={t('panel.end')}
            value={draft.end ?? 'blind'}
            disabled={firstFeature}
            options={[
              { value: 'blind', label: t('panel.endBlind') },
              { value: 'throughAll', label: t('panel.endThroughAll') },
            ]}
            onChange={(end) => commands.updateDraft({ end })}
          />
          {draft.end === 'throughAll' ? null : (
            <NumberField label={t('panel.extrudeDepth')} value={draft.depth} testId="extrude-depth" {...equation(draft, 'depth')} onChange={(depth) => commands.updateDraft({ depth })} />
          )}
          <Segmented<ExtrudeDirection>
            label={t('panel.direction')}
            value={draft.direction}
            options={[
              { value: 'normal', label: t('panel.directionNormal') },
              { value: 'reverse', label: t('panel.directionReverse') },
              { value: 'both', label: t('panel.directionBoth') },
            ]}
            onChange={(direction) => commands.updateDraft({ direction })}
          />
          <p className="panel-hint">{t('panel.extrudeHint')}</p>
        </Section>
      );
    case 'revolve':
      return (
        <Section title={t('panel.parameters')}>
          <SketchField value={draft.sketch} index={index} />
          <AxisField sketch={draft.sketch} value={draft.axis} />
          <OperationField value={draft.operation} firstFeature={firstFeature} />
          <NumberField label={t('panel.angle')} unit="°" step={15} value={draft.angle} testId="revolve-angle" {...equation(draft, 'angle')} onChange={(angle) => commands.updateDraft({ angle })} />
          <Segmented<ExtrudeDirection>
            label={t('panel.direction')}
            value={draft.direction}
            options={[
              { value: 'normal', label: t('panel.directionNormal') },
              { value: 'reverse', label: t('panel.directionReverse') },
              { value: 'both', label: t('panel.directionSymmetric') },
            ]}
            onChange={(direction) => commands.updateDraft({ direction })}
          />
          <p className="panel-hint">{t('panel.revolveHint')}</p>
        </Section>
      );
    case 'box':
      return (
        <>
          <Section title={t('panel.parameters')}>
            <OperationField value={draft.operation} firstFeature={firstFeature} />
            <NumberField label={t('panel.width')} value={draft.width} testId="box-width" {...equation(draft, 'width')} onChange={(width) => commands.updateDraft({ width })} />
            <NumberField label={t('panel.depth')} value={draft.depth} testId="box-depth" {...equation(draft, 'depth')} onChange={(depth) => commands.updateDraft({ depth })} />
            <NumberField label={t('panel.height')} value={draft.height} testId="box-height" {...equation(draft, 'height')} onChange={(height) => commands.updateDraft({ height })} />
          </Section>
          <Section title={t('panel.position')}>
            <PositionFields value={draft.position} onChange={(position) => commands.updateDraft({ position })} />
          </Section>
        </>
      );
    case 'cylinder':
      return (
        <>
          <Section title={t('panel.parameters')}>
            <OperationField value={draft.operation} firstFeature={firstFeature} />
            <NumberField label={t('panel.radius')} value={draft.radius} testId="cylinder-radius" {...equation(draft, 'radius')} onChange={(radius) => commands.updateDraft({ radius })} />
            <NumberField label={t('panel.height')} value={draft.height} testId="cylinder-height" {...equation(draft, 'height')} onChange={(height) => commands.updateDraft({ height })} />
            <Segmented<Axis>
              label={t('panel.axis')}
              value={draft.axis}
              options={[
                { value: 'x', label: 'X' },
                { value: 'y', label: 'Y' },
                { value: 'z', label: 'Z' },
              ]}
              onChange={(axis) => commands.updateDraft({ axis })}
            />
          </Section>
          <Section title={t('panel.position')}>
            <PositionFields value={draft.position} onChange={(position) => commands.updateDraft({ position })} />
          </Section>
        </>
      );
    case 'sketch':
      // Sketches are edited in sketch mode, not in the property panel.
      return null;
    case 'variables':
      return <VariablesEditor draft={draft} />;
    case 'fillet':
    case 'chamfer':
      return (
        <>
          <Section title={t('panel.parameters')}>
            {draft.type === 'fillet' ? (
              <NumberField label={t('panel.radius')} value={draft.radius} testId="fillet-radius" {...equation(draft, 'radius')} step={0.5} onChange={(radius) => commands.updateDraft({ radius })} />
            ) : (
              <NumberField label={t('panel.distance')} value={draft.distance} testId="chamfer-distance" {...equation(draft, 'distance')} step={0.5} onChange={(distance) => commands.updateDraft({ distance })} />
            )}
          </Section>
          <Section title={t('panel.edges')}>
            <div className="edge-summary">
              <span data-testid="edge-count">{t('panel.edgesCount', { count: draft.edges.length })}</span>
              <button type="button" className="text-button" disabled={draft.edges.length === 0} onClick={() => commands.updateDraft({ edges: [] })}>
                {t('panel.clearEdges')}
              </button>
            </div>
            <MissingEdges draft={draft} />
            <p className="panel-hint">{t('panel.edgesHint')}</p>
          </Section>
        </>
      );
  }
}

/** Edges of the draft that are gone from the body it modifies, with a button that removes them. */
function MissingEdges({ draft }: { draft: EdgeFeature }) {
  const { t } = useTranslation();
  const naming = useAppState((state) => state.display.body?.naming);
  const missing = naming ? resolveEdgeRefs(draft.edges, naming).filter((match) => match === null).length : 0;
  if (missing === 0) return null;
  return (
    <div className="panel-warning edge-missing" role="status" data-testid="edges-missing">
      <span>{t('panel.edgesMissing', { count: missing })}</span>
      <button type="button" className="text-button" data-testid="remove-missing-edges" onClick={commands.removeMissingEdges}>
        {t('panel.removeMissingEdges')}
      </button>
    </div>
  );
}

/** Props that let a parameter field take an equation over the part's variables. */
function equation(draft: Feature, field: string): { expression?: string; onExpression(text: string | undefined): void } {
  const expression = draft.expressions?.[field];
  return { ...(expression !== undefined ? { expression } : {}), onExpression: (text) => commands.setDraftExpression(field, text) };
}

export function PropertyPanel() {
  const { t } = useTranslation();
  const edit = useAppState((state) => state.activeEdit);
  const result = useAppState((state) => (state.activeEdit ? state.rebuild?.results[state.activeEdit.index] : undefined));
  if (!edit) return null;

  const Icon = FEATURE_ICONS[edit.draft.type];
  const featureLabel = t(`features.${edit.draft.type}`);
  const title = edit.mode === 'create' ? t('panel.creating', { feature: featureLabel }) : t('panel.editing', { feature: featureLabel });
  const error = result?.id === edit.draft.id && result.status === 'error' ? result.error : undefined;
  // Variables are applied only when every one has a valid name and a value.
  const applicable = edit.draft.type !== 'variables' || variablesValid(edit.draft.variables);

  return (
    <section
      className="panel property-panel"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          if (applicable) commands.commitEdit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          commands.cancelEdit();
        }
      }}
    >
      <div className="property-header">
        <Icon className="property-icon" />
        <h2 className="panel-title">{title}</h2>
        <div className="confirm-buttons">
          <button type="button" className="confirm-button is-ok" title={`${t('panel.ok')} (Enter)`} aria-label={t('panel.ok')} data-testid="panel-ok" disabled={!applicable} onClick={commands.commitEdit}>
            <CheckIcon />
          </button>
          <button type="button" className="confirm-button is-cancel" title={`${t('panel.cancel')} (Esc)`} aria-label={t('panel.cancel')} data-testid="panel-cancel" onClick={commands.cancelEdit}>
            <CloseIcon />
          </button>
        </div>
      </div>
      {error ? (
        <div className="panel-error" role="alert">
          {t(`errors.${error.code}`, { detail: error.detail ?? '' })}
        </div>
      ) : null}
      <FeatureFields draft={edit.draft} index={edit.index} />
    </section>
  );
}
