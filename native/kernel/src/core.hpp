// ParaWerk geometry kernel core: plain C++ over Open CASCADE Technology.
//
// No Emscripten dependency, so the same code runs in the WebAssembly module
// (bindings.cpp), in native benchmarks (bench/native) and in native tests.
// Shapes are kept in an internal store and referenced by integer ids.

#pragma once

#include <cstdint>
#include <exception>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace parawerk {

/** A failure with a ParaWerk error code (see FeatureErrorCode in src/kernel/protocol.ts). */
struct KernelError : std::runtime_error {
  std::string code;
  KernelError(std::string errorCode, const std::string& message);
};

/** Kinds must match SurfaceKind / CurveKind in src/kernel/protocol.ts. */
enum SurfaceKind : uint8_t { Plane, Cylinder, Cone, Sphere, Torus, BSpline, Revolution, Extrusion, OtherSurface };
enum CurveKind : uint8_t { Line, Circle, Ellipse, BSplineCurve, OtherCurve };

struct Counts {
  int faces = 0;
  int edges = 0;
  int solids = 0;
};

struct BoundingBox {
  double min[3] = {0, 0, 0};
  double max[3] = {0, 0, 0};
};

struct MassProperties {
  double volume = 0;
  double area = 0;
  double center[3] = {0, 0, 0};
};

/** Everything the 3D view needs for one body. Face i / edge i follow TopExp::MapShapes order. */
struct MeshData {
  std::vector<float> positions;
  std::vector<float> normals;
  std::vector<uint32_t> indices;
  std::vector<uint32_t> faceRanges;  // [start, count] per face, in units of `indices`
  std::vector<float> edgePositions;  // segment pairs
  std::vector<uint32_t> edgeRanges;  // [start, count] per edge, in points of `edgePositions`
  std::vector<uint8_t> faceKinds;
  std::vector<double> faceAreas;
  std::vector<double> faceRadii;  // NaN when not applicable
  // Planar faces: point on the plane and outward unit normal (6 values per face, NaN otherwise).
  std::vector<double> facePlanes;
  std::vector<uint8_t> edgeKinds;
  std::vector<double> edgeLengths;
  std::vector<double> edgeRadii;  // NaN when not applicable
  // Per edge: start and end point of the curve's own parameter range, then circle center and axis
  // (12 values per edge; center and axis NaN for other curves, everything NaN for degenerate edges).
  std::vector<double> edgeGeometry;
};

/**
 * Persistent names of a body's faces (docs/adr/0002-persistent-naming.md): every stored shape keeps one
 * name per face, in TopExp::MapShapes order. Operations name the faces they create after the feature
 * (`name` parameters, usually "<feature id>:<role>") and pass the names of modified faces on.
 */
using FaceNames = std::vector<std::string>;

/** Face names of a body and how its edges lie between faces (edge i follows TopExp::MapShapes order). */
struct Naming {
  FaceNames faces;
  std::vector<double> facePlanes;     // 6 per face: a point on the plane and the outward normal (NaN when not planar)
  std::vector<int32_t> edgeFaces;     // 2 per edge: face indices on both sides (the same twice for seams, -1 for none)
  std::vector<double> edgeMidpoints;  // 3 per edge: the point in the middle of the curve (NaN when degenerate)
  std::vector<int32_t> edgeVertices;  // 2 per edge: vertex indices at its start and end (-1 for none)
  std::vector<double> vertexPositions;      // 3 per vertex (TopExp::MapShapes order)
  std::vector<int32_t> vertexFaceOffsets;   // vertex v meets faces vertexFaces[offsets[v] .. offsets[v + 1])
  std::vector<int32_t> vertexFaces;
};

/** Exact geometry of one face (see faceGeometry). Unused values are NaN. */
struct FaceGeometry {
  uint8_t kind = OtherSurface;
  double area = 0;
  double center[3];  // center of the area
  double plane[6];   // planes: a point and the outward normal
  double axis[6];    // cylinders, cones, tori, surfaces of revolution: a point on the axis and its direction; spheres: the center
  double radius;     // cylinders and spheres
};

/** Exact geometry of one edge (see edgeGeometry). Unused values are NaN. */
struct EdgeGeometry {
  uint8_t kind = OtherCurve;
  double length = 0;
  double start[3];
  double end[3];
  double middle[3];
  double center[3];  // circles and ellipses
  double axis[3];    // circles and ellipses: the normal of their plane; lines: the direction from start to end
  double radius;     // circles
};

/** Faces are named "<name>:left|right|front|back|bottom|top" after their outward normal (-x, +x, -y, +y, -z, +z). */
int makeBox(double x, double y, double z, double dx, double dy, double dz, const std::string& name = "");
/** Faces are named "<name>:side|bottom|top". */
int makeCylinder(double px, double py, double pz, double dx, double dy, double dz, double radius, double height, const std::string& name = "");
/** op: 0 = fuse (add material), 1 = cut (remove material). Faces keep the names of the faces they come from. */
int booleanOperation(int bodyId, int toolId, int op);

/**
 * The solid swept by planar regions along the normal of their plane, from `from` to `to`.
 *
 * `profile` holds the regions in plane coordinates: the region count, then per region its loop count
 * (outer loop first, counterclockwise; holes clockwise), per loop its edge count, and per edge, in the
 * direction the loop runs, its kind and parameters:
 *   0 line      x0 y0 x1 y1
 *   1 arc       cx cy radius start end ccw      (angles in radians from the x axis)
 *   2 circle    cx cy radius ccw
 *   3 ellipse   cx cy ux uy a b ccw             (u: unit direction of semi-axis a; b lies to its left)
 *   4 bspline   poleCount x y ... knotCount k ...  (cubic; every inner knot joins two Bézier spans)
 * `frame` is the plane: origin, x direction and normal (9 values).
 *
 * `edgeNames` holds one name per profile edge in the same order: the side face an edge sweeps is named
 * "<name>:side:<edge name>"; the end faces are "<name>:start" (at `from`) and "<name>:end".
 */
int extrudeProfile(const std::vector<double>& profile, const std::vector<double>& frame, double from, double to,
                   const std::vector<std::string>& edgeNames = {}, const std::string& name = "");

/**
 * The solid swept by the regions of `profile` (encoded as for extrudeProfile) around `axis`, a line in
 * plane coordinates (x0 y0 x1 y1), from angle `from` to `to` in radians (at most a full turn). Faces are
 * named as for extrudeProfile.
 */
int revolveProfile(const std::vector<double>& profile, const std::vector<double>& frame, const std::vector<double>& axis, double from, double to,
                   const std::vector<std::string>& edgeNames = {}, const std::string& name = "");
/**
 * Rounds the given edges. The faces made for edge k are named `edgeNames[k]`, other new faces (corners
 * where rounds meet) "<name>:corner".
 */
int fillet(int bodyId, const std::vector<int>& edgeIndices, double radius, const std::vector<std::string>& edgeNames = {}, const std::string& name = "");
/** Bevels the given edges; faces are named as for fillet. */
int chamfer(int bodyId, const std::vector<int>& edgeIndices, double distance, const std::vector<std::string>& edgeNames = {}, const std::string& name = "");
void release(int id);
int shapeCount();

/** The face names of a body, the faces on both sides of each edge and the faces at each vertex. */
Naming naming(int id);
/** Exact geometry of face `index` (TopExp::MapShapes order) of a body. */
FaceGeometry faceGeometry(int id, int index);
/** Exact geometry of edge `index` (TopExp::MapShapes order) of a body. */
EdgeGeometry edgeGeometry(int id, int index);

Counts counts(int id);
BoundingBox boundingBox(int id);
MassProperties massProperties(int id);
/** Display mesh with edges and exact face/edge geometry; keeps triangulations of unchanged faces. */
MeshData mesh(int id, double linear, double angular);
/** Fine faces-only mesh of a copy (for STL), so the display triangulation is not replaced. */
MeshData exportMesh(int id, double linear, double angular);
std::string exportStep(int id);
int importStep(const std::string& data);

/** Enables OCCT's parallel algorithms (meshing, booleans); requires a threaded build. */
void setParallel(bool enabled);

/** Converts the current exception into an error code and message (call inside a catch block). */
std::pair<std::string, std::string> describeException(std::exception_ptr error);

}  // namespace parawerk
