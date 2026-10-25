import { useTranslation } from 'react-i18next';
import { formatQuantity } from '../format.ts';
import { CHAMFER_METHODS, EXTRUDE_ENDS, hasReferenceSlots, isCopyFeature, type Axis, type BooleanOperation, type ChamferFeature, type ChamferMethod, type EdgeFeature, type ExtrudeDirection, type ExtrudeEnd, type ExtrudeFeature, type Feature, type Vec3 } from '../../../shared/model/feature.ts';
import type { GeometryRef } from '../../../shared/model/reference.ts';
import { referenceRoles } from '../references.ts';
import { resolveEdgeRefs } from '../../../shared/model/naming.ts';
import * as commands from '../commands.ts';
import { hasBodyBefore } from '../state/document.ts';
import { useAppState } from '../state/store.ts';
import { useFeatureName } from './FeatureTree.tsx';
import { CheckIcon, CloseIcon, FEATURE_ICONS } from './icons.tsx';
import { NumberField } from './NumberField.tsx';
import { ReferenceFields, useReferenceName } from './ReferencePanel.tsx';
import { HoleFields } from './HolePanel.tsx';
import { CopyFields } from './CopyPanel.tsx';
import { Segmented } from './Segmented.tsx';
import { VariablesEditor, variablesValid } from './VariablesPanel.tsx';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="panel-section">
      <legend className="panel-section-title">{title}</legend>
      {children}
    </fieldset>
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
      onChange={commands.setOperation}
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

/**
 * The axis of a revolution: a line of its sketch (centerlines first, numbered as they were drawn) or a
 * reference axis before the revolution.
 */
function AxisField({ sketch, value, axisRef, index }: { sketch: string; value: string; axisRef: GeometryRef | undefined; index: number }) {
  const { t } = useTranslation();
  const nameOf = useFeatureName();
  const features = useAppState((state) => state.history.features);
  const references = features.slice(0, index).flatMap((feature, i) => (feature.type === 'axis' && !feature.suppressed ? [{ id: `feature:${feature.id}`, label: nameOf(features, i) }] : []));
  const data = features.find((feature) => feature.type === 'sketch' && feature.id === sketch);
  const lines = data?.type === 'sketch' ? data.sketch.entities.filter((entity) => entity.type === 'line') : [];
  const centerlines = lines.filter((line) => line.construction);
  const others = lines.filter((line) => !line.construction);
  const options = [
    ...centerlines.map((line, i) => ({ id: line.id, label: t('panel.centerline', { n: i + 1 }) })),
    ...others.map((line, i) => ({ id: line.id, label: t('panel.line', { n: i + 1 }) })),
  ];
  const selected = axisRef?.kind === 'feature' ? `feature:${axisRef.feature}` : value;
  const known = options.some((option) => option.id === selected) || references.some((option) => option.id === selected);
  return (
    <label className="field">
      <span className="field-label">{t('panel.axis')}</span>
      <select className="field-select" value={selected} data-testid="revolve-axis" onChange={(event) => commands.chooseRevolveAxis(event.target.value)}>
        {known ? null : <option value={selected}>{t('panel.noAxis')}</option>}
        <optgroup label={t('panel.axisSketchLines')}>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </optgroup>
        {references.length > 0 ? (
          <optgroup label={t('panel.axisReferences')}>
            {references.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}

function FeatureFields({ draft, index }: { draft: Feature; index: number }) {
  const { t } = useTranslation();
  const language = useAppState((state) => state.language);
  const features = useAppState((state) => state.history.features);
  const firstFeature = !hasBodyBefore(features, index);

  switch (draft.type) {
    case 'extrude':
      return (
        <Section title={t('panel.parameters')}>
          <SketchField value={draft.sketch} index={index} />
          <OperationField value={draft.operation} firstFeature={firstFeature} />
          <label className="field">
            <span className="field-label">{t('panel.end')}</span>
            <select className="field-select" value={draft.end ?? 'blind'} data-testid="extrude-end" onChange={(event) => commands.setExtrudeEnd(event.target.value as ExtrudeEnd)}>
              {EXTRUDE_ENDS.map((end) => (
                // Through all needs a body to go through.
                <option key={end} value={end} disabled={end === 'throughAll' && firstFeature}>
                  {t(`panel.ends.${end}`)}
                </option>
              ))}
            </select>
          </label>
          {draft.end === 'blind' || draft.end === undefined ? (
            <NumberField label={t('panel.extrudeDepth')} value={draft.depth} testId="extrude-depth" {...equation(draft, 'depth')} onChange={(depth) => commands.updateDraft({ depth })} />
          ) : null}
          {draft.end === 'upToSurface' || draft.end === 'upToVertex' ? <ExtrudeEndFields draft={draft} /> : null}
          <Segmented<ExtrudeDirection>
            label={t('panel.direction')}
            value={draft.direction}
            options={[
              { value: 'normal', label: t('panel.directionNormal') },
              { value: 'reverse', label: t('panel.directionReverse') },
              // Up to a surface or vertex goes one way.
              ...(draft.end === 'upToSurface' || draft.end === 'upToVertex' ? [] : [{ value: 'both' as const, label: t('panel.directionBoth') }]),
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
          <AxisField sketch={draft.sketch} value={draft.axis} axisRef={draft.axisRef} index={index} />
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
    case 'import':
      return (
        <Section title={t('panel.parameters')}>
          <div className="field">
            <span className="field-label">{t('import.file')}</span>
            <span className="import-file" data-testid="import-file">
              <span className="import-name">{draft.file}</span>
              <span className="import-size">{formatQuantity(draft.data.length / 1024, language, 'KB', 0)}</span>
            </span>
          </div>
          <button type="button" className="text-button import-replace" data-testid="import-replace" onClick={() => void commands.replaceImportedFile()}>
            {t('import.replace')}
          </button>
          <OperationField value={draft.operation} firstFeature={firstFeature} />
          <p className="panel-hint">{t('import.hint')}</p>
        </Section>
      );
    case 'sketch':
      // Sketches are edited in sketch mode, not in the property panel.
      return null;
    case 'plane':
    case 'axis':
    case 'point':
      return <ReferenceFields draft={draft} />;
    case 'hole':
      return <HoleFields draft={draft} index={index} />;
    case 'pattern':
    case 'mirror':
      return <CopyFields draft={draft} />;
    case 'shell':
      return (
        <Section title={t('panel.parameters')}>
          <NumberField label={t('shell.thickness')} value={draft.thickness} step={0.5} testId="shell-thickness" {...equation(draft, 'thickness')} onChange={(thickness) => commands.updateDraft({ thickness })} />
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.outward} data-testid="shell-outward" onChange={(event) => commands.updateDraft({ outward: event.target.checked })} />
            {t('shell.outward')}
          </label>
          <div className="edge-summary">
            <span data-testid="shell-faces">{draft.faces.length > 0 ? t('shell.faces', { count: draft.faces.length }) : t('shell.none')}</span>
            <button type="button" className="text-button" disabled={draft.faces.length === 0} onClick={() => commands.updateDraft({ faces: [] })}>
              {t('shell.clear')}
            </button>
          </div>
          <p className="panel-hint">{t('shell.hint')}</p>
        </Section>
      );
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
              <ChamferFields draft={draft} />
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

/** The size of a chamfer: one distance, two distances, or a distance and an angle. */
function ChamferFields({ draft }: { draft: ChamferFeature }) {
  const { t } = useTranslation();
  const method = draft.method ?? 'equal';
  return (
    <>
      <Segmented<ChamferMethod>
        label={t('chamfer.method')}
        value={method}
        options={CHAMFER_METHODS.map((value) => ({ value, label: t(`chamfer.methods.${value}`) }))}
        onChange={(next) =>
          commands.updateDraft({
            method: next,
            ...(next === 'distances' && draft.distance2 === undefined ? { distance2: draft.distance } : {}),
            ...(next === 'angle' && draft.angle === undefined ? { angle: 45 } : {}),
          })
        }
      />
      <NumberField
        label={method === 'equal' ? t('panel.distance') : t('chamfer.distance1')}
        value={draft.distance}
        testId="chamfer-distance"
        {...equation(draft, 'distance')}
        step={0.5}
        onChange={(distance) => commands.updateDraft({ distance })}
      />
      {method === 'distances' ? (
        <NumberField label={t('chamfer.distance2')} value={draft.distance2 ?? draft.distance} testId="chamfer-distance2" {...equation(draft, 'distance2')} step={0.5} onChange={(distance2) => commands.updateDraft({ distance2 })} />
      ) : null}
      {method === 'angle' ? (
        <NumberField
          label={t('chamfer.angle')}
          unit="°"
          step={5}
          value={draft.angle ?? 45}
          testId="chamfer-angle"
          {...equation(draft, 'angle')}
          onChange={(angle) => commands.updateDraft({ angle: Math.min(89, Math.max(1, angle)) })}
        />
      ) : null}
      {method !== 'equal' ? (
        <label className="checkbox-field">
          <input type="checkbox" checked={draft.flip ?? false} data-testid="chamfer-flip" onChange={(event) => commands.updateDraft({ flip: event.target.checked })} />
          {t('chamfer.flip')}
        </label>
      ) : null}
    </>
  );
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

/** What an extrusion goes up to (picked in the 3D view or the tree), and the offset from a surface. */
function ExtrudeEndFields({ draft }: { draft: ExtrudeFeature }) {
  const { t } = useTranslation();
  const nameOf = useReferenceName();
  const surface = draft.end === 'upToSurface';
  return (
    <>
      <div className={`reference-slot is-active${draft.endRef ? ' is-filled' : ''}`} data-testid="extrude-end-ref">
        <div className="reference-slot-button">
          <span className="reference-slot-role">{surface ? t('panel.endSurface') : t('panel.endVertex')}</span>
          <span className="reference-slot-value">{draft.endRef ? nameOf(draft.endRef) : t('references.pick')}</span>
        </div>
      </div>
      {surface ? (
        <>
          <NumberField
            label={t('panel.endOffset')}
            signed
            value={draft.endOffset ?? 0}
            step={0.5}
            testId="extrude-end-offset"
            {...equation(draft, 'endOffset')}
            onChange={(endOffset) => commands.updateDraft({ endOffset: Math.max(0, endOffset) })}
          />
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.endBeyond ?? false} data-testid="extrude-end-beyond" onChange={(event) => commands.updateDraft({ endBeyond: event.target.checked })} />
            {t('panel.endBeyond')}
          </label>
        </>
      ) : null}
    </>
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
  // Reference geometry needs all its references; until they are chosen, the missing ones are no error yet.
  const draft = edit.draft;
  const incomplete = hasReferenceSlots(draft) && (draft.references.length < referenceRoles(draft).length || (isCopyFeature(draft) && draft.features.length === 0));
  const failure = result?.id === draft.id && result.status === 'error' ? result.error : undefined;
  const error = incomplete && (failure?.code === 'reference-missing' || failure?.code === 'pattern-empty') ? undefined : failure;
  // Lost fillet edges have their own notice in the edges section.
  const warning = result?.id === draft.id && result.status === 'ok' && result.warning?.code !== 'edge-missing' ? result.warning : undefined;
  // Variables are applied only when every one has a valid name and a value.
  const applicable = (edit.draft.type !== 'variables' || variablesValid(edit.draft.variables)) && !incomplete;

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
      {warning ? (
        <div className="panel-warning panel-notice" role="status" data-testid="panel-warning">
          {t(`warnings.${warning.code}`, { count: Number(warning.detail) || 0 })}
        </div>
      ) : null}
      <FeatureFields draft={edit.draft} index={edit.index} />
    </section>
  );
}
