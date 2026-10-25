import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CUSTOM_MATERIAL,
  MATERIAL_CATEGORIES,
  MATERIALS,
  materialInfo,
  MAX_DENSITY,
  MIN_DENSITY,
  partColor,
  type PartMaterial,
  type PartProperties,
} from '../../../shared/model/material.ts';
import * as commands from '../commands.ts';
import { formatQuantity } from '../format.ts';
import { getState, partProperties, useAppState } from '../state/store.ts';
import { CloseIcon } from './icons.tsx';
import { NumberField } from './NumberField.tsx';

/** Density of a new custom material: water. */
const CUSTOM_DENSITY = 1000;

/** Colors offered for the part besides the material's own. */
const SWATCHES = ['#b7c4d6', '#8d959e', '#2f3640', '#e9e5da', '#d64545', '#e8833a', '#e2b93b', '#3f9d5a', '#2f7fc1', '#6b5bc9'];

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The name of a part material as the UI shows it. */
export function materialName(material: PartMaterial | undefined, t: Translate): string {
  if (!material) return t('material.none');
  if (material.id === CUSTOM_MATERIAL) return material.name ?? t('material.custom');
  return t(`material.names.${material.id}`);
}

/**
 * Material and appearance of the part: a library material (its density can be changed), a custom one
 * or none, and the color in the 3D view. OK applies both as one undo step.
 */
export function MaterialDialog() {
  const { t } = useTranslation();
  const open = useAppState((state) => state.dialogs.material);
  const language = useAppState((state) => state.language);
  const ref = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<PartProperties>({});

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setDraft(partProperties(getState().history));
      dialog.showModal();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const close = () => commands.closeDialog('material');
  const apply = () => {
    commands.setMaterial(draft.material ?? null);
    commands.setPartColor(draft.color ?? null);
    close();
  };
  const material = draft.material;
  const library = material ? materialInfo(material.id) : undefined;
  const choose = (next: PartMaterial | undefined) => setDraft((current) => {
    const { material: _old, ...rest } = current;
    return next ? { ...rest, material: next } : rest;
  });
  const shownColor = partColor(draft) ?? SWATCHES[0] ?? '#b7c4d6';

  return (
    <dialog ref={ref} className="modal material-dialog" aria-label={t('material.title')} data-testid="material-dialog" onClose={close} onCancel={close}>
      <header className="modal-header">
        <h2>{t('material.title')}</h2>
        <button type="button" className="icon-button" aria-label={t('massProperties.close')} onClick={close}>
          <CloseIcon />
        </button>
      </header>
      <div className="modal-body material-body">
        <div className="material-list" role="listbox" aria-label={t('material.title')}>
          {MATERIAL_CATEGORIES.map((category) => (
            <div key={category} className="material-category" role="group" aria-label={t(`material.categories.${category}`)}>
              <div className="material-category-title">{t(`material.categories.${category}`)}</div>
              {(category === 'other' ? [] : MATERIALS.filter((info) => info.category === category)).map((info) => (
                <button
                  key={info.id}
                  type="button"
                  role="option"
                  aria-selected={material?.id === info.id}
                  className={`material-option${material?.id === info.id ? ' is-selected' : ''}`}
                  data-material={info.id}
                  onClick={() => choose({ id: info.id, density: info.density })}
                >
                  <span className="material-swatch" style={{ background: info.color }} aria-hidden="true" />
                  <span className="material-option-name">{t(`material.names.${info.id}`)}</span>
                  <span className="material-option-density">{formatQuantity(info.density, language, 'kg/m³', 0)}</span>
                </button>
              ))}
              {category === 'other' ? (
                <>
                  <button
                    type="button"
                    role="option"
                    aria-selected={material?.id === CUSTOM_MATERIAL}
                    className={`material-option${material?.id === CUSTOM_MATERIAL ? ' is-selected' : ''}`}
                    data-material={CUSTOM_MATERIAL}
                    onClick={() => choose({ id: CUSTOM_MATERIAL, density: material?.density ?? CUSTOM_DENSITY, name: t('material.customDefault') })}
                  >
                    <span className="material-swatch is-custom" aria-hidden="true" />
                    <span className="material-option-name">{t('material.custom')}</span>
                  </button>
                  <button
                    type="button"
                    role="option"
                    aria-selected={material === undefined}
                    className={`material-option${material === undefined ? ' is-selected' : ''}`}
                    data-material="none"
                    onClick={() => choose(undefined)}
                  >
                    <span className="material-swatch is-none" aria-hidden="true" />
                    <span className="material-option-name">{t('material.remove')}</span>
                  </button>
                </>
              ) : null}
            </div>
          ))}
        </div>
        <div className="material-details">
          {material ? (
            <fieldset className="panel-section">
              <legend className="panel-section-title">{materialName(material, t)}</legend>
              {material.id === CUSTOM_MATERIAL ? (
                <div className="field">
                  <label className="field-label" htmlFor="material-name">
                    {t('material.customName')}
                  </label>
                  <div className="field-control">
                    <input
                      id="material-name"
                      className="field-input"
                      data-testid="material-name"
                      value={material.name ?? ''}
                      maxLength={120}
                      onChange={(event) => choose({ ...material, name: event.target.value })}
                    />
                  </div>
                </div>
              ) : null}
              <NumberField
                label={t('material.density')}
                unit="kg/m³"
                step={10}
                value={material.density}
                testId="material-density"
                onChange={(density) => choose({ ...material, density: Math.min(MAX_DENSITY, Math.max(MIN_DENSITY, density)) })}
              />
              {library && library.density !== material.density ? (
                <button type="button" className="text-button" data-testid="material-library-density" onClick={() => choose({ ...material, density: library.density })}>
                  {t('material.libraryDensity')}: {formatQuantity(library.density, language, 'kg/m³', 0)}
                </button>
              ) : null}
              <p className="panel-hint">{t('material.densityHint')}</p>
            </fieldset>
          ) : null}
          <fieldset className="panel-section">
            <legend className="panel-section-title">{t('material.appearance')}</legend>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={draft.color === undefined}
                data-testid="material-color-default"
                onChange={(event) =>
                  setDraft((current) => {
                    const { color: _old, ...rest } = current;
                    return event.target.checked ? rest : { ...rest, color: shownColor };
                  })
                }
              />
              {t('material.useMaterialColor')}
            </label>
            <div className="color-swatches" role="radiogroup" aria-label={t('material.color')}>
              {SWATCHES.map((color) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={draft.color === color}
                  aria-label={color}
                  className={`color-swatch${draft.color === color ? ' is-selected' : ''}`}
                  style={{ background: color }}
                  onClick={() => setDraft((current) => ({ ...current, color }))}
                />
              ))}
              <label className="color-picker" title={t('material.color')}>
                <input type="color" value={shownColor} data-testid="material-color" onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))} />
              </label>
            </div>
          </fieldset>
        </div>
      </div>
      <footer className="modal-footer">
        <button type="button" className="button" onClick={close}>
          {t('panel.cancel')}
        </button>
        <button type="button" className="button is-primary" data-testid="material-ok" onClick={apply}>
          {t('panel.ok')}
        </button>
      </footer>
    </dialog>
  );
}
