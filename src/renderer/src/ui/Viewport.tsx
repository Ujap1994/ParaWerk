import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { hasReferenceSlots, isCopyFeature, isEdgeFeature, isSketchBased, roundFaceCount, type Vec3 } from '../../../shared/model/feature.ts';
import { resolveEdgeRefs } from '../../../shared/model/naming.ts';
import { frameOf, STANDARD_PLANES } from '../../../shared/model/sketch.ts';
import * as commands from '../commands.ts';
import { builtOn, extrudesUpTo, picksReferences, referenceItems, referencePicks, visibleThreads } from '../references.ts';
import { SketchController, sketchHighlight, statusColors } from '../sketch/controller.ts';
import { sketchSolver } from '../sketch/solver.ts';
import { modelEnd, partProperties, setState, store, type AppState, type Pick } from '../state/store.ts';
import { partColor } from '../../../shared/model/material.ts';
import { ViewportEngine, type InactiveSketch, type PickFilter } from '../viewport/engine.ts';
import type { PlaneDisplay } from '../viewport/reference-planes.ts';
import { registerSketchControl, registerViewport } from '../viewport/registry.ts';
import type { CubeFace } from '../viewport/view-cube.ts';
import { ViewToolbar } from './ViewToolbar.tsx';
import { MassPropertiesPanel } from './MassPropertiesPanel.tsx';
import { measureLines, MeasurePanel } from './MeasurePanel.tsx';
import { SectionPanel } from './SectionPanel.tsx';
import { sectionCut } from '../section.ts';

function cubeLabels(t: (key: string) => string): Record<CubeFace, string> {
  return {
    front: t('viewcube.front'),
    back: t('viewcube.back'),
    left: t('viewcube.left'),
    right: t('viewcube.right'),
    top: t('viewcube.top'),
    bottom: t('viewcube.bottom'),
  };
}

/**
 * Selection shown in the view: the draft's edges while editing a fillet/chamfer, the faces, edges and
 * vertices the edited reference geometry is built on, otherwise the user selection.
 */
function visibleSelection(state: AppState): Pick[] {
  const edit = state.activeEdit;
  if (edit && extrudesUpTo(edit.draft)) return referencePicks(builtOn(edit.draft), state).filter((pick) => pick.kind === 'face' || pick.kind === 'edge' || pick.kind === 'vertex');
  // The preview of a shell shows its openings; highlighting the open faces would cover them.
  if (edit?.draft.type === 'shell') return state.display.preview ? [] : referencePicks(edit.draft.faces, state);
  if (edit && hasReferenceSlots(edit.draft)) {
    const picks = referencePicks(edit.draft.references, state).filter((pick) => pick.kind === 'face' || pick.kind === 'edge' || pick.kind === 'vertex');
    // The faces of the features a pattern or mirror copies are highlighted (faces are named after their feature).
    if (isCopyFeature(edit.draft)) {
      const seeds = new Set(edit.draft.features);
      const faces = state.display.body?.naming.faces ?? [];
      faces.forEach((name, index) => {
        if (seeds.has(name.split(':')[0] ?? '')) picks.push({ kind: 'face', index });
      });
    }
    return picks;
  }
  // Once all three faces are picked, the preview shows the round; highlighting the faces would cover it.
  if (edit?.draft.type === 'fillet' && roundFaceCount(edit.draft.method) > 0) {
    const refs = edit.draft.round ?? [];
    return refs.length >= roundFaceCount(edit.draft.method) && state.display.preview ? [] : referencePicks(refs, state);
  }
  if (edit && isEdgeFeature(edit.draft)) {
    const naming = state.display.body?.naming;
    if (!naming) return [];
    const edges = resolveEdgeRefs(edit.draft.edges, naming).flatMap((match) => (match ? [{ kind: 'edge' as const, index: match.index }] : []));
    return [...edges, ...referencePicks(edit.draft.faces ?? [], state)];
  }
  return state.selection;
}

/** Where the edges of the edited fillet or chamfer were that no longer exist in the shown body. */
function lostEdgePoints(state: AppState): Vec3[] {
  const edit = state.activeEdit;
  const naming = state.display.body?.naming;
  if (!edit || !isEdgeFeature(edit.draft) || !naming) return [];
  const matches = resolveEdgeRefs(edit.draft.edges, naming);
  return edit.draft.edges.flatMap((ref, i) => (matches[i] === null && ref.kind === 'edge' ? [ref.at] : []));
}

function pickFilter(state: AppState): PickFilter {
  if (state.choosingSketchPlane) return 'planes';
  if (state.sketch) return 'none';
  const edit = state.activeEdit;
  if (!edit) return 'all';
  if (edit.draft.type === 'shell' || (edit.draft.type === 'fillet' && roundFaceCount(edit.draft.method) > 0)) return 'faces';
  return isEdgeFeature(edit.draft) ? 'edgesAndFaces' : picksReferences(edit.draft) ? 'references' : 'none';
}

/** Sketches shown in the 3D view besides the open one: those before the current edit position, unless suppressed. */
function inactiveSketches(state: AppState): InactiveSketch[] {
  const features = state.history.features;
  const end = modelEnd(state);
  // Sketches that an extrusion or revolution has turned into a solid are hidden (editing that feature shows its sketch).
  const used = new Set(features.slice(0, end).flatMap((feature) => (isSketchBased(feature) && !feature.suppressed ? [feature.sketch] : [])));
  // The axis of the revolution being edited is highlighted in its sketch.
  const draft = state.activeEdit?.draft;
  const axis = draft?.type === 'revolve' ? { sketch: draft.sketch, line: draft.axis } : null;
  const sketches: InactiveSketch[] = [];
  for (const feature of features.slice(0, end)) {
    if (feature.type !== 'sketch' || feature.suppressed || used.has(feature.id)) continue;
    sketches.push({ id: feature.id, frame: frameOf(feature.plane), data: feature.sketch, ...(axis?.sketch === feature.id ? { highlighted: [axis.line] } : {}) });
  }
  return sketches;
}

/** All planes while choosing a sketch plane; otherwise only hovered (also in the tree) and selected ones. */
function planeDisplay(state: AppState): PlaneDisplay {
  if (state.sketch) return { visible: [], hovered: null, selected: [] };
  const draft = state.activeEdit?.draft;
  // The standard planes a reference feature is built on are shown while it is edited.
  const referenced = draft ? referencePicks(builtOn(draft), state).filter((pick) => pick.kind === 'plane') : [];
  // While reference geometry is edited, the standard planes are shown so they can be picked as references.
  const showAll = state.choosingSketchPlane || (draft !== undefined && (hasReferenceSlots(draft) || (draft.type === 'extrude' && draft.end === 'upToSurface')));
  return {
    visible: STANDARD_PLANES.map(() => showAll),
    hovered: state.hover?.kind === 'plane' ? state.hover.index : null,
    selected: [...state.selection, ...referenced].filter((pick) => pick.kind === 'plane').map((pick) => pick.index),
  };
}

export function Viewport() {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const cursorInfoRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ViewportEngine | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = new ViewportEngine(
      container,
      {
        onHover: (hover) => setState({ hover }),
        onPick: (pick, additive) => commands.handlePick(pick, additive),
        onFrameStats: (frameStats) => setState({ frameStats }),
      },
      cubeLabels(i18n.t.bind(i18n)),
    );
    engineRef.current = engine;
    registerViewport(engine);
    // The measurement next to the cursor follows every mouse move, so it bypasses React.
    const controller = new SketchController(engine, sketchSolver, (info) => {
      const element = cursorInfoRef.current;
      if (!element) return;
      element.hidden = info === null;
      if (!info) return;
      element.textContent = info.text;
      element.style.transform = `translate(${Math.round(info.x + 18)}px, ${Math.round(info.y + 20)}px)`;
    }, viewportRef.current);
    engine.setSketchInput(controller);
    registerSketchControl(controller);

    const sync = (state: AppState, previous: AppState | null) => {
      if (!previous || state.display !== previous.display) {
        engine.setBody(state.display.body, state.display.pickable);
        engine.setPreview(state.display.preview);
      }
      if (
        !previous ||
        state.activeEdit !== previous.activeEdit ||
        state.selection !== previous.selection ||
        state.display !== previous.display ||
        state.choosingSketchPlane !== previous.choosingSketchPlane ||
        state.sketch !== previous.sketch
      ) {
        engine.setSelection(visibleSelection(state));
        engine.setLostMarkers(lostEdgePoints(state));
        engine.setPickFilter(pickFilter(state));
      }
      if (
        !previous ||
        state.choosingSketchPlane !== previous.choosingSketchPlane ||
        state.selection !== previous.selection ||
        state.hover !== previous.hover ||
        state.activeEdit !== previous.activeEdit ||
        (state.sketch === null) !== (previous.sketch === null)
      ) {
        engine.setReferencePlanes(planeDisplay(state));
      }
      if (
        !previous ||
        state.history.features !== previous.history.features ||
        state.rebuild !== previous.rebuild ||
        state.activeEdit !== previous.activeEdit ||
        state.sketch?.index !== previous.sketch?.index ||
        state.hover !== previous.hover ||
        state.selection !== previous.selection ||
        state.display !== previous.display
      ) {
        engine.setReferences(referenceItems(state));
        engine.setThreads(visibleThreads(state));
      }
      const plane = state.sketch?.draft.plane;
      if (!previous || plane !== previous.sketch?.draft.plane) {
        // Entering sketch mode turns the view normal to the sketch plane.
        engine.setSketchFrame(plane ? frameOf(plane) : null, plane !== undefined && !previous?.sketch);
      }
      const sketch = state.sketch?.draft.sketch;
      if (sketch && (sketch !== previous?.sketch?.draft.sketch || plane !== previous.sketch.draft.plane || state.sketchAnalysis !== previous.sketchAnalysis)) {
        engine.setActiveSketch(sketch, sketchHighlight(state), statusColors(state));
      } else if (sketch && (state.sketchHover !== previous?.sketchHover || state.sketchSelection !== previous.sketchSelection)) {
        engine.setSketchHighlight(sketchHighlight(state));
      }
      if (
        !previous ||
        state.history.features !== previous.history.features ||
        state.sketch?.index !== previous.sketch?.index ||
        state.activeEdit?.index !== previous.activeEdit?.index ||
        state.rollback !== previous.rollback
      ) {
        engine.setInactiveSketches(inactiveSketches(state));
      }
      if (
        !previous ||
        state.measurement !== previous.measurement ||
        state.measuring !== previous.measuring ||
        state.selection !== previous.selection ||
        state.language !== previous.language
      ) {
        engine.setMeasureLines(measureLines(state));
      }
      if (!previous || state.section !== previous.section) engine.setSection(state.section ? sectionCut(state.section) : null);
      if (!previous || state.effectiveTheme !== previous.effectiveTheme) engine.setTheme(state.effectiveTheme);
      if (!previous || state.history.properties !== previous.history.properties) engine.setBodyColor(partColor(partProperties(state.history)));
      if (!previous || state.language !== previous.language) engine.setDimensionLanguage(state.language);
      if (!previous || state.settings.projection !== previous.settings.projection) engine.setProjection(state.settings.projection);
      if (!previous || state.settings.navigation !== previous.settings.navigation) engine.setNavigation(state.settings.navigation);
      if (!previous || state.settings.showSketchRelations !== previous.settings.showSketchRelations) {
        engine.setShowRelations(state.settings.showSketchRelations);
      }
      if (!previous || state.settings.showFrameStats !== previous.settings.showFrameStats) {
        engine.setFrameStatsEnabled(state.settings.showFrameStats);
      }
    };
    sync(store.getState(), null);
    const unsubscribe = store.subscribe((state, previous) => sync(state, previous));

    return () => {
      unsubscribe();
      controller.dispose();
      registerSketchControl(null);
      registerViewport(null);
      engineRef.current = null;
      engine.dispose();
    };
  }, [i18n]);

  useEffect(() => {
    engineRef.current?.setCubeLabels(cubeLabels(t));
  }, [t, i18n.language]);

  return (
    <div ref={viewportRef} className="viewport" data-testid="viewport">
      <div ref={containerRef} className="viewport-surface" />
      <div ref={cursorInfoRef} className="sketch-cursor-info" data-testid="sketch-cursor-info" hidden />
      <ViewToolbar />
      <div className="viewport-panels">
        <SectionPanel />
        <MeasurePanel />
        <MassPropertiesPanel />
      </div>
    </div>
  );
}
