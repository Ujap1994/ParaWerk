import { useTranslation } from 'react-i18next';
import * as commands from '../commands.ts';
import { formatNumber } from '../format.ts';
import { offsetRange } from '../section.ts';
import { useAppState } from '../state/store.ts';
import { CloseIcon } from './icons.tsx';
import { NumberField } from './NumberField.tsx';
import { Segmented } from './Segmented.tsx';

type PlaneChoice = 'front' | 'top' | 'right' | 'custom';

/** The section view: which plane it cuts along, how far from it, and which side is shown. */
export function SectionPanel() {
  const { t } = useTranslation();
  const section = useAppState((state) => state.section);
  const language = useAppState((state) => state.language);
  const properties = useAppState((state) => state.rebuild?.properties ?? null);
  // A single planar face or plane in the selection can become the section plane.
  const canUseSelection = useAppState((state) => {
    const pick = state.selection.length === 1 ? state.selection[0] : undefined;
    if (!pick) return false;
    if (pick.kind === 'plane' || pick.kind === 'reference') return true;
    return pick.kind === 'face' && state.display.body?.faceInfo[pick.index]?.plane !== undefined;
  });
  if (!section) return null;
  const choice: PlaneChoice = section.plane.kind === 'standard' ? section.plane.plane : 'custom';
  const [low, high] = properties ? offsetRange(section.plane, properties.bboxMin, properties.bboxMax) : [-100, 100];
  const step = Math.max(0.001, Math.round(((high - low) / 200) * 1000) / 1000);

  return (
    <section className="section-panel" aria-label={t('section.title')} data-testid="section-panel">
      <header className="mass-panel-header">
        <h2>{t('section.title')}</h2>
        <button type="button" className="icon-button" aria-label={t('section.close')} title={t('section.close')} onClick={() => commands.toggleSection(false)}>
          <CloseIcon />
        </button>
      </header>
      <div className="mass-panel-body">
        <Segmented<PlaneChoice>
          label={t('section.plane')}
          value={choice}
          options={[
            { value: 'front', label: t('section.front') },
            { value: 'top', label: t('section.top') },
            { value: 'right', label: t('section.right') },
            { value: 'custom', label: t('section.custom') },
          ]}
          onChange={(value) => {
            if (value === 'custom') commands.sectionAlongSelection();
            else commands.updateSection({ plane: { kind: 'standard', plane: value } });
          }}
        />
        {canUseSelection ? (
          <button type="button" className="text-button" data-testid="section-use-selection" onClick={commands.sectionAlongSelection}>
            {t('section.useSelection')}
          </button>
        ) : null}
        <div className="section-offset">
          <NumberField label={t('section.offset')} signed value={section.offset} step={step} testId="section-offset" onChange={(offset) => commands.updateSection({ offset })} />
          <input
            type="range"
            min={Math.min(low, section.offset)}
            max={Math.max(high, section.offset)}
            step={step}
            value={section.offset}
            aria-label={t('section.offset')}
            aria-valuetext={`${formatNumber(section.offset, language)} mm`}
            data-testid="section-slider"
            onChange={(event) => commands.updateSection({ offset: Number(event.target.value) })}
          />
        </div>
        <label className="checkbox-field">
          <input type="checkbox" checked={section.flip} data-testid="section-flip" onChange={(event) => commands.updateSection({ flip: event.target.checked })} />
          {t('section.flip')}
        </label>
        <p className="mass-note">{t('section.hint')}</p>
      </div>
    </section>
  );
}
