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
  /** Inertia tensor at the center of mass for density 1 (mm^5): xx, yy, zz, xy, xz, yz. */
  double inertia[6] = {0, 0, 0, 0, 0, 0};
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
 * The solid swept by the regions of `profile` (encoded as for extrudeProfile, on the plane `frame`) along a
 * path: one chain of curves on the plane `pathFrame`, encoded like one outline (its edge count, then its
 * edges in order; it may be open). The profile is swept as it lies, usually at the start of the path. Faces
 * are named as for extrudeProfile. Fails with "sweep-failed" when the profile cannot follow the path.
 */
int sweepProfile(const std::vector<double>& profile, const std::vector<double>& frame, const std::vector<double>& path, const std::vector<double>& pathFrame,
                 const std::vector<std::string>& edgeNames = {}, const std::string& name = "");

/**
 * A solid through closed outlines on several planes, in order (`ruled`: flat between them). `sections`
 * holds their count, then per outline its plane (9 values, as `frame` of extrudeProfile) and the outline
 * (edge count, then edges, as one loop of extrudeProfile). Side faces are named after the edges of the first
 * outline ("<name>:side:<edge name>"), the end faces "<name>:start" and "<name>:end".
 */
int loftProfiles(const std::vector<double>& sections, bool ruled, const std::vector<std::string>& edgeNames = {}, const std::string& name = "");

/**
 * Cuts holes: the same `profile` revolved a full turn at every placement. The profile (encoded as for
 * extrudeProfile) lies in a plane through the hole axis: x is the distance from the axis, y the depth
 * into the material; the axis is x = 0. `placements` holds per hole its center and the direction into
 * the material (6 values). The faces of hole k are named "<name>:<k>:<edge name>".
 */
int cutHoles(int bodyId, const std::vector<double>& profile, const std::vector<double>& placements, const std::vector<std::string>& edgeNames,
             const std::string& name = "");

/**
 * The part of a solid behind a plane (`plane`: a point and the normal, 6 values; the part on the normal's
 * side is cut off). The new face along the plane is named "<name>:end".
 */
int trimByPlane(int shapeId, const std::vector<double>& plane, const std::string& name = "");

/**
 * Up to next: the part of a long extrusion (`toolId`, faces named as by extrudeProfile, from the sketch
 * plane on along `direction`; `reversed`: against the plane's normal, so its "start" face is the far one)
 * that reaches up to the body. Adding (op 0) keeps the pieces outside the body that start at the
 * sketch; cutting (op 1) keeps, per outline (solid of the tool), the first material of the body it passes
 * through. Fails with "end-missed" when the body does not stop an outline that it adds, or when the
 * extrusion does not reach the body at all.
 */
int limitToNext(int toolId, int bodyId, int op, const std::vector<double>& direction, bool reversed, const std::string& name = "");

/**
 * Up to a surface: cuts a long extrusion (`toolId`, as for limitToNext, going along `direction`) off where
 * it meets the surface of face `faceIndex` of the body, extended past the face's bounds and moved by
 * `offset` towards the sketch (negative: past the surface). Keeps the pieces that start at the sketch; their
 * faces along the surface are named like the far end ("<name>:end", or "<name>:start" when reversed). Fails with "end-missed" when the surface does not stop
 * the whole profile.
 */
int limitBySurface(int toolId, int bodyId, int faceIndex, const std::vector<double>& direction, double offset, bool reversed,
                   const std::string& name = "");

/**
 * Hollows a body out to walls of `thickness`, inside the body or (`outward`) around it. The faces in
 * `openFaces` are removed so the shell is open there; without any, the body gets a closed cavity. The
 * wall faces made from face f are named "<name>:<name of f>", faces along the openings "<name>:rim".
 */
int shell(int bodyId, const std::vector<int>& openFaces, double thickness, bool outward, const std::string& name = "");

/**
 * Adds (op 0) or cuts (op 1) copies of a stored tool: one per transformation, 12 values each (the rows
 * of a 3 × 4 matrix: rotation or mirror, then translation). All copies are combined with the body in one
 * operation. The faces of copy k are named "<name>:<k>:<face name in the tool>".
 */
int combineCopies(int bodyId, int toolId, const std::vector<double>& transforms, int op, const std::string& name = "");

/**
 * Rounds the given edges. The faces made for edge k are named `edgeNames[k]`, other new faces (corners
 * where rounds meet) "<name>:corner".
 */
int fillet(int bodyId, const std::vector<int>& edgeIndices, double radius, const std::vector<std::string>& edgeNames = {}, const std::string& name = "");
/**
 * Rounds edges with a radius that changes evenly from `startRadius` to `endRadius` along each edge. The
 * start is the end of an edge with the smaller coordinates (x, then y, then z; the other one with `swap`).
 * Faces are named as for fillet.
 */
int filletVariable(int bodyId, const std::vector<int>& edgeIndices, double startRadius, double endRadius, bool swap, const std::vector<std::string>& edgeNames = {},
                   const std::string& name = "");
/** Bevels the given edges; faces are named as for fillet. */
int chamfer(int bodyId, const std::vector<int>& edgeIndices, double distance, const std::vector<std::string>& edgeNames = {}, const std::string& name = "");
/**
 * Bevels edges unevenly: `distance` along one of the two faces of each edge (the first one found, the other
 * one with `flip`) and along the other face `second` (byAngle false) or as far as the angle `second`
 * (radians, measured from the first face) reaches (byAngle true).
 */
int chamferUneven(int bodyId, const std::vector<int>& edgeIndices, double distance, double second, bool byAngle, bool flip,
                  const std::vector<std::string>& edgeNames = {}, const std::string& name = "");
/**
 * A copy of a body moved and turned by `transform` (12 values: the rows of a 3 × 4 matrix of a rotation
 * and a translation); the faces keep their names. Used to export in a coordinate system.
 */
int transformShape(int id, const std::vector<double>& transform);

/**
 * Tilts faces of a body by `angle` (radians) about the neutral plane (`plane`: a point and the pull
 * direction, 6 values): positive angles make the body narrower along the pull direction. Faces keep their
 * names. Fails with "draft-face" (detail: the position of the face in the list) when a face cannot be
 * tilted (for example one at a right angle to the pull direction).
 */
int draftFaces(int bodyId, const std::vector<int>& faceIndices, const std::vector<double>& plane, double angle, const std::string& name = "");

/**
 * A face fillet: a round of `radius` between two planar faces at an angle, also where they share no
 * edge (faces between them, such as a chamfer, are rounded over). At an outer corner the material outside
 * the round is cut away, at an inner corner the corner is filled. The round face is named "<name>:round".
 * Fails with "round-planes" (not two planar faces forming a corner) or "round-radius".
 */
int faceFillet(int bodyId, int faceA, int faceB, double radius, const std::string& name = "");

/**
 * A modeled ISO metric thread on a cylindrical face: the groove of the basic profile (60° flanks, pitch
 * `pitch`) swept along a helix and cut out – into the shaft for a face with its material inside, into the
 * wall for a hole. The thread starts at the end of the face where its axis parameter is smallest (the other
 * end with `reverse`), runs out of the face there and goes `length` into it (at most the face's length); `leftHand` turns it the other
 * way. The crest of a bolt thread is the face itself, the minor diameter of a nut thread too. Groove faces
 * are named "<name>:thread". Fails with "thread-face" or "thread-size".
 */
int cutThread(int bodyId, int faceIndex, double pitch, double length, bool reverse, bool leftHand, const std::string& name = "");

/**
 * A full round: the center face between two side faces (parallel planes facing away from each other)
 * replaced by half a cylinder tangent to all three, as wide as the sides are apart, over the length of
 * the center face. The round face is named "<name>:round", faces the cut leaves where the part goes on
 * "<name>:end". Fails with "round-sides" or "round-center" when the faces do not fit.
 */
int fullRound(int bodyId, int side1, int center, int side2, const std::string& name = "");

void release(int id);
int shapeCount();

/** The face names of a body, the faces on both sides of each edge and the faces at each vertex. */
Naming naming(int id);
/** Exact geometry of face `index` (TopExp::MapShapes order) of a body. */
FaceGeometry faceGeometry(int id, int index);
/** Exact geometry of edge `index` (TopExp::MapShapes order) of a body. */
EdgeGeometry edgeGeometry(int id, int index);

/** The shortest distance between two faces, edges or vertices of a body and where it is. */
struct Distance {
  double value = 0;
  double from[3] = {0, 0, 0};
  double to[3] = {0, 0, 0};
};
/** Kinds of sub-shapes for `distance`: 0 vertex, 1 edge, 2 face (index in TopExp::MapShapes order). */
Distance distance(int id, int kindA, int indexA, int kindB, int indexB);

Counts counts(int id);
BoundingBox boundingBox(int id);
MassProperties massProperties(int id);
/** Display mesh with edges and exact face/edge geometry; keeps triangulations of unchanged faces. */
MeshData mesh(int id, double linear, double angular);
/** Fine faces-only mesh of a copy (for STL), so the display triangulation is not replaced. */
MeshData exportMesh(int id, double linear, double angular);
std::string exportStep(int id);
/**
 * Reads the solids of a STEP file into one body (a compound when there are several). Faces are named
 * "<name>:f<i>" in TopExp::MapShapes order; a file without solids fails with "import-no-solid".
 */
int importStep(const std::string& data, const std::string& name = "");

/**
 * Tapers the side faces of an extrusion (faces named "<name>:side:...") by `angle` radians about the
 * sketch plane (`frame`, 9 values), pulling along its normal; positive angles make the extrusion
 * narrower away from the plane. The faces keep their names.
 */
int draftSides(int toolId, const std::vector<double>& frame, double angle, const std::string& name);

/** Whether the last cut left the body as it was (its tool missed the body); reading it clears it. */
bool takeCutMissed();

/** Enables OCCT's parallel algorithms (meshing, booleans); requires a threaded build. */
void setParallel(bool enabled);

/** Converts the current exception into an error code and message (call inside a catch block). */
std::pair<std::string, std::string> describeException(std::exception_ptr error);

}  // namespace parawerk
