// ParaWerk geometry kernel core (see core.hpp and docs/adr/0001-geometry-kernel.md).

#include "core.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepGProp.hxx>
#include <BRepLib.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <GCE2d_MakeSegment.hxx>
#include <Geom2d_BSplineCurve.hxx>
#include <Geom2d_Circle.hxx>
#include <Geom2d_Ellipse.hxx>
#include <Geom_Plane.hxx>
#include <Precision.hxx>
#include <GProp_GProps.hxx>
#include <IFSelect_ReturnStatus.hxx>
#include <IMeshTools_Parameters.hxx>
#include <NCollection_IndexedDataMap.hxx>
#include <NCollection_IndexedMap.hxx>
#include <NCollection_List.hxx>
#include <Poly_PolygonOnTriangulation.hxx>
#include <Poly_Triangulation.hxx>
#include <STEPControl_Reader.hxx>
#include <STEPControl_Writer.hxx>
#include <ShapeCustom.hxx>
#include <Standard_Failure.hxx>
#include <TColStd_Array1OfInteger.hxx>
#include <TColStd_Array1OfReal.hxx>
#include <TColgp_Array1OfPnt2d.hxx>
#include <TopExp.hxx>
#include <TopTools_ShapeMapHasher.hxx>
#include <TopoDS.hxx>
#include <TopoDS_Edge.hxx>
#include <TopoDS_Face.hxx>
#include <TopoDS_Shape.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Pnt.hxx>
#include <gp_Sphere.hxx>

#include <limits>
#include <sstream>
#include <unordered_map>

namespace parawerk {

KernelError::KernelError(std::string errorCode, const std::string& message)
    : std::runtime_error(message), code(std::move(errorCode)) {}

namespace {

using ShapeMap = NCollection_IndexedMap<TopoDS_Shape, TopTools_ShapeMapHasher>;
using AncestorMap = NCollection_IndexedDataMap<TopoDS_Shape, NCollection_List<TopoDS_Shape>, TopTools_ShapeMapHasher>;

constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();

bool parallel = false;

class ShapeStore {
 public:
  int add(const TopoDS_Shape& shape) {
    const int id = next_++;
    shapes_.emplace(id, shape);
    return id;
  }

  const TopoDS_Shape& get(int id) const {
    const auto it = shapes_.find(id);
    if (it == shapes_.end()) throw KernelError("unknown", "unknown shape id " + std::to_string(id));
    return it->second;
  }

  void release(int id) { shapes_.erase(id); }
  int size() const { return static_cast<int>(shapes_.size()); }

 private:
  std::unordered_map<int, TopoDS_Shape> shapes_;
  int next_ = 1;
};

ShapeStore& store() {
  static ShapeStore instance;
  return instance;
}

int countSolids(const TopoDS_Shape& shape) {
  ShapeMap solids;
  TopExp::MapShapes(shape, TopAbs_SOLID, solids);
  return solids.Extent();
}

std::vector<TopoDS_Edge> selectEdges(const TopoDS_Shape& body, const std::vector<int>& edgeIndices) {
  ShapeMap edges;
  TopExp::MapShapes(body, TopAbs_EDGE, edges);
  std::vector<TopoDS_Edge> selected;
  for (const int index : edgeIndices) {
    if (index < 0 || index >= edges.Extent()) throw KernelError("edge-missing", "edge " + std::to_string(index) + " does not exist");
    selected.push_back(TopoDS::Edge(edges(index + 1)));
  }
  if (selected.empty()) throw KernelError("no-edges", "no edges selected");
  return selected;
}

/** Fillets can produce invalid solids; catching that keeps later features stable. */
void requireValidSolid(const TopoDS_Shape& result, const char* what) {
  if (countSolids(result) == 0) throw KernelError("operation-failed", std::string(what) + " result is not a solid");
  BRepCheck_Analyzer analyzer(result, false);
  if (!analyzer.IsValid()) throw KernelError("operation-failed", std::string(what) + " produced an invalid solid");
}

uint8_t surfaceKind(GeomAbs_SurfaceType type) {
  switch (type) {
    case GeomAbs_Plane: return Plane;
    case GeomAbs_Cylinder: return Cylinder;
    case GeomAbs_Cone: return Cone;
    case GeomAbs_Sphere: return Sphere;
    case GeomAbs_Torus: return Torus;
    case GeomAbs_BezierSurface:
    case GeomAbs_BSplineSurface: return BSpline;
    case GeomAbs_SurfaceOfRevolution: return Revolution;
    case GeomAbs_SurfaceOfExtrusion: return Extrusion;
    default: return OtherSurface;
  }
}

uint8_t curveKind(GeomAbs_CurveType type) {
  switch (type) {
    case GeomAbs_Line: return Line;
    case GeomAbs_Circle: return Circle;
    case GeomAbs_Ellipse: return Ellipse;
    case GeomAbs_BezierCurve:
    case GeomAbs_BSplineCurve: return BSplineCurve;
    default: return OtherCurve;
  }
}

void pushPoint(std::vector<float>& out, const gp_Pnt& point) {
  out.push_back(static_cast<float>(point.X()));
  out.push_back(static_cast<float>(point.Y()));
  out.push_back(static_cast<float>(point.Z()));
}

/**
 * Triangulates faces that have no sufficient triangulation yet.
 *
 * The 3D view uses Delabella, a fast Delaunay triangulator that matters most for large
 * planar faces with many holes. At the very fine STL tolerance it is much slower than
 * the default Watson algorithm, so exports use Watson (measured, see docs/benchmarks).
 */
void triangulate(const TopoDS_Shape& shape, double linear, double angular, bool forDisplay) {
  IMeshTools_Parameters parameters;
  parameters.MeshAlgo = forDisplay ? IMeshTools_MeshAlgoType_Delabella : IMeshTools_MeshAlgoType_Watson;
  parameters.Deflection = linear;
  parameters.Angle = angular;
  parameters.Relative = false;
  parameters.InParallel = parallel;
  BRepMesh_IncrementalMesh mesher(shape, parameters);
}

void appendFaces(const TopoDS_Shape& shape, MeshData& out, bool withInfo) {
  ShapeMap faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  out.faceRanges.reserve(static_cast<size_t>(faces.Extent()) * 2);

  for (int f = 1; f <= faces.Extent(); ++f) {
    const TopoDS_Face face = TopoDS::Face(faces(f));
    const uint32_t start = static_cast<uint32_t>(out.indices.size());
    TopLoc_Location location;
    const occ::handle<Poly_Triangulation>& triangulation = BRep_Tool::Triangulation(face, location);
    if (!triangulation.IsNull()) {
      if (!triangulation->HasNormals()) BRepLib_ToolTriangulatedShape::ComputeNormals(face, triangulation);
      const gp_Trsf transform = location.Transformation();
      const bool reversed = face.Orientation() == TopAbs_REVERSED;
      const uint32_t base = static_cast<uint32_t>(out.positions.size() / 3);
      for (int n = 1; n <= triangulation->NbNodes(); ++n) {
        pushPoint(out.positions, triangulation->Node(n).Transformed(transform));
        gp_Dir normal = triangulation->Normal(n).Transformed(transform);
        if (reversed) normal.Reverse();
        out.normals.push_back(static_cast<float>(normal.X()));
        out.normals.push_back(static_cast<float>(normal.Y()));
        out.normals.push_back(static_cast<float>(normal.Z()));
      }
      for (int t = 1; t <= triangulation->NbTriangles(); ++t) {
        int a = 0, b = 0, c = 0;
        triangulation->Triangle(t).Get(a, b, c);
        if (reversed) std::swap(b, c);
        out.indices.push_back(base + static_cast<uint32_t>(a - 1));
        out.indices.push_back(base + static_cast<uint32_t>(b - 1));
        out.indices.push_back(base + static_cast<uint32_t>(c - 1));
      }
    }
    out.faceRanges.push_back(start);
    out.faceRanges.push_back(static_cast<uint32_t>(out.indices.size()) - start);

    if (withInfo) {
      BRepAdaptor_Surface surface(face, false);
      const uint8_t kind = surfaceKind(surface.GetType());
      GProp_GProps props;
      BRepGProp::SurfaceProperties(face, props);
      double radius = kNaN;
      if (kind == Cylinder) radius = surface.Cylinder().Radius();
      else if (kind == Sphere) radius = surface.Sphere().Radius();
      out.faceKinds.push_back(kind);
      out.faceAreas.push_back(props.Mass());
      out.faceRadii.push_back(radius);
      if (kind == Plane) {
        // The adaptor applies the face location; the face orientation decides which side is outside.
        const gp_Pln plane = surface.Plane();
        gp_Dir normal = plane.Axis().Direction();
        if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
        const gp_Pnt origin = plane.Location();
        out.facePlanes.insert(out.facePlanes.end(), {origin.X(), origin.Y(), origin.Z(), normal.X(), normal.Y(), normal.Z()});
      } else {
        out.facePlanes.insert(out.facePlanes.end(), 6, kNaN);
      }
    }
  }
}

void appendEdges(const TopoDS_Shape& shape, double linear, double angular, MeshData& out) {
  ShapeMap edges;
  TopExp::MapShapes(shape, TopAbs_EDGE, edges);
  AncestorMap edgeFaces;
  TopExp::MapShapesAndAncestors(shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);

  for (int e = 1; e <= edges.Extent(); ++e) {
    const TopoDS_Edge edge = TopoDS::Edge(edges(e));
    const uint32_t start = static_cast<uint32_t>(out.edgePositions.size() / 3);
    const NCollection_List<TopoDS_Shape>* adjacent = edgeFaces.Seek(edge);
    const bool degenerated = BRep_Tool::Degenerated(edge);

    // Seams (a closed surface meeting itself) and degenerated edges are not drawn.
    bool hidden = degenerated;
    if (!hidden && adjacent != nullptr) {
      for (const TopoDS_Shape& f : *adjacent) {
        if (BRep_Tool::IsClosed(edge, TopoDS::Face(f))) {
          hidden = true;
          break;
        }
      }
    }

    if (!hidden) {
      bool drawn = false;
      if (adjacent != nullptr) {
        for (const TopoDS_Shape& f : *adjacent) {
          TopLoc_Location location;
          const occ::handle<Poly_Triangulation>& triangulation = BRep_Tool::Triangulation(TopoDS::Face(f), location);
          if (triangulation.IsNull()) continue;
          const occ::handle<Poly_PolygonOnTriangulation>& polygon = BRep_Tool::PolygonOnTriangulation(edge, triangulation, location);
          if (polygon.IsNull()) continue;
          const gp_Trsf transform = location.Transformation();
          const NCollection_Array1<int>& nodes = polygon->Nodes();
          for (int k = nodes.Lower(); k < nodes.Upper(); ++k) {
            pushPoint(out.edgePositions, triangulation->Node(nodes(k)).Transformed(transform));
            pushPoint(out.edgePositions, triangulation->Node(nodes(k + 1)).Transformed(transform));
          }
          drawn = true;
          break;
        }
      }
      if (!drawn) {
        // Free edges without a triangulated face: discretize the curve directly.
        BRepAdaptor_Curve curve(edge);
        GCPnts_TangentialDeflection discretizer(curve, angular, linear);
        for (int k = 1; k < discretizer.NbPoints(); ++k) {
          pushPoint(out.edgePositions, discretizer.Value(k));
          pushPoint(out.edgePositions, discretizer.Value(k + 1));
        }
      }
    }
    out.edgeRanges.push_back(start);
    out.edgeRanges.push_back(static_cast<uint32_t>(out.edgePositions.size() / 3) - start);

    if (degenerated) {
      out.edgeKinds.push_back(OtherCurve);
      out.edgeLengths.push_back(0);
      out.edgeRadii.push_back(kNaN);
      out.edgeGeometry.insert(out.edgeGeometry.end(), 12, kNaN);
    } else {
      BRepAdaptor_Curve curve(edge);
      const uint8_t kind = curveKind(curve.GetType());
      GProp_GProps props;
      BRepGProp::LinearProperties(edge, props);
      out.edgeKinds.push_back(kind);
      out.edgeLengths.push_back(props.Mass());
      out.edgeRadii.push_back(kind == Circle ? curve.Circle().Radius() : kNaN);
      // Start and end follow the curve's parameters (not the edge orientation), so an arc runs
      // counterclockwise around its axis from start to end.
      const gp_Pnt first = curve.Value(curve.FirstParameter());
      const gp_Pnt last = curve.Value(curve.LastParameter());
      out.edgeGeometry.insert(out.edgeGeometry.end(), {first.X(), first.Y(), first.Z(), last.X(), last.Y(), last.Z()});
      if (kind == Circle) {
        const gp_Circ circle = curve.Circle();
        const gp_Pnt center = circle.Location();
        const gp_Dir axis = circle.Axis().Direction();
        out.edgeGeometry.insert(out.edgeGeometry.end(), {center.X(), center.Y(), center.Z(), axis.X(), axis.Y(), axis.Z()});
      } else {
        out.edgeGeometry.insert(out.edgeGeometry.end(), 6, kNaN);
      }
    }
  }
}

/** Sets up and runs a boolean operation, in parallel when enabled. */
void configure(BRepAlgoAPI_BooleanOperation& algorithm, const TopoDS_Shape& body, const TopoDS_Shape& tool) {
  NCollection_List<TopoDS_Shape> arguments;
  arguments.Append(body);
  NCollection_List<TopoDS_Shape> tools;
  tools.Append(tool);
  algorithm.SetArguments(arguments);
  algorithm.SetTools(tools);
  algorithm.SetRunParallel(parallel);
  algorithm.Build();
}

}  // namespace

namespace {

/** Reads the numbers of an encoded profile in order. */
class ProfileReader {
 public:
  explicit ProfileReader(const std::vector<double>& data) : data_(data) {}

  double number() {
    if (next_ >= data_.size()) throw KernelError("operation-failed", "profile data ends too early");
    return data_[next_++];
  }

  int count(int limit) {
    const double value = number();
    if (!(value >= 0 && value <= limit) || value != static_cast<int>(value)) throw KernelError("operation-failed", "invalid count in profile data");
    return static_cast<int>(value);
  }

 private:
  const std::vector<double>& data_;
  size_t next_ = 0;
};

TopoDS_Edge oriented(const TopoDS_Edge& edge, bool forward) {
  return forward ? edge : TopoDS::Edge(edge.Reversed());
}

/**
 * One exact edge of a profile loop (see extrudeProfile in core.hpp for the encoding), built from its
 * 2D curve on the sketch plane: the sketch coordinates are the plane's own parameters. Areas and
 * volumes are integrated along these curves, so they must not be approximations.
 */
TopoDS_Edge readEdge(ProfileReader& in, const occ::handle<Geom_Plane>& plane) {
  const int kind = in.count(4);
  switch (kind) {
    case 0: {
      const gp_Pnt2d from(in.number(), in.number());
      const gp_Pnt2d to(in.number(), in.number());
      if (from.Distance(to) <= Precision::Confusion()) throw KernelError("operation-failed", "a line of the profile has no length");
      return BRepBuilderAPI_MakeEdge(GCE2d_MakeSegment(from, to).Value(), plane).Edge();
    }
    case 1:
    case 2: {
      const gp_Pnt2d center(in.number(), in.number());
      const double radius = in.number();
      const double start = kind == 1 ? in.number() : 0;
      const double end = kind == 1 ? in.number() : 0;
      const bool ccw = in.number() != 0;
      occ::handle<Geom2d_Circle> circle = new Geom2d_Circle(gp_Ax2d(center, gp_Dir2d(1, 0)), radius);
      if (kind == 2) return oriented(BRepBuilderAPI_MakeEdge(circle, plane).Edge(), ccw);
      // The circle runs counterclockwise; a clockwise arc is the reversed counterclockwise one.
      return ccw ? BRepBuilderAPI_MakeEdge(circle, plane, start, end).Edge() : oriented(BRepBuilderAPI_MakeEdge(circle, plane, end, start).Edge(), false);
    }
    case 3: {
      const gp_Pnt2d center(in.number(), in.number());
      const double ux = in.number(), uy = in.number(), a = in.number(), b = in.number();
      const bool ccw = in.number() != 0;
      // An ellipse needs the major radius first; the other axis is turned a quarter counterclockwise.
      const bool aMajor = a >= b;
      const gp_Dir2d major = aMajor ? gp_Dir2d(ux, uy) : gp_Dir2d(-uy, ux);
      occ::handle<Geom2d_Ellipse> ellipse = new Geom2d_Ellipse(gp_Ax2d(center, major), aMajor ? a : b, aMajor ? b : a);
      return oriented(BRepBuilderAPI_MakeEdge(ellipse, plane).Edge(), ccw);
    }
    default: {
      const int poleCount = in.count(1 << 20);
      TColgp_Array1OfPnt2d poles(1, poleCount);
      for (int i = 1; i <= poleCount; ++i) {
        const double u = in.number();
        const double v = in.number();
        poles.SetValue(i, gp_Pnt2d(u, v));
      }
      const int knotCount = in.count(1 << 20);
      if (knotCount < 2 || poleCount != 3 * (knotCount - 1) + 1) throw KernelError("operation-failed", "invalid spline in profile data");
      TColStd_Array1OfReal knots(1, knotCount);
      TColStd_Array1OfInteger multiplicities(1, knotCount);
      for (int i = 1; i <= knotCount; ++i) {
        knots.SetValue(i, in.number());
        multiplicities.SetValue(i, i == 1 || i == knotCount ? 4 : 3);
      }
      occ::handle<Geom2d_BSplineCurve> curve = new Geom2d_BSplineCurve(poles, knots, multiplicities, 3);
      // The spans join with continuous curvature, so the inner knots reduce to simple ones exactly.
      for (int i = 2; i < knotCount; ++i) curve->RemoveKnot(i, 1, 1e-9);
      BRepBuilderAPI_MakeEdge maker(curve, plane);
      if (!maker.IsDone()) throw KernelError("operation-failed", "a spline of the profile could not be built");
      return maker.Edge();
    }
  }
}

TopoDS_Wire readLoop(ProfileReader& in, const occ::handle<Geom_Plane>& plane) {
  const int edgeCount = in.count(1 << 20);
  BRepBuilderAPI_MakeWire wire;
  for (int e = 0; e < edgeCount; ++e) {
    TopoDS_Edge edge = readEdge(in, plane);
    BRepLib::BuildCurves3d(edge);
    wire.Add(edge);
    if (!wire.IsDone()) throw KernelError("operation-failed", "the edges of a profile outline do not connect");
  }
  if (!wire.IsDone() || !wire.Wire().Closed()) throw KernelError("operation-failed", "a profile outline is not closed");
  return wire.Wire();
}

}  // namespace

int extrudeProfile(const std::vector<double>& profile, const std::vector<double>& frame, double from, double to) {
  if (frame.size() != 9) throw KernelError("operation-failed", "a plane needs 9 values");
  if (!(std::abs(to - from) > 1e-9)) throw KernelError("operation-failed", "the extrusion has no depth");
  const gp_Pnt origin(frame[0], frame[1], frame[2]);
  const gp_Dir xDir(frame[3], frame[4], frame[5]);
  const gp_Dir normal(frame[6], frame[7], frame[8]);
  // u along xDir, v along normal × xDir: the sketch coordinates.
  const occ::handle<Geom_Plane> plane = new Geom_Plane(gp_Ax3(origin, normal, xDir));

  ProfileReader in(profile);
  const int regionCount = in.count(1 << 20);
  if (regionCount == 0) throw KernelError("operation-failed", "the sketch has no closed outline");
  TopoDS_Shape result;
  for (int r = 0; r < regionCount; ++r) {
    const int loopCount = in.count(1 << 20);
    if (loopCount == 0) throw KernelError("operation-failed", "a profile region has no outline");
    // Outer loops run counterclockwise and holes clockwise, as the face needs them.
    BRepBuilderAPI_MakeFace faceMaker(plane, readLoop(in, plane), Precision::Confusion());
    for (int l = 1; l < loopCount; ++l) faceMaker.Add(readLoop(in, plane));
    if (!faceMaker.IsDone()) throw KernelError("operation-failed", "a face could not be built from the profile");
    TopoDS_Shape face = faceMaker.Face();
    if (from != 0) {
      gp_Trsf shift;
      shift.SetTranslation(gp_Vec(normal) * from);
      face = BRepBuilderAPI_Transform(face, shift, true).Shape();
    }
    BRepPrimAPI_MakePrism prism(face, gp_Vec(normal) * (to - from));
    if (!prism.IsDone()) throw KernelError("operation-failed", "the profile could not be extruded");
    if (result.IsNull()) {
      result = prism.Shape();
    } else {
      BRepAlgoAPI_Fuse fuse;
      configure(fuse, result, prism.Shape());
      if (fuse.HasErrors()) throw KernelError("operation-failed", "the extruded regions could not be joined");
      fuse.SimplifyResult(true, true, 1e-6);
      result = fuse.Shape();
    }
  }
  if (countSolids(result) == 0) throw KernelError("operation-failed", "the extrusion is not a solid");
  return store().add(result);
}

void setParallel(bool enabled) { parallel = enabled; }

// ------------------------------------------------------------------ features

int makeBox(double x, double y, double z, double dx, double dy, double dz) {
  BRepPrimAPI_MakeBox maker(gp_Pnt(x, y, z), dx, dy, dz);
  return store().add(maker.Shape());
}

int makeCylinder(double px, double py, double pz, double dx, double dy, double dz, double radius, double height) {
  BRepPrimAPI_MakeCylinder maker(gp_Ax2(gp_Pnt(px, py, pz), gp_Dir(dx, dy, dz)), radius, height);
  return store().add(maker.Shape());
}

int booleanOperation(int bodyId, int toolId, int op) {
  const TopoDS_Shape& body = store().get(bodyId);
  const TopoDS_Shape& tool = store().get(toolId);
  TopoDS_Shape result;
  if (op == 0) {
    BRepAlgoAPI_Fuse algorithm;
    configure(algorithm, body, tool);
    if (algorithm.HasErrors()) throw KernelError("operation-failed", "boolean operation failed");
    algorithm.SimplifyResult(true, true, 1e-6);
    result = algorithm.Shape();
  } else {
    BRepAlgoAPI_Cut algorithm;
    configure(algorithm, body, tool);
    if (algorithm.HasErrors()) throw KernelError("operation-failed", "boolean operation failed");
    algorithm.SimplifyResult(true, true, 1e-6);
    result = algorithm.Shape();
  }
  if (countSolids(result) == 0) throw KernelError("empty-result", "the operation removed the whole body");
  return store().add(result);
}

int fillet(int bodyId, const std::vector<int>& edgeIndices, double radius) {
  const TopoDS_Shape& body = store().get(bodyId);
  BRepFilletAPI_MakeFillet maker(body, ChFi3d_Rational);
  for (const TopoDS_Edge& edge : selectEdges(body, edgeIndices)) maker.Add(radius, edge);
  maker.Build();
  if (!maker.IsDone()) throw KernelError("operation-failed", "fillet could not be computed (radius too large?)");
  const TopoDS_Shape result = maker.Shape();
  requireValidSolid(result, "fillet");
  return store().add(result);
}

int chamfer(int bodyId, const std::vector<int>& edgeIndices, double distance) {
  const TopoDS_Shape& body = store().get(bodyId);
  BRepFilletAPI_MakeChamfer maker(body);
  for (const TopoDS_Edge& edge : selectEdges(body, edgeIndices)) maker.Add(distance, edge);
  maker.Build();
  if (!maker.IsDone()) throw KernelError("operation-failed", "chamfer could not be computed (distance too large?)");
  const TopoDS_Shape result = maker.Shape();
  requireValidSolid(result, "chamfer");
  return store().add(result);
}

void release(int id) { store().release(id); }

int shapeCount() { return store().size(); }

// ------------------------------------------------------------------ queries

Counts counts(int id) {
  const TopoDS_Shape& shape = store().get(id);
  ShapeMap faces, edges;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  TopExp::MapShapes(shape, TopAbs_EDGE, edges);
  return {faces.Extent(), edges.Extent(), countSolids(shape)};
}

BoundingBox boundingBox(int id) {
  Bnd_Box box;
  BRepBndLib::Add(store().get(id), box, false);
  BoundingBox result;
  if (box.IsVoid()) return result;
  const gp_Pnt min = box.CornerMin();
  const gp_Pnt max = box.CornerMax();
  result.min[0] = min.X();
  result.min[1] = min.Y();
  result.min[2] = min.Z();
  result.max[0] = max.X();
  result.max[1] = max.Y();
  result.max[2] = max.Z();
  return result;
}

namespace {

/**
 * Whether the fast fixed Gauss rule would be inexact: it integrates planes, cylinders, cones, spheres and
 * tori bounded by lines and circles exactly, but not faces bounded by ellipses or splines, and OCCT
 * integrates surfaces of extrusion and revolution over spline curves inaccurately in any mode.
 */
bool needsPreciseIntegration(const TopoDS_Shape& shape) {
  ShapeMap faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  for (int f = 1; f <= faces.Extent(); ++f) {
    switch (BRepAdaptor_Surface(TopoDS::Face(faces(f)), false).GetType()) {
      case GeomAbs_Plane:
      case GeomAbs_Cylinder:
      case GeomAbs_Cone:
      case GeomAbs_Sphere:
      case GeomAbs_Torus:
        break;
      default:
        return true;
    }
  }
  ShapeMap edges;
  TopExp::MapShapes(shape, TopAbs_EDGE, edges);
  for (int e = 1; e <= edges.Extent(); ++e) {
    const TopoDS_Edge edge = TopoDS::Edge(edges(e));
    if (BRep_Tool::Degenerated(edge)) continue;
    const GeomAbs_CurveType type = BRepAdaptor_Curve(edge).GetType();
    if (type != GeomAbs_Line && type != GeomAbs_Circle) return true;
  }
  return false;
}

}  // namespace

MassProperties massProperties(int id) {
  const TopoDS_Shape& body = store().get(id);
  GProp_GProps volume;
  GProp_GProps surface;
  if (needsPreciseIntegration(body)) {
    // Surfaces of extrusion and revolution become exact B-spline surfaces in a copy (the body keeps its
    // analytic surfaces), then adaptive integration reaches the requested accuracy.
    const TopoDS_Shape shape = ShapeCustom::ConvertToBSpline(body, true, true, false, false);
    constexpr double kRelativeError = 1e-9;
    BRepGProp::VolumeProperties(shape, volume, kRelativeError, true);
    BRepGProp::SurfaceProperties(shape, surface, kRelativeError);
  } else {
    BRepGProp::VolumeProperties(body, volume);
    BRepGProp::SurfaceProperties(body, surface);
  }
  const gp_Pnt center = volume.CentreOfMass();
  MassProperties result;
  result.volume = volume.Mass();
  result.area = surface.Mass();
  result.center[0] = center.X();
  result.center[1] = center.Y();
  result.center[2] = center.Z();
  return result;
}

MeshData mesh(int id, double linear, double angular) {
  const TopoDS_Shape& shape = store().get(id);
  triangulate(shape, linear, angular, true);
  MeshData out;
  appendFaces(shape, out, true);
  appendEdges(shape, linear, angular, out);
  return out;
}

MeshData exportMesh(int id, double linear, double angular) {
  BRepBuilderAPI_Copy copier(store().get(id), true, false);
  const TopoDS_Shape copy = copier.Shape();
  triangulate(copy, linear, angular, false);
  MeshData out;
  appendFaces(copy, out, false);
  return out;
}

// ------------------------------------------------------------------ data exchange

std::string exportStep(int id) {
  STEPControl_Writer writer;
  if (writer.Transfer(store().get(id), STEPControl_AsIs) != IFSelect_RetDone) throw KernelError("operation-failed", "STEP transfer failed");
  std::ostringstream stream;
  if (writer.WriteStream(stream) != IFSelect_RetDone) throw KernelError("operation-failed", "STEP write failed");
  return stream.str();
}

int importStep(const std::string& data) {
  std::istringstream stream(data);
  STEPControl_Reader reader;
  if (reader.ReadStream("import.step", stream) != IFSelect_RetDone) throw KernelError("operation-failed", "the STEP file could not be read");
  if (reader.TransferRoots() == 0) throw KernelError("operation-failed", "the STEP file contains no shapes");
  return store().add(reader.OneShape());
}

// ------------------------------------------------------------------ errors

std::pair<std::string, std::string> describeException(std::exception_ptr error) {
  try {
    std::rethrow_exception(error);
  } catch (const KernelError& e) {
    return {e.code, e.what()};
  } catch (const Standard_Failure& e) {
    const char* text = e.what();
    return {"operation-failed", std::string("OCCT: ") + (text && *text ? text : "geometry error")};
  } catch (const std::exception& e) {
    return {"operation-failed", e.what()};
  } catch (...) {
    return {"operation-failed", "unknown kernel error"};
  }
}

}  // namespace parawerk
