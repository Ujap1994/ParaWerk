import { useTranslation } from 'react-i18next';
import type { Language } from '../../../shared/i18n.ts';
import type { Vec3 } from '../../../shared/model/feature.ts';
import type { MeasuredEntity, MeasureResult } from '../../../kernel/measure.ts';
import * as commands from '../commands.ts';
import { formatNumber, formatQuantity } from '../format.ts';
import { useAppState, type AppState } from '../state/store.ts';
import type { MeasureLine } from '../viewport/measure-graphics.ts';
import { CloseIcon } from './icons.tsx';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Lengths in the measure tool: 3 decimals, without −0. */
export function measureLength(value: number, language: Language): string {
  return formatQuantity(Math.round(value * 1000) / 1000 + 0, language, 'mm', 3);
}

const point = (p: Vec3, language: Language) => `${p.map((value) => formatNumber(Math.round(value * 1000) / 1000 + 0, language, 3)).join(' ; ')} mm`;

/** The measurement of the current selection, or null while it is measured (or without one). */
export function currentMeasurement(state: AppState): MeasureResult | null {
  return state.measuring && state.measurement && state.measurement.targets === state.selection ? state.measurement.result : null;
}

/** The lines the 3D view shows for a measurement: the shortest distance and the center distance. */
export function measureLines(state: AppState): MeasureLine[] {
  const result = currentMeasurement(state);
  if (!result) return [];
  const lines: MeasureLine[] = [];
  if (result.distance && result.distance.value > 1e-9) lines.push({ ...result.distance, label: measureLength(result.distance.value, state.language), style: 'distance' });
  if (result.centerDistance && result.centerDistance.value > 1e-9) {
    lines.push({ ...result.centerDistance, label: measureLength(result.centerDistance.value, state.language), style: 'center' });
  }
  return lines;
}

/** One measured face, edge or vertex: what it is and its size. */
function EntityRows({ entity, t, language }: { entity: MeasuredEntity; t: Translate; language: Language }) {
  if (entity.kind === 'vertex') {
    return (
      <>
        <dt>{t('measure.vertex')}</dt>
        <dd>{point(entity.position, language)}</dd>
      </>
    );
  }
  if (entity.kind === 'face') {
    const { geometry } = entity;
    return (
      <>
        <dt>{t('measure.face')}</dt>
        <dd>
          {t(`geometry.surfaces.${geometry.kind}`)}
          {geometry.radius !== undefined ? ` Ø ${measureLength(2 * geometry.radius, language)}` : ''}
        </dd>
        <dt className="is-sub">{t('measure.area')}</dt>
        <dd>{formatQuantity(geometry.area, language, 'mm²', 3)}</dd>
      </>
    );
  }
  const { geometry } = entity;
  return (
    <>
      <dt>{t('measure.edge')}</dt>
      <dd>
        {t(`geometry.curves.${geometry.kind}`)}
        {geometry.radius !== undefined ? ` Ø ${measureLength(2 * geometry.radius, language)}` : ''}
      </dd>
      <dt className="is-sub">{t('measure.length')}</dt>
      <dd>{measureLength(geometry.length, language)}</dd>
      {geometry.center && geometry.radius !== undefined ? (
        <>
          <dt className="is-sub">{t('measure.center')}</dt>
          <dd>{point(geometry.center, language)}</dd>
        </>
      ) : null}
    </>
  );
}

/** The measure tool: picks in the 3D view and what is measured between them. */
export function MeasurePanel() {
  const { t } = useTranslation();
  const open = useAppState((state) => state.measuring);
  const language = useAppState((state) => state.language);
  const result = useAppState(currentMeasurement);
  const selection = useAppState((state) => state.selection);
  const editing = useAppState((state) => state.activeEdit !== null || state.sketch !== null);
  if (!open) return null;
  const measurable = selection.filter((pick) => pick.kind === 'face' || pick.kind === 'edge' || pick.kind === 'vertex');
  const unsupported = selection.length > measurable.length;
  const distance = result?.distance;

  return (
    <section className="measure-panel" aria-label={t('measure.title')} data-testid="measure-panel">
      <header className="mass-panel-header">
        <h2>{t('measure.title')}</h2>
        <button type="button" className="icon-button" aria-label={t('measure.close')} title={t('measure.close')} onClick={() => commands.toggleMeasure(false)}>
          <CloseIcon />
        </button>
      </header>
      <div className="mass-panel-body">
        {editing ? <p className="mass-note">{t('measure.editing')}</p> : null}
        {!editing && measurable.length === 0 ? <p className="mass-note">{t('measure.hint')}</p> : null}
        {!editing && measurable.length > 0 && !result ? <p className="mass-note">{t('measure.busy')}</p> : null}
        {result ? (
          <>
            {result.entities.length === 2 ? (
              <dl className="mass-table measure-results" data-testid="measure-results">
                {distance ? (
                  <>
                    <dt>{t('measure.distance')}</dt>
                    <dd className="is-strong" data-testid="measure-distance">
                      {measureLength(distance.value, language)}
                    </dd>
                    <dd className="measure-deltas">
                      {t('measure.deltas', {
                        x: formatNumber(Math.round(Math.abs(distance.to[0] - distance.from[0]) * 1000) / 1000, language, 3),
                        y: formatNumber(Math.round(Math.abs(distance.to[1] - distance.from[1]) * 1000) / 1000, language, 3),
                        z: formatNumber(Math.round(Math.abs(distance.to[2] - distance.from[2]) * 1000) / 1000, language, 3),
                      })}
                    </dd>
                  </>
                ) : null}
                {result.normalDistance !== undefined ? (
                  <>
                    <dt>{t('measure.normalDistance')}</dt>
                    <dd data-testid="measure-normal-distance">{measureLength(result.normalDistance, language)}</dd>
                  </>
                ) : null}
                {result.centerDistance ? (
                  <>
                    <dt>{t('measure.centerDistance')}</dt>
                    <dd data-testid="measure-center-distance">{measureLength(result.centerDistance.value, language)}</dd>
                  </>
                ) : null}
                {result.angle !== undefined ? (
                  <>
                    <dt>{t('measure.angle')}</dt>
                    <dd data-testid="measure-angle">{formatNumber(Math.round(result.angle * 1000) / 1000 + 0, language, 3)}°</dd>
                  </>
                ) : null}
              </dl>
            ) : null}
            <dl className="mass-table measure-entities" data-testid="measure-entities">
              {result.entities.map((entity, i) => (
                <EntityRows key={i} entity={entity} t={t} language={language} />
              ))}
            </dl>
          </>
        ) : null}
        {unsupported ? <p className="mass-note">{t('measure.unsupported')}</p> : null}
      </div>
    </section>
  );
}
