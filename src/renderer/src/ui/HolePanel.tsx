import { useTranslation } from 'react-i18next';
import type { ExtrudeEnd, Feature, HoleFeature, HoleFit, HoleKind } from '../../../shared/model/feature.ts';
import { HOLE_FITS, HOLE_KINDS, holePositions, metricSize, sizesFor } from '../../../shared/model/hole.ts';
import * as commands from '../commands.ts';
import { formatNumber } from '../format.ts';
import { useAppState } from '../state/store.ts';
import { useFeatureName } from './FeatureTree.tsx';
import { NumberField } from './NumberField.tsx';
import { Segmented } from './Segmented.tsx';

/** Props that let a parameter field take an equation over the part's variables. */
function equation(draft: Feature, field: string): { expression?: string; onExpression(text: string | undefined): void } {
  const expression = draft.expressions?.[field];
  return { ...(expression !== undefined ? { expression } : {}), onExpression: (text) => commands.setDraftExpression(field, text) };
}


/** The sketches before the hole; the hole goes to the free points of the chosen one. */
function PositionsField({ value, index }: { value: string; index: number }) {
  const { t } = useTranslation();
  const features = useAppState((state) => state.history.features);
  const nameOf = useFeatureName();
  const sketches = features.slice(0, index).flatMap((feature, i) => (feature.type === 'sketch' && !feature.suppressed ? [{ feature, label: nameOf(features, i) }] : []));
  const chosen = sketches.find((entry) => entry.feature.id === value)?.feature;
  const count = chosen ? holePositions(chosen.sketch).length : 0;
  return (
    <>
      <label className="field">
        <span className="field-label">{t('hole.positions')}</span>
        <select className="field-select" value={value} data-testid="hole-sketch" onChange={(event) => commands.chooseFeatureSketch(event.target.value)}>
          {chosen ? null : <option value={value}>{t('panel.noSketch')}</option>}
          {sketches.map(({ feature, label }) => (
            <option key={feature.id} value={feature.id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="panel-hint" data-testid="hole-count">
        {t('hole.count', { count })}
      </p>
    </>
  );
}

/** Kind, size and placement of holes, and their dimensions (from the standard tables, changeable). */
export function HoleFields({ draft, index }: { draft: HoleFeature; index: number }) {
  const { t } = useTranslation();
  const language = useAppState((state) => state.language);
  const thread = metricSize(draft.size);
  const tapped = draft.kind === 'tapped';
  const blind = draft.end === 'blind';
  return (
    <>
      <fieldset className="panel-section">
        <legend className="panel-section-title">{t('hole.type')}</legend>
        <label className="field">
          <span className="field-label">{t('hole.kind')}</span>
          <select className="field-select" value={draft.kind} data-testid="hole-kind" onChange={(event) => commands.setHoleType({ kind: event.target.value as HoleKind })}>
            {HOLE_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`hole.kinds.${kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">{t('hole.size')}</span>
          <select className="field-select" value={draft.size} data-testid="hole-size" onChange={(event) => commands.setHoleType({ size: event.target.value })}>
            {metricSize(draft.size) ? null : <option value={draft.size}>{draft.size}</option>}
            {sizesFor(draft.kind).map((entry) => (
              <option key={entry.size} value={entry.size}>
                {tapped ? `${entry.size} × ${formatNumber(entry.pitch, language)}` : entry.size}
              </option>
            ))}
          </select>
        </label>
        {tapped ? null : (
          <Segmented<HoleFit>
            label={t('hole.fit')}
            value={draft.fit}
            options={HOLE_FITS.map((fit) => ({ value: fit, label: t(`hole.fits.${fit}`) }))}
            onChange={(fit) => commands.setHoleType({ fit })}
          />
        )}
        <Segmented<ExtrudeEnd>
          label={t('panel.end')}
          value={draft.end}
          options={[
            { value: 'blind', label: t('panel.endBlind') },
            { value: 'throughAll', label: t('panel.endThroughAll') },
          ]}
          onChange={(end) => commands.updateDraft({ end })}
        />
        <PositionsField value={draft.sketch} index={index} />
        <label className="checkbox-field">
          <input type="checkbox" checked={draft.reverse} data-testid="hole-reverse" onChange={(event) => commands.updateDraft({ reverse: event.target.checked })} />
          {t('hole.reverse')}
        </label>
      </fieldset>
      <fieldset className="panel-section">
        <legend className="panel-section-title">{t('hole.dimensions')}</legend>
        <NumberField label={tapped ? t('hole.tapDrill') : t('hole.diameter')} value={draft.diameter} step={0.1} testId="hole-diameter" {...equation(draft, 'diameter')} onChange={(diameter) => commands.updateDraft({ diameter })} />
        {blind ? <NumberField label={t('hole.depth')} value={draft.depth} testId="hole-depth" {...equation(draft, 'depth')} onChange={(depth) => commands.updateDraft({ depth })} /> : null}
        {draft.kind === 'counterbore' ? (
          <div className="field-row is-two">
            <NumberField label={t('hole.counterboreDiameter')} value={draft.counterboreDiameter} step={0.5} testId="hole-counterbore-diameter" {...equation(draft, 'counterboreDiameter')} onChange={(counterboreDiameter) => commands.updateDraft({ counterboreDiameter })} />
            <NumberField label={t('hole.counterboreDepth')} value={draft.counterboreDepth} step={0.1} testId="hole-counterbore-depth" {...equation(draft, 'counterboreDepth')} onChange={(counterboreDepth) => commands.updateDraft({ counterboreDepth })} />
          </div>
        ) : null}
        {draft.kind === 'countersink' ? (
          <div className="field-row is-two">
            <NumberField label={t('hole.countersinkDiameter')} value={draft.countersinkDiameter} step={0.5} testId="hole-countersink-diameter" {...equation(draft, 'countersinkDiameter')} onChange={(countersinkDiameter) => commands.updateDraft({ countersinkDiameter })} />
            <NumberField label={t('hole.countersinkAngle')} unit="°" value={draft.countersinkAngle} step={1} testId="hole-countersink-angle" {...equation(draft, 'countersinkAngle')} onChange={(countersinkAngle) => commands.updateDraft({ countersinkAngle })} />
          </div>
        ) : null}
        {tapped && blind ? <NumberField label={t('hole.threadDepth')} value={draft.threadDepth} testId="hole-thread-depth" {...equation(draft, 'threadDepth')} onChange={(threadDepth) => commands.updateDraft({ threadDepth })} /> : null}
        {tapped && thread ? <p className="panel-hint">{t('hole.threadInfo', { size: thread.size, pitch: formatNumber(thread.pitch, language), diameter: formatNumber(thread.d, language) })}</p> : null}
        <p className="panel-hint">{t('hole.hint')}</p>
      </fieldset>
    </>
  );
}
