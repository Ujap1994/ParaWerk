import { useTranslation } from 'react-i18next';
import { COPYABLE_TYPES, hasReferenceSlots, isCopyFeature, isReferenceFeature, type Feature } from '../../../shared/model/feature.ts';
import { STANDARD_PLANES } from '../../../shared/model/sketch.ts';
import * as commands from '../commands.ts';
import { featureOrdinal } from '../state/document.ts';
import { useAppState } from '../state/store.ts';
import { AlertIcon, EditIcon, EyeIcon, EyeOffIcon, FEATURE_ICONS, OriginIcon, PlaneIcon, SketchIcon, TrashIcon } from './icons.tsx';

export function useFeatureName() {
  const { t } = useTranslation();
  return (features: readonly Feature[], index: number): string => {
    const feature = features[index];
    if (!feature) return '';
    // A part has one list of variables, so it needs no number.
    if (feature.type === 'variables') return feature.name ?? t('features.variables');
    return feature.name ?? `${t(`features.${feature.type}`)}${featureOrdinal(features, index)}`;
  };
}

/** Front, Top and Right plane: select them, or sketch on them. */
function PlaneItems() {
  const { t } = useTranslation();
  const selection = useAppState((state) => state.selection);
  const hover = useAppState((state) => state.hover);
  const choosing = useAppState((state) => state.choosingSketchPlane);
  const sketching = useAppState((state) => state.sketch !== null);
  // While reference fields are filled, the planes are only picked.
  const picking = useAppState((state) => state.activeEdit !== null && hasReferenceSlots(state.activeEdit.draft));

  return STANDARD_PLANES.map((plane, index) => {
    const selected = selection.some((pick) => pick.kind === 'plane' && pick.index === index);
    const hovered = hover?.kind === 'plane' && hover.index === index;
    const classes = ['tree-item', 'is-reference', selected ? 'is-selected' : '', hovered ? 'is-hovered' : '', choosing ? 'is-choice' : ''].filter(Boolean).join(' ');
    return (
      <li
        key={plane}
        className={classes}
        role="treeitem"
        aria-selected={selected}
        data-plane={plane}
        onPointerEnter={() => commands.hoverPlane(index)}
        onPointerLeave={() => commands.hoverPlane(null)}
        onClick={(event) => {
          if (!sketching) commands.handlePick({ kind: 'plane', index }, event.ctrlKey || event.metaKey || event.shiftKey);
        }}
      >
        <PlaneIcon className="tree-icon" />
        <span className="tree-name">{t(`planes.${plane}`)}</span>
        {sketching || choosing || picking ? null : (
          <span className="tree-actions">
            <button
              type="button"
              className="icon-button"
              title={t('tree.sketchOnPlane')}
              aria-label={t('tree.sketchOnPlane')}
              onClick={(event) => {
                event.stopPropagation();
                commands.chooseSketchPlane({ kind: 'standard', plane });
              }}
            >
              <SketchIcon />
            </button>
          </span>
        )}
      </li>
    );
  });
}

export function FeatureTree() {
  const { t } = useTranslation();
  const features = useAppState((state) => state.history.features);
  const results = useAppState((state) => state.rebuild?.results);
  const activeEdit = useAppState((state) => state.activeEdit ?? state.sketch);
  // The tree only picks while a sketch or a feature with reference fields is edited; its actions are hidden.
  const locked = useAppState((state) => state.sketch !== null || state.choosingSketchPlane || (state.activeEdit !== null && hasReferenceSlots(state.activeEdit.draft)));
  const sketchStatuses = useAppState((state) => state.sketchStatuses);
  const selection = useAppState((state) => state.selection);
  const hover = useAppState((state) => state.hover);
  const sketching = useAppState((state) => state.sketch !== null);
  const editingReference = useAppState((state) => state.activeEdit !== null && hasReferenceSlots(state.activeEdit.draft));
  // While a pattern or mirror is edited, the features it can copy are picked in the tree.
  const copying = useAppState((state) => (state.activeEdit && isCopyFeature(state.activeEdit.draft) ? state.activeEdit.draft.features : null));
  const nameOf = useFeatureName();

  return (
    <section className={`panel feature-tree${locked ? ' is-locked' : ''}`} aria-label={t('tree.title')}>
      <h2 className="panel-title">{t('tree.title')}</h2>
      <ul className="tree-list" role="tree">
        <li
          className={`tree-item is-static${editingReference ? ' is-choice' : ''}`}
          role="treeitem"
          aria-selected={false}
          data-origin
          onClick={() => {
            // The origin is a point that reference geometry can be built on.
            if (editingReference) commands.assignReference('origin');
          }}
        >
          <OriginIcon className="tree-icon" />
          <span className="tree-name">{t('features.origin')}</span>
        </li>
        <PlaneItems />
        {features.map((feature, index) => {
          const Icon = FEATURE_ICONS[feature.type];
          const result = !activeEdit ? results?.find((r) => r.id === feature.id) : undefined;
          const error = result?.status === 'error' ? result.error : undefined;
          const warning = result?.status === 'ok' ? result.warning : undefined;
          const rolledBack = activeEdit !== null && (index > activeEdit.index || (activeEdit.mode === 'create' && index >= activeEdit.index));
          const editing = activeEdit?.mode === 'edit' && activeEdit.index === index;
          // Reference geometry is picked in the tree like in the 3D view (to select it, or to build on it).
          const reference = isReferenceFeature(feature) && !feature.suppressed && !rolledBack && !editing;
          const seed = copying !== null && !rolledBack && !editing && COPYABLE_TYPES.has(feature.type) && !feature.suppressed;
          const selected = (reference && selection.some((pick) => pick.kind === 'reference' && pick.index === index)) || (seed && copying.includes(feature.id));
          const hovered = reference && hover?.kind === 'reference' && hover.index === index;
          const classes = [
            'tree-item',
            feature.suppressed ? 'is-suppressed' : '',
            rolledBack ? 'is-rolled-back' : '',
            editing ? 'is-editing' : '',
            error ? 'has-error' : '',
            warning ? 'has-warning' : '',
            reference || seed ? 'is-reference' : '',
            selected ? 'is-selected' : '',
            hovered ? 'is-hovered' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <li
              key={feature.id}
              className={classes}
              role="treeitem"
              aria-selected={editing}
              data-feature-id={feature.id}
              title={
                rolledBack
                  ? t('tree.rolledBack')
                  : error
                    ? t(`errors.${error.code}`, { detail: error.detail ?? '' })
                    : warning
                      ? t(`warnings.${warning.code}`, { count: Number(warning.detail) || 0 })
                      : undefined
              }
              onDoubleClick={() => commands.editFeature(feature.id)}
              {...(seed
                ? { onClick: () => commands.toggleCopySeed(feature.id) }
                : reference
                ? {
                    onPointerEnter: () => commands.hoverReference(index),
                    onPointerLeave: () => commands.hoverReference(null),
                    onClick: (event: React.MouseEvent) => {
                      if (!sketching) commands.handlePick({ kind: 'reference', index }, event.ctrlKey || event.metaKey || event.shiftKey);
                    },
                  }
                : {})}
            >
              <Icon className="tree-icon" />
              <span className="tree-name">{nameOf(features, index)}</span>
              {error ? <AlertIcon className="tree-status is-error" aria-label={t('tree.statusError')} /> : null}
              {warning ? <AlertIcon className="tree-status is-warning" aria-label={t('tree.statusWarning')} data-testid="tree-warning" /> : null}
              {feature.type === 'sketch' && sketchStatuses[feature.id] === 'under' ? (
                <span className="tree-sketch-status is-under" title={t('tree.sketchUnder')} aria-label={t('tree.sketchUnder')} data-sketch-status="under" />
              ) : null}
              {feature.type === 'sketch' && sketchStatuses[feature.id] === 'over' ? (
                <AlertIcon className="tree-status is-error" aria-label={t('tree.sketchOver')} data-sketch-status="over" />
              ) : null}
              <span className="tree-actions" hidden={locked}>
                {feature.type === 'plane' && reference && !error ? (
                  <button
                    type="button"
                    className="icon-button"
                    title={t('tree.sketchOnPlane')}
                    aria-label={t('tree.sketchOnPlane')}
                    data-testid="sketch-on-plane"
                    onClick={(event) => {
                      event.stopPropagation();
                      commands.sketchOnReferencePlane(feature.id);
                    }}
                  >
                    <SketchIcon />
                  </button>
                ) : null}
                <button type="button" className="icon-button" title={t('tree.edit')} aria-label={t('tree.edit')} onClick={() => commands.editFeature(feature.id)}>
                  <EditIcon />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title={feature.suppressed ? t('tree.unsuppress') : t('tree.suppress')}
                  aria-label={feature.suppressed ? t('tree.unsuppress') : t('tree.suppress')}
                  onClick={() => commands.toggleSuppress(feature.id)}
                >
                  {feature.suppressed ? <EyeOffIcon /> : <EyeIcon />}
                </button>
                <button type="button" className="icon-button is-danger" title={t('tree.delete')} aria-label={t('tree.delete')} onClick={() => commands.deleteFeature(feature.id)}>
                  <TrashIcon />
                </button>
              </span>
            </li>
          );
        })}
        {activeEdit?.mode === 'create' ? (
          <li className="tree-item is-editing is-draft" role="treeitem" aria-selected>
            {(() => {
              const Icon = FEATURE_ICONS[activeEdit.draft.type];
              return <Icon className="tree-icon" />;
            })()}
            <span className="tree-name">{nameOf([...features, activeEdit.draft], features.length)}…</span>
          </li>
        ) : null}
      </ul>
      {features.length === 0 && !activeEdit ? <p className="panel-hint">{t('tree.empty')}</p> : null}
    </section>
  );
}
