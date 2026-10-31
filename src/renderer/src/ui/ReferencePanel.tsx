import { useTranslation } from 'react-i18next';
import type { Feature, ReferenceFeature, SlotFeature } from '../../../shared/model/feature.ts';
import { AXIS_METHODS, CSYS_METHODS, PLANE_METHODS, POINT_METHODS, type GeometryRef } from '../../../shared/model/reference.ts';
import * as commands from '../commands.ts';
import { referencePicks, referenceRoles } from '../references.ts';
import { useAppState } from '../state/store.ts';
import { useFeatureName } from './FeatureTree.tsx';
import { CloseIcon } from './icons.tsx';
import { NumberField } from './NumberField.tsx';

const METHODS = { plane: PLANE_METHODS, axis: AXIS_METHODS, point: POINT_METHODS, csys: CSYS_METHODS, pattern: ['linear', 'circular'], mirror: ['plane'], draft: ['neutralPlane'], split: ['plane', 'surface'] } as const;

/** What the fields of a coordinate system stand for. */
const CSYS_SLOTS = ['origin', 'xAxis', 'yAxis'] as const;

/** "Top plane", "Plane1", "Face 4", "Edge 7", "Vertex 2" – what a reference field holds. */
export function useReferenceName() {
  const { t } = useTranslation();
  const nameOf = useFeatureName();
  const history = useAppState((state) => state.history);
  const display = useAppState((state) => state.display);
  const features = history.features;
  return (ref: GeometryRef): string => {
    switch (ref.kind) {
      case 'standard-plane':
        return t(`planes.${ref.plane}`);
      case 'origin':
        return t('features.origin');
      case 'feature':
        return nameOf(features, features.findIndex((feature) => feature.id === ref.feature));
      default: {
        // Faces, edges and vertices are named by their number in the shown body.
        const pick = referencePicks([ref], { display, history })[0];
        const key = ref.kind === 'face' ? 'status.face' : ref.kind === 'edge' ? 'status.edge' : 'status.vertex';
        return pick ? t(key, { index: pick.index + 1 }) : t('references.lost');
      }
    }
  };
}

/** Props that let a parameter field take an equation over the part's variables. */
function equation(draft: Feature, field: string): { expression?: string; onExpression(text: string | undefined): void } {
  const expression = draft.expressions?.[field];
  return { ...(expression !== undefined ? { expression } : {}), onExpression: (text) => commands.setDraftExpression(field, text) };
}

/**
 * The method of a feature with reference fields (when it has more than one) and its fields, filled one
 * after the other from picks; the active one has a frame. A negative `slot` in the state means no field.
 */
export function ReferenceSlots({ draft }: { draft: SlotFeature }) {
  const { t } = useTranslation();
  const slot = useAppState((state) => state.referenceSlot);
  const nameOf = useReferenceName();
  const roles = referenceRoles(draft);
  const methods: readonly string[] = METHODS[draft.type];
  // Fields are filled in order, so the active field is never after the first empty one.
  const activeSlot = slot < 0 ? -1 : Math.min(slot, draft.references.length, roles.length - 1);
  const activeRole = roles[activeSlot];
  return (
    <>
      {methods.length > 1 ? (
        <label className="field">
          <span className="field-label">{t('references.method')}</span>
          <select className="field-select" value={draft.method} data-testid="reference-method" onChange={(event) => commands.setReferenceMethod(event.target.value)}>
            {methods.map((method) => (
              <option key={method} value={method}>
                {t(`references.methods.${draft.type}.${method}`)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {roles.length > 0 ? (
        <ul className="reference-slots" aria-label={t('references.title')}>
          {roles.map((role, index) => {
            const ref = draft.references[index];
            const active = index === activeSlot;
            return (
              <li key={index} className={`reference-slot${active ? ' is-active' : ''}${ref ? ' is-filled' : ''}`} data-testid={`reference-slot-${index}`}>
                <button type="button" className="reference-slot-button" disabled={index > draft.references.length} onClick={() => commands.setReferenceSlot(index)}>
                  <span className="reference-slot-role">
                    {draft.type === 'csys' ? t(`references.csysSlots.${CSYS_SLOTS[index] ?? 'origin'}`) : draft.type === 'draft' ? t('draft.neutralPlane') : draft.type === 'split' ? t('split.plane') : t(`references.roles.${role}`)}
                  </span>
                  <span className="reference-slot-value">{ref ? nameOf(ref) : active ? t('references.pick') : t('references.empty')}</span>
                </button>
                {ref ? (
                  <button type="button" className="icon-button" title={t('references.clear')} aria-label={t('references.clear')} onClick={() => commands.clearReference(index)}>
                    <CloseIcon />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {roles.length > 0 ? (
        <div className="reference-hint">
          <p className="panel-hint is-flush">{t('references.hint')}</p>
          {/* The origin is not drawn in the view; it is offered here for fields that take a point. */}
          {activeRole === 'point' || activeRole === 'center' ? (
            <button type="button" className="text-button" data-testid="reference-origin" onClick={() => commands.assignReference('origin')}>
              {t('references.useOrigin')}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** How a reference plane, axis, point or coordinate system is defined: its method, its reference fields and its values. */
export function ReferenceFields({ draft }: { draft: ReferenceFeature }) {
  const { t } = useTranslation();
  const flipLabel =
    draft.type === 'plane' ? (draft.method === 'offset' ? t('references.flipOffset') : draft.method === 'angle' ? t('references.flipAngle') : t('references.flipNormal')) : '';

  return (
    <>
      <fieldset className="panel-section">
        <legend className="panel-section-title">{t('references.definition')}</legend>
        <ReferenceSlots draft={draft} />
      </fieldset>
      {draft.type === 'plane' ? (
        <fieldset className="panel-section">
          <legend className="panel-section-title">{t('panel.parameters')}</legend>
          {draft.method === 'offset' ? (
            <NumberField label={t('references.distance')} value={draft.distance} testId="plane-distance" {...equation(draft, 'distance')} onChange={(distance) => commands.updateDraft({ distance })} />
          ) : null}
          {draft.method === 'angle' ? (
            <NumberField label={t('panel.angle')} unit="°" step={15} value={draft.angle} testId="plane-angle" {...equation(draft, 'angle')} onChange={(angle) => commands.updateDraft({ angle })} />
          ) : null}
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.flip} data-testid="plane-flip" onChange={(event) => commands.updateDraft({ flip: event.target.checked })} />
            {flipLabel}
          </label>
        </fieldset>
      ) : null}
      {draft.type === 'csys' ? (
        <fieldset className="panel-section">
          <legend className="panel-section-title">{t('panel.parameters')}</legend>
          {draft.method === 'position' ? (
            <>
              <div className="field-row">
                {(['x', 'y', 'z'] as const).map((axis) => (
                  <NumberField
                    key={axis}
                    label={axis.toUpperCase()}
                    signed
                    value={draft[axis]}
                    testId={`csys-${axis}`}
                    {...equation(draft, axis)}
                    onChange={(value) => commands.updateDraft({ [axis]: value })}
                  />
                ))}
              </div>
              <NumberField label={t('references.csysAngle')} unit="°" step={15} signed value={draft.angle} testId="csys-angle" {...equation(draft, 'angle')} onChange={(angle) => commands.updateDraft({ angle })} />
            </>
          ) : null}
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.flipX} data-testid="csys-flip-x" onChange={(event) => commands.updateDraft({ flipX: event.target.checked })} />
            {t('references.flipX')}
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={draft.flipY} data-testid="csys-flip-y" onChange={(event) => commands.updateDraft({ flipY: event.target.checked })} />
            {t('references.flipY')}
          </label>
        </fieldset>
      ) : null}
      {draft.type === 'point' && draft.method === 'coordinates' ? (
        <fieldset className="panel-section">
          <legend className="panel-section-title">{t('panel.position')}</legend>
          <div className="field-row">
            {(['x', 'y', 'z'] as const).map((axis) => (
              <NumberField
                key={axis}
                label={axis.toUpperCase()}
                signed
                value={draft[axis]}
                testId={`point-${axis}`}
                {...equation(draft, axis)}
                onChange={(value) => commands.updateDraft({ [axis]: value })}
              />
            ))}
          </div>
        </fieldset>
      ) : null}
    </>
  );
}
