import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { pointIn, tensorIn } from '../../../shared/model/frame.ts';
import { massOf, principalMoments } from '../../../shared/model/material.ts';
import * as commands from '../commands.ts';
import { formatMass, formatNumber, formatQuantity, formatSignificant } from '../format.ts';
import { coordinateSystems } from '../references.ts';
import { featureName, rollbackIndex } from '../state/document.ts';
import { partProperties, useAppState } from '../state/store.ts';
import { CloseIcon } from './icons.tsx';
import { materialName } from './MaterialDialog.tsx';

const AXES = ['X', 'Y', 'Z'] as const;



/**
 * Mass, center of mass and moments of inertia of the part, from the exact B-Rep and the density of its
 * material. It stays open over the 3D view and follows every change of the part.
 */
export function MassPropertiesPanel() {
  const { t } = useTranslation();
  const open = useAppState((state) => state.showMassProperties);
  const language = useAppState((state) => state.language);
  const properties = useAppState((state) => state.rebuild?.properties ?? null);
  const material = useAppState((state) => partProperties(state.history).material);
  const editing = useAppState((state) => state.activeEdit !== null || state.sketch !== null);
  const rolledBack = useAppState((state) => rollbackIndex(state.history.features, state.rollback) < state.history.features.length);
  const hasBody = useAppState((state) => state.display.body !== null);
  const features = useAppState((state) => state.history.features);
  // As text, so the selection stays the same while they do (a new list each time would redraw without end).
  const systemsText = useAppState((state) => JSON.stringify(coordinateSystems(state)));
  const systems = useMemo(() => JSON.parse(systemsText) as ReturnType<typeof coordinateSystems>, [systemsText]);
  const frameId = useAppState((state) => state.massFrame);
  if (!open) return null;

  // In a coordinate system: the center in its coordinates, the tensor about its axes.
  const frame = systems.find((system) => system.id === frameId)?.frame ?? null;
  const center = properties ? (frame ? pointIn(frame, properties.center) : properties.center) : null;
  const density = material?.density;
  const inertia = properties?.inertia && frame ? tensorIn(frame, properties.inertia) : properties?.inertia;
  // Moments of inertia in kg·mm²: the tensor for density 1 times the density.
  const scaled = inertia && density !== undefined ? inertia.map((value) => massOf(value, density)) : null;
  const [xx, yy, zz, xy, xz, yz] = scaled ?? [];
  const tensor = scaled ? [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]] : null;
  const principal = scaled ? principalMoments(scaled as [number, number, number, number, number, number]) : null;
  const inertiaText = (value: number | undefined) => formatSignificant(Math.abs(value ?? 0) < 1e-9 * Math.abs(xx ?? 1) ? 0 : (value ?? 0), language, '', 6).trim();

  return (
    <section className="mass-panel" aria-label={t('massProperties.title')} data-testid="mass-properties">
      <header className="mass-panel-header">
        <h2>{t('massProperties.title')}</h2>
        <button type="button" className="icon-button" aria-label={t('massProperties.close')} title={t('massProperties.close')} onClick={() => commands.toggleMassProperties(false)}>
          <CloseIcon />
        </button>
      </header>
      <div className="mass-panel-body">
        {systems.length > 0 ? (
          <label className="field mass-frame">
            <span className="field-label">{t('massProperties.relativeTo')}</span>
            <select className="field-select" value={frame ? (frameId ?? '') : ''} data-testid="mass-frame" onChange={(event) => commands.setMassFrame(event.target.value || null)}>
              <option value="">{t('massProperties.modelOrigin')}</option>
              {systems.map((system) => (
                <option key={system.id} value={system.id}>
                  {featureName(features, system.index, t)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <dl className="mass-table">
          <dt>{t('massProperties.material')}</dt>
          <dd>
            <button type="button" className="text-button" data-testid="mass-material" onClick={() => commands.openDialog('material')}>
              {material ? materialName(material, t) : t('massProperties.choose')}
            </button>
          </dd>
          {density !== undefined ? (
            <>
              <dt>{t('massProperties.density')}</dt>
              <dd>{formatQuantity(density, language, 'kg/m³', 1)}</dd>
            </>
          ) : null}
          {properties && hasBody ? (
            <>
              {density !== undefined ? (
                <>
                  <dt>{t('massProperties.mass')}</dt>
                  <dd className="is-strong" data-testid="mass-value">
                    {formatMass(massOf(properties.volume, density), language)}
                  </dd>
                </>
              ) : null}
              <dt>{t('massProperties.volume')}</dt>
              <dd data-testid="mass-volume">{formatQuantity(properties.volume, language, 'mm³', 1)}</dd>
              <dt>{t('massProperties.area')}</dt>
              <dd>{formatQuantity(properties.area, language, 'mm²', 1)}</dd>
              <dt>{t('massProperties.center')}</dt>
              <dd data-testid="mass-center">
                {(center ?? properties.center).map((value) => formatNumber(Math.round(value * 1000) / 1000 + 0, language, 3)).join(' ; ')} mm
              </dd>
              <dt>{t('massProperties.size')}</dt>
              <dd>
                {[0, 1, 2].map((axis) => formatNumber((properties.bboxMax[axis] ?? 0) - (properties.bboxMin[axis] ?? 0), language, 3)).join(' × ')} mm
              </dd>
            </>
          ) : null}
        </dl>
        {properties && hasBody ? (
          principal && tensor ? (
            <>
              <h3 className="mass-section-title">
                {t('massProperties.principal')} <span className="mass-unit">(kg·mm²)</span>
              </h3>
              <dl className="mass-table" data-testid="mass-principal">
                {principal.map((value, i) => (
                  <Fragment key={i}>
                    <dt>I{['₁', '₂', '₃'][i]}</dt>
                    <dd>{inertiaText(value)}</dd>
                  </Fragment>
                ))}
              </dl>
              <h3 className="mass-section-title">
                {t('massProperties.tensor')} <span className="mass-unit">(kg·mm²)</span>
              </h3>
              <div className="mass-matrix" data-testid="mass-tensor">
                {tensor.map((row, i) => (
                  <Fragment key={i}>
                    <span className="mass-matrix-axis">{AXES[i]}</span>
                    {row.map((value, j) => (
                      <span key={j}>{inertiaText(value)}</span>
                    ))}
                  </Fragment>
                ))}
              </div>
              <p className="mass-note">{t(frame ? 'massProperties.tensorHintFrame' : 'massProperties.tensorHint')}</p>
            </>
          ) : (
            <p className="mass-note">{t('massProperties.noMaterial')}</p>
          )
        ) : (
          <p className="mass-note">{t('massProperties.empty')}</p>
        )}
        {editing ? <p className="mass-note">{t('massProperties.editing')}</p> : rolledBack ? <p className="mass-note">{t('massProperties.rolledBack')}</p> : null}
      </div>
    </section>
  );
}
