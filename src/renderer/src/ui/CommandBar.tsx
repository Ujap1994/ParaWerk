import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type SVGProps } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { FeatureType } from '../../../shared/model/feature.ts';
import * as commands from '../commands.ts';
import type { SketchToolName } from '../sketch/tools.ts';
import { useAppState, type AppState, type CommandTab } from '../state/store.ts';
import {
  BoxIcon, ExtrudeIcon, HoleIcon, RevolveIcon,
  CenterArcIcon,
  CenterlineIcon,
  CenterRectangleIcon,
  ParallelogramIcon,
  ChamferIcon,
  ChevronDownIcon,
  CircleIcon,
  PolygonIcon,
  EllipseIcon,
  ExtendIcon,
  SketchChamferIcon,
  TrimIcon,
  SketchFilletIcon,
  SlotIcon,
  SplineIcon,
  TangentArcIcon,
  ThreePointCircleIcon,
  ThreePointRectangleIcon,
  ConstructionIcon,
  ConvertIcon,
  CornerRectangleIcon,
  CylinderIcon,
  DimensionIcon,
  ExitSketchIcon,
  ExportDxfIcon,
  ExportStepIcon,
  ImportDxfIcon,
  ExportStlIcon,
  ExportThreeMfIcon,
  ImportStepIcon,
  FilletIcon,
  InfoIcon,
  NewIcon,
  OpenIcon,
  RedoIcon,
  SaveIcon,
  LineIcon,
  MassPropertiesIcon,
  MaterialIcon,
  MeasureIcon,
  PointIcon,
  CircularPatternIcon,
  MirrorIcon,
  PatternIcon,
  ReferenceAxisIcon,
  ReferencePlaneIcon,
  ReferencePointIcon,
  SettingsIcon,
  ShellIcon,
  SketchIcon,
  ThreePointArcIcon,
  TrashIcon,
  UndoIcon,
  VariablesIcon,
} from './icons.tsx';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const TOOL_ICONS: Record<SketchToolName, IconType> = {
  line: LineIcon,
  centerline: CenterlineIcon,
  cornerRectangle: CornerRectangleIcon,
  centerRectangle: CenterRectangleIcon,
  threePointRectangle: ThreePointRectangleIcon,
  parallelogram: ParallelogramIcon,
  circle: CircleIcon,
  threePointCircle: ThreePointCircleIcon,
  ellipse: EllipseIcon,
  centerArc: CenterArcIcon,
  threePointArc: ThreePointArcIcon,
  tangentArc: TangentArcIcon,
  slot: SlotIcon,
  polygon: PolygonIcon,
  sketchFillet: SketchFilletIcon,
  sketchChamfer: SketchChamferIcon,
  trim: TrimIcon,
  extend: ExtendIcon,
  point: PointIcon,
  spline: SplineIcon,
  convert: ConvertIcon,
  dimension: DimensionIcon,
};

interface CommandButtonProps {
  id: string;
  icon: IconType;
  label: string;
  tooltip: string;
  onClick(): void;
  active?: boolean;
  disabled?: boolean;
}

function CommandButton({ id, icon: Icon, label, tooltip, onClick, active = false, disabled = false }: CommandButtonProps) {
  return (
    <button
      type="button"
      className={`command-button${active ? ' is-active' : ''}`}
      data-command={id}
      title={tooltip}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="command-icon" />
      <span className="command-label">{label}</span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="command-group" role="group" aria-label={label}>
      <div className="command-group-buttons">{children}</div>
      <div className="command-group-label">{label}</div>
    </div>
  );
}

const FEATURE_BUTTONS: { type: FeatureType; icon: IconType }[] = [
  { type: 'sketch', icon: SketchIcon },
  { type: 'extrude', icon: ExtrudeIcon },
  { type: 'revolve', icon: RevolveIcon },
  { type: 'hole', icon: HoleIcon },
  { type: 'box', icon: BoxIcon },
  { type: 'cylinder', icon: CylinderIcon },
  { type: 'fillet', icon: FilletIcon },
  { type: 'chamfer', icon: ChamferIcon },
  { type: 'shell', icon: ShellIcon },
  { type: 'variables', icon: VariablesIcon },
];

const TABS: CommandTab[] = ['features', 'sketch', 'evaluate'];

interface SplitEntry {
  id: string;
  icon: IconType;
  /** Key below commands. and commands.tooltips. */
  label: string;
  start(): void;
  /** The feature being created when this entry is active. */
  active(state: AppState): boolean;
}

const REFERENCE_ENTRIES: readonly SplitEntry[] = (['plane', 'axis', 'point'] as const).map((type) => ({
  id: type,
  icon: { plane: ReferencePlaneIcon, axis: ReferenceAxisIcon, point: ReferencePointIcon }[type],
  label: type,
  start: () => commands.startFeature(type),
  active: (state: AppState) => state.activeEdit?.mode === 'create' && state.activeEdit.draft.type === type,
}));

/** Export formats: the button exports in the last used one. */
const EXPORT_ENTRIES: readonly SplitEntry[] = (
  [
    { id: 'export-step', icon: ExportStepIcon, label: 'exportStep', format: 'step' },
    { id: 'export-stl', icon: ExportStlIcon, label: 'exportStl', format: 'stl' },
    { id: 'export-3mf', icon: ExportThreeMfIcon, label: 'exportThreeMf', format: '3mf' },
  ] as const
).map(({ format, ...entry }) => ({ ...entry, start: () => void commands.exportModel(format), active: () => false }));

const COPY_ENTRIES: readonly SplitEntry[] = [
  {
    id: 'pattern',
    icon: PatternIcon,
    label: 'pattern',
    start: () => commands.startFeature('pattern'),
    active: (state) => state.activeEdit?.mode === 'create' && state.activeEdit.draft.type === 'pattern' && state.activeEdit.draft.method === 'linear',
  },
  {
    id: 'circular-pattern',
    icon: CircularPatternIcon,
    label: 'circularPattern',
    start: commands.startCircularPattern,
    active: (state) => state.activeEdit?.mode === 'create' && state.activeEdit.draft.type === 'pattern' && state.activeEdit.draft.method === 'circular',
  },
  { id: 'mirror', icon: MirrorIcon, label: 'mirror', start: () => commands.startFeature('mirror'), active: (state) => state.activeEdit?.mode === 'create' && state.activeEdit.draft.type === 'mirror' },
];

/** Features of one kind: the button starts the last used one, the arrow offers all of them. */
function SplitFeatureButton({ entries, menuLabel, variants, disabled }: { entries: readonly SplitEntry[]; menuLabel: string; variants: string; disabled: boolean }) {
  const { t } = useTranslation();
  const [currentId, setCurrentId] = useState(entries[0]?.id ?? '');
  const current = entries.find((entry) => entry.id === currentId) ?? (entries[0] as SplitEntry);
  const activeId = useAppState((state) => entries.find((entry) => entry.active(state))?.id ?? null);
  const { menuAt, open, anchor, menu, toggle, close } = useSplitMenu();
  const start = (entry: SplitEntry) => {
    setCurrentId(entry.id);
    close();
    entry.start();
  };
  return (
    <div className="split-command popover-anchor" ref={anchor}>
      <CommandButton
        id={current.id}
        icon={current.icon}
        label={t(`commands.${current.label}`)}
        tooltip={t(`commands.tooltips.${current.label}`)}
        active={activeId === current.id}
        disabled={disabled}
        onClick={() => start(current)}
      />
      <button
        type="button"
        className={`split-toggle${activeId !== null ? ' is-active' : ''}`}
        title={menuLabel}
        aria-label={menuLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        data-variants={variants}
        disabled={disabled}
        onClick={toggle}
      >
        <ChevronDownIcon />
      </button>
      {menuAt
        ? createPortal(
            <div className="popover-menu is-fixed" role="menu" ref={menu} style={{ left: menuAt.left, top: menuAt.top }}>
              {entries.map((entry) => {
                const Icon = entry.icon;
                return (
                  <button key={entry.id} type="button" role="menuitem" className="menu-item" data-entry={entry.id} title={t(`commands.tooltips.${entry.label}`)} onClick={() => start(entry)}>
                    <span className="menu-item-label">
                      <Icon className="menu-item-icon" />
                      {t(`commands.${entry.label}`)}
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function FeaturesTab() {
  const { t } = useTranslation();
  const activeType = useAppState((state) =>
    state.sketch || state.choosingSketchPlane ? 'sketch' : state.activeEdit?.mode === 'create' ? state.activeEdit.draft.type : null,
  );
  const sketching = useAppState((state) => state.sketch !== null || state.choosingSketchPlane);
  const hasFeatures = useAppState((state) => state.history.features.length > 0);
  return (
    <Group label={t('commands.groups.features')}>
      {FEATURE_BUTTONS.map(({ type, icon }) => (
        <CommandButton
          key={type}
          id={type}
          icon={icon}
          label={t(`commands.${type}`)}
          tooltip={t(`commands.tooltips.${type}`)}
          active={activeType === type}
          disabled={(sketching && type !== 'sketch') || ((type === 'fillet' || type === 'chamfer' || type === 'hole' || type === 'shell') && !hasFeatures)}
          onClick={() => commands.startFeature(type)}
        />
      ))}
      <SplitFeatureButton entries={COPY_ENTRIES} menuLabel={t('commands.copyGeometry')} variants="copy" disabled={sketching || !hasFeatures} />
      <SplitFeatureButton entries={REFERENCE_ENTRIES} menuLabel={t('commands.referenceGeometry')} variants="reference-geometry" disabled={sketching} />
    </Group>
  );
}

function ToolButton({ tool, disabled }: { tool: SketchToolName; disabled: boolean }) {
  const { t } = useTranslation();
  const active = useAppState((state) => state.sketchTool === tool);
  return (
    <CommandButton
      id={`tool-${tool}`}
      icon={TOOL_ICONS[tool]}
      label={t(`commands.sketchTools.${tool}`)}
      tooltip={t(`commands.sketchToolTips.${tool}`)}
      active={active}
      disabled={disabled}
      onClick={() => commands.setSketchTool(tool)}
    />
  );
}

/** Width the variant menu needs at most; it stays inside the window. */
const MENU_WIDTH_PX = 220;

/**
 * A tool with variants: the button runs the last used variant, the arrow offers all of them. The menu
 * is placed on the document body: the command bar clips its content (it scrolls sideways as a last
 * resort on tiny windows), which would cut the menu off.
 */
function useSplitMenu() {
  const [menuAt, setMenuAt] = useState<{ left: number; top: number } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = menuAt !== null;
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !menu.current?.contains(target)) setMenuAt(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // The menu takes this Esc; it must not also leave the sketch tool.
      event.stopPropagation();
      setMenuAt(null);
    };
    const dismiss = () => setMenuAt(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeOnEscape, true);
    // The menu does not follow the bar when the window changes or the bar scrolls sideways.
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeOnEscape, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);
  const toggle = () => {
    const rect = anchor.current?.getBoundingClientRect();
    if (open || !rect) {
      setMenuAt(null);
      return;
    }
    setMenuAt({ left: Math.max(4, Math.min(rect.left, window.innerWidth - MENU_WIDTH_PX - 4)), top: rect.bottom + 4 });
  };
  return { menuAt, open, anchor, menu, toggle, close: () => setMenuAt(null) };
}

function SplitToolButton({ tools, current, disabled }: { tools: readonly SketchToolName[]; current: SketchToolName; disabled: boolean }) {
  const { t } = useTranslation();
  const activeTool = useAppState((state) => state.sketchTool);
  const { menuAt, open, anchor, menu, toggle, close } = useSplitMenu();
  return (
    <div className="split-command popover-anchor" ref={anchor}>
      <ToolButton tool={current} disabled={disabled} />
      <button
        type="button"
        className={`split-toggle${tools.includes(activeTool as SketchToolName) ? ' is-active' : ''}`}
        title={t('commands.sketchTools.variants')}
        aria-label={t('commands.sketchTools.variants')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-variants={tools.join(' ')}
        disabled={disabled}
        onClick={toggle}
      >
        <ChevronDownIcon />
      </button>
      {menuAt
        ? createPortal(
            <div className="popover-menu is-fixed" role="menu" ref={menu} style={{ left: menuAt.left, top: menuAt.top }}>
              {tools.map((tool) => {
                const Icon = TOOL_ICONS[tool];
                return (
                  <button
                    key={tool}
                    type="button"
                    role="menuitemradio"
                    aria-checked={activeTool === tool}
                    className="menu-item"
                    data-tool={tool}
                    onClick={() => {
                      commands.setSketchTool(activeTool === tool ? null : tool);
                      close();
                    }}
                  >
                    <span className="menu-item-label">
                      <Icon className="menu-item-icon" />
                      {t(`commands.sketchTools.${tool}`)}
                    </span>
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function SketchTab() {
  const { t } = useTranslation();
  const inSketch = useAppState((state) => state.sketch !== null);
  const choosing = useAppState((state) => state.choosingSketchPlane);
  const variants = useAppState((state) => state.sketchToolVariants);
  const selection = useAppState((state) => state.sketchSelection.length);
  const off = !inSketch;
  return (
    <>
      <Group label={t('commands.groups.sketch')}>
        {inSketch ? (
          <CommandButton id="exit-sketch" icon={ExitSketchIcon} label={t('commands.exitSketch')} tooltip={t('commands.tooltips.exitSketch')} onClick={commands.exitSketch} />
        ) : (
          <CommandButton id="sketch-start" icon={SketchIcon} label={t('commands.sketch')} tooltip={t('commands.tooltips.sketch')} active={choosing} onClick={commands.startSketch} />
        )}
        <ToolButton tool="convert" disabled={off} />
      </Group>
      <Group label={t('commands.groups.define')}>
        <ToolButton tool="dimension" disabled={off} />
      </Group>
      <Group label={t('commands.groups.draw')}>
        <SplitToolButton tools={['line', 'centerline']} current={variants.line} disabled={off} />
        <SplitToolButton tools={['cornerRectangle', 'centerRectangle', 'threePointRectangle', 'parallelogram']} current={variants.rectangle} disabled={off} />
        <SplitToolButton tools={['circle', 'threePointCircle', 'ellipse']} current={variants.circle} disabled={off} />
        <SplitToolButton tools={['centerArc', 'threePointArc', 'tangentArc']} current={variants.arc} disabled={off} />
        <ToolButton tool="spline" disabled={off} />
        <ToolButton tool="slot" disabled={off} />
        <ToolButton tool="polygon" disabled={off} />
        <ToolButton tool="point" disabled={off} />
      </Group>
      <Group label={t('commands.groups.exchange')}>
        <CommandButton id="import-dxf" icon={ImportDxfIcon} label={t('commands.importDxf')} tooltip={t('commands.tooltips.importDxf')} disabled={off} onClick={() => void commands.importDxfIntoSketch()} />
        <CommandButton id="export-dxf" icon={ExportDxfIcon} label={t('commands.exportDxf')} tooltip={t('commands.tooltips.exportDxf')} disabled={off} onClick={() => void commands.exportSketchDxf()} />
      </Group>
      <Group label={t('commands.groups.modify')}>
        <SplitToolButton tools={['trim', 'extend']} current={variants.trim} disabled={off} />
        <SplitToolButton tools={['sketchFillet', 'sketchChamfer']} current={variants.corner} disabled={off} />
        <CommandButton
          id="construction"
          icon={ConstructionIcon}
          label={t('commands.sketchTools.construction')}
          tooltip={t('commands.sketchToolTips.construction')}
          disabled={off || selection === 0}
          onClick={commands.toggleConstruction}
        />
        <CommandButton
          id="delete-sketch"
          icon={TrashIcon}
          label={t('commands.sketchTools.delete')}
          tooltip={t('commands.sketchToolTips.delete')}
          disabled={off || selection === 0}
          onClick={commands.deleteSketchSelection}
        />
      </Group>
    </>
  );
}

/** The part as a whole: its material and color, and what it weighs. */
function EvaluateTab() {
  const { t } = useTranslation();
  const showMass = useAppState((state) => state.showMassProperties);
  const materialOpen = useAppState((state) => state.dialogs.material);
  const measuring = useAppState((state) => state.measuring);
  return (
    <>
      <Group label={t('commands.groups.part')}>
        <CommandButton id="material" icon={MaterialIcon} label={t('commands.material')} tooltip={t('commands.tooltips.material')} active={materialOpen} onClick={() => commands.openDialog('material')} />
      </Group>
      <Group label={t('commands.groups.evaluate')}>
        <CommandButton id="measure" icon={MeasureIcon} label={t('commands.measure')} tooltip={t('commands.tooltips.measure')} active={measuring} onClick={() => commands.toggleMeasure()} />
        <CommandButton
          id="mass-properties"
          icon={MassPropertiesIcon}
          label={t('commands.massProperties')}
          tooltip={t('commands.tooltips.massProperties')}
          active={showMass}
          onClick={() => commands.toggleMassProperties()}
        />
      </Group>
    </>
  );
}

const DENSITIES = ['normal', 'tight', 'icons', 'dense'] as const;

/**
 * Sets the first density at which all commands of the bar fit. The bar keeps the height of the
 * normal density, so the 3D view never jumps when the mode (and with it the commands) changes.
 */
function fitDensity(bar: HTMLElement): void {
  bar.style.minHeight = '';
  bar.dataset.density = DENSITIES[0];
  // Without the horizontal scroll bar that overflowing commands show in the normal density.
  const style = getComputedStyle(bar);
  const height = bar.clientHeight + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  if (bar.scrollWidth <= bar.clientWidth + 1) return;
  bar.style.minHeight = `${height}px`;
  for (const density of DENSITIES.slice(1)) {
    bar.dataset.density = density;
    if (bar.scrollWidth <= bar.clientWidth + 1) return;
  }
}

/** Fits the bar after every render (the commands change with the tab and mode) and on window resizes. */
function useFittingDensity(bar: React.RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const fit = () => {
      if (bar.current) fitDensity(bar.current);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  });
}

export function CommandBar() {
  const { t } = useTranslation();
  const barRef = useRef<HTMLElement>(null);
  useFittingDensity(barRef);
  const tab = useAppState((state) => state.commandTab);
  const canUndo = useAppState((state) => (state.sketch ? state.sketch.past.length > 0 : state.history.past.length > 0 || state.activeEdit !== null));
  const canRedo = useAppState((state) =>
    state.sketch ? state.sketch.future.length > 0 : state.history.future.length > 0 && state.activeEdit === null && !state.choosingSketchPlane,
  );
  const hasFeatures = useAppState((state) => state.history.features.length > 0);
  const sketching = useAppState((state) => state.sketch !== null || state.choosingSketchPlane);

  return (
    <header ref={barRef} className="command-bar" role="toolbar" aria-label="ParaWerk">
      <div className="brand" aria-hidden="true">
        <img src="./favicon.svg" alt="" width={28} height={28} />
      </div>
      <Group label={t('commands.groups.file')}>
        <CommandButton id="new" icon={NewIcon} label={t('commands.new')} tooltip={t('commands.tooltips.new')} onClick={() => void commands.newDocument()} />
        <CommandButton id="open" icon={OpenIcon} label={t('commands.open')} tooltip={t('commands.tooltips.open')} onClick={() => void commands.openDocument()} />
        <CommandButton id="save" icon={SaveIcon} label={t('commands.save')} tooltip={t('commands.tooltips.save')} onClick={() => void commands.saveDocument()} />
      </Group>
      <Group label={t('commands.groups.edit')}>
        <CommandButton id="undo" icon={UndoIcon} label={t('commands.undo')} tooltip={t('commands.tooltips.undo')} disabled={!canUndo} onClick={commands.undo} />
        <CommandButton id="redo" icon={RedoIcon} label={t('commands.redo')} tooltip={t('commands.tooltips.redo')} disabled={!canRedo} onClick={commands.redo} />
      </Group>
      <div className="command-tabs" role="tablist" aria-label={t('commands.tabs.label')} aria-orientation="vertical">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`command-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="command-tab-panel"
            data-tab={id}
            className={`command-tab${tab === id ? ' is-selected' : ''}`}
            onClick={() => commands.setCommandTab(id)}
          >
            {t(`commands.tabs.${id}`)}
          </button>
        ))}
      </div>
      <div className="command-tab-panel" id="command-tab-panel" role="tabpanel" aria-labelledby={`command-tab-${tab}`}>
        {tab === 'features' ? <FeaturesTab /> : tab === 'sketch' ? <SketchTab /> : <EvaluateTab />}
      </div>
      <div className="command-bar-spacer" />
      <Group label={t('commands.groups.exchange')}>
        <CommandButton id="import-step" icon={ImportStepIcon} label={t('commands.importStep')} tooltip={t('commands.tooltips.importStep')} disabled={sketching} onClick={() => void commands.importStepFile()} />
        <SplitFeatureButton entries={EXPORT_ENTRIES} menuLabel={t('commands.exportFormats')} variants="export" disabled={!hasFeatures} />
      </Group>
      <div className="command-bar-end">
        <CommandButton id="settings" icon={SettingsIcon} label={t('commands.settings')} tooltip={t('commands.tooltips.settings')} onClick={() => commands.openDialog('settings')} />
        <CommandButton id="about" icon={InfoIcon} label={t('commands.about')} tooltip={t('commands.tooltips.about')} onClick={() => commands.openDialog('about')} />
      </div>
    </header>
  );
}
