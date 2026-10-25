import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { COPYABLE_TYPES, hasReferenceSlots, isCopyFeature, isReferenceFeature, type Feature } from '../../../shared/model/feature.ts';
import { STANDARD_PLANES } from '../../../shared/model/sketch.ts';
import * as commands from '../commands.ts';
import { picksReferences } from '../references.ts';
import { featureName, rollbackIndex } from '../state/document.ts';
import { dropRow, ROLLBACK_ROW, type TreeRow } from '../state/tree-order.ts';
import { getState, partProperties, useAppState } from '../state/store.ts';
import { materialName } from './MaterialDialog.tsx';
import { AlertIcon, EditIcon, EyeIcon, EyeOffIcon, FEATURE_ICONS, MaterialIcon, OriginIcon, PlaneIcon, RollForwardIcon, SketchIcon, TrashIcon } from './icons.tsx';

export function useFeatureName() {
  const { t } = useTranslation();
  return (features: readonly Feature[], index: number): string => featureName(features, index, t);
}

/** The part's material: double-click (or the pencil) chooses it and the part's color. */
function MaterialItem({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const material = useAppState((state) => partProperties(state.history).material);
  return (
    <li className="tree-item is-static" role="treeitem" aria-selected={false} data-testid="tree-material" onDoubleClick={() => commands.openDialog('material')}>
      <MaterialIcon className="tree-icon" />
      <span className="tree-name">{t('material.treeLabel', { name: materialName(material, t) })}</span>
      <span className="tree-actions" hidden={locked}>
        <button type="button" className="icon-button" title={t('commands.tooltips.material')} aria-label={t('commands.tooltips.material')} onClick={() => commands.openDialog('material')}>
          <EditIcon />
        </button>
      </span>
    </li>
  );
}

/** Front, Top and Right plane: select them, or sketch on them. */
function PlaneItems() {
  const { t } = useTranslation();
  const selection = useAppState((state) => state.selection);
  const hover = useAppState((state) => state.hover);
  const choosing = useAppState((state) => state.choosingSketchPlane);
  const sketching = useAppState((state) => state.sketch !== null);
  // While reference fields are filled, the planes are only picked.
  const picking = useAppState((state) => picksReferences(state.activeEdit?.draft));

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

/** Rows dragged in the tree move only after the pointer went this far (px), so clicks stay clicks. */
const DRAG_THRESHOLD = 4;

interface TreeDrag {
  row: TreeRow;
  /** Where it would go: a gap of treeRows (0: in front of the first row). */
  gap: number | null;
  allowed: boolean;
}

/**
 * Drags features to another place in the tree and the rollback bar to another feature. Every row the
 * pointer passes shows where the dragged row would go, and whether it can go there.
 */
function useTreeDrag(list: React.RefObject<HTMLUListElement | null>) {
  const [drag, setDrag] = useState<TreeDrag | null>(null);
  const start = (event: React.PointerEvent, row: TreeRow) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return;
    const state = getState();
    if (state.activeEdit || state.sketch || state.choosingSketchPlane) return;
    const startY = event.clientY;
    let moved = false;
    let gap: number | null = null;
    const gapAt = (y: number): number => {
      const rows = [...(list.current?.querySelectorAll<HTMLElement>('[data-row]') ?? [])];
      const index = rows.findIndex((element) => {
        const rect = element.getBoundingClientRect();
        return y < rect.top + rect.height / 2;
      });
      return index < 0 ? rows.length : index;
    };
    const move = (e: PointerEvent) => {
      if (!moved && Math.abs(e.clientY - startY) < DRAG_THRESHOLD) return;
      moved = true;
      gap = gapAt(e.clientY);
      const { history, rollback } = getState();
      setDrag({ row, gap, allowed: dropRow(history.features, rollback, row, gap).kind !== 'refused' });
    };
    const end = (e: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      setDrag(null);
      if (!moved || gap === null || e.type === 'pointercancel') return;
      // The click that ends a drag picks nothing.
      const swallow = (click: MouseEvent) => click.stopPropagation();
      window.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      commands.dropTreeRow(row, gap);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };
  return { drag, start };
}

/** Classes that mark the gap a dragged row would be dropped into: above row `position`, or below the last row. */
function dropClasses(drag: TreeDrag | null, position: number, last: boolean): string {
  if (!drag || drag.gap === null) return '';
  const marker = drag.allowed ? '' : ' is-refused';
  if (drag.gap === position) return `drop-before${marker}`;
  if (last && drag.gap === position + 1) return `drop-after${marker}`;
  return '';
}

/** The rollback bar: features below it are not built. Drag it, or move it with the arrow keys. */
function RollbackBar({ position, last, drag, onPointerDown }: { position: number; last: boolean; drag: TreeDrag | null; onPointerDown(event: React.PointerEvent): void }) {
  const { t } = useTranslation();
  const rolledBack = useAppState((state) => rollbackIndex(state.history.features, state.rollback) < state.history.features.length);
  const classes = ['tree-rollback', rolledBack ? 'is-rolled-back' : '', drag?.row === ROLLBACK_ROW ? 'is-dragging' : '', dropClasses(drag, position, last)].filter(Boolean).join(' ');
  return (
    <li
      className={classes}
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('tree.rollbackBar')}
      title={t('tree.rollbackHint')}
      tabIndex={0}
      data-row={ROLLBACK_ROW}
      data-testid="rollback-bar"
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        const steps = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : event.key === 'Home' ? -Infinity : event.key === 'End' ? Infinity : 0;
        if (steps === 0) return;
        event.preventDefault();
        commands.moveRollback(Number.isFinite(steps) ? steps : Math.sign(steps) * (getState().history.features.length + 1));
      }}
    >
      <span className="tree-rollback-line" />
      {rolledBack ? (
        <button type="button" className="icon-button" title={t('tree.rollToEnd')} aria-label={t('tree.rollToEnd')} data-testid="roll-to-end" onClick={() => commands.setRollback(null)}>
          <RollForwardIcon />
        </button>
      ) : null}
    </li>
  );
}

export function FeatureTree() {
  const { t } = useTranslation();
  const features = useAppState((state) => state.history.features);
  const results = useAppState((state) => state.rebuild?.results);
  const activeEdit = useAppState((state) => state.activeEdit ?? state.sketch);
  // The tree only picks while a sketch or a feature with reference fields is edited; its actions are hidden.
  const locked = useAppState((state) => state.sketch !== null || state.choosingSketchPlane || picksReferences(state.activeEdit?.draft));
  const sketchStatuses = useAppState((state) => state.sketchStatuses);
  const selection = useAppState((state) => state.selection);
  const hover = useAppState((state) => state.hover);
  const sketching = useAppState((state) => state.sketch !== null);
  const editingReference = useAppState((state) => state.activeEdit !== null && hasReferenceSlots(state.activeEdit.draft));
  // While a pattern or mirror is edited, the features it can copy are picked in the tree.
  const copying = useAppState((state) => (state.activeEdit && isCopyFeature(state.activeEdit.draft) ? state.activeEdit.draft.features : null));
  const rollback = useAppState((state) => rollbackIndex(state.history.features, state.rollback));
  const choosing = useAppState((state) => state.choosingSketchPlane);
  const nameOf = useFeatureName();
  const listRef = useRef<HTMLUListElement>(null);
  const { drag, start } = useTreeDrag(listRef);
  // The bar is moved while nothing is edited; a feature being edited rolls back everything after it anyway.
  const showBar = activeEdit === null && !choosing;

  const featureRow = (feature: Feature, index: number, position: number, last: boolean) => {
    const Icon = FEATURE_ICONS[feature.type];
    const result = !activeEdit ? results?.find((r) => r.id === feature.id) : undefined;
    const error = result?.status === 'error' ? result.error : undefined;
    const warning = result?.status === 'ok' ? result.warning : undefined;
    const rolledBack = activeEdit !== null ? index > activeEdit.index || (activeEdit.mode === 'create' && index >= activeEdit.index) : index >= rollback;
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
      drag?.row === feature.id ? 'is-dragging' : '',
      showBar ? dropClasses(drag, position, last) : '',
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
        {...(showBar ? { 'data-row': feature.id, onPointerDown: (event: React.PointerEvent) => start(event, feature.id) } : {})}
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
  };

  const draftRow = () => {
    if (activeEdit?.mode !== 'create') return null;
    const Icon = FEATURE_ICONS[activeEdit.draft.type];
    const withDraft = [...features];
    withDraft.splice(activeEdit.index, 0, activeEdit.draft);
    return (
      <li key="draft" className="tree-item is-editing is-draft" role="treeitem" aria-selected>
        <Icon className="tree-icon" />
        <span className="tree-name">{nameOf(withDraft, activeEdit.index)}…</span>
      </li>
    );
  };

  // The rows in tree order (see state/tree-order.ts); a new feature appears where it goes in.
  const rows: React.ReactNode[] = [];
  const rowCount = features.length + (showBar ? 1 : 0);
  let position = 0;
  for (let index = 0; index <= features.length; index++) {
    if (activeEdit?.mode === 'create' && activeEdit.index === index) rows.push(draftRow());
    if (showBar && index === rollback) {
      rows.push(<RollbackBar key={ROLLBACK_ROW} position={position} last={position === rowCount - 1} drag={drag} onPointerDown={(event) => start(event, ROLLBACK_ROW)} />);
      position++;
    }
    const feature = features[index];
    if (!feature) continue;
    rows.push(featureRow(feature, index, position, position === rowCount - 1));
    position++;
  }

  return (
    <section className={`panel feature-tree${locked ? ' is-locked' : ''}${drag?.gap !== null && drag ? ' is-dragging' : ''}`} aria-label={t('tree.title')}>
      <h2 className="panel-title">{t('tree.title')}</h2>
      <ul className="tree-list" role="tree" ref={listRef}>
        <MaterialItem locked={locked} />
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
        {rows}
      </ul>
      {features.length === 0 && !activeEdit ? <p className="panel-hint">{t('tree.empty')}</p> : null}
    </section>
  );
}
