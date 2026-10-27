import {
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NoToneMapping,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  Scene,
  Sphere,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Camera,
  type Intersection,
  type Object3D,
} from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import type { MeshPayload } from '../../../kernel/protocol.ts';
import type { Vec3 } from '../../../shared/model/feature.ts';
import type { CosmeticThread } from '../../../shared/model/hole.ts';
import { toSketch, type SketchData, type SketchFrame } from '../../../shared/model/sketch.ts';
import type { NavigationPreset, Projection } from '../../../shared/settings.ts';
import type { FrameStats, Pick } from '../state/store.ts';
import { CameraController } from './camera-controller.ts';
import { AxisTriad } from './axis-triad.ts';
import { palettes, type ViewportPalette } from './palette.ts';
import { DirectionArrow, type DirectionArrowSpec } from './direction-arrow.ts';
import { LostMarkers } from './lost-markers.ts';
import { MeasureGraphics, type MeasureLine } from './measure-graphics.ts';
import { SectionView, type SectionCut } from './section-view.ts';
import { CosmeticThreads } from './threads.ts';
import { pointTexture, ReferenceGeometryLayer, type ReferenceItem } from './reference-geometry.ts';
import { disposeOverlay, PartModel } from './part-model.ts';
import { ReferencePlanes, type PlaneDisplay } from './reference-planes.ts';
import {
  defaultDimensionFormat,
  GLYPH_SIZE_PX,
  NO_HIGHLIGHT,
  SketchGraphics,
  SketchMaterials,
  type SketchHighlight,
  type SketchStatusColors,
} from './sketch-graphics.ts';
import { SketchLayer, type SketchToolDisplay } from './sketch-layer.ts';
import { createSyntheticAssembly, type SyntheticAssembly } from './synthetic-scene.ts';
import { ViewCube, type CubeFace } from './view-cube.ts';
import { VIEW_DIRECTIONS, viewQuaternion, type StandardView } from './views.ts';

/** What a click can pick: everything, only edges (fillet, chamfer), planes and planar faces (choosing a sketch plane) or nothing. */
/** What a click can pick: anything, only edges (fillets), only faces (shells), only planes (sketch planes), references (reference geometry) or nothing. */
/** `edgesAndFaces`: fillets and chamfers (an edge where one is near, otherwise the face, no vertices). */
export type PickFilter = 'all' | 'edges' | 'edgesAndFaces' | 'faces' | 'planes' | 'references' | 'none';

/** Pointer position in sketch mode: CSS pixels on the canvas and sketch coordinates on the sketch plane. */
export interface SketchPointer {
  x: number;
  y: number;
  u: number;
  v: number;
  mmPerPixel: number;
  additive: boolean;
}

/** Receives the left-button input while a sketch is open (see sketch/controller.ts). */
export interface SketchInput {
  hover(pointer: SketchPointer | null): void;
  down(pointer: SketchPointer): void;
  move(pointer: SketchPointer): void;
  up(pointer: SketchPointer, moved: boolean): void;
}

/** A sketch shown in the 3D view while it is not open. */
export interface InactiveSketch {
  id: string;
  frame: SketchFrame;
  data: SketchData;
  /** Entities shown highlighted, e.g. the axis of the revolution being edited. */
  highlighted?: readonly string[];
}

export interface ViewportCallbacks {
  onHover(pick: Pick | null): void;
  onPick(pick: Pick | null, additive: boolean): void;
  onFrameStats(stats: FrameStats): void;
}

export interface BenchmarkResult {
  frames: number;
  fps: number;
  frameMsMedian: number;
  frameMsP95: number;
  cpuMsMedian: number;
  triangles: number;
  drawCalls: number;
}

type DragMode = 'rotate' | 'pan' | 'select' | 'cube' | 'sketch';

interface DragState {
  mode: DragMode;
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  button: number;
  pivot: Vector3;
}

const CLICK_TOLERANCE_PX = 4;
const EDGE_PICK_THRESHOLD_PX = 5;
/** How close to the end of an edge (in CSS pixels) a click picks the vertex there. */
const VERTEX_PICK_PX = 9;
/** Smallest half side length of the standard planes, in mm. */
const MIN_PLANE_HALF_SIZE = 40;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number;
}

function samePick(a: Pick | null, b: Pick | null): boolean {
  return a === b || (a !== null && b !== null && a.kind === b.kind && a.index === b.index);
}

/** Renders parts, handles navigation and picking. Lives outside React for predictable performance. */
export class ViewportEngine {
  private readonly container: HTMLElement;
  private readonly callbacks: ViewportCallbacks;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  /** HTML labels (dimension values) positioned over the canvas. */
  private readonly labelRenderer = new CSS2DRenderer();
  private readonly scene = new Scene();
  private readonly overlays = new Group();
  private readonly ortho = new OrthographicCamera();
  private readonly perspective = new PerspectiveCamera();
  private readonly controller = new CameraController();
  private readonly hemisphere: HemisphereLight;
  private readonly headlight = new DirectionalLight(0xffffff, 2.1);
  private readonly raycaster = new Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private readonly viewCube: ViewCube;
  private readonly triad = new AxisTriad();
  private readonly referencePlanes = new ReferencePlanes();
  private readonly sketchMaterials = new SketchMaterials();
  private readonly sketchLayer = new SketchLayer(this.sketchMaterials);
  private readonly inactiveSketches = new Map<string, SketchGraphics>();
  private readonly inactiveHighlights = new Map<string, string>();
  private readonly inactiveSketchGroup = new Group();
  private sketchInput: SketchInput | null = null;
  private lastSketchPointer: SketchPointer | null = null;
  private readonly pivotMarker: Mesh<SphereGeometry, MeshBasicMaterial>;
  private readonly lostMarkers = new LostMarkers();
  private readonly directionArrow = new DirectionArrow();
  private readonly measureGraphics = new MeasureGraphics();
  private readonly sectionView = new SectionView();
  private sectionCut: SectionCut | null = null;
  private palette: ViewportPalette = palettes.light;
  /** The part's own color, over the theme's body color. */
  private bodyColor: string | null = null;
  private readonly materials: {
    face: MeshStandardMaterial;
    edge: LineMaterial;
    hoverFace: MeshStandardMaterial;
    hoverEdge: LineMaterial;
    selectedFace: MeshStandardMaterial;
    selectedEdge: LineMaterial;
    referenceEdge: LineMaterial;
  };

  private projection: Projection = 'orthographic';
  private navigation: NavigationPreset = 'mouse';
  private body: PartModel | null = null;
  private preview: PartModel | null = null;
  private bench: SyntheticAssembly | null = null;
  private bodyPickable = true;
  private pickFilter: PickFilter = 'all';
  private selection: Pick[] = [];
  private hover: Pick | null = null;
  private selectionOverlays: (Mesh | LineSegments2 | Sprite)[] = [];
  private hoverOverlay: Mesh | LineSegments2 | Sprite | null = null;
  private readonly referenceGeometry = new ReferenceGeometryLayer();
  private readonly threads = new CosmeticThreads();
  private readonly vertexMaterials = { hover: new SpriteMaterial({ depthTest: false, transparent: true }), selected: new SpriteMaterial({ depthTest: false, transparent: true }) };
  private bounds = new Sphere(new Vector3(0, 0, 20), 120);
  private fitOnNextBody = true;

  private width = 1;
  private height = 1;
  private frameRequested = false;
  private continuousRequests = 0;
  private drag: DragState | null = null;
  private lastPointer: { x: number; y: number } | null = null;
  private hoverQueued = false;
  private wheelPivot: { point: Vector3; time: number } | null = null;
  private disposed = false;

  private statsEnabled = false;
  private lastFrameTime = 0;
  private frameIntervals: number[] = [];
  private cpuTimes: number[] = [];
  private lastStatsEmit = 0;
  private frameListener: ((interval: number, cpu: number, total: number) => void) | null = null;
  private readonly syncPixel = new Uint8Array(4);

  constructor(container: HTMLElement, callbacks: ViewportCallbacks, labels: Record<CubeFace, string>) {
    this.container = container;
    this.callbacks = callbacks;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'viewport-canvas';
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.labelRenderer.domElement.className = 'viewport-labels';
    container.appendChild(this.labelRenderer.domElement);

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      // The section view finds its caps with the stencil buffer.
      stencil: true,
    });
    this.renderer.localClippingEnabled = true;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;

    this.materials = {
      face: new MeshStandardMaterial({ metalness: 0.08, roughness: 0.62, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
      edge: new LineMaterial({ linewidth: 1.3, worldUnits: false }),
      hoverFace: new MeshStandardMaterial({ metalness: 0.05, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 0.5 }),
      hoverEdge: new LineMaterial({ linewidth: 3.5, worldUnits: false }),
      selectedFace: new MeshStandardMaterial({ metalness: 0.05, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: 0.5, polygonOffsetUnits: 0.5 }),
      selectedEdge: new LineMaterial({ linewidth: 3.5, worldUnits: false }),
      referenceEdge: new LineMaterial({ linewidth: 1.6, worldUnits: false }),
    };
    this.sectionView.setClippedMaterials(Object.values(this.materials));

    this.hemisphere = new HemisphereLight(0xffffff, 0x888888, 1.9);
    this.scene.add(
      this.hemisphere,
      this.headlight,
      this.headlight.target,
      this.overlays,
      this.referencePlanes.group,
      this.inactiveSketchGroup,
      this.sketchLayer.group,
    );

    this.pivotMarker = new Mesh(new SphereGeometry(1, 16, 12), new MeshBasicMaterial({ depthTest: false }));
    this.pivotMarker.renderOrder = 10;
    this.pivotMarker.visible = false;
    this.scene.add(this.pivotMarker, this.lostMarkers.group, this.directionArrow.group, this.measureGraphics.group, this.sectionView.group, this.referenceGeometry.group, this.threads.group);
    const texture = pointTexture();
    this.vertexMaterials.hover.map = texture;
    this.vertexMaterials.selected.map = texture;

    this.viewCube = new ViewCube(this.palette, labels);
    this.setTheme('light');

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.bindEvents();
    this.requestRender();
  }

  // ---------------------------------------------------------------- content

  setBody(payload: MeshPayload | null, pickable: boolean): void {
    this.bodyPickable = pickable;
    if (payload?.key === this.body?.key) return;
    this.clearHover();
    this.clearSelectionOverlays();
    if (this.body) {
      this.scene.remove(this.body.group);
      this.body.dispose();
      this.body = null;
    }
    if (payload) {
      this.body = new PartModel(payload, this.materials.face, this.materials.edge);
      this.scene.add(this.body.group);
    }
    this.updateBounds();
    if (this.body && this.fitOnNextBody) {
      this.fitOnNextBody = false;
      this.zoomToFit(false);
    }
    this.applyPreviewMode();
    this.rebuildSelectionOverlays();
    this.requestRender();
  }

  /**
   * Shows the result of the feature being edited. The body before the feature
   * stays pickable: its faces are hidden (but still hit-tested) and its edges are
   * drawn as reference lines on top of the result.
   */
  setPreview(payload: MeshPayload | null): void {
    if (payload?.key !== this.preview?.key) {
      if (this.preview) {
        this.scene.remove(this.preview.group);
        this.preview.dispose();
        this.preview = null;
      }
      if (payload) {
        this.preview = new PartModel(payload, this.materials.face, this.materials.edge);
        this.preview.mesh.raycast = () => undefined;
        this.preview.edges.raycast = () => undefined;
        this.scene.add(this.preview.group);
      }
    }
    this.applyPreviewMode();
    this.requestRender();
  }

  private applyPreviewMode(): void {
    // The section caps the body that is shown: the preview while a feature is edited.
    this.sectionView.attach(this.preview ?? this.body);
    this.sectionView.set(this.sectionCut, this.bounds);
    if (!this.body) return;
    const previewing = this.preview !== null;
    // Raycasting ignores visibility, so the hidden faces still occlude and pick.
    this.body.mesh.visible = !previewing;
    this.body.edges.material = previewing ? this.materials.referenceEdge : this.materials.edge;
    this.body.edges.renderOrder = previewing ? 4 : 1;
  }

  /** The reference planes, axes and points to show (see ReferenceGeometryLayer). */
  setReferences(items: readonly ReferenceItem[]): void {
    const counted = this.referenceGeometry.count;
    this.referenceGeometry.set(items);
    if (counted !== this.referenceGeometry.count) this.updateBounds();
    this.requestRender();
  }

  get referenceCount(): number {
    return this.referenceGeometry.count;
  }

  /** The cosmetic threads of tapped holes (see CosmeticThreads). */
  setThreads(threads: readonly CosmeticThread[]): void {
    this.threads.set(threads);
    this.requestRender();
  }

  get threadCount(): number {
    return this.threads.count;
  }

  /** Marks where lost references were (see LostMarkers). */
  setLostMarkers(points: readonly Vec3[]): void {
    this.lostMarkers.set(points);
    this.requestRender();
  }

  get lostMarkerCount(): number {
    return this.lostMarkers.count;
  }

  /** Shows which way the copies of the pattern being edited go (null: no arrow); see DirectionArrow. */
  setDirectionArrow(arrow: DirectionArrowSpec | null): void {
    this.directionArrow.set(arrow);
    this.requestRender();
  }

  get directionArrowShown(): DirectionArrowSpec | null {
    return this.directionArrow.shown;
  }

  /** Cuts the part open in the view (null: whole part); see SectionView. */
  setSection(cut: SectionCut | null): void {
    this.sectionCut = cut;
    this.sectionView.set(cut, this.bounds);
    this.requestRender();
  }

  get sectionActive(): boolean {
    return this.sectionView.active;
  }

  /** Shows the lines of the measure tool (see MeasureGraphics). */
  setMeasureLines(lines: readonly MeasureLine[]): void {
    this.measureGraphics.set(lines);
    this.requestRender();
  }

  get measureLineCount(): number {
    return this.measureGraphics.count;
  }

  setSelection(picks: Pick[]): void {
    this.selection = picks;
    this.rebuildSelectionOverlays();
    this.requestRender();
  }

  setPickFilter(filter: PickFilter): void {
    this.pickFilter = filter;
    if (filter === 'none') this.clearHover();
  }

  setReferencePlanes(display: PlaneDisplay): void {
    const wasVisible = this.referencePlanes.anyVisible;
    this.referencePlanes.setDisplay(display);
    if (wasVisible !== this.referencePlanes.anyVisible) this.updateBounds();
    this.requestRender();
  }

  /** Enters (frame) or leaves (null) sketch mode; `orient` turns the view normal to the sketch plane. */
  setSketchFrame(frame: SketchFrame | null, orient = false): void {
    this.sketchLayer.setFrame(frame);
    this.updateBounds();
    if (frame && orient) this.lookAtFrame(frame);
    this.requestRender();
  }

  /** Geometry of the open sketch, or of an intermediate state while dragging. */
  setActiveSketch(sketch: SketchData, highlight: SketchHighlight, status: SketchStatusColors | null = null): void {
    this.sketchLayer.setSketch(sketch, highlight, status);
    this.updateBounds();
    this.requestRender();
  }

  setSketchToolDisplay(display: SketchToolDisplay | null): void {
    this.sketchLayer.setToolDisplay(display);
    this.requestRender();
  }

  setSketchHighlight(highlight: SketchHighlight): void {
    this.sketchLayer.setHighlight(highlight);
    this.requestRender();
  }

  /** The sketches shown while they are not open; unchanged ones are kept as they are. */
  setInactiveSketches(sketches: readonly InactiveSketch[]): void {
    const shown = new Set<string>();
    for (const sketch of sketches) {
      shown.add(sketch.id);
      let graphics = this.inactiveSketches.get(sketch.id);
      if (!graphics) {
        graphics = new SketchGraphics(this.sketchMaterials, 'inactive');
        this.inactiveSketches.set(sketch.id, graphics);
        this.inactiveSketchGroup.add(graphics.group);
      }
      graphics.setFrame(sketch.frame);
      const highlightKey = (sketch.highlighted ?? []).join(' ');
      if (graphics.data !== sketch.data || this.inactiveHighlights.get(sketch.id) !== highlightKey) {
        graphics.update(sketch.data, highlightKey ? { hovered: null, selected: sketch.highlighted ?? [] } : NO_HIGHLIGHT, this.mmPerPixel());
        this.inactiveHighlights.set(sketch.id, highlightKey);
      }
    }
    for (const [id, graphics] of this.inactiveSketches) {
      if (shown.has(id)) continue;
      this.inactiveSketchGroup.remove(graphics.group);
      graphics.dispose();
      this.inactiveSketches.delete(id);
      this.inactiveHighlights.delete(id);
    }
    this.updateBounds();
    this.requestRender();
  }

  /** Number format of dimension labels (decimal comma in German). */
  setDimensionLanguage(language: string): void {
    this.sketchMaterials.format = defaultDimensionFormat(language);
    this.sketchLayer.refresh();
    this.requestRender();
  }

  /** Relation symbols next to the geometry of the open sketch on or off. */
  setShowRelations(show: boolean): void {
    if (this.sketchMaterials.showRelations === show) return;
    this.sketchMaterials.showRelations = show;
    this.sketchLayer.refresh();
    this.requestRender();
  }

  /** The dimension whose label is under a canvas position (CSS pixels), if any. */
  dimensionAt(x: number, y: number): string | null {
    if (!this.sketchLayer.active) return null;
    const canvas = this.canvas.getBoundingClientRect();
    for (const [id, element] of this.sketchLayer.dimensionLabelElements()) {
      const rect = element.getBoundingClientRect();
      const [left, top] = [rect.left - canvas.left, rect.top - canvas.top];
      // A few pixels of slack make small labels easier to grab.
      if (x >= left - 3 && x <= left + rect.width + 3 && y >= top - 3 && y <= top + rect.height + 3) return id;
    }
    return null;
  }

  /** The relation symbols of the open sketch at their screen positions (CSS pixels on the canvas). */
  relationGlyphsOnScreen(): { relation: string; kind: string; symbol: string; x: number; y: number }[] {
    if (!this.sketchLayer.active) return [];
    return this.sketchLayer.relationGlyphs().flatMap((glyph) => {
      const at = this.sketchToScreen(glyph.at[0], glyph.at[1]);
      return at ? [{ relation: glyph.relation, kind: glyph.kind, symbol: glyph.symbol, ...at }] : [];
    });
  }

  /** The relation whose symbol is under a canvas position (CSS pixels), if any; the nearest one wins. */
  relationAt(x: number, y: number): string | null {
    const reach = GLYPH_SIZE_PX / 2 + 2;
    let best: { relation: string; distance: number } | null = null;
    for (const glyph of this.relationGlyphsOnScreen()) {
      const [dx, dy] = [Math.abs(glyph.x - x), Math.abs(glyph.y - y)];
      if (dx > reach || dy > reach) continue;
      const distance = Math.hypot(dx, dy);
      if (!best || distance < best.distance) best = { relation: glyph.relation, distance };
    }
    return best?.relation ?? null;
  }

  dimensionLabel(id: string): HTMLElement | null {
    return this.sketchLayer.dimensionLabel(id);
  }

  /** Screen position (CSS pixels on the canvas) of a point in sketch coordinates of the open sketch. */
  sketchToScreen(u: number, v: number): { x: number; y: number } | null {
    const frame = this.sketchLayer.sketchFrame;
    if (!frame) return null;
    const p = new Vector3(...frame.origin).addScaledVector(new Vector3(...frame.xDir), u).addScaledVector(new Vector3(...frame.yDir), v);
    return this.project(p);
  }

  setSketchInput(input: SketchInput | null): void {
    this.sketchInput = input;
  }

  /** Benchmarks: the mouse moves to (or clicks at) a point of the open sketch, given in sketch coordinates. */
  simulateSketchPointer(u: number, v: number, action: 'hover' | 'click'): void {
    const screen = this.sketchToScreen(u, v);
    const pointer = screen ? this.sketchPointer(screen.x, screen.y, false) : null;
    if (!pointer || !this.sketchInput) return;
    if (action === 'hover') {
      this.sketchInput.hover(pointer);
    } else {
      this.sketchInput.down(pointer);
      this.sketchInput.up(pointer, false);
    }
  }

  setCursor(cursor: string): void {
    this.canvas.style.cursor = cursor;
  }

  /** The next body that appears is framed automatically (new or opened document). */
  requestFitOnNextBody(): void {
    this.fitOnNextBody = true;
  }

  // ---------------------------------------------------------------- appearance

  /** The part's own color ('#rrggbb'); null shows it in the theme's body color. */
  setBodyColor(color: string | null): void {
    this.bodyColor = color;
    this.materials.face.color.set(color ?? this.palette.body);
    this.requestRender();
  }

  setTheme(theme: 'light' | 'dark'): void {
    this.palette = palettes[theme];
    const p = this.palette;
    this.materials.face.color.set(this.bodyColor ?? p.body);
    this.materials.edge.color.setHex(p.edge);
    this.materials.hoverFace.color.setHex(p.hover);
    this.materials.hoverEdge.color.setHex(p.hover);
    this.materials.selectedFace.color.setHex(p.selected);
    this.materials.selectedEdge.color.setHex(p.selected);
    this.materials.referenceEdge.color.setHex(p.referenceEdge);
    this.pivotMarker.material.color.setHex(p.pivot);
    this.lostMarkers.setColor(p.lost);
    this.directionArrow.setColor(p.selected);
    this.measureGraphics.setColor(p.measure);
    this.sectionView.setCapColor(p.sectionCap);
    this.referenceGeometry.setPalette(p);
    this.threads.setColor(p.edge);
    this.vertexMaterials.hover.color.setHex(p.hover);
    this.vertexMaterials.selected.color.setHex(p.selected);
    this.referencePlanes.setPalette(p);
    this.sketchLayer.setPalette(p);
    this.sketchMaterials.setPalette(p);
    this.sketchLayer.refresh();
    for (const graphics of this.inactiveSketches.values()) graphics.refresh();
    this.hemisphere.color = new Color(p.hemisphereSky);
    this.hemisphere.groundColor = new Color(p.hemisphereGround);
    this.viewCube.setPalette(p);
    this.requestRender();
  }

  setCubeLabels(labels: Record<CubeFace, string>): void {
    this.viewCube.refreshLabels(labels);
    this.requestRender();
  }

  setProjection(projection: Projection): void {
    this.projection = projection;
    this.requestRender();
  }

  setNavigation(navigation: NavigationPreset): void {
    this.navigation = navigation;
  }

  // ---------------------------------------------------------------- views

  zoomToFit(animate = true): void {
    this.updateBounds();
    const target = this.controller.fitState(this.bounds, this.aspect());
    // A view that is turning (to a sketch plane, say) goes on turning to the fitted view.
    this.controller.animateTo(target, animate || this.controller.animating ? 320 : 0);
    this.requestRender();
  }

  setStandardView(view: StandardView): void {
    this.setViewDirection(VIEW_DIRECTIONS[view]);
  }

  setViewDirection(direction: Vector3): void {
    this.updateBounds();
    const target = this.controller.fitState(this.bounds, this.aspect(), viewQuaternion(direction));
    this.controller.animateTo(target);
    this.requestRender();
  }

  /** Looks straight at a plane with its x axis pointing right ("normal to"). */
  lookAtFrame(frame: SketchFrame): void {
    this.updateBounds();
    const basis = new Matrix4().makeBasis(new Vector3(...frame.xDir), new Vector3(...frame.yDir), new Vector3(...frame.normal));
    const target = this.controller.fitState(this.bounds, this.aspect(), new Quaternion().setFromRotationMatrix(basis));
    this.controller.animateTo(target);
    this.requestRender();
  }

  // ---------------------------------------------------------------- statistics and benchmarks

  setFrameStatsEnabled(enabled: boolean): void {
    this.statsEnabled = enabled;
    this.frameIntervals = [];
    this.cpuTimes = [];
  }

  loadBenchmarkScene(components: number, instanced: boolean): { triangles: number; drawCalls: number } {
    this.clearBenchmarkScene();
    this.bench = createSyntheticAssembly(components, instanced);
    this.scene.add(this.bench.group);
    this.updateBounds();
    this.zoomToFit(false);
    return { triangles: this.bench.triangles, drawCalls: this.bench.drawCalls };
  }

  clearBenchmarkScene(): void {
    if (!this.bench) return;
    this.scene.remove(this.bench.group);
    this.bench.dispose();
    this.bench = null;
    this.updateBounds();
    this.requestRender();
  }

  /**
   * Orbits the camera for `frames` frames and reports GPU-synchronized frame times
   * (CPU work plus GPU completion of each frame).
   */
  runOrbitBenchmark(frames = 240): Promise<BenchmarkResult> {
    return new Promise((resolve) => {
      const totals: number[] = [];
      const cpu: number[] = [];
      let triangles = 0;
      let drawCalls = 0;
      this.continuousRequests += 1;
      this.frameListener = (_interval, cpuMs, totalMs) => {
        this.controller.rotate(6, 1.5, this.bounds.center);
        totals.push(totalMs);
        cpu.push(cpuMs);
        triangles = this.renderer.info.render.triangles;
        drawCalls = this.renderer.info.render.calls;
        if (totals.length >= frames) {
          this.frameListener = null;
          this.continuousRequests -= 1;
          const frameMsMedian = percentile(totals, 50);
          resolve({
            frames: totals.length,
            fps: frameMsMedian > 0 ? 1000 / frameMsMedian : 0,
            frameMsMedian,
            frameMsP95: percentile(totals, 95),
            cpuMsMedian: percentile(cpu, 50),
            triangles,
            drawCalls,
          });
        }
      };
      this.requestRender();
    });
  }

  /** Renders a frame right away, so HTML labels exist and are positioned (e.g. before editing one). */
  renderFrame(): void {
    this.controller.update(performance.now());
    this.renderNow();
  }

  /** Renders one frame right away and waits for the GPU; returns the time in ms (benchmarks). */
  renderSynchronously(): number {
    const start = performance.now();
    this.controller.update(start);
    this.renderNow();
    const gl = this.renderer.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.syncPixel);
    return performance.now() - start;
  }

  debugInfo(): { triangles: number; drawCalls: number; geometries: number; textures: number } {
    return {
      triangles: this.renderer.info.render.triangles,
      drawCalls: this.renderer.info.render.calls,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
    };
  }

  /** Screen position (CSS pixels, relative to the canvas) of a world point; used by tests. */
  project(point: Vector3): { x: number; y: number } {
    const camera = this.camera();
    camera.updateMatrixWorld();
    const ndc = point.clone().project(camera);
    return { x: ((ndc.x + 1) / 2) * this.width, y: ((1 - ndc.y) / 2) * this.height };
  }

  // ---------------------------------------------------------------- rendering

  requestRender(): void {
    if (this.frameRequested || this.disposed) return;
    this.frameRequested = true;
    requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.frameRequested = false;
    if (this.disposed) return;
    const animating = this.controller.update(now);
    const cpuStart = performance.now();
    this.renderNow();
    const cpuMs = performance.now() - cpuStart;

    const interval = this.lastFrameTime > 0 && now - this.lastFrameTime < 250 ? now - this.lastFrameTime : 0;
    this.lastFrameTime = now;
    if (this.frameListener) {
      // Benchmarks wait for the GPU to finish the frame; otherwise frame intervals only measure the CPU side.
      const gl = this.renderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.syncPixel);
      this.frameListener(interval, cpuMs, performance.now() - cpuStart);
    }
    if (this.statsEnabled) this.collectStats(interval, cpuMs, now);

    if (animating || this.drag !== null || this.continuousRequests > 0) this.requestRender();
  };

  private renderNow(): void {
    const camera = this.camera();
    this.controller.apply(this.ortho, this.perspective, this.aspect(), this.bounds);
    this.updateHeadlight();
    this.updatePivotMarkerScale();
    const mmPerPixel = this.mmPerPixel();
    this.sketchMaterials.setZoom(mmPerPixel);
    this.lostMarkers.setZoom(mmPerPixel);
    this.directionArrow.setZoom(mmPerPixel);
    this.measureGraphics.setZoom(mmPerPixel);
    this.referenceGeometry.setZoom(mmPerPixel);
    // Vertex highlights keep their size on screen.
    for (const overlay of [this.hoverOverlay, ...this.selectionOverlays]) {
      if (overlay instanceof Sprite) overlay.scale.setScalar(12 * mmPerPixel);
    }
    for (const graphics of this.inactiveSketches.values()) graphics.ensureResolution(mmPerPixel);
    if (this.sketchLayer.active) {
      const { target, height } = this.controller.state;
      this.sketchLayer.update({ target, height, aspect: this.aspect(), viewportHeightPx: this.height });
    }

    this.renderer.info.reset();
    this.renderer.setViewport(0, 0, this.width, this.height);
    this.renderer.setScissorTest(false);
    this.renderer.clear(true, true, true);
    this.renderer.render(this.scene, camera);
    // Labels only exist in sketch mode and for measurements; skipping the label pass keeps large scenes fast.
    const labels = this.sketchLayer.active || this.measureGraphics.hasLabels;
    this.labelRenderer.domElement.hidden = !labels;
    if (labels) this.labelRenderer.render(this.scene, camera);
    this.viewCube.render(this.renderer, this.width, this.height, this.controller.state.quaternion);
    this.triad.render(this.renderer, this.height, this.controller.state.quaternion);
  }

  private collectStats(interval: number, cpuMs: number, now: number): void {
    if (interval > 0) this.frameIntervals.push(interval);
    this.cpuTimes.push(cpuMs);
    if (now - this.lastStatsEmit < 500 || this.frameIntervals.length < 5) return;
    this.lastStatsEmit = now;
    const median = percentile(this.frameIntervals, 50);
    this.callbacks.onFrameStats({ fps: median > 0 ? Math.round(1000 / median) : 0, frameMs: Math.round(percentile(this.cpuTimes, 50) * 10) / 10 });
    this.frameIntervals = [];
    this.cpuTimes = [];
  }

  private camera(): Camera {
    return this.projection === 'perspective' ? this.perspective : this.ortho;
  }

  private aspect(): number {
    return this.width / Math.max(1, this.height);
  }

  private mmPerPixel(): number {
    return this.controller.state.height / Math.max(1, this.height);
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.width, this.height, false);
    this.labelRenderer.setSize(this.width, this.height);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    const resolution = new Vector2(this.width, this.height);
    for (const material of [this.materials.edge, this.materials.hoverEdge, this.materials.selectedEdge, this.materials.referenceEdge]) {
      material.resolution.copy(resolution);
    }
    this.referencePlanes.setResolution(resolution);
    this.referenceGeometry.setResolution(resolution);
    this.threads.setResolution(resolution);
    this.directionArrow.setResolution(this.width, this.height);
    this.sketchLayer.setResolution(resolution);
    this.sketchMaterials.setResolution(resolution, this.renderer.getPixelRatio());
    this.requestRender();
  }

  private updateHeadlight(): void {
    const camera = this.camera();
    const offset = this.controller.up().multiplyScalar(0.6).add(this.controller.right().multiplyScalar(-0.35));
    this.headlight.position.copy(camera.position).addScaledVector(offset, this.controller.state.height);
    this.headlight.target.position.copy(this.controller.state.target);
    this.headlight.target.updateMatrixWorld();
  }

  private updatePivotMarkerScale(): void {
    if (!this.pivotMarker.visible) return;
    this.pivotMarker.scale.setScalar((this.controller.state.height / this.height) * 4);
  }

  private updateBounds(): void {
    const box = new Box3();
    for (const model of [this.body, this.preview]) {
      if (model?.mesh.geometry.boundingBox) box.union(model.mesh.geometry.boundingBox);
    }
    if (this.bench) {
      this.bounds = this.bench.bounds.clone();
      return;
    }
    // The standard planes reach a little beyond the body in every direction from the origin.
    const reach = box.isEmpty() ? 0 : Math.max(...box.min.toArray().map(Math.abs), ...box.max.toArray().map(Math.abs));
    this.referencePlanes.setHalfSize(Math.max(MIN_PLANE_HALF_SIZE, Math.ceil((reach * 1.15) / 10) * 10));
    // Reference planes and axes are drawn as large as the part.
    this.referenceGeometry.setExtent(box.isEmpty() ? null : box);
    const planes = this.referencePlanes.visibleBounds();
    if (planes) box.union(planes);
    const references = this.referenceGeometry.bounds();
    if (references) box.union(references);
    for (const sketch of [this.sketchLayer.worldBounds(), ...[...this.inactiveSketches.values()].map((graphics) => graphics.worldBounds())]) {
      if (sketch) box.union(sketch);
    }
    // The sketch plane must stay inside the camera's depth range.
    const frame = this.sketchLayer.sketchFrame;
    if (frame && !box.isEmpty()) box.expandByPoint(new Vector3(...frame.origin));
    if (box.isEmpty()) {
      this.bounds = new Sphere(new Vector3(0, 0, 20), 120);
      return;
    }
    box.getBoundingSphere(this.bounds);
  }

  // ---------------------------------------------------------------- picking and highlighting

  private ndc(x: number, y: number): Vector2 {
    return new Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
  }

  private pickAt(x: number, y: number): Pick | null {
    if (this.pickFilter === 'none') return null;
    const body = this.bodyPickable ? this.body : null;
    const camera = this.camera();
    this.controller.apply(this.ortho, this.perspective, this.aspect(), this.bounds);
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc(x, y), camera);
    this.raycaster.params.Line2 = { threshold: EDGE_PICK_THRESHOLD_PX };
    (this.raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;

    body?.ensureBvh();
    // Faces always occlude what lies behind them, even when they cannot be picked themselves.
    const faceHit = body ? this.firstShownHit(body.mesh) : undefined;
    const edgeHit = body && this.pickFilter !== 'planes' && this.pickFilter !== 'faces' ? this.firstShownHit(body.edges) : undefined;
    const bodyOnly = this.pickFilter === 'edges' || this.pickFilter === 'edgesAndFaces' || this.pickFilter === 'faces';
    const planeHit = bodyOnly ? null : this.referencePlanes.intersect(this.raycaster);
    // Choosing a sketch plane takes reference planes, not axes or points.
    const referenceHit = bodyOnly ? null : this.referenceGeometry.intersect(this.raycaster, this.pickFilter === 'planes' ? 'plane' : undefined);
    const worldPerPixel = this.controller.state.height / this.height;
    const tolerance = worldPerPixel * 8;
    const at = (point: Vector3): Vec3 => [point.x, point.y, point.z];

    if (body && edgeHit && edgeHit.faceIndex !== undefined && edgeHit.faceIndex !== null && (!faceHit || edgeHit.distance <= faceHit.distance + tolerance)) {
      const edge = body.edgeOfSegment(edgeHit.faceIndex);
      // Near the end of an edge the vertex there is picked (not for fillets, which take edges only).
      const vertex = this.pickFilter === 'edges' || this.pickFilter === 'edgesAndFaces' ? null : body.vertexNear(edge, edgeHit.point, worldPerPixel * VERTEX_PICK_PX);
      if (vertex !== null) return { kind: 'vertex', index: vertex, at: at(body.vertexPosition(vertex)) };
      return { kind: 'edge', index: edge, at: at(edgeHit.point) };
    }
    // Reference points are drawn on top of everything, so they win where they are.
    if (referenceHit && (!faceHit || referenceHit.distance < faceHit.distance + tolerance)) {
      const feature = referenceHit.index;
      if (this.pickFilter === 'all' || this.pickFilter === 'references' || this.pickFilter === 'planes') return { kind: 'reference', index: feature };
    }
    // A pickable face wins over a translucent plane in front of it: the face is what one sees and aims at,
    // and planes stay pickable where they extend beyond the part (and in the feature tree).
    if (body && faceHit && faceHit.faceIndex !== undefined && faceHit.faceIndex !== null) {
      const face = body.faceOfTriangle(faceHit.faceIndex);
      if (this.pickFilter === 'all' || this.pickFilter === 'references' || this.pickFilter === 'faces' || this.pickFilter === 'edgesAndFaces' || (this.pickFilter === 'planes' && body.isPlanarFace(face))) {
        return { kind: 'face', index: face, at: at(faceHit.point) };
      }
    }
    if (planeHit && (!faceHit || planeHit.distance < faceHit.distance)) return { kind: 'plane', index: planeHit.index };
    return null;
  }

  /** The model edge under a canvas position (CSS pixels), unless a face hides it; for sketch tools. */
  modelEdgeAt(x: number, y: number): number | null {
    const body = this.body;
    if (!body) return null;
    const camera = this.camera();
    this.controller.apply(this.ortho, this.perspective, this.aspect(), this.bounds);
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc(x, y), camera);
    this.raycaster.params.Line2 = { threshold: EDGE_PICK_THRESHOLD_PX };
    (this.raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    body.ensureBvh();
    const faceHit = this.firstShownHit(body.mesh);
    const edgeHit = this.firstShownHit(body.edges);
    const tolerance = (this.controller.state.height / this.height) * 8;
    if (!edgeHit || edgeHit.faceIndex === undefined || edgeHit.faceIndex === null) return null;
    if (faceHit && edgeHit.distance > faceHit.distance + tolerance) return null;
    return body.edgeOfSegment(edgeHit.faceIndex);
  }

  /** Highlights the model edge a sketch tool aims at (null: none). */
  setModelEdgeHover(edge: number | null): void {
    this.setHoverPick(edge === null ? null : { kind: 'edge', index: edge });
  }

  /** Where the cursor meets the sketch plane, in sketch coordinates. */
  private sketchPointer(x: number, y: number, additive: boolean): SketchPointer | null {
    const frame = this.sketchLayer.sketchFrame;
    if (!frame) return null;
    const camera = this.camera();
    this.controller.apply(this.ortho, this.perspective, this.aspect(), this.bounds);
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc(x, y), camera);
    const normal = new Vector3(...frame.normal);
    const plane = new Plane().setFromNormalAndCoplanarPoint(normal, new Vector3(...frame.origin));
    const hit = this.raycaster.ray.intersectPlane(plane, new Vector3());
    if (!hit) return null;
    const [u, v] = toSketch(frame, [hit.x, hit.y, hit.z]);
    this.lastSketchPointer = { x, y, u, v, mmPerPixel: this.mmPerPixel(), additive };
    return this.lastSketchPointer;
  }

  /** The nearest hit of the raycaster on `object` that the section view does not cut away. */
  private firstShownHit(object: Object3D): Intersection | undefined {
    if (!this.sectionView.active) return this.raycaster.intersectObject(object, false)[0];
    const raycaster = this.raycaster as Raycaster & { firstHitOnly?: boolean };
    const first = raycaster.firstHitOnly;
    raycaster.firstHitOnly = false;
    const hit = this.raycaster.intersectObject(object, false).find((candidate) => this.sectionView.keeps(candidate.point));
    raycaster.firstHitOnly = first;
    return hit;
  }

  /** Surface point under the cursor, used as rotation pivot. */
  private surfacePointAt(x: number, y: number): Vector3 | null {
    const targets = [this.body?.mesh, this.bench?.group].filter((object) => object !== undefined);
    if (targets.length === 0) return null;
    this.body?.ensureBvh();
    const camera = this.camera();
    this.controller.apply(this.ortho, this.perspective, this.aspect(), this.bounds);
    camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.ndc(x, y), camera);
    (this.raycaster as Raycaster & { firstHitOnly?: boolean }).firstHitOnly = !this.sectionView.active;
    const hit = this.raycaster.intersectObjects(targets, true).find((candidate) => this.sectionView.keeps(candidate.point));
    return hit ? hit.point.clone() : null;
  }

  private setHoverPick(pick: Pick | null): void {
    if (samePick(pick, this.hover)) return;
    this.hover = pick;
    if (this.hoverOverlay) {
      this.overlays.remove(this.hoverOverlay);
      disposeOverlay(this.hoverOverlay);
      this.hoverOverlay = null;
    }
    const alreadySelected = pick !== null && this.selection.some((s) => samePick(s, pick));
    // Planes and reference geometry show their hover state through setReferencePlanes and setReferences.
    if (pick && pick.kind !== 'plane' && pick.kind !== 'reference' && this.body && !alreadySelected) {
      this.hoverOverlay = this.pickOverlay(this.body, pick, 'hover');
      if (this.hoverOverlay) this.overlays.add(this.hoverOverlay);
    }
    this.canvas.style.cursor = pick ? 'pointer' : '';
    this.callbacks.onHover(pick);
    this.requestRender();
  }

  /** The highlight of a face, edge or vertex. */
  private pickOverlay(body: PartModel, pick: Pick, style: 'hover' | 'selected'): Mesh | LineSegments2 | Sprite | null {
    switch (pick.kind) {
      case 'face':
        return body.faceOverlay(pick.index, style === 'hover' ? this.materials.hoverFace : this.materials.selectedFace);
      case 'edge':
        return body.edgeOverlay(pick.index, style === 'hover' ? this.materials.hoverEdge : this.materials.selectedEdge);
      case 'vertex':
        return body.vertexOverlay(pick.index, this.vertexMaterials[style], this.mmPerPixel());
      default:
        return null;
    }
  }

  private clearHover(): void {
    this.setHoverPick(null);
  }

  private clearSelectionOverlays(): void {
    for (const overlay of this.selectionOverlays) {
      this.overlays.remove(overlay);
      disposeOverlay(overlay);
    }
    this.selectionOverlays = [];
  }

  private rebuildSelectionOverlays(): void {
    this.clearSelectionOverlays();
    const body = this.body;
    if (!body) return;
    for (const pick of this.selection) {
      if (pick.kind === 'plane' || pick.kind === 'reference') continue;
      if (pick.kind === 'face' && pick.index >= body.faceCount) continue;
      if (pick.kind === 'edge' && pick.index >= body.edgeCount) continue;
      const overlay = this.pickOverlay(body, pick, 'selected');
      if (overlay) {
        this.selectionOverlays.push(overlay);
        this.overlays.add(overlay);
      }
    }
  }

  private queueHover(): void {
    if (this.hoverQueued) return;
    this.hoverQueued = true;
    requestAnimationFrame(() => {
      this.hoverQueued = false;
      if (this.disposed || this.drag || !this.lastPointer) return;
      const { x, y } = this.lastPointer;
      const cubeDirection = this.viewCube.hitTest(x, y, this.width, this.controller.state.quaternion);
      if (this.viewCube.setHover(cubeDirection)) this.requestRender();
      if (cubeDirection) {
        this.setHoverPick(null);
        this.sketchInput?.hover(null);
        this.canvas.style.cursor = 'pointer';
        return;
      }
      if (this.sketchLayer.active && this.sketchInput) {
        this.sketchInput.hover(this.sketchPointer(x, y, false));
        return;
      }
      this.setHoverPick(this.pickAt(x, y));
    });
  }

  // ---------------------------------------------------------------- input

  private local(event: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private dragModeFor(event: PointerEvent): DragMode {
    const { x, y } = this.local(event);
    if (event.button === 0 && this.viewCube.contains(x, y, this.width)) return 'cube';
    if (event.button === 1) return event.shiftKey || event.ctrlKey ? 'pan' : 'rotate';
    if (event.button === 2) return 'pan';
    if (event.button === 0 && event.altKey) return event.shiftKey ? 'pan' : 'rotate';
    return 'select';
  }

  private bindEvents(): void {
    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    // Prevent the browser's auto-scroll on middle click.
    canvas.addEventListener('mousedown', this.onMouseDown);
  }

  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button === 1) event.preventDefault();
  };

  private readonly onContextMenu = (event: MouseEvent): void => event.preventDefault();

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (this.drag) return;
    this.canvas.focus({ preventScroll: true });
    const { x, y } = this.local(event);
    let mode = this.dragModeFor(event);
    if (mode === 'select' && this.sketchLayer.active && this.sketchInput) {
      const pointer = this.sketchPointer(x, y, event.ctrlKey || event.metaKey || event.shiftKey);
      if (pointer) {
        mode = 'sketch';
        this.sketchInput.down(pointer);
      }
    }
    let pivot = this.bounds.center.clone();
    if (mode === 'rotate') {
      pivot = this.surfacePointAt(x, y) ?? this.controller.state.target.clone();
      this.pivotMarker.position.copy(pivot);
      this.pivotMarker.visible = true;
    }
    this.drag = { mode, pointerId: event.pointerId, startX: x, startY: y, lastX: x, lastY: y, moved: false, button: event.button, pivot };
    this.canvas.setPointerCapture(event.pointerId);
    if (mode === 'rotate' || mode === 'pan') this.setHoverPick(null);
    this.requestRender();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const point = this.local(event);
    this.lastPointer = point;
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) {
      this.queueHover();
      return;
    }
    const dx = point.x - drag.lastX;
    const dy = point.y - drag.lastY;
    drag.lastX = point.x;
    drag.lastY = point.y;
    if (Math.hypot(point.x - drag.startX, point.y - drag.startY) > CLICK_TOLERANCE_PX) drag.moved = true;
    if (drag.mode === 'rotate') this.controller.rotate(dx, dy, drag.pivot);
    else if (drag.mode === 'pan' && drag.moved) this.controller.pan(dx, dy, this.height);
    else if (drag.mode === 'sketch') {
      const pointer = this.sketchPointer(point.x, point.y, event.ctrlKey || event.metaKey || event.shiftKey);
      if (pointer) this.sketchInput?.move(pointer);
    }
    this.requestRender();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    this.drag = null;
    this.pivotMarker.visible = false;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    const { x, y } = this.local(event);
    if (drag.mode === 'sketch') {
      // Seen exactly edge-on the plane has no intersection: finish where the pointer was last.
      const pointer = this.sketchPointer(x, y, event.ctrlKey || event.metaKey || event.shiftKey) ?? this.lastSketchPointer;
      if (pointer) this.sketchInput?.up(pointer, drag.moved);
    } else if (!drag.moved && drag.mode === 'cube') {
      const direction = this.viewCube.hitTest(x, y, this.width, this.controller.state.quaternion);
      if (direction) this.setViewDirection(direction);
    } else if (!drag.moved && drag.mode === 'select') {
      this.callbacks.onPick(this.pickAt(x, y), event.ctrlKey || event.metaKey || event.shiftKey);
    }
    this.requestRender();
  };

  private readonly onPointerLeave = (): void => {
    this.lastPointer = null;
    if (this.viewCube.setHover(null)) this.requestRender();
    if (!this.drag) {
      this.setHoverPick(null);
      this.sketchInput?.hover(null);
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const { x, y } = this.local(event);
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1;
    const dx = event.deltaX * scale;
    const dy = event.deltaY * scale;
    const ndc = this.ndc(x, y);

    if (event.ctrlKey) {
      // Pinch gesture on a trackpad (reported as ctrl + wheel).
      this.controller.zoomAt(Math.exp(dy * 0.01), ndc.x, ndc.y, this.aspect());
    } else if (this.navigation === 'trackpad') {
      if (event.shiftKey) {
        this.controller.pan(-dx, -dy, this.height);
      } else {
        const now = performance.now();
        if (!this.wheelPivot || now - this.wheelPivot.time > 250) {
          this.wheelPivot = { point: this.surfacePointAt(x, y) ?? this.controller.state.target.clone(), time: now };
        }
        this.wheelPivot.time = now;
        this.controller.rotate(-dx, -dy, this.wheelPivot.point);
      }
    } else {
      this.controller.zoomAt(Math.exp(dy * 0.0015), ndc.x, ndc.y, this.aspect());
    }
    this.requestRender();
  };

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    this.clearSelectionOverlays();
    if (this.hoverOverlay) disposeOverlay(this.hoverOverlay);
    this.body?.dispose();
    this.preview?.dispose();
    this.bench?.dispose();
    this.viewCube.dispose();
    this.triad.dispose();
    this.referencePlanes.dispose();
    this.referenceGeometry.dispose();
    this.threads.dispose();
    this.vertexMaterials.hover.map?.dispose();
    for (const material of Object.values(this.vertexMaterials)) material.dispose();
    this.lostMarkers.dispose();
    this.directionArrow.dispose();
    this.measureGraphics.dispose();
    this.sectionView.dispose();
    this.sketchLayer.dispose();
    for (const graphics of this.inactiveSketches.values()) graphics.dispose();
    this.sketchMaterials.dispose();
    this.pivotMarker.geometry.dispose();
    this.pivotMarker.material.dispose();
    Object.values(this.materials).forEach((material) => material.dispose());
    this.renderer.dispose();
    this.labelRenderer.domElement.remove();
    this.canvas.remove();
  }
}
