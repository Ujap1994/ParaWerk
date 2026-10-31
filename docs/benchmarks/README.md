# Performance benchmarks

ParaWerk measures performance from the first commit. Every phase raises the **scale ladder**
([roadmap, section 6](../../ROADMAP.md#6-performance-and-scale-testing)); earlier rungs stay in the
suite as regression tests.

## How to run

```bash
npm run bench:kernel   # geometry kernel (Node, OCCT WebAssembly)
npm run bench:solver   # 2D constraint solver: ParaWerk's sparse solver and PlaneGCS for comparison
npm run build && npm run bench:render   # 3D view (orbiting synthetic assemblies), dragging and drawing in sketches (uses your GPU)
npm run bench:compare  # compare bench/results with bench/baselines
```

Results are written to `bench/results/<suite>-<platform>-<arch>.json`. In CI the suites run on Windows,
macOS and Linux for every push and are compared with the baselines in `bench/baselines` (taken from CI
runs of the main branch); a slowdown of more than ×1.75 fails the build. The Linux and Windows runners
render in software, so their render numbers only serve as relative regression checks; the macOS runner
has a virtual GPU.

To refresh the baselines after an intended change, download the `benchmarks-*` artifacts of a main-branch
CI run and copy the JSON files into `bench/baselines`.

## Reference results – Phase 0 (Apple M3, 16 GB, macOS)

### Geometry kernel (ParaWerk kernel: OCCT 8.0.1, own WebAssembly build)

| Case | Median | Phase 0 prebuilt build |
|---|---|---|
| Kernel start (load WebAssembly) | 51 ms | 114 ms |
| Box rebuild | 0.7 ms | 1.1 ms |
| Fillet of all 12 box edges (with validity check) | 34 ms | 24 ms |
| Plate with 10 holes, full rebuild (11 features) | 84 ms | 74 ms |
| Plate with 50 holes, full rebuild (51 features) | 576 ms | 572 ms |
| Plate with 100 holes, full rebuild (101 features) | 1,657 ms | 1,822 ms |
| Plate with 100 holes, edit last feature | 218 ms | 495 ms |
| Mesh of the unchanged 100-hole plate (25,612 triangles) | 60 ms | 421 ms |
| Mass properties of the 100-hole plate | 35 ms | 30 ms |
| STEP export of the 100-hole plate | 46 ms | 43 ms |
| STL export of the 100-hole plate (fine tessellation) | 795 ms | 774 ms |

`KERNEL_BACKEND=replicad npm run bench:kernel` runs the same suite on the Phase 0 build.

**Native comparison:** `bench/native/build-occt-native.sh` and `bench/native/run.sh` run the same cases
on natively compiled OCCT with the same kernel core. Native is 1.5–4× faster (for example editing the
100-hole plate: 60 ms native, 218 ms WebAssembly); see [ADR 0001](../adr/0001-geometry-kernel.md).

### 2D constraint solver (PlaneGCS, one connected sketch)

| Constraints | Median |
|---|---|
| 55 | < 1 ms |
| 251 | 7.5 ms |
| 503 | 44 ms |
| ≈ 1,000 | out of memory (see [ADR 0005](../adr/0005-sketch-solver.md)) |

### 3D view (1600 × 1000 window, Retina, GPU-synchronized frame times)

| Synthetic assembly | Triangles | Draw calls | Frames per second |
|---|---|---|---|
| 10 components, instanced | 44,336 | 45 | 178 |
| 100 components, instanced | 248,188 | 47 | 130 |
| 1,000 components, instanced | 2,258,212 | 47 | 118 |
| 10,000 components, instanced | 21,536,672 | 47 | 32 |
| 50,000 components, instanced | 107,424,080 | 47 | 8 |
| 100 components, individual meshes | 248,188 | 141 | 155 |
| 1,000 components, individual meshes | 2,258,212 | 1,041 | 78 |
| 5,000 components, individual meshes | 10,667,348 | 5,041 | 30 |

Draw calls include the view cube and the axis indicator (about 41).

## Reference results – Phase 1 (Apple M3, 16 GB, macOS)

### Dragging in sketches (1600 × 1000 window, Retina)

Each step is what one mouse movement costs: the solver round trip to its worker, updating the sketch
graphics (including the relation symbols) and drawing a GPU-synchronized frame. The sketches are chains
of linked rectangles without dimensions, so the dragged point can move; a corner at the far end is dragged.

| Sketch entities | Step (median) | Solver | Graphics update | Steps per second |
|---|---|---|---|---|
| 50 | 6.8 ms | 0.4 ms | 0.14 ms | 148 |
| 500 | 6.5 ms | 1.2 ms | 0.58 ms | 155 |
| 2,000 | 7.7 ms | 3.1 ms | 1.39 ms | 129 |

The Phase 1 target (60 fps with 500 entities) is met with a wide margin; most of each step is the frame
itself. Solver-only numbers are in [ADR 0005](../adr/0005-sketch-solver.md).

### Drawing in sketches (same sketches and window)

A line is started near the first rectangle, then the pointer moves along the whole chain. Each step is
snapping (points, midpoints, curves, alignments), the tool preview with its measurement, and a
GPU-synchronized frame.

| Sketch entities | Step (median) | Snapping and preview | Steps per second |
|---|---|---|---|
| 50 | 2.9 ms | 0.10 ms | 350 |
| 500 | 3.6 ms | 0.51 ms | 276 |
| 2,000 | 4.5 ms | 1.27 ms | 220 |

### Points on splines (solver only)

A point held on a spline depends on all of its fit points, so dragging a fit point re-solves every
point on the curve. Median solve per drag step (`npm run bench:solver`):

| Spline | Points held on it | Drag step |
|---|---|---|
| 20 fit points | 10 | 3.3 ms |
| 100 fit points | 20 | 18 ms |

## Reference results – Phase 2 (Apple M3)

| Case | Time |
|---|---|
| Plate with 100 holes as one sketch and one extrusion, full rebuild | 138 ms (101 box and cylinder features: 1,174 ms) |
| Spline profile with 100 fit points, extrusion with exact volume | 6 ms |
| The same outline revolved a full turn, with exact volume | 68 ms |
| Exact mass properties of the 100-hole plate (fast path for planes and circles) | 22 ms |
| 100 M8 clearance holes as one hole feature | 304 ms |
| 25 holes cut *up to next* through the lid of a closed box (sketch and cut rebuilt) | 136 ms |
| A modeled M10 thread over 20 mm (13 turns swept along a helix and cut) | 732 ms |
| Part of 100 features (a plate with 33 bosses: sketch, extrusion, rim fillet each): full rebuild / edit last feature | 501 ms / 32 ms |
| Part of 301 features (100 bosses): full rebuild / edit last feature | 2.77 s / 87 ms |

The Phase 2 budgets – a full rebuild of 300 features within 10 s and editing the last feature within
1 s, both in the kernel worker, so the interface never waits – are met with a wide margin.

## Reference results – Phase 3 (Apple M3)

| Case | Time |
|---|---|
| Part of 502 features (167 bosses: sketch, extrusion, rim fillet each): full rebuild / edit last feature | 6.9 s / 151 ms |
| [Feature showcase](../user-guide/showcase.md) (86 features of every kind): a new value of the first variable, everything rebuilt with mass properties | 2.07 s |
| Feature showcase: switching between its two configurations | 2.03 s |
| A fillet on every edge of a face with 100 holes (101 rims, 0.8 mm) | 0.84 s |

Phase 3 asks for parts of 500 features. Editing the last feature stays interactive at 151 ms. A full
rebuild grows faster than the number of features (100: 0.5 s, 301: 2.8 s, 502: 6.9 s): every Boolean
operation and every fillet works on the whole body, which grows with each feature – 3.1 s of the 502-feature
rebuild go to the extrusions and 2.4 s to the fillets, 0.2 s to persistent naming. Rebuilds run in the
kernel worker, so the interface stays responsive; making early edits of very large parts faster (local
Booleans, cached tools) is noted for Phase 8.

## CI runners – Phase 0 baselines

| Case | Linux (AMD EPYC 7763) | Windows (Intel Xeon 8573C) | macOS (Apple M1, virtual) |
|---|---|---|---|
| Fillet of 12 box edges | 22.8 ms | 23.4 ms | 24.7 ms |
| 100-hole plate, edit last feature | 307 ms | 313 ms | 345 ms |
| Tessellation of the 100-hole plate | 270 ms | 274 ms | 334 ms |
| Solver, 503 constraints | 51 ms | 50 ms | 41 ms |
| 1,000 instanced components | software rendering | software rendering | 142 fps |

## What the numbers tell us

- Small and medium parts rebuild well within interactive limits; the incremental cache makes edits
  independent of the number of features before the edited one.
- ParaWerk's own kernel keeps the triangulation of unchanged faces and uses a fast Delaunay
  triangulator, which made editing large parts about twice as fast and removed the memory leaks of the
  prebuilt build ([ADR 0001](../adr/0001-geometry-kernel.md)). Multi-threading is the next step.
- Instancing keeps assemblies with thousands of identical parts fast. Beyond about 10,000 components,
  level of detail and culling are needed to reach the v1.0 target of 30 fps for 50,000 instances.
- PlaneGCS ran out of memory at about 1,000 constraints, so ParaWerk got its own sparse solver
  ([ADR 0005](../adr/0005-sketch-solver.md)); dragging stays at about 130 steps per second at 2,000 sketch
  entities. Relation symbols are GPU sprites from one symbol atlas: as HTML labels they slowed a drag
  step at 2,000 entities from 7 ms to 114 ms.
