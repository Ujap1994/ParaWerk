// ParaWerk geometry kernel core (see core.hpp and docs/adr/0001-geometry-kernel.md).

#include "core.hpp"

#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepBndLib.hxx>
#include <BRepBuilderAPI_Copy.hxx>
#include <BRepBuilderAPI_MakeShape.hxx>
#include <BRepBuilderAPI_MakeEdge.hxx>
#include <BRepBuilderAPI_MakeFace.hxx>
#include <BRepBuilderAPI_MakeWire.hxx>
#include <BRepBuilderAPI_Transform.hxx>
#include <BRepCheck_Analyzer.hxx>
#include <BRepFilletAPI_MakeChamfer.hxx>
#include <BRepFilletAPI_MakeFillet.hxx>
#include <BRepBuilderAPI_MakeSolid.hxx>
#include <BRepAlgoAPI_Common.hxx>
#include <BRepPrimAPI_MakeHalfSpace.hxx>
#include <BRepOffsetAPI_MakeOffsetShape.hxx>
#include <BRepOffsetAPI_MakeThickSolid.hxx>
#include <BRepExtrema_DistShapeShape.hxx>
#include <BRepBuilderAPI_MakeVertex.hxx>
#include <BRepGProp.hxx>
#include <BRepOffsetAPI_DraftAngle.hxx>
#include <BRep_Builder.hxx>
#include <TopoDS_Compound.hxx>
#include <BRepLib.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
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
#include <TopoDS_Vertex.hxx>
#include <gp_Cone.hxx>
#include <gp_Elips.hxx>
#include <gp_Lin.hxx>
#include <gp_Torus.hxx>
#include <gp_Ax2.hxx>
#include <gp_Circ.hxx>
#include <gp_Cylinder.hxx>
#include <gp_Ax3.hxx>
#include <gp_Dir.hxx>
#include <gp_Pln.hxx>
#include <gp_Mat.hxx>
#include <gp_Pnt.hxx>
#include <gp_Sphere.hxx>

#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>
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

/** A body and the names of its faces (see FaceNames in core.hpp). */
struct StoredShape {
  TopoDS_Shape shape;
  FaceNames names;
};

class ShapeStore {
 public:
  int add(const TopoDS_Shape& shape, FaceNames names = {}) {
    const int id = next_++;
    shapes_.emplace(id, StoredShape{shape, std::move(names)});
    return id;
  }

  const StoredShape& entry(int id) const {
    const auto it = shapes_.find(id);
    if (it == shapes_.end()) throw KernelError("unknown", "unknown shape id " + std::to_string(id));
    return it->second;
  }

  const TopoDS_Shape& get(int id) const { return entry(id).shape; }

  void release(int id) { shapes_.erase(id); }
  int size() const { return static_cast<int>(shapes_.size()); }

 private:
  std::unordered_map<int, StoredShape> shapes_;
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

/**
 * Names the faces of `result` after the faces of the inputs they come from: unchanged, modified (split
 * faces share the name) or merged (the earlier input wins, so faces of the existing body keep their
 * names). Faces without a source stay unnamed ("").
 */
class FaceNamer {
 public:
  explicit FaceNamer(const TopoDS_Shape& result) {
    TopExp::MapShapes(result, TopAbs_FACE, faces_);
    names_.resize(static_cast<size_t>(faces_.Extent()));
    named_.resize(static_cast<size_t>(faces_.Extent()), false);
  }

  /** Gives the face its name unless it already has one. */
  void assign(const TopoDS_Shape& face, const std::string& name) {
    const int index = faces_.FindIndex(face);
    if (index == 0 || named_[static_cast<size_t>(index - 1)]) return;
    names_[static_cast<size_t>(index - 1)] = name;
    named_[static_cast<size_t>(index - 1)] = true;
  }

  void inherit(BRepBuilderAPI_MakeShape& maker, const TopoDS_Shape& input, const FaceNames& names) {
    ShapeMap inputFaces;
    TopExp::MapShapes(input, TopAbs_FACE, inputFaces);
    for (int f = 1; f <= inputFaces.Extent(); ++f) {
      const TopoDS_Shape& face = inputFaces(f);
      const std::string& name = f <= static_cast<int>(names.size()) ? names[static_cast<size_t>(f - 1)] : empty_;
      const NCollection_List<TopoDS_Shape>& modified = maker.Modified(face);
      if (!modified.IsEmpty()) {
        for (const TopoDS_Shape& piece : modified) assign(piece, name);
      } else if (!maker.IsDeleted(face)) {
        assign(face, name);
      }
    }
  }

  /** Names the faces generated from `source` (an edge or vertex). */
  void generated(BRepBuilderAPI_MakeShape& maker, const TopoDS_Shape& source, const std::string& name) {
    for (const TopoDS_Shape& shape : maker.Generated(source)) {
      if (shape.ShapeType() == TopAbs_FACE) assign(shape, name);
    }
  }

  /** Names every face that has no name yet. */
  void rest(const std::string& name) {
    for (size_t i = 0; i < names_.size(); ++i) {
      if (!named_[i]) names_[i] = name;
      named_[i] = true;
    }
  }

  FaceNames take() { return std::move(names_); }

 private:
  ShapeMap faces_;
  FaceNames names_;
  std::vector<bool> named_;
  const std::string empty_;
};

/** Set by cuts that leave every face of the body as it was (the tool missed the body). */
bool cutMissed = false;

/** The faces of `result` that come from faces of `input` (unchanged, modified or merged). */
ShapeMap facesFrom(BRepBuilderAPI_MakeShape& maker, const TopoDS_Shape& input, const ShapeMap& result) {
  ShapeMap faces, from;
  TopExp::MapShapes(input, TopAbs_FACE, faces);
  for (int f = 1; f <= faces.Extent(); ++f) {
    for (const TopoDS_Shape& piece : maker.Modified(faces(f))) {
      if (result.Contains(piece)) from.Add(piece);
    }
    if (!maker.IsDeleted(faces(f)) && result.Contains(faces(f))) from.Add(faces(f));
  }
  return from;
}

/**
 * Whether a cut removed material: then walls of its tools are faces of the result that do not come from
 * the body. A tool that misses the body, or only touches it (its face merges into a face of the body),
 * leaves none.
 */
bool toolsLeftWalls(BRepBuilderAPI_MakeShape& maker, const TopoDS_Shape& body, const std::vector<TopoDS_Shape>& tools, const TopoDS_Shape& result) {
  ShapeMap kept;
  TopExp::MapShapes(result, TopAbs_FACE, kept);
  const ShapeMap fromBody = facesFrom(maker, body, kept);
  for (const TopoDS_Shape& tool : tools) {
    const ShapeMap fromTool = facesFrom(maker, tool, kept);
    for (int f = 1; f <= fromTool.Extent(); ++f) {
      if (!fromBody.Contains(fromTool(f))) return true;
    }
  }
  return false;
}

/** "<prefix>:<role>", or no name when the operation has none. */
std::string faceName(const std::string& prefix, const std::string& role) { return prefix.empty() ? std::string() : prefix + ":" + role; }

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

/** The edges of a profile as they are in its faces, with the names of the sketch curves they come from. */
struct NamedEdges {
  const std::vector<std::string>& names;
  std::vector<std::pair<TopoDS_Edge, std::string>> edges;

  void add(const TopoDS_Edge& edge) {
    const size_t next = edges.size();
    edges.emplace_back(edge, next < names.size() ? names[next] : std::string());
  }
};

TopoDS_Wire readLoop(ProfileReader& in, const occ::handle<Geom_Plane>& plane, NamedEdges& named) {
  const int edgeCount = in.count(1 << 20);
  BRepBuilderAPI_MakeWire wire;
  for (int e = 0; e < edgeCount; ++e) {
    TopoDS_Edge edge = readEdge(in, plane);
    BRepLib::BuildCurves3d(edge);
    wire.Add(edge);
    if (!wire.IsDone()) throw KernelError("operation-failed", "the edges of a profile outline do not connect");
    // The wire may replace the edge to share vertices with its neighbours: remember the edge it keeps.
    named.add(wire.Edge());
  }
  if (!wire.IsDone() || !wire.Wire().Closed()) throw KernelError("operation-failed", "a profile outline is not closed");
  return wire.Wire();
}

}  // namespace

namespace {

/** The sketch plane of a frame (origin, x direction, normal): u along x, v along normal × x. */
occ::handle<Geom_Plane> framePlane(const std::vector<double>& frame) {
  if (frame.size() != 9) throw KernelError("operation-failed", "a plane needs 9 values");
  const gp_Pnt origin(frame[0], frame[1], frame[2]);
  const gp_Dir xDir(frame[3], frame[4], frame[5]);
  const gp_Dir normal(frame[6], frame[7], frame[8]);
  return new Geom_Plane(gp_Ax3(origin, normal, xDir));
}

/** One planar face per profile region (see extrudeProfile in core.hpp for the encoding). */
std::vector<TopoDS_Face> readFaces(const std::vector<double>& profile, const occ::handle<Geom_Plane>& plane, NamedEdges& named) {
  ProfileReader in(profile);
  const int regionCount = in.count(1 << 20);
  if (regionCount == 0) throw KernelError("operation-failed", "the sketch has no closed outline");
  std::vector<TopoDS_Face> faces;
  for (int r = 0; r < regionCount; ++r) {
    const int loopCount = in.count(1 << 20);
    if (loopCount == 0) throw KernelError("operation-failed", "a profile region has no outline");
    // Outer loops run counterclockwise and holes clockwise, as the face needs them.
    BRepBuilderAPI_MakeFace faceMaker(plane, readLoop(in, plane, named), Precision::Confusion());
    for (int l = 1; l < loopCount; ++l) faceMaker.Add(readLoop(in, plane, named));
    if (!faceMaker.IsDone()) throw KernelError("operation-failed", "a face could not be built from the profile");
    faces.push_back(faceMaker.Face());
  }
  return faces;
}

/** Joins the solids made from the regions of one profile (with their face names). */
StoredShape joinRegions(const std::vector<StoredShape>& solids, const char* what) {
  StoredShape result;
  for (const StoredShape& solid : solids) {
    if (result.shape.IsNull()) {
      result = solid;
      continue;
    }
    BRepAlgoAPI_Fuse fuse;
    configure(fuse, result.shape, solid.shape);
    if (fuse.HasErrors()) throw KernelError("operation-failed", std::string("the ") + what + " regions could not be joined");
    fuse.SimplifyResult(true, true, 1e-6);
    FaceNamer namer(fuse.Shape());
    namer.inherit(fuse, result.shape, result.names);
    namer.inherit(fuse, solid.shape, solid.names);
    result = {fuse.Shape(), namer.take()};
  }
  if (countSolids(result.shape) == 0) throw KernelError("operation-failed", std::string("the ") + what + " is not a solid");
  return result;
}

/** Names the faces a sweep (prism or revolution) made from `face`: sides after their profile edges, then the ends. */
template <typename Sweep>
FaceNames sweepNames(Sweep& sweep, const NamedEdges& named, const std::string& name) {
  FaceNamer namer(sweep.Shape());
  for (const auto& [edge, edgeName] : named.edges) namer.generated(sweep, edge, faceName(name, "side:" + edgeName));
  namer.assign(sweep.FirstShape(), faceName(name, "start"));
  namer.assign(sweep.LastShape(), faceName(name, "end"));
  namer.rest(faceName(name, "other"));
  return namer.take();
}

}  // namespace

int extrudeProfile(const std::vector<double>& profile, const std::vector<double>& frame, double from, double to,
                   const std::vector<std::string>& edgeNames, const std::string& name) {
  if (!(std::abs(to - from) > 1e-9)) throw KernelError("operation-failed", "the extrusion has no depth");
  const occ::handle<Geom_Plane> plane = framePlane(frame);
  const gp_Vec normal(plane->Position().Direction());
  // The faces start on the plane moved to `from`: the profile coordinates are the plane's own parameters.
  if (from != 0) plane->Translate(normal * from);
  NamedEdges named{edgeNames, {}};
  std::vector<StoredShape> solids;
  for (const TopoDS_Face& face : readFaces(profile, plane, named)) {
    BRepPrimAPI_MakePrism prism(face, normal * (to - from));
    if (!prism.IsDone()) throw KernelError("operation-failed", "the profile could not be extruded");
    solids.push_back({prism.Shape(), sweepNames(prism, named, name)});
  }
  StoredShape result = joinRegions(solids, "extruded");
  return store().add(result.shape, std::move(result.names));
}

int draftSides(int toolId, const std::vector<double>& frame, double angle, const std::string& name) {
  const StoredShape& tool = store().entry(toolId);
  const occ::handle<Geom_Plane> plane = framePlane(frame);
  const gp_Pln neutral = plane->Pln();
  const gp_Dir pull = neutral.Axis().Direction();
  BRepOffsetAPI_DraftAngle draft(tool.shape);
  ShapeMap faces;
  TopExp::MapShapes(tool.shape, TopAbs_FACE, faces);
  const std::string side = faceName(name, "side:");
  for (int f = 1; f <= faces.Extent(); ++f) {
    const std::string& faceName = f <= static_cast<int>(tool.names.size()) ? tool.names[static_cast<size_t>(f - 1)] : std::string();
    if (faceName.rfind(side, 0) != 0) continue;
    draft.Add(TopoDS::Face(faces(f)), pull, angle, neutral);
    if (!draft.AddDone()) throw KernelError("operation-failed", "the draft angle does not fit a side face (too steep?)");
  }
  draft.Build();
  if (!draft.IsDone()) throw KernelError("operation-failed", "the draft could not be computed");
  FaceNamer namer(draft.Shape());
  // The drafted faces are not reported by Modified(), only by ModifiedShape().
  for (int f = 1; f <= faces.Extent(); ++f) {
    const std::string& faceName = f <= static_cast<int>(tool.names.size()) ? tool.names[static_cast<size_t>(f - 1)] : std::string();
    const NCollection_List<TopoDS_Shape>& modified = draft.Modified(faces(f));
    if (!modified.IsEmpty()) {
      for (const TopoDS_Shape& piece : modified) namer.assign(piece, faceName);
    } else {
      const TopoDS_Shape& moved = draft.ModifiedShape(faces(f));
      namer.assign(moved.IsNull() ? faces(f) : moved, faceName);
    }
  }
  namer.rest(faceName(name, "other"));
  return store().add(draft.Shape(), namer.take());
}

namespace {

/** The solid of revolveProfile, with its face names, not yet stored. */
/**
 * Names the faces a sweep left unnamed after the profile edge whose middle lies on them. A revolution
 * reports no generated face for an edge that touches the axis (it sweeps a flat disk), so the disks at
 * the ends of a shaft would otherwise share the name "<name>:other".
 */
void nameByContact(const TopoDS_Shape& shape, FaceNames& names, const NamedEdges& named, const std::string& name) {
  const std::string other = faceName(name, "other");
  ShapeMap faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  std::vector<std::pair<gp_Pnt, std::string>> middles;
  for (const auto& [edge, edgeName] : named.edges) {
    if (edgeName.empty() || BRep_Tool::Degenerated(edge)) continue;
    BRepAdaptor_Curve curve(edge);
    middles.emplace_back(curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2), edgeName);
  }
  for (int f = 1; f <= faces.Extent() && f <= static_cast<int>(names.size()); ++f) {
    std::string& faceName_ = names[static_cast<size_t>(f - 1)];
    if (faceName_ != other) continue;
    for (const auto& [middle, edgeName] : middles) {
      BRepExtrema_DistShapeShape distance(BRepBuilderAPI_MakeVertex(middle).Vertex(), faces(f));
      if (distance.IsDone() && distance.Value() < 1e-6) {
        faceName_ = faceName(name, "side:" + edgeName);
        break;
      }
    }
  }
}

StoredShape revolveRegions(const std::vector<double>& profile, const std::vector<double>& frame, const std::vector<double>& axis, double from, double to,
                           const std::vector<std::string>& edgeNames, const std::string& name) {
  if (axis.size() != 4) throw KernelError("operation-failed", "an axis needs 4 values");
  if (!(to - from > 1e-9 && to - from <= 2 * M_PI + 1e-9)) throw KernelError("operation-failed", "the angle must be above 0 and up to 360 degrees");
  const occ::handle<Geom_Plane> plane = framePlane(frame);
  const gp_Pnt start = plane->Value(axis[0], axis[1]);
  const gp_Pnt end = plane->Value(axis[2], axis[3]);
  if (start.Distance(end) <= Precision::Confusion()) throw KernelError("operation-failed", "the axis has no length");
  const gp_Ax1 line(start, gp_Dir(gp_Vec(start, end)));
  // A full turn is exactly 2π, so the solid closes on itself.
  const double sweep = std::min(to - from, 2 * M_PI);
  // The faces start on the plane turned to `from` (the axis lies in the plane, so it stays where it is).
  if (from != 0) plane->Rotate(line, from);
  NamedEdges named{edgeNames, {}};
  std::vector<StoredShape> solids;
  for (const TopoDS_Face& face : readFaces(profile, plane, named)) {
    BRepPrimAPI_MakeRevol revolution(face, line, sweep);
    if (!revolution.IsDone()) throw KernelError("operation-failed", "the profile could not be revolved");
    FaceNames names = sweepNames(revolution, named, name);
    nameByContact(revolution.Shape(), names, named, name);
    solids.push_back({revolution.Shape(), std::move(names)});
  }
  return joinRegions(solids, "revolved");
}

}  // namespace

int revolveProfile(const std::vector<double>& profile, const std::vector<double>& frame, const std::vector<double>& axis, double from, double to,
                   const std::vector<std::string>& edgeNames, const std::string& name) {
  StoredShape result = revolveRegions(profile, frame, axis, from, to, edgeNames, name);
  return store().add(result.shape, std::move(result.names));
}

int cutHoles(int bodyId, const std::vector<double>& profile, const std::vector<double>& placements, const std::vector<std::string>& edgeNames,
             const std::string& name) {
  if (placements.empty() || placements.size() % 6 != 0) throw KernelError("operation-failed", "every hole needs a center and a direction");
  // One hole around the -Z axis through the origin: profile x is the radius, y the depth (plane v = -Z).
  const std::vector<double> frame = {0, 0, 0, 1, 0, 0, 0, 1, 0};
  const StoredShape hole = revolveRegions(profile, frame, {0, 0, 0, 1}, 0, 2 * M_PI, edgeNames, "#");
  const gp_Ax3 canonical(gp_Pnt(0, 0, 0), gp_Dir(0, 0, -1), gp_Dir(1, 0, 0));

  // Every hole is the same solid moved into place (sharing its geometry), and all are cut in one operation.
  const StoredShape& body = store().entry(bodyId);
  NCollection_List<TopoDS_Shape> tools;
  std::vector<StoredShape> placed;
  for (size_t k = 0; k < placements.size(); k += 6) {
    const gp_Pnt center(placements[k], placements[k + 1], placements[k + 2]);
    const gp_Dir direction(placements[k + 3], placements[k + 4], placements[k + 5]);
    gp_Trsf move;
    move.SetDisplacement(canonical, gp_Ax3(center, direction));
    StoredShape copy{hole.shape.Moved(TopLoc_Location(move)), hole.names};
    // Faces of hole k are "<name>:<k>:<role>" (the template was named "#:<role>").
    for (std::string& face : copy.names) face = name.empty() ? std::string() : name + ":" + std::to_string(k / 6) + face.substr(1);
    tools.Append(copy.shape);
    placed.push_back(std::move(copy));
  }
  BRepAlgoAPI_Cut algorithm;
  NCollection_List<TopoDS_Shape> arguments;
  arguments.Append(body.shape);
  algorithm.SetArguments(arguments);
  algorithm.SetTools(tools);
  algorithm.SetRunParallel(parallel);
  algorithm.Build();
  if (algorithm.HasErrors()) throw KernelError("operation-failed", "the holes could not be cut");
  algorithm.SimplifyResult(true, true, 1e-6);
  const TopoDS_Shape result = algorithm.Shape();
  if (countSolids(result) == 0) throw KernelError("empty-result", "the holes removed the whole body");
  std::vector<TopoDS_Shape> holeShapes;
  for (const StoredShape& copy : placed) holeShapes.push_back(copy.shape);
  cutMissed = !toolsLeftWalls(algorithm, body.shape, holeShapes, result);
  FaceNamer namer(result);
  namer.inherit(algorithm, body.shape, body.names);
  for (const StoredShape& copy : placed) namer.inherit(algorithm, copy.shape, copy.names);
  return store().add(result, namer.take());
}

int shell(int bodyId, const std::vector<int>& openFaces, double thickness, bool outward, const std::string& name) {
  if (!(thickness > 0)) throw KernelError("operation-failed", "the wall thickness must be above 0");
  const StoredShape& body = store().entry(bodyId);
  ShapeMap faces;
  TopExp::MapShapes(body.shape, TopAbs_FACE, faces);
  NCollection_List<TopoDS_Shape> closing;
  for (const int index : openFaces) {
    if (index < 0 || index >= faces.Extent()) throw KernelError("operation-failed", "face " + std::to_string(index) + " does not exist");
    closing.Append(faces(index + 1));
  }
  const double offset = outward ? thickness : -thickness;
  const char* failure = "the shell could not be made (wall too thick for the part?)";
  // OCCT returns the body unchanged (or a cavity of nothing) when the walls meet: a real shell removes
  // material inside, or reaches beyond the body outside.
  const auto requireShelled = [&](const TopoDS_Shape& result) {
    GProp_GProps before, after;
    BRepGProp::VolumeProperties(body.shape, before);
    BRepGProp::VolumeProperties(result, after);
    Bnd_Box inner, outer;
    BRepBndLib::Add(body.shape, inner, false);
    BRepBndLib::Add(result, outer, false);
    const double grown = outer.CornerMax().Distance(inner.CornerMax()) + outer.CornerMin().Distance(inner.CornerMin());
    const bool shelled = outward ? grown > 1e-6 && after.Mass() > 0 : after.Mass() < before.Mass() * (1 - 1e-9);
    if (!shelled) throw KernelError("operation-failed", failure);
  };
  // The wall faces made from face f are named "<name>:<name of f>"; faces along the openings "<name>:rim".
  const auto wallName = [&](int f) {
    const std::string& original = f <= static_cast<int>(body.names.size()) ? body.names[static_cast<size_t>(f - 1)] : std::string();
    return faceName(name, original.empty() ? "wall" : original);
  };
  if (!closing.IsEmpty()) {
    BRepOffsetAPI_MakeThickSolid maker;
    maker.MakeThickSolidByJoin(body.shape, closing, offset, 1e-3, BRepOffset_Skin, false, false, GeomAbs_Intersection);
    maker.Build();
    if (!maker.IsDone()) throw KernelError("operation-failed", failure);
    const TopoDS_Shape result = maker.Shape();
    requireValidSolid(result, "shell");
    requireShelled(result);
    FaceNamer namer(result);
    for (int f = 1; f <= faces.Extent(); ++f) namer.generated(maker, faces(f), wallName(f));
    namer.inherit(maker, body.shape, body.names);
    namer.rest(faceName(name, "rim"));
    return store().add(result, namer.take());
  }
  // A closed hollow body: the surface moved inwards (or outwards) bounds the cavity (or the new outside).
  BRepOffsetAPI_MakeOffsetShape surface;
  surface.PerformByJoin(body.shape, offset, 1e-3, BRepOffset_Skin, false, false, GeomAbs_Intersection);
  if (!surface.IsDone()) throw KernelError("operation-failed", failure);
  ShapeMap shells;
  TopExp::MapShapes(surface.Shape(), TopAbs_SHELL, shells);
  if (shells.Extent() != 1) throw KernelError("operation-failed", failure);
  BRepBuilderAPI_MakeSolid solidMaker(TopoDS::Shell(shells(1)));
  if (!solidMaker.IsDone()) throw KernelError("operation-failed", failure);
  TopoDS_Shape offsetSolid = solidMaker.Solid();
  BRepLib::OrientClosedSolid(TopoDS::Solid(offsetSolid));
  FaceNamer offsetNamer(offsetSolid);
  for (int f = 1; f <= faces.Extent(); ++f) offsetNamer.generated(surface, faces(f), wallName(f));
  offsetNamer.rest(faceName(name, "wall"));
  const FaceNames offsetNames = offsetNamer.take();
  // Inwards: cut the cavity out of the body; outwards: the body becomes the cavity of the bigger solid.
  BRepAlgoAPI_Cut cut;
  configure(cut, outward ? offsetSolid : body.shape, outward ? body.shape : offsetSolid);
  if (cut.HasErrors()) throw KernelError("operation-failed", failure);
  const TopoDS_Shape result = cut.Shape();
  if (countSolids(result) == 0) throw KernelError("operation-failed", failure);
  requireShelled(result);
  FaceNamer namer(result);
  namer.inherit(cut, body.shape, body.names);
  namer.inherit(cut, offsetSolid, offsetNames);
  return store().add(result, namer.take());
}

int trimByPlane(int shapeId, const std::vector<double>& plane, const std::string& name) {
  if (plane.size() != 6) throw KernelError("operation-failed", "a plane needs a point and a normal");
  const StoredShape& shape = store().entry(shapeId);
  const gp_Pnt point(plane[0], plane[1], plane[2]);
  const gp_Dir normal(plane[3], plane[4], plane[5]);
  // The half space behind the plane (against its normal), marked by a point on that side.
  const TopoDS_Face face = BRepBuilderAPI_MakeFace(gp_Pln(point, normal)).Face();
  const TopoDS_Shape behind = BRepPrimAPI_MakeHalfSpace(face, point.Translated(-gp_Vec(normal))).Solid();
  BRepAlgoAPI_Common common;
  configure(common, shape.shape, behind);
  if (common.HasErrors()) throw KernelError("operation-failed", "the solid could not be cut off at the plane");
  common.SimplifyResult(true, true, 1e-6);
  const TopoDS_Shape result = common.Shape();
  if (countSolids(result) == 0) throw KernelError("empty-result", "nothing is left in front of the plane");
  FaceNamer namer(result);
  namer.inherit(common, shape.shape, shape.names);
  namer.rest(faceName(name, "end"));
  return store().add(result, namer.take());
}

int combineCopies(int bodyId, int toolId, const std::vector<double>& transforms, int op, const std::string& name) {
  if (transforms.empty() || transforms.size() % 12 != 0) throw KernelError("operation-failed", "every copy needs a transformation (12 values)");
  const StoredShape& body = store().entry(bodyId);
  const StoredShape& tool = store().entry(toolId);
  ShapeMap toolFaces;
  TopExp::MapShapes(tool.shape, TopAbs_FACE, toolFaces);
  NCollection_List<TopoDS_Shape> tools;
  std::vector<StoredShape> copies;
  for (size_t k = 0; k < transforms.size(); k += 12) {
    const double* m = &transforms[k];
    gp_Trsf transform;
    transform.SetValues(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11]);
    const std::string prefix = name.empty() ? std::string() : name + ":" + std::to_string(k / 12) + ":";
    const auto renamed = [&](int face) {
      const std::string& original = face <= static_cast<int>(tool.names.size()) ? tool.names[static_cast<size_t>(face - 1)] : std::string();
      return prefix.empty() || original.empty() ? std::string() : prefix + original;
    };
    StoredShape copy;
    if (transform.IsNegative()) {
      // A mirror image cannot be a location: copy the geometry and follow the faces through the copy.
      BRepBuilderAPI_Transform copier(tool.shape, transform, true);
      copy.shape = copier.Shape();
      FaceNamer namer(copy.shape);
      for (int f = 1; f <= toolFaces.Extent(); ++f) namer.assign(copier.ModifiedShape(toolFaces(f)), renamed(f));
      copy.names = namer.take();
    } else {
      // Moved copies share the tool's geometry; their faces come in the same order.
      copy.shape = tool.shape.Moved(TopLoc_Location(transform));
      for (int f = 1; f <= toolFaces.Extent(); ++f) copy.names.push_back(renamed(f));
    }
    tools.Append(copy.shape);
    copies.push_back(std::move(copy));
  }
  const auto run = [&](BRepAlgoAPI_BooleanOperation& algorithm) {
    NCollection_List<TopoDS_Shape> arguments;
    arguments.Append(body.shape);
    algorithm.SetArguments(arguments);
    algorithm.SetTools(tools);
    algorithm.SetRunParallel(parallel);
    algorithm.Build();
    if (algorithm.HasErrors()) throw KernelError("operation-failed", "the copies could not be combined with the body");
    algorithm.SimplifyResult(true, true, 1e-6);
    const TopoDS_Shape result = algorithm.Shape();
    if (countSolids(result) == 0) throw KernelError("empty-result", "the operation removed the whole body");
    if (op == 1) {
      std::vector<TopoDS_Shape> copyShapes;
      for (const StoredShape& copy : copies) copyShapes.push_back(copy.shape);
      cutMissed = !toolsLeftWalls(algorithm, body.shape, copyShapes, result);
    }
    FaceNamer namer(result);
    namer.inherit(algorithm, body.shape, body.names);
    for (const StoredShape& copy : copies) namer.inherit(algorithm, copy.shape, copy.names);
    return store().add(result, namer.take());
  };
  if (op == 0) {
    BRepAlgoAPI_Fuse algorithm;
    return run(algorithm);
  }
  BRepAlgoAPI_Cut algorithm;
  return run(algorithm);
}

bool takeCutMissed() {
  const bool missed = cutMissed;
  cutMissed = false;
  return missed;
}

void setParallel(bool enabled) { parallel = enabled; }

// ------------------------------------------------------------------ features

namespace {

/** The outward normal of a planar face, or nothing for other faces. */
std::optional<gp_Dir> planeNormal(const TopoDS_Face& face) {
  BRepAdaptor_Surface surface(face, false);
  if (surface.GetType() != GeomAbs_Plane) return std::nullopt;
  gp_Dir normal = surface.Plane().Axis().Direction();
  if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
  return normal;
}

/** Names the faces of a primitive by what `role` says about each face. */
template <typename Role>
FaceNames primitiveNames(const TopoDS_Shape& shape, const std::string& name, Role role) {
  FaceNamer namer(shape);
  ShapeMap faces;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  for (int f = 1; f <= faces.Extent(); ++f) namer.assign(faces(f), faceName(name, role(TopoDS::Face(faces(f)))));
  return namer.take();
}

/** Rounds or bevels edges (BRepFilletAPI_MakeFillet or _MakeChamfer) and names the new faces. */
template <typename Maker>
int finishEdgeFeature(Maker& maker, int bodyId, const std::vector<TopoDS_Edge>& edges, const std::vector<std::string>& edgeNames,
                      const std::string& name, const char* what, const char* failure) {
  maker.Build();
  if (!maker.IsDone()) throw KernelError("operation-failed", failure);
  const TopoDS_Shape result = maker.Shape();
  requireValidSolid(result, what);
  const StoredShape& body = store().entry(bodyId);
  FaceNamer namer(result);
  for (size_t k = 0; k < edges.size(); ++k) namer.generated(maker, edges[k], k < edgeNames.size() ? edgeNames[k] : faceName(name, std::to_string(k)));
  namer.inherit(maker, body.shape, body.names);
  namer.rest(faceName(name, "corner"));
  return store().add(result, namer.take());
}

}  // namespace

int makeBox(double x, double y, double z, double dx, double dy, double dz, const std::string& name) {
  BRepPrimAPI_MakeBox maker(gp_Pnt(x, y, z), dx, dy, dz);
  const TopoDS_Shape shape = maker.Shape();
  return store().add(shape, primitiveNames(shape, name, [](const TopoDS_Face& face) {
    const gp_Dir n = planeNormal(face).value_or(gp_Dir(0, 0, 1));
    const double ax = std::abs(n.X()), ay = std::abs(n.Y()), az = std::abs(n.Z());
    if (ax >= ay && ax >= az) return n.X() < 0 ? "left" : "right";
    if (ay >= az) return n.Y() < 0 ? "front" : "back";
    return n.Z() < 0 ? "bottom" : "top";
  }));
}

int makeCylinder(double px, double py, double pz, double dx, double dy, double dz, double radius, double height, const std::string& name) {
  const gp_Dir axis(dx, dy, dz);
  BRepPrimAPI_MakeCylinder maker(gp_Ax2(gp_Pnt(px, py, pz), axis), radius, height);
  const TopoDS_Shape shape = maker.Shape();
  return store().add(shape, primitiveNames(shape, name, [&](const TopoDS_Face& face) {
    const std::optional<gp_Dir> normal = planeNormal(face);
    if (!normal) return "side";
    return normal->Dot(axis) > 0 ? "top" : "bottom";
  }));
}

int booleanOperation(int bodyId, int toolId, int op) {
  const StoredShape& body = store().entry(bodyId);
  const StoredShape& tool = store().entry(toolId);
  const auto run = [&](BRepAlgoAPI_BooleanOperation& algorithm) {
    configure(algorithm, body.shape, tool.shape);
    if (algorithm.HasErrors()) throw KernelError("operation-failed", "boolean operation failed");
    algorithm.SimplifyResult(true, true, 1e-6);
    const TopoDS_Shape result = algorithm.Shape();
    if (countSolids(result) == 0) throw KernelError("empty-result", "the operation removed the whole body");
    if (op == 1) cutMissed = !toolsLeftWalls(algorithm, body.shape, {tool.shape}, result);
    // Faces of the body win over coplanar tool faces merged into them, so existing names stay.
    FaceNamer namer(result);
    namer.inherit(algorithm, body.shape, body.names);
    namer.inherit(algorithm, tool.shape, tool.names);
    return store().add(result, namer.take());
  };
  if (op == 0) {
    BRepAlgoAPI_Fuse algorithm;
    return run(algorithm);
  }
  BRepAlgoAPI_Cut algorithm;
  return run(algorithm);
}

int fillet(int bodyId, const std::vector<int>& edgeIndices, double radius, const std::vector<std::string>& edgeNames, const std::string& name) {
  const TopoDS_Shape& body = store().get(bodyId);
  BRepFilletAPI_MakeFillet maker(body, ChFi3d_Rational);
  const std::vector<TopoDS_Edge> edges = selectEdges(body, edgeIndices);
  for (const TopoDS_Edge& edge : edges) maker.Add(radius, edge);
  return finishEdgeFeature(maker, bodyId, edges, edgeNames, name, "fillet", "fillet could not be computed (radius too large?)");
}

int chamfer(int bodyId, const std::vector<int>& edgeIndices, double distance, const std::vector<std::string>& edgeNames, const std::string& name) {
  const TopoDS_Shape& body = store().get(bodyId);
  BRepFilletAPI_MakeChamfer maker(body);
  const std::vector<TopoDS_Edge> edges = selectEdges(body, edgeIndices);
  for (const TopoDS_Edge& edge : edges) maker.Add(distance, edge);
  return finishEdgeFeature(maker, bodyId, edges, edgeNames, name, "chamfer", "chamfer could not be computed (distance too large?)");
}

int chamferUneven(int bodyId, const std::vector<int>& edgeIndices, double distance, double second, bool byAngle, bool flip,
                  const std::vector<std::string>& edgeNames, const std::string& name) {
  const TopoDS_Shape& body = store().get(bodyId);
  BRepFilletAPI_MakeChamfer maker(body);
  const std::vector<TopoDS_Edge> edges = selectEdges(body, edgeIndices);
  AncestorMap edgeFaces;
  TopExp::MapShapesAndAncestors(body, TopAbs_EDGE, TopAbs_FACE, edgeFaces);
  for (const TopoDS_Edge& edge : edges) {
    const auto& faces = edgeFaces.FindFromKey(edge);
    if (faces.IsEmpty()) throw KernelError("operation-failed", "an edge to chamfer lies on no face");
    const TopoDS_Face face = TopoDS::Face(flip ? faces.Last() : faces.First());
    if (byAngle) maker.AddDA(distance, second, edge, face);
    else maker.Add(distance, second, edge, face);
  }
  return finishEdgeFeature(maker, bodyId, edges, edgeNames, name, "chamfer", "chamfer could not be computed (distance too large?)");
}

void release(int id) { store().release(id); }

int shapeCount() { return store().size(); }

Naming naming(int id) {
  const StoredShape& entry = store().entry(id);
  ShapeMap faces, edges;
  TopExp::MapShapes(entry.shape, TopAbs_FACE, faces);
  TopExp::MapShapes(entry.shape, TopAbs_EDGE, edges);
  AncestorMap edgeFaces;
  TopExp::MapShapesAndAncestors(entry.shape, TopAbs_EDGE, TopAbs_FACE, edgeFaces);

  Naming result;
  result.faces.resize(static_cast<size_t>(faces.Extent()));
  for (size_t f = 0; f < result.faces.size() && f < entry.names.size(); ++f) result.faces[f] = entry.names[f];
  result.facePlanes.reserve(static_cast<size_t>(faces.Extent()) * 6);
  for (int f = 1; f <= faces.Extent(); ++f) {
    const TopoDS_Face face = TopoDS::Face(faces(f));
    if (const std::optional<gp_Dir> normal = planeNormal(face)) {
      const gp_Pnt origin = BRepAdaptor_Surface(face, false).Plane().Location();
      result.facePlanes.insert(result.facePlanes.end(), {origin.X(), origin.Y(), origin.Z(), normal->X(), normal->Y(), normal->Z()});
    } else {
      result.facePlanes.insert(result.facePlanes.end(), 6, kNaN);
    }
  }
  result.edgeFaces.reserve(static_cast<size_t>(edges.Extent()) * 2);
  result.edgeMidpoints.reserve(static_cast<size_t>(edges.Extent()) * 3);
  for (int e = 1; e <= edges.Extent(); ++e) {
    const TopoDS_Edge edge = TopoDS::Edge(edges(e));
    int32_t sides[2] = {-1, -1};
    if (const NCollection_List<TopoDS_Shape>* adjacent = edgeFaces.Seek(edge)) {
      int k = 0;
      for (const TopoDS_Shape& face : *adjacent) {
        if (k < 2) sides[k++] = faces.FindIndex(face) - 1;
      }
      // A seam lies between a face and itself.
      if (k == 1) sides[1] = sides[0];
    }
    result.edgeFaces.insert(result.edgeFaces.end(), {sides[0], sides[1]});
    if (BRep_Tool::Degenerated(edge)) {
      result.edgeMidpoints.insert(result.edgeMidpoints.end(), 3, kNaN);
    } else {
      BRepAdaptor_Curve curve(edge);
      const gp_Pnt middle = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2);
      result.edgeMidpoints.insert(result.edgeMidpoints.end(), {middle.X(), middle.Y(), middle.Z()});
    }
  }

  ShapeMap vertices;
  TopExp::MapShapes(entry.shape, TopAbs_VERTEX, vertices);
  for (int e = 1; e <= edges.Extent(); ++e) {
    TopoDS_Vertex first, last;
    TopExp::Vertices(TopoDS::Edge(edges(e)), first, last);
    result.edgeVertices.push_back(first.IsNull() ? -1 : vertices.FindIndex(first) - 1);
    result.edgeVertices.push_back(last.IsNull() ? -1 : vertices.FindIndex(last) - 1);
  }
  AncestorMap vertexFaces;
  TopExp::MapShapesAndUniqueAncestors(entry.shape, TopAbs_VERTEX, TopAbs_FACE, vertexFaces);
  result.vertexPositions.reserve(static_cast<size_t>(vertices.Extent()) * 3);
  result.vertexFaceOffsets.reserve(static_cast<size_t>(vertices.Extent()) + 1);
  result.vertexFaceOffsets.push_back(0);
  for (int v = 1; v <= vertices.Extent(); ++v) {
    const gp_Pnt point = BRep_Tool::Pnt(TopoDS::Vertex(vertices(v)));
    result.vertexPositions.insert(result.vertexPositions.end(), {point.X(), point.Y(), point.Z()});
    if (const NCollection_List<TopoDS_Shape>* adjacent = vertexFaces.Seek(vertices(v))) {
      for (const TopoDS_Shape& face : *adjacent) result.vertexFaces.push_back(faces.FindIndex(face) - 1);
    }
    result.vertexFaceOffsets.push_back(static_cast<int32_t>(result.vertexFaces.size()));
  }
  return result;
}

namespace {

template <size_t N>
void setPoint(double (&out)[N], size_t at, const gp_XYZ& value) {
  out[at] = value.X();
  out[at + 1] = value.Y();
  out[at + 2] = value.Z();
}

template <size_t N>
void setNaN(double (&out)[N]) {
  std::fill(std::begin(out), std::end(out), kNaN);
}

TopoDS_Shape subShape(int id, TopAbs_ShapeEnum type, int index, const char* what) {
  ShapeMap shapes;
  TopExp::MapShapes(store().get(id), type, shapes);
  if (index < 0 || index >= shapes.Extent()) throw KernelError("unknown", std::string(what) + " " + std::to_string(index) + " does not exist");
  return shapes(index + 1);
}

}  // namespace

FaceGeometry faceGeometry(int id, int index) {
  const TopoDS_Face face = TopoDS::Face(subShape(id, TopAbs_FACE, index, "face"));
  FaceGeometry result;
  setNaN(result.center);
  setNaN(result.plane);
  setNaN(result.axis);
  result.radius = kNaN;
  BRepAdaptor_Surface surface(face, true);
  result.kind = surfaceKind(surface.GetType());
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  result.area = props.Mass();
  setPoint(result.center, 0, props.CentreOfMass().XYZ());
  const auto setAxis = [&](const gp_Ax1& axis) {
    setPoint(result.axis, 0, axis.Location().XYZ());
    setPoint(result.axis, 3, axis.Direction().XYZ());
  };
  switch (result.kind) {
    case Plane: {
      gp_Dir normal = surface.Plane().Axis().Direction();
      if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
      setPoint(result.plane, 0, surface.Plane().Location().XYZ());
      setPoint(result.plane, 3, normal.XYZ());
      break;
    }
    case Cylinder:
      setAxis(surface.Cylinder().Axis());
      result.radius = surface.Cylinder().Radius();
      break;
    case Cone:
      setAxis(surface.Cone().Axis());
      break;
    case Torus:
      setAxis(surface.Torus().Axis());
      break;
    case Revolution:
      setAxis(surface.AxeOfRevolution());
      break;
    case Sphere:
      setPoint(result.axis, 0, surface.Sphere().Location().XYZ());
      result.radius = surface.Sphere().Radius();
      break;
    default:
      break;
  }
  return result;
}

EdgeGeometry edgeGeometry(int id, int index) {
  const TopoDS_Edge edge = TopoDS::Edge(subShape(id, TopAbs_EDGE, index, "edge"));
  EdgeGeometry result;
  for (double* values : {result.start, result.end, result.middle, result.center, result.axis}) std::fill(values, values + 3, kNaN);
  result.radius = kNaN;
  if (BRep_Tool::Degenerated(edge)) return result;
  BRepAdaptor_Curve curve(edge);
  result.kind = curveKind(curve.GetType());
  GProp_GProps props;
  BRepGProp::LinearProperties(edge, props);
  result.length = props.Mass();
  const double first = curve.FirstParameter(), last = curve.LastParameter();
  setPoint(result.start, 0, curve.Value(first).XYZ());
  setPoint(result.end, 0, curve.Value(last).XYZ());
  setPoint(result.middle, 0, curve.Value((first + last) / 2).XYZ());
  switch (result.kind) {
    case Line:
      setPoint(result.axis, 0, curve.Line().Direction().XYZ());
      break;
    case Circle:
      setPoint(result.center, 0, curve.Circle().Location().XYZ());
      setPoint(result.axis, 0, curve.Circle().Axis().Direction().XYZ());
      result.radius = curve.Circle().Radius();
      break;
    case Ellipse:
      setPoint(result.center, 0, curve.Ellipse().Location().XYZ());
      setPoint(result.axis, 0, curve.Ellipse().Axis().Direction().XYZ());
      break;
    default:
      break;
  }
  return result;
}

// ------------------------------------------------------------------ queries

namespace {

TopAbs_ShapeEnum measuredKind(int kind) {
  switch (kind) {
    case 0:
      return TopAbs_VERTEX;
    case 1:
      return TopAbs_EDGE;
    case 2:
      return TopAbs_FACE;
    default:
      throw KernelError("unknown", "unknown kind of shape to measure");
  }
}

}  // namespace

Distance distance(int id, int kindA, int indexA, int kindB, int indexB) {
  const TopoDS_Shape a = subShape(id, measuredKind(kindA), indexA, "shape");
  const TopoDS_Shape b = subShape(id, measuredKind(kindB), indexB, "shape");
  BRepExtrema_DistShapeShape extrema(a, b, Extrema_ExtFlag_MIN);
  if (!extrema.IsDone() || extrema.NbSolution() < 1) throw KernelError("operation-failed", "the distance could not be computed");
  Distance result;
  result.value = extrema.Value();
  setPoint(result.from, 0, extrema.PointOnShape1(1).XYZ());
  setPoint(result.to, 0, extrema.PointOnShape2(1).XYZ());
  return result;
}

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
  // OCCT gives the tensor in axes through the center of mass, parallel to the model axes.
  const gp_Mat inertia = volume.MatrixOfInertia();
  result.inertia[0] = inertia.Value(1, 1);
  result.inertia[1] = inertia.Value(2, 2);
  result.inertia[2] = inertia.Value(3, 3);
  result.inertia[3] = inertia.Value(1, 2);
  result.inertia[4] = inertia.Value(1, 3);
  result.inertia[5] = inertia.Value(2, 3);
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

int importStep(const std::string& data, const std::string& name) {
  std::istringstream stream(data);
  STEPControl_Reader reader;
  if (reader.ReadStream("import.step", stream) != IFSelect_RetDone) throw KernelError("operation-failed", "the STEP file could not be read");
  if (reader.TransferRoots() == 0) throw KernelError("operation-failed", "the STEP file contains no shapes");
  const TopoDS_Shape shape = reader.OneShape();
  // Only solids make a body (surfaces and wireframes of the file are left out).
  ShapeMap solids;
  TopExp::MapShapes(shape, TopAbs_SOLID, solids);
  if (solids.Extent() == 0) throw KernelError("import-no-solid", "the STEP file contains no solid");
  TopoDS_Shape body = solids(1);
  if (solids.Extent() > 1) {
    TopoDS_Compound compound;
    BRep_Builder builder;
    builder.MakeCompound(compound);
    for (int s = 1; s <= solids.Extent(); ++s) builder.Add(compound, solids(s));
    body = compound;
  }
  ShapeMap faces;
  TopExp::MapShapes(body, TopAbs_FACE, faces);
  FaceNames names;
  names.reserve(static_cast<size_t>(faces.Extent()));
  for (int f = 1; f <= faces.Extent(); ++f) names.push_back(faceName(name, "f" + std::to_string(f - 1)));
  return store().add(body, std::move(names));
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
