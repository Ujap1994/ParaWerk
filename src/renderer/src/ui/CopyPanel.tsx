import { useTranslation } from 'react-i18next';
import type { CopyFeature, Feature } from '../../../shared/model/feature.ts';
import { MAX_PATTERN_COUNT } from '../../../shared/model/pattern.ts';
import * as commands from '../commands.ts';
import { useAppState } from '../state/store.ts';
import { useFeatureName } from './FeatureTree.tsx';
import { CloseIcon } from './icons.tsx';
import { NumberField } from './NumberField.tsx';
import { ReferenceSlots } from './ReferencePanel.tsx';

/** Props that let a parameter field take an equation over the part's variables. */
function equation(draft: Feature, field: string): { expression?: string; onExpression(text: string | undefined): void } {
  const expression = draft.expressions?.[field];
  return { ...(expression !== undefined ? { expression } : {}), onExpression: (text) => commands.setDraftExpression(field, text) };
}

/** The features a pattern or mirror copies; while the list is the active field, picks add or remove features. */
function SeedList({ draft }: { draft: CopyFeature }) {
  const { t } = useTranslation();
  const active = useAppState((state) => state.referenceSlot === commands.FEATURES_SLOT);
  const features = useAppState((state) => state.history.features);
  const nameOf = useFeatureName();
  return (
    <div className={`reference-slot seed-list${active ? ' is-active' : ''}${draft.features.length > 0 ? ' is-filled' : ''}`} data-testid="copy-features">
      <button type="button" className="reference-slot-button" onClick={() => commands.setReferenceSlot(commands.FEATURES_SLOT)}>
        <span className="reference-slot-role">{t('copy.features')}</span>
        {draft.features.length === 0 ? <span className="reference-slot-value">{active ? t('copy.pickFeatures') : t('references.empty')}</span> : null}
      </button>
      {draft.features.length > 0 ? (
        <ul className="seed-chips">
          {draft.features.map((id) => {
            const index = features.findIndex((feature) => feature.id === id);
            return (
              <li key={id} className="seed-chip">
                <span>{index >= 0 ? nameOf(features, index) : t('references.lost')}</span>
                <button type="button" className="icon-button" title={t('references.clear')} aria-label={t('references.clear')} onClick={() => commands.toggleCopySeed(id)}>
                  <CloseIcon />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** A pattern (linear or circular) or a mirror: what it copies, along or around what, and how often. */
export function CopyFields({ draft }: { draft: CopyFeature }) {
  const { t } = useTranslation();
  return (
    <>
      <fieldset className="panel-section">
        <legend className="panel-section-title">{t('references.definition')}</legend>
        <SeedList draft={draft} />
        <ReferenceSlots draft={draft} />
      </fieldset>
      {draft.type === 'pattern' ? (
        <fieldset className="panel-section">
          <legend className="panel-section-title">{t('panel.parameters')}</legend>
          <NumberField
            label={t('copy.count')}
            unit=""
            step={1}
            value={draft.count}
            testId="pattern-count"
            {...equation(draft, 'count')}
            onChange={(count) => commands.updateDraft({ count: Math.min(MAX_PATTERN_COUNT, Math.max(2, Math.round(count))) })}
          />
          {draft.method === 'linear' ? (
            <NumberField label={t('copy.spacing')} value={draft.spacing} testId="pattern-spacing" {...equation(draft, 'spacing')} onChange={(spacing) => commands.updateDraft({ spacing })} />
          ) : (
            <NumberField label={t('copy.angle')} unit="°" step={15} value={draft.angle} testId="pattern-angle" {...equation(draft, 'angle')} onChange={(angle) => commands.updateDraft({ angle: Math.min(360, angle) })} />
          )}
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.flip} data-testid="pattern-flip" onChange={(event) => commands.setCopyFlip(event.target.checked)} />
            {draft.method === 'linear' ? t('copy.flipLinear') : t('copy.flipCircular')}
          </label>
          <p className="panel-hint">{draft.method === 'linear' ? t('copy.linearHint') : t('copy.circularHint')}</p>
        </fieldset>
      ) : null}
    </>
  );
}
