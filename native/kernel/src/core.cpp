// ParaWerk geometry kernel core (see core.hpp and docs/adr/0001-geometry-kernel.md).

#include "core.hpp"

#include <BRepAdaptor_CompCurve.hxx>
#include <BRepAdaptor_Curve.hxx>
#include <BRepAdaptor_Surface.hxx>
#include <BRepAlgoAPI_Cut.hxx>
#include <BRepAlgoAPI_Fuse.hxx>
#include <BRepAlgoAPI_Splitter.hxx>
#include <BRepTools.hxx>
#include <GeomAPI_IntCS.hxx>
#include <GeomAPI_ProjectPointOnSurf.hxx>
#include <GeomLProp_SLProps.hxx>
#include <Geom_ConicalSurface.hxx>
#include <Geom_Line.hxx>
#include <Geom_OffsetSurface.hxx>
#include <Geom_RectangularTrimmedSurface.hxx>
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
#include <BRepOffsetAPI_MakePipe.hxx>
#include <BRepOffsetAPI_MakePipeShell.hxx>
#include <BRepBuilderAPI_MakePolygon.hxx>
#include <Geom2d_Line.hxx>
#include <Geom_CylindricalSurface.hxx>
#include <BRepOffsetAPI_ThruSections.hxx>
#include <BRep_Builder.hxx>
#include <TopoDS_Compound.hxx>
#include <BRepLib.hxx>
#include <BRepLib_ToolTriangulatedShape.hxx>
#include <BRepMesh_IncrementalMesh.hxx>
#include <BRepPrimAPI_MakeBox.hxx>
#include <BRepAlgoAPI_Section.hxx>
#include <BRepProj_Projection.hxx>
#include <ShapeAnalysis_FreeBounds.hxx>
#include <BRepPrimAPI_MakeCylinder.hxx>
#include <BRepPrimAPI_MakePrism.hxx>
#include <BRepPrimAPI_MakeRevol.hxx>
#include <BRep_Tool.hxx>
#include <Bnd_Box.hxx>
#include <GCPnts_TangentialDeflection.hxx>
#include <GCPnts_UniformAbscissa.hxx>
#include <GeomAPI_PointsToBSpline.hxx>
#include <Geom_BSplineCurve.hxx>
#include <GCE2d_MakeSegment.hxx>
#include <GC_MakeArcOfCircle.hxx>
#include <Geom_TrimmedCurve.hxx>
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
#include <TopExp_Explorer.hxx>
#include <TopoDS_Iterator.hxx>
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
#include <functional>
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

  /** Names the faces of `input` that are in the result as they are (shapes put together without an algorithm). */
  void keep(const TopoDS_Shape& input, const FaceNames& names) {
    ShapeMap inputFaces;
    TopExp::MapShapes(input, TopAbs_FACE, inputFaces);
    for (int f = 1; f <= inputFaces.Extent(); ++f) assign(inputFaces(f), f <= static_cast<int>(names.size()) ? names[static_cast<size_t>(f - 1)] : empty_);
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

// ---------------------------------------------------------------- bodies (docs/adr/0011-multi-body-parts.md)

/** The solids of a body, each with the names of its faces. */
std::vector<StoredShape> solidsOf(const StoredShape& body) {
  ShapeMap solids, faces;
  TopExp::MapShapes(body.shape, TopAbs_SOLID, solids);
  TopExp::MapShapes(body.shape, TopAbs_FACE, faces);
  std::vector<StoredShape> out;
  for (int s = 1; s <= solids.Extent(); ++s) {
    FaceNamer namer(solids(s));
    ShapeMap own;
    TopExp::MapShapes(solids(s), TopAbs_FACE, own);
    for (int f = 1; f <= own.Extent(); ++f) {
      const int index = faces.FindIndex(own(f));
      namer.assign(own(f), index > 0 && index <= static_cast<int>(body.names.size()) ? body.names[static_cast<size_t>(index - 1)] : std::string());
    }
    out.push_back({solids(s), namer.take()});
  }
  return out;
}

/** Bodies put together into one shape (a compound when there are several), keeping their face names. */
StoredShape bodyOf(const std::vector<StoredShape>& parts) {
  if (parts.size() == 1) return parts.front();
  BRep_Builder builder;
  TopoDS_Compound compound;
  builder.MakeCompound(compound);
  // Compounds are unpacked, so the bodies stay one level deep.
  for (const StoredShape& part : parts) {
    if (part.shape.ShapeType() != TopAbs_COMPOUND) {
      builder.Add(compound, part.shape);
      continue;
    }
    for (TopoDS_Iterator it(part.shape); it.More(); it.Next()) builder.Add(compound, it.Value());
  }
  FaceNamer namer(compound);
  for (const StoredShape& part : parts) namer.keep(part.shape, part.names);
  return {compound, namer.take()};
}

/** Shapes put together into one compound. */
TopoDS_Compound compoundOf(const NCollection_List<TopoDS_Shape>& shapes) {
  BRep_Builder builder;
  TopoDS_Compound compound;
  builder.MakeCompound(compound);
  for (const TopoDS_Shape& shape : shapes) builder.Add(compound, shape);
  return compound;
}

/** Two bodies fused; the faces of `a` keep their names where faces merge. */
StoredShape fuseBodies(const StoredShape& a, const StoredShape& b) {
  BRepAlgoAPI_Fuse fuse;
  configure(fuse, a.shape, b.shape);
  if (fuse.HasErrors()) throw KernelError("operation-failed", "the bodies could not be fused");
  fuse.SimplifyResult(true, true, 1e-6);
  FaceNamer namer(fuse.Shape());
  namer.inherit(fuse, a.shape, a.names);
  namer.inherit(fuse, b.shape, b.names);
  return {fuse.Shape(), namer.take()};
}

/**
 * A Boolean step of a body with tools, body by body when the body has several solids, so that no OCCT
 * Boolean gets solids that overlap each other in one argument. `step` combines one body with the tools.
 * A cut goes to every solid the tools come near, separately (a solid it removes completely is dropped); a
 * fuse goes to the first of them, and the result is fused with the others one after the other.
 */
StoredShape bodyByBody(const StoredShape& body, const TopoDS_Shape& tools, bool fuse, const std::function<StoredShape(const StoredShape&)>& step) {
  if (countSolids(body.shape) <= 1) return step(body);
  Bnd_Box reach;
  BRepBndLib::Add(tools, reach);
  reach.Enlarge(1e-6);
  std::vector<StoredShape> kept, near;
  for (StoredShape& solid : solidsOf(body)) {
    Bnd_Box box;
    BRepBndLib::Add(solid.shape, box);
    (box.IsOut(reach) ? kept : near).push_back(std::move(solid));
  }
  std::vector<StoredShape> parts;
  if (fuse) {
    // A tool that touches no body fuses with none: it becomes a body of its own next to them.
    if (near.empty()) {
      near.push_back(kept.back());
      kept.pop_back();
    }
    StoredShape merged = step(near.front());
    for (size_t i = 1; i < near.size(); ++i) merged = fuseBodies(merged, near[i]);
    parts = kept;
    parts.push_back(std::move(merged));
    return bodyOf(parts);
  }
  bool missed = true;
  parts = kept;
  for (const StoredShape& solid : near) {
    try {
      parts.push_back(step(solid));
      missed = missed && cutMissed;
    } catch (const KernelError& error) {
      if (error.code != "empty-result") throw;
      missed = false;
    }
  }
  if (parts.empty()) throw KernelError("empty-result", "the operation removed every body");
  cutMissed = missed;
  return bodyOf(parts);
}

/** The index (in TopExp::MapShapes order) of the solid that holds each face of a body. */
std::vector<int32_t> faceSolids(const TopoDS_Shape& shape) {
  ShapeMap faces, solids;
  TopExp::MapShapes(shape, TopAbs_FACE, faces);
  TopExp::MapShapes(shape, TopAbs_SOLID, solids);
  std::vector<int32_t> out(static_cast<size_t>(faces.Extent()), -1);
  for (int s = 1; s <= solids.Extent(); ++s) {
    ShapeMap own;
    TopExp::MapShapes(solids(s), TopAbs_FACE, own);
    for (int f = 1; f <= own.Extent(); ++f) {
      const int index = faces.FindIndex(own(f));
      if (index > 0) out[static_cast<size_t>(index - 1)] = s - 1;
    }
  }
  return out;
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

TopoDS_Wire readLoop(ProfileReader& in, const occ::handle<Geom_Plane>& plane, NamedEdges& named, bool mustClose = true) {
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
  if (!wire.IsDone() || (mustClose && !wire.Wire().Closed())) throw KernelError("operation-failed", "a profile outline is not closed");
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

namespace {

/** One chain of curves (open or closed) of a sketch path on its plane. */
TopoDS_Wire pathWire(const std::vector<double>& path, const std::vector<double>& pathFrame) {
  ProfileReader pathData(path);
  const std::vector<std::string> noNames;
  NamedEdges pathEdges{noNames, {}};
  return readLoop(pathData, framePlane(pathFrame), pathEdges, false);
}

/** The regions of `profile` swept along `spine`, joined into one body. */
/**
 * A curve beside `spine` that winds `twist` radians around it from its start to its end, evenly along
 * its length. As auxiliary spine of a pipe shell, the direction from the spine to it turns the profile.
 */
TopoDS_Wire twistSpine(const TopoDS_Wire& spine, double twist) {
  BRepAdaptor_CompCurve curve(spine);
  const int count = 48 + static_cast<int>(std::abs(twist) / (2 * M_PI) * 48);
  GCPnts_UniformAbscissa abscissa(curve, count + 1);
  if (!abscissa.IsDone() || abscissa.NbPoints() < 2) throw KernelError("sweep-failed", "the path could not be divided");
  Bnd_Box box;
  BRepBndLib::Add(spine, box);
  const double distance = 0.1 * std::sqrt(box.SquareExtent()) + 1;
  NCollection_Array1<gp_Pnt> points(1, abscissa.NbPoints());
  gp_Vec across;
  for (int i = 1; i <= abscissa.NbPoints(); ++i) {
    gp_Pnt point;
    gp_Vec tangent;
    curve.D1(abscissa.Parameter(i), point, tangent);
    tangent.Normalize();
    // A direction across the path, carried along it without turning about it.
    if (i == 1) across = std::abs(tangent.Z()) < 0.9 ? tangent.Crossed(gp_Vec(0, 0, 1)) : tangent.Crossed(gp_Vec(1, 0, 0));
    across -= tangent * across.Dot(tangent);
    across.Normalize();
    const double angle = twist * (i - 1) / (abscissa.NbPoints() - 1);
    const gp_Vec turned = across * std::cos(angle) + tangent.Crossed(across) * std::sin(angle);
    points(i) = point.Translated(turned * distance);
  }
  GeomAPI_PointsToBSpline fit(points, 3, 8, GeomAbs_C2, 1e-6 * distance);
  if (!fit.IsDone()) throw KernelError("sweep-failed", "the twist could not be built");
  return BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(fit.Curve()).Edge()).Wire();
}

/**
 * Whether `guide` is `spine` moved as a whole (compared at the same fractions of their lengths): such a
 * guide neither turns nor scales the profile, and the pipe shell cannot follow a straight guide parallel
 * to a straight path.
 */
bool movedCopy(const TopoDS_Wire& spine, const TopoDS_Wire& guide) {
  BRepAdaptor_CompCurve a(spine), b(guide);
  GCPnts_UniformAbscissa pa(a, 9), pb(b, 9);
  if (!pa.IsDone() || !pb.IsDone() || pa.NbPoints() != pb.NbPoints()) return false;
  const gp_Vec offset(a.Value(pa.Parameter(1)), b.Value(pb.Parameter(1)));
  for (int i = 2; i <= pa.NbPoints(); ++i)
    if (gp_Vec(a.Value(pa.Parameter(i)), b.Value(pb.Parameter(i))).Subtracted(offset).Magnitude() > 1e-6 * (1 + offset.Magnitude())) return false;
  return true;
}

/** `guide` running from its end nearer to the start of `spine`. */
TopoDS_Wire alongSpine(const TopoDS_Wire& guide, const TopoDS_Wire& spine) {
  TopoDS_Vertex start, end, first, last;
  TopExp::Vertices(spine, start, end);
  TopExp::Vertices(guide, first, last);
  if (start.IsNull() || first.IsNull() || last.IsNull()) return guide;
  const gp_Pnt from = BRep_Tool::Pnt(start);
  return from.Distance(BRep_Tool::Pnt(last)) < from.Distance(BRep_Tool::Pnt(first)) ? TopoDS::Wire(guide.Reversed()) : guide;
}

/** Where the guide crosses the plane through `point` normal to `tangent`, searched from `from` on (its parameter). */
std::optional<double> guideCrossing(const BRepAdaptor_CompCurve& rail, const gp_Pnt& point, const gp_Vec& tangent, double from) {
  const auto side = [&](double u) { return gp_Vec(point, rail.Value(u)).Dot(tangent); };
  const double last = rail.LastParameter();
  const int steps = 400;
  const double step = (last - rail.FirstParameter()) / steps;
  double a = from;
  double fa = side(a);
  if (std::abs(fa) < 1e-9) return a;
  for (double b = std::min(last, a + step); a < last; a = b, b = std::min(last, b + step)) {
    const double fb = side(b);
    if (fa * fb <= 0) {
      // Bisection to the crossing.
      double lo = a, hi = b, flo = fa;
      for (int k = 0; k < 60; ++k) {
        const double mid = (lo + hi) / 2;
        const double fm = side(mid);
        if (flo * fm <= 0) {
          hi = mid;
        } else {
          lo = mid;
          flo = fm;
        }
      }
      return (lo + hi) / 2;
    }
    fa = fb;
  }
  return std::nullopt;
}

/**
 * The outlines of `face` swept along `spine` touching `guide`: copies of its outer wire placed along the
 * spine, each turned about the spine towards the guide and scaled with its distance from it, joined by a
 * smooth loft. Side faces are named after the profile's edges as for the other sweeps.
 */
StoredShape guidedSweep(const TopoDS_Wire& spine, const TopoDS_Wire& guide, const TopoDS_Face& face, const NamedEdges& named, const std::string& name) {
  BRepAdaptor_CompCurve path(spine), rail(guide);
  const int count = 48;
  GCPnts_UniformAbscissa along(path, count);
  if (!along.IsDone() || along.NbPoints() < 2) throw KernelError("sweep-failed", "the path could not be divided");
  // Where along the path the profile is, and the direction across it towards the guide.
  struct Place {
    gp_Ax3 frame;
    double distance;
  };
  double search = rail.FirstParameter();
  const auto placeAt = [&](int i) -> Place {
    gp_Pnt point;
    gp_Vec tangent;
    path.D1(along.Parameter(i), point, tangent);
    tangent.Normalize();
    // The guide where it crosses the plane of the profile there, or at the same share of its length.
    const std::optional<double> crossing = guideCrossing(rail, point, tangent, search);
    const double u = crossing ? *crossing : rail.FirstParameter() + (rail.LastParameter() - rail.FirstParameter()) * (i - 1) / (along.NbPoints() - 1);
    if (crossing) search = *crossing;
    gp_Vec across(point, rail.Value(u));
    across -= tangent * across.Dot(tangent);
    if (across.Magnitude() < 1e-9) throw KernelError("sweep-failed", "the guide curve meets the path");
    return {gp_Ax3(point, gp_Dir(tangent), gp_Dir(across)), across.Magnitude()};
  };
  const Place start = placeAt(1);
  const TopoDS_Wire outline = BRepTools::OuterWire(face);
  BRepOffsetAPI_ThruSections loft(true, false, 1e-6);
  loft.CheckCompatibility(false);
  loft.AddWire(outline);
  for (int i = 2; i <= along.NbPoints(); ++i) {
    const Place place = placeAt(i);
    gp_Trsf move;
    move.SetDisplacement(start.frame, place.frame);
    gp_Trsf scale;
    scale.SetScale(place.frame.Location(), place.distance / start.distance);
    loft.AddWire(TopoDS::Wire(BRepBuilderAPI_Transform(outline, scale.Multiplied(move), true).Shape()));
  }
  loft.Build();
  if (!loft.IsDone()) throw KernelError("sweep-failed", "the profile could not follow the guide curve");
  const TopoDS_Shape result = loft.Shape();
  requireValidSolid(result, "sweep");
  ShapeMap own;
  TopExp::MapShapes(outline, TopAbs_EDGE, own);
  FaceNamer namer(result);
  for (const auto& [edge, edgeName] : named.edges) {
    if (edgeName.empty() || !own.Contains(edge)) continue;
    const TopoDS_Shape side = loft.GeneratedFace(edge);
    if (!side.IsNull()) namer.assign(side, faceName(name, "side:" + edgeName));
  }
  namer.assign(loft.FirstShape(), faceName(name, "start"));
  namer.assign(loft.LastShape(), faceName(name, "end"));
  namer.rest(faceName(name, "side"));
  return {result, namer.take()};
}

/**
 * The regions of `profile` swept along `spine`, joined into one body. With a `twist` (radians) the
 * profile turns about the path; with a `guide` it keeps touching that curve, growing and shrinking with
 * its distance from the path. Both take outlines without holes.
 */
int sweepRegions(const TopoDS_Wire& spine, const std::vector<TopoDS_Face>& faces, NamedEdges& named, const std::string& name, double twist = 0,
                 const TopoDS_Wire* guide = nullptr) {
  std::vector<StoredShape> solids;
  if (guide && movedCopy(spine, alongSpine(*guide, spine))) guide = nullptr;
  for (const TopoDS_Face& face : faces) {
    if (twist == 0 && !guide) {
      BRepOffsetAPI_MakePipe pipe(spine, face);
      pipe.Build();
      if (!pipe.IsDone()) throw KernelError("sweep-failed", "the profile could not be swept along the path");
      requireValidSolid(pipe.Shape(), "sweep");
      solids.push_back({pipe.Shape(), sweepNames(pipe, named, name)});
      continue;
    }
    ShapeMap wires;
    TopExp::MapShapes(face, TopAbs_WIRE, wires);
    if (wires.Extent() != 1) throw KernelError("sweep-holes", "a twisted or guided sweep takes outlines without holes");
    if (guide) {
      solids.push_back(guidedSweep(spine, alongSpine(*guide, spine), face, named, name));
      continue;
    }
    BRepOffsetAPI_MakePipeShell pipe(spine);
    pipe.SetMode(twistSpine(spine, twist), false, BRepFill_NoContact);
    pipe.Add(BRepTools::OuterWire(face));
    pipe.Build();
    if (!pipe.IsDone() || !pipe.MakeSolid()) throw KernelError("sweep-failed", "the profile could not be swept along the path");
    requireValidSolid(pipe.Shape(), "sweep");
    solids.push_back({pipe.Shape(), sweepNames(pipe, named, name)});
  }
  StoredShape result = joinRegions(solids, "swept");
  return store().add(result.shape, std::move(result.names));
}

/** The guide curve `guideId` of the store (-1 for none) as one wire. */
std::optional<TopoDS_Wire> guideWire(int guideId) {
  if (guideId < 0) return std::nullopt;
  const TopoDS_Shape& guide = store().get(guideId);
  if (guide.ShapeType() != TopAbs_WIRE) throw KernelError("guide-gaps", "the guide curve is not one chain");
  return TopoDS::Wire(guide);
}

/** The edges of a shape joined into wires where their ends meet (as few wires as possible). */
std::vector<TopoDS_Wire> joinEdges(const TopoDS_Shape& shape) {
  ShapeMap map;
  TopExp::MapShapes(shape, TopAbs_EDGE, map);
  occ::handle<NCollection_HSequence<TopoDS_Shape>> edges = new NCollection_HSequence<TopoDS_Shape>();
  for (int i = 1; i <= map.Extent(); ++i)
    if (!BRep_Tool::Degenerated(TopoDS::Edge(map(i)))) edges->Append(map(i));
  std::vector<TopoDS_Wire> result;
  if (edges->IsEmpty()) return result;
  const occ::handle<NCollection_HSequence<TopoDS_Shape>> wires = ShapeAnalysis_FreeBounds::ConnectEdgesToWires(edges, 1e-4, false);
  for (int i = 1; i <= wires->Length(); ++i) result.push_back(TopoDS::Wire(wires->Value(i)));
  return result;
}

/** One wire as it is, several as a compound of wires. */
TopoDS_Shape curveShape(const std::vector<TopoDS_Wire>& wires) {
  if (wires.size() == 1) return wires[0];
  BRep_Builder builder;
  TopoDS_Compound compound;
  builder.MakeCompound(compound);
  for (const TopoDS_Wire& wire : wires) builder.Add(compound, wire);
  return compound;
}

gp_Dir directionOf(const std::vector<double>& d) {
  if (d.size() != 3) throw KernelError("operation-failed", "a direction needs 3 values");
  return gp_Dir(d[0], d[1], d[2]);
}

}  // namespace

int sweepProfile(const std::vector<double>& profile, const std::vector<double>& frame, const std::vector<double>& path, const std::vector<double>& pathFrame,
                 const std::vector<std::string>& edgeNames, const std::string& name, double twist, int guideId) {
  // The path: one chain of curves (open or closed) on its own sketch plane.
  const TopoDS_Wire spine = pathWire(path, pathFrame);
  NamedEdges named{edgeNames, {}};
  const std::optional<TopoDS_Wire> guide = guideWire(guideId);
  return sweepRegions(spine, readFaces(profile, framePlane(frame), named), named, name, twist, guide ? &*guide : nullptr);
}

int sweepAlongCurve(const std::vector<double>& profile, const std::vector<double>& frame, int curveId, const std::vector<std::string>& edgeNames, const std::string& name,
                    double twist, int guideId) {
  const TopoDS_Shape& curve = store().get(curveId);
  if (curve.ShapeType() != TopAbs_WIRE) throw KernelError("path-gaps", "the curve is not one chain");
  TopoDS_Wire spine = TopoDS::Wire(curve);
  NamedEdges named{edgeNames, {}};
  const std::vector<TopoDS_Face> faces = readFaces(profile, framePlane(frame), named);
  // An open curve runs from its end nearer to the outlines.
  TopoDS_Vertex first, last;
  TopExp::Vertices(spine, first, last);
  if (!first.IsNull() && !last.IsNull() && !first.IsSame(last) && !faces.empty()) {
    GProp_GProps props;
    for (const TopoDS_Face& face : faces) BRepGProp::SurfaceProperties(face, props);
    const gp_Pnt middle = props.CentreOfMass();
    if (middle.Distance(BRep_Tool::Pnt(last)) < middle.Distance(BRep_Tool::Pnt(first))) spine = TopoDS::Wire(spine.Reversed());
  }
  const std::optional<TopoDS_Wire> guide = guideWire(guideId);
  return sweepRegions(spine, faces, named, name, twist, guide ? &*guide : nullptr);
}

int sketchWire(const std::vector<double>& path, const std::vector<double>& pathFrame) { return store().add(pathWire(path, pathFrame)); }

int projectCurve(int wireId, int bodyId, const std::vector<int>& faceIndices, const std::vector<double>& origin, const std::vector<double>& direction, int side) {
  ShapeMap faces;
  TopExp::MapShapes(store().get(bodyId), TopAbs_FACE, faces);
  BRep_Builder builder;
  TopoDS_Compound target;
  builder.MakeCompound(target);
  for (int index : faceIndices) {
    if (index < 0 || index >= faces.Extent()) throw KernelError("operation-failed", "no such face");
    builder.Add(target, faces(index + 1));
  }
  // Along the direction both ways: the curve lands on the faces on either side of its sketch.
  const gp_Dir along = directionOf(direction);
  BRepProj_Projection projection(store().get(wireId), target, along);
  if (!projection.IsDone()) throw KernelError("curve-missed", "the curve misses the faces");
  std::vector<TopoDS_Wire> wires = joinEdges(projection.Shape());
  if (side != 0 && origin.size() == 3) {
    // Each piece by the middle of its first edge.
    const gp_Pnt start(origin[0], origin[1], origin[2]);
    std::vector<TopoDS_Wire> kept;
    for (const TopoDS_Wire& wire : wires) {
      TopExp_Explorer edges(wire, TopAbs_EDGE);
      if (!edges.More()) continue;
      BRepAdaptor_Curve curve(TopoDS::Edge(edges.Current()));
      const gp_Pnt middle = curve.Value((curve.FirstParameter() + curve.LastParameter()) / 2);
      if (side * gp_Vec(start, middle).Dot(gp_Vec(along)) > 0) kept.push_back(wire);
    }
    wires = kept;
  }
  if (wires.empty()) throw KernelError("curve-missed", "the curve misses the faces");
  return store().add(curveShape(wires));
}

int intersectCurves(int wireA, const std::vector<double>& directionA, int wireB, const std::vector<double>& directionB) {
  const TopoDS_Shape& a = store().get(wireA);
  const TopoDS_Shape& b = store().get(wireB);
  Bnd_Box box;
  BRepBndLib::Add(a, box);
  BRepBndLib::Add(b, box);
  const double size = 2 * std::sqrt(box.SquareExtent()) + 1;
  // Each curve as a surface along its sketch normal, through the whole space of both.
  const auto wall = [size](const TopoDS_Shape& wire, const gp_Dir& d) {
    gp_Trsf back;
    back.SetTranslation(gp_Vec(d) * -size);
    return BRepPrimAPI_MakePrism(BRepBuilderAPI_Transform(wire, back, true).Shape(), gp_Vec(d) * (2 * size)).Shape();
  };
  BRepAlgoAPI_Section section(wall(a, directionOf(directionA)), wall(b, directionOf(directionB)), false);
  section.Approximation(true);
  section.Build();
  if (!section.IsDone()) throw KernelError("curve-missed", "the curves of the two sketches do not meet");
  const std::vector<TopoDS_Wire> wires = joinEdges(section.Shape());
  if (wires.empty()) throw KernelError("curve-missed", "the curves of the two sketches do not meet");
  return store().add(curveShape(wires));
}

int compositeCurve(int bodyId, const std::vector<int>& edgeIndices, const std::vector<int>& curveIds, bool oneChain) {
  BRep_Builder builder;
  TopoDS_Compound all;
  builder.MakeCompound(all);
  if (!edgeIndices.empty()) {
    ShapeMap edges;
    TopExp::MapShapes(store().get(bodyId), TopAbs_EDGE, edges);
    for (int index : edgeIndices) {
      if (index < 0 || index >= edges.Extent()) throw KernelError("operation-failed", "no such edge");
      builder.Add(all, edges(index + 1));
    }
  }
  for (int id : curveIds) builder.Add(all, store().get(id));
  const std::vector<TopoDS_Wire> wires = joinEdges(all);
  if (wires.empty()) throw KernelError("curve-empty", "the curve has no edges");
  if (oneChain && wires.size() > 1) throw KernelError("path-gaps", "the curves do not join into one chain");
  return store().add(curveShape(wires));
}

CurveInfo curveInfo(int id, double linear, double angular) {
  const TopoDS_Shape& shape = store().get(id);
  CurveInfo info;
  ShapeMap edges, wires;
  TopExp::MapShapes(shape, TopAbs_EDGE, edges);
  TopExp::MapShapes(shape, TopAbs_WIRE, wires);
  info.chains = wires.Extent();
  if (shape.ShapeType() == TopAbs_WIRE) {
    TopoDS_Vertex first, last;
    TopExp::Vertices(TopoDS::Wire(shape), first, last);
    info.closed = !first.IsNull() && first.IsSame(last);
  }
  for (int i = 1; i <= edges.Extent(); ++i) {
    const TopoDS_Edge& edge = TopoDS::Edge(edges(i));
    if (BRep_Tool::Degenerated(edge)) continue;
    GProp_GProps props;
    BRepGProp::LinearProperties(edge, props);
    info.length += props.Mass();
    BRepAdaptor_Curve curve(edge);
    GCPnts_TangentialDeflection discretizer(curve, angular, linear);
    info.points.push_back(discretizer.NbPoints());
    for (int k = 1; k <= discretizer.NbPoints(); ++k) {
      const gp_Pnt p = discretizer.Value(k);
      info.points.insert(info.points.end(), {p.X(), p.Y(), p.Z()});
    }
  }
  return info;
}

int sweepAlongHelix(const std::vector<double>& profile, const std::vector<double>& frame, const std::vector<double>& helix, const std::vector<std::string>& edgeNames,
                    const std::string& name) {
  if (helix.size() != 13) throw KernelError("operation-failed", "a helix needs 13 values");
  const gp_Pnt center(helix[0], helix[1], helix[2]);
  const gp_Dir axis(helix[3], helix[4], helix[5]);
  const gp_Dir xDir(helix[6], helix[7], helix[8]);
  const double radius = helix[9], pitch = helix[10], turns = helix[11];
  const bool leftHand = helix[12] != 0;
  if (!(radius > 0) || !(pitch > 0) || !(turns > 0)) throw KernelError("operation-failed", "the helix needs a radius, a pitch and turns above 0");
  // The helix as a line on a cylinder: one turn of 2π rises one pitch.
  const occ::handle<Geom_CylindricalSurface> surface = new Geom_CylindricalSurface(gp_Ax3(center, axis, xDir), radius);
  const occ::handle<Geom2d_Line> line = new Geom2d_Line(gp_Pnt2d(0, 0), gp_Dir2d(leftHand ? -2 * M_PI : 2 * M_PI, pitch));
  TopoDS_Edge edge = BRepBuilderAPI_MakeEdge(line, surface, 0, turns * std::hypot(2 * M_PI, pitch)).Edge();
  BRepLib::BuildCurves3d(edge, 1e-5, GeomAbs_C1, 14, std::max(16, static_cast<int>(turns * 4)));
  const TopoDS_Wire spine = BRepBuilderAPI_MakeWire(edge).Wire();
  NamedEdges named{edgeNames, {}};
  std::vector<StoredShape> solids;
  for (const TopoDS_Face& face : readFaces(profile, framePlane(frame), named)) {
    ShapeMap wires;
    TopExp::MapShapes(face, TopAbs_WIRE, wires);
    if (wires.Extent() != 1) throw KernelError("sweep-holes", "a sweep along a helix takes outlines without holes");
    // The outlines keep their angle to the axis as they wind around it.
    BRepOffsetAPI_MakePipeShell pipe(spine);
    pipe.SetMode(axis);
    pipe.SetTolerance(1e-4, 1e-4, 1e-2);
    pipe.Add(BRepTools::OuterWire(face));
    pipe.Build();
    if (!pipe.IsDone() || !pipe.MakeSolid()) throw KernelError("sweep-failed", "the profile could not be swept along the helix");
    requireValidSolid(pipe.Shape(), "sweep");
    solids.push_back({pipe.Shape(), sweepNames(pipe, named, name)});
  }
  StoredShape result = joinRegions(solids, "swept");
  return store().add(result.shape, std::move(result.names));
}

int loftProfiles(const std::vector<double>& sections, bool ruled, const std::vector<std::string>& edgeNames, const std::string& name) {
  // The sections in order: their count, then per section its plane (9 values) and its outline.
  ProfileReader in(sections);
  const int count = in.count(1000);
  if (count < 2) throw KernelError("loft-sections", "a loft needs at least two profiles");
  BRepOffsetAPI_ThruSections loft(true, ruled, 1e-6);
  loft.CheckCompatibility(true);
  NamedEdges first{edgeNames, {}};
  const std::vector<std::string> noNames;
  for (int s = 0; s < count; ++s) {
    std::vector<double> frame(9);
    for (double& value : frame) value = in.number();
    NamedEdges others{noNames, {}};
    loft.AddWire(readLoop(in, framePlane(frame), s == 0 ? first : others));
  }
  loft.Build();
  if (!loft.IsDone()) throw KernelError("loft-failed", "the profiles could not be joined");
  const TopoDS_Shape result = loft.Shape();
  requireValidSolid(result, "loft");
  // Side faces after the edges of the first profile, then the end faces.
  FaceNamer namer(result);
  for (const auto& [edge, edgeName] : first.edges) {
    const TopoDS_Shape side = loft.GeneratedFace(edge);
    if (!side.IsNull()) namer.assign(side, faceName(name, "side:" + edgeName));
  }
  namer.assign(loft.FirstShape(), faceName(name, "start"));
  namer.assign(loft.LastShape(), faceName(name, "end"));
  namer.rest(faceName(name, "side"));
  return store().add(result, namer.take());
}

int loftAlongCurve(const std::vector<double>& sections, int centerlineId, const std::vector<std::string>& edgeNames, const std::string& name) {
  const TopoDS_Shape& line = store().get(centerlineId);
  if (line.ShapeType() != TopAbs_WIRE) throw KernelError("path-gaps", "the centerline is not one chain");
  ProfileReader in(sections);
  const int count = in.count(1000);
  if (count < 2) throw KernelError("loft-sections", "a loft needs at least two profiles");
  NamedEdges first{edgeNames, {}};
  const std::vector<std::string> noNames;
  std::vector<TopoDS_Wire> wires;
  for (int s = 0; s < count; ++s) {
    std::vector<double> frame(9);
    for (double& value : frame) value = in.number();
    NamedEdges others{noNames, {}};
    wires.push_back(readLoop(in, framePlane(frame), s == 0 ? first : others));
  }
  // The centerline runs from its end nearer to the first profile.
  TopoDS_Wire spine = TopoDS::Wire(line);
  TopoDS_Vertex start, end;
  TopExp::Vertices(spine, start, end);
  if (!start.IsNull() && !end.IsNull() && !start.IsSame(end)) {
    Bnd_Box box;
    BRepBndLib::Add(wires.front(), box);
    const gp_Pnt middle((box.CornerMin().XYZ() + box.CornerMax().XYZ()) / 2);
    if (middle.Distance(BRep_Tool::Pnt(end)) < middle.Distance(BRep_Tool::Pnt(start))) spine = TopoDS::Wire(spine.Reversed());
  }
  // Each profile where it lies, at the point of the centerline nearest to it.
  BRepOffsetAPI_MakePipeShell pipe(spine);
  for (const TopoDS_Wire& wire : wires) pipe.Add(wire, false, false);
  pipe.Build();
  if (!pipe.IsDone() || !pipe.MakeSolid()) throw KernelError("loft-failed", "the profiles could not be joined along the centerline");
  requireValidSolid(pipe.Shape(), "loft");
  return store().add(pipe.Shape(), sweepNames(pipe, first, name));
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
  const auto step = [&](const StoredShape& part) -> StoredShape {
    BRepAlgoAPI_Cut algorithm;
    NCollection_List<TopoDS_Shape> arguments;
    arguments.Append(part.shape);
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
    cutMissed = !toolsLeftWalls(algorithm, part.shape, holeShapes, result);
    FaceNamer namer(result);
    namer.inherit(algorithm, part.shape, part.names);
    for (const StoredShape& copy : placed) namer.inherit(algorithm, copy.shape, copy.names);
    return {result, namer.take()};
  };
  StoredShape result = bodyByBody(body, compoundOf(tools), false, step);
  return store().add(result.shape, std::move(result.names));
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

namespace {

/** The faces of a shape that carry `name` (names in TopExp::MapShapes order of `shape`). */
bool hasFaceNamed(const TopoDS_Shape& piece, const ShapeMap& faces, const FaceNames& names, const std::string& name) {
  ShapeMap own;
  TopExp::MapShapes(piece, TopAbs_FACE, own);
  for (int f = 1; f <= own.Extent(); ++f) {
    const int index = faces.FindIndex(own(f));
    if (index > 0 && index <= static_cast<int>(names.size()) && names[static_cast<size_t>(index - 1)] == name) return true;
  }
  return false;
}

/** Some solids of a named shape as one shape, their faces named as in `from`; unnamed faces get `fallback`. */
StoredShape namedSolids(const std::vector<TopoDS_Shape>& solids, const ShapeMap& faces, const FaceNames& names, const std::string& fallback) {
  TopoDS_Shape shape = solids.front();
  if (solids.size() > 1) {
    TopoDS_Compound compound;
    BRep_Builder builder;
    builder.MakeCompound(compound);
    for (const TopoDS_Shape& solid : solids) builder.Add(compound, solid);
    shape = compound;
  }
  FaceNamer namer(shape);
  ShapeMap own;
  TopExp::MapShapes(shape, TopAbs_FACE, own);
  for (int f = 1; f <= own.Extent(); ++f) {
    const int index = faces.FindIndex(own(f));
    if (index > 0 && index <= static_cast<int>(names.size()) && !names[static_cast<size_t>(index - 1)].empty()) {
      namer.assign(own(f), names[static_cast<size_t>(index - 1)]);
    }
  }
  namer.rest(fallback);
  return {shape, namer.take()};
}

std::vector<TopoDS_Shape> solidsOf(const TopoDS_Shape& shape) {
  ShapeMap solids;
  TopExp::MapShapes(shape, TopAbs_SOLID, solids);
  std::vector<TopoDS_Shape> result;
  for (int s = 1; s <= solids.Extent(); ++s) result.push_back(solids(s));
  return result;
}

double diagonal(const TopoDS_Shape& shape) {
  Bnd_Box box;
  BRepBndLib::Add(shape, box);
  return box.IsVoid() ? 0 : std::sqrt(box.SquareExtent());
}

/**
 * The surface of a face beyond the face's bounds, `size` further where the surface goes on without end
 * (planes, cylinders, cones, extrusions) and as far as it goes otherwise (whole turns, B-spline patches).
 */
TopoDS_Face extendedFace(const occ::handle<Geom_Surface>& surface, const TopoDS_Face& face, double size) {
  double fu1, fu2, fv1, fv2;
  BRepTools::UVBounds(face, fu1, fu2, fv1, fv2);
  double u1, u2, v1, v2;
  surface->Bounds(u1, u2, v1, v2);
  if (!surface->IsUPeriodic()) {
    if (Precision::IsInfinite(u1)) u1 = fu1 - size;
    if (Precision::IsInfinite(u2)) u2 = fu2 + size;
  }
  if (!surface->IsVPeriodic()) {
    if (Precision::IsInfinite(v1)) v1 = fv1 - size;
    if (Precision::IsInfinite(v2)) v2 = fv2 + size;
  }
  // A cone ends at its apex: going on past it would let the surface cross itself.
  if (const auto cone = occ::down_cast<Geom_ConicalSurface>(surface)) {
    const double apex = -cone->RefRadius() / std::sin(cone->SemiAngle());
    const double margin = 1e-6 * std::max(1.0, size);
    if (fv1 >= apex) v1 = std::max(v1, apex + margin);
    else v2 = std::min(v2, apex - margin);
  }
  BRepBuilderAPI_MakeFace maker(surface, u1, u2, v1, v2, Precision::Confusion());
  if (!maker.IsDone()) throw KernelError("operation-failed", "the surface could not be extended");
  return maker.Face();
}

/** The untrimmed surface of a face, in place (its location applied). */
occ::handle<Geom_Surface> faceSurface(const TopoDS_Face& face) {
  occ::handle<Geom_Surface> surface = BRep_Tool::Surface(face);
  if (const auto trimmed = occ::down_cast<Geom_RectangularTrimmedSurface>(surface)) surface = trimmed->BasisSurface();
  return surface;
}

/**
 * The surface moved by `offset` towards where a ray from `from` along `direction` comes from (negative:
 * away from it, past the surface); analytic surfaces stay analytic.
 */
occ::handle<Geom_Surface> offsetTowards(const occ::handle<Geom_Surface>& surface, const TopoDS_Face& face, const gp_Pnt& from, const gp_Dir& direction, double offset) {
  if (offset == 0) return surface;
  // Which way the surface's own normal points where the extrusion meets it.
  double u = 0, v = 0;
  bool found = false;
  GeomAPI_IntCS hits(new Geom_Line(from, direction), surface);
  if (hits.IsDone()) {
    double nearest = std::numeric_limits<double>::infinity();
    for (int i = 1; i <= hits.NbPoints(); ++i) {
      double hu, hv, w;
      hits.Parameters(i, hu, hv, w);
      if (w > -Precision::Confusion() && w < nearest) {
        nearest = w;
        u = hu;
        v = hv;
        found = true;
      }
    }
  }
  if (!found) {
    // The ray misses: the face's center decides.
    GProp_GProps props;
    BRepGProp::SurfaceProperties(face, props);
    GeomAPI_ProjectPointOnSurf projection(props.CentreOfMass(), surface);
    if (projection.NbPoints() == 0) throw KernelError("operation-failed", "the offset side of the surface is unclear");
    projection.LowerDistanceParameters(u, v);
  }
  GeomLProp_SLProps props(surface, u, v, 1, Precision::Confusion());
  if (!props.IsNormalDefined()) throw KernelError("operation-failed", "the surface has no normal where the extrusion meets it");
  const double along = props.Normal().Dot(direction);
  occ::handle<Geom_OffsetSurface> moved = new Geom_OffsetSurface(surface, along > 0 ? -offset : offset);
  const occ::handle<Geom_Surface> analytic = moved->Surface();
  return analytic.IsNull() ? occ::handle<Geom_Surface>(moved) : analytic;
}

}  // namespace

int limitToNext(int toolId, int bodyId, int op, const std::vector<double>& direction, bool reversed, const std::string& name) {
  if (direction.size() != 3) throw KernelError("operation-failed", "a direction needs 3 values");
  const gp_Dir along(direction[0], direction[1], direction[2]);
  const StoredShape& tool = store().entry(toolId);
  const StoredShape& body = store().entry(bodyId);
  // The end at the sketch plane and the far one (a reversed extrusion starts at its far end).
  const std::string start = faceName(name, reversed ? "end" : "start");
  const std::string end = faceName(name, reversed ? "start" : "end");
  const auto pieces = [&](BRepAlgoAPI_BooleanOperation& algorithm) -> StoredShape {
    configure(algorithm, tool.shape, body.shape);
    if (algorithm.HasErrors()) throw KernelError("operation-failed", "the extrusion could not be stopped at the body");
    FaceNamer namer(algorithm.Shape());
    namer.inherit(algorithm, tool.shape, tool.names);
    namer.inherit(algorithm, body.shape, body.names);
    return {algorithm.Shape(), namer.take()};
  };
  StoredShape split;
  if (op == 0) {
    BRepAlgoAPI_Cut outside;
    split = pieces(outside);
  } else {
    BRepAlgoAPI_Common inside;
    split = pieces(inside);
  }
  ShapeMap faces;
  TopExp::MapShapes(split.shape, TopAbs_FACE, faces);
  const std::vector<TopoDS_Shape> found = solidsOf(split.shape);
  std::vector<TopoDS_Shape> kept;
  if (op == 0) {
    // Adding: the pieces outside the body that start at the sketch; the body must stop each of them.
    for (const TopoDS_Shape& piece : found) {
      if (!hasFaceNamed(piece, faces, split.names, start)) continue;
      if (hasFaceNamed(piece, faces, split.names, end)) throw KernelError("end-missed", "the body does not stop the whole outline");
      kept.push_back(piece);
    }
  } else {
    // Cutting: per outline (a solid of the tool) the first material it passes through.
    const double tolerance = 1e-6 * std::max(1.0, diagonal(tool.shape));
    std::vector<TopoDS_Shape> outlines = solidsOf(tool.shape);
    std::vector<Bnd_Box> boxes;
    for (const TopoDS_Shape& outline : outlines) {
      Bnd_Box box;
      BRepBndLib::Add(outline, box);
      box.Enlarge(tolerance);
      boxes.push_back(box);
    }
    // Coordinates with the z axis along the extrusion: the low end of a piece's tight box there is where
    // it begins (much cheaper than the exact distance from the sketch, and as exact for planar faces).
    gp_Trsf toAlong;
    toAlong.SetTransformation(gp_Ax3(gp_Pnt(0, 0, 0), along));
    const auto beginsAt = [&](const TopoDS_Shape& piece) {
      Bnd_Box box;
      BRepBndLib::AddOptimal(piece.Moved(TopLoc_Location(toAlong)), box, false, false);
      double x0, y0, z0, x1, y1, z1;
      box.Get(x0, y0, z0, x1, y1, z1);
      return z0;
    };
    // The outline each piece lies in, and where along the extrusion it begins.
    std::vector<std::pair<size_t, double>> placed;
    std::vector<double> nearest(outlines.size(), std::numeric_limits<double>::infinity());
    for (const TopoDS_Shape& piece : found) {
      Bnd_Box box;
      BRepBndLib::Add(piece, box);
      std::vector<size_t> candidates;
      for (size_t o = 0; o < outlines.size(); ++o) {
        if (!boxes[o].IsOut(box)) candidates.push_back(o);
      }
      if (candidates.empty()) {
        for (size_t o = 0; o < outlines.size(); ++o) candidates.push_back(o);
      }
      size_t owner = candidates.front();
      double best = std::numeric_limits<double>::infinity();
      for (const size_t o : candidates) {
        if (candidates.size() == 1) break;
        BRepExtrema_DistShapeShape gap(piece, outlines[o], Extrema_ExtFlag_MIN);
        const double value = gap.IsDone() ? gap.Value() : std::numeric_limits<double>::infinity();
        if (value < best) {
          best = value;
          owner = o;
        }
      }
      const double begin = beginsAt(piece);
      placed.emplace_back(owner, begin);
      nearest[owner] = std::min(nearest[owner], begin);
    }
    for (size_t p = 0; p < found.size(); ++p) {
      const auto [owner, begin] = placed[p];
      if (begin <= nearest[owner] + 10 * tolerance) kept.push_back(found[p]);
    }
  }
  if (kept.empty()) throw KernelError("end-missed", "the extrusion does not reach the body");
  StoredShape result = namedSolids(kept, faces, split.names, faceName(name, "other"));
  return store().add(result.shape, std::move(result.names));
}

int limitBySurface(int toolId, int bodyId, int faceIndex, const std::vector<double>& direction, double offset, bool reversed, const std::string& name) {
  if (direction.size() != 3) throw KernelError("operation-failed", "a direction needs 3 values");
  const StoredShape& tool = store().entry(toolId);
  const TopoDS_Shape& body = store().get(bodyId);
  ShapeMap bodyFaces;
  TopExp::MapShapes(body, TopAbs_FACE, bodyFaces);
  if (faceIndex < 0 || faceIndex >= bodyFaces.Extent()) throw KernelError("face-missing", "face " + std::to_string(faceIndex) + " does not exist");
  const TopoDS_Face target = TopoDS::Face(bodyFaces(faceIndex + 1));
  const gp_Dir along(direction[0], direction[1], direction[2]);
  const std::string start = faceName(name, reversed ? "end" : "start");
  const std::string end = faceName(name, reversed ? "start" : "end");

  // Where the extrusion starts: the middle of its first face on the sketch plane.
  ShapeMap toolFaces;
  TopExp::MapShapes(tool.shape, TopAbs_FACE, toolFaces);
  gp_Pnt from;
  for (int f = 1; f <= toolFaces.Extent(); ++f) {
    if (f <= static_cast<int>(tool.names.size()) && tool.names[static_cast<size_t>(f - 1)] == start) {
      GProp_GProps props;
      BRepGProp::SurfaceProperties(toolFaces(f), props);
      from = props.CentreOfMass();
      break;
    }
  }
  const occ::handle<Geom_Surface> surface = offsetTowards(faceSurface(target), target, from, along, offset);
  const TopoDS_Face cutter = extendedFace(surface, target, diagonal(tool.shape) + diagonal(body));

  BRepAlgoAPI_Splitter splitter;
  NCollection_List<TopoDS_Shape> arguments;
  arguments.Append(tool.shape);
  NCollection_List<TopoDS_Shape> tools;
  tools.Append(cutter);
  splitter.SetArguments(arguments);
  splitter.SetTools(tools);
  splitter.SetRunParallel(parallel);
  splitter.Build();
  if (splitter.HasErrors()) throw KernelError("operation-failed", "the extrusion could not be cut off at the surface");
  FaceNamer namer(splitter.Shape());
  namer.inherit(splitter, tool.shape, tool.names);
  const FaceNames names = namer.take();
  ShapeMap faces;
  TopExp::MapShapes(splitter.Shape(), TopAbs_FACE, faces);
  // The pieces between the sketch and the surface; the surface must stop each of them.
  std::vector<TopoDS_Shape> kept;
  for (const TopoDS_Shape& piece : solidsOf(splitter.Shape())) {
    if (!hasFaceNamed(piece, faces, names, start)) continue;
    if (hasFaceNamed(piece, faces, names, end)) throw KernelError("end-missed", "the surface does not stop the whole outline");
    kept.push_back(piece);
  }
  if (kept.empty()) throw KernelError("end-missed", "the extrusion does not reach the surface");
  StoredShape result = namedSolids(kept, faces, names, end);
  return store().add(result.shape, std::move(result.names));
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
  const auto step = [&](const StoredShape& part) -> StoredShape {
    const auto run = [&](BRepAlgoAPI_BooleanOperation& algorithm) -> StoredShape {
      NCollection_List<TopoDS_Shape> arguments;
      arguments.Append(part.shape);
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
        cutMissed = !toolsLeftWalls(algorithm, part.shape, copyShapes, result);
      }
      FaceNamer namer(result);
      namer.inherit(algorithm, part.shape, part.names);
      for (const StoredShape& copy : copies) namer.inherit(algorithm, copy.shape, copy.names);
      return {result, namer.take()};
    };
    if (op == 0) {
      BRepAlgoAPI_Fuse algorithm;
      return run(algorithm);
    }
    BRepAlgoAPI_Cut algorithm;
    return run(algorithm);
  };
  StoredShape result = bodyByBody(body, compoundOf(tools), op == 0, step);
  return store().add(result.shape, std::move(result.names));
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
  // A new body: the tool's solids next to the body's, not fused.
  if (op == 2) {
    StoredShape result = bodyOf({body, tool});
    return store().add(result.shape, std::move(result.names));
  }
  const auto step = [&](const StoredShape& part) {
    const auto run = [&](BRepAlgoAPI_BooleanOperation& algorithm) -> StoredShape {
      configure(algorithm, part.shape, tool.shape);
      if (algorithm.HasErrors()) throw KernelError("operation-failed", "boolean operation failed");
      algorithm.SimplifyResult(true, true, 1e-6);
      const TopoDS_Shape result = algorithm.Shape();
      if (countSolids(result) == 0) throw KernelError("empty-result", "the operation removed the whole body");
      if (op == 1) cutMissed = !toolsLeftWalls(algorithm, part.shape, {tool.shape}, result);
      // Faces of the body win over coplanar tool faces merged into them, so existing names stay.
      FaceNamer namer(result);
      namer.inherit(algorithm, part.shape, part.names);
      namer.inherit(algorithm, tool.shape, tool.names);
      return {result, namer.take()};
    };
    if (op == 0) {
      BRepAlgoAPI_Fuse algorithm;
      return run(algorithm);
    }
    BRepAlgoAPI_Cut algorithm;
    return run(algorithm);
  };
  StoredShape result = bodyByBody(body, tool.shape, op == 0, step);
  return store().add(result.shape, std::move(result.names));
}

int combineBodies(int bodyId, const std::vector<int>& faceIndices, int op, const std::string& name) {
  const StoredShape& body = store().entry(bodyId);
  std::vector<StoredShape> solids = solidsOf(body);
  const std::vector<int32_t> owners = faceSolids(body.shape);
  // The main body first, then the others, each once.
  std::vector<int> chosen;
  for (int face : faceIndices) {
    if (face < 0 || face >= static_cast<int>(owners.size())) throw KernelError("operation-failed", "no such face");
    const int solid = owners[static_cast<size_t>(face)];
    if (solid >= 0 && std::find(chosen.begin(), chosen.end(), solid) == chosen.end()) chosen.push_back(solid);
  }
  if (chosen.size() < 2) throw KernelError("combine-bodies", "pick the main body and at least one other body");
  StoredShape result = solids[static_cast<size_t>(chosen.front())];
  for (size_t i = 1; i < chosen.size(); ++i) {
    const StoredShape& other = solids[static_cast<size_t>(chosen[i])];
    if (op == 0) {
      result = fuseBodies(result, other);
      continue;
    }
    const auto run = [&](BRepAlgoAPI_BooleanOperation& algorithm) -> StoredShape {
      configure(algorithm, result.shape, other.shape);
      if (algorithm.HasErrors()) throw KernelError("operation-failed", "the bodies could not be combined");
      algorithm.SimplifyResult(true, true, 1e-6);
      FaceNamer namer(algorithm.Shape());
      namer.inherit(algorithm, result.shape, result.names);
      namer.inherit(algorithm, other.shape, other.names);
      namer.rest(faceName(name, "face"));
      return {algorithm.Shape(), namer.take()};
    };
    if (op == 1) {
      BRepAlgoAPI_Cut algorithm;
      result = run(algorithm);
    } else {
      BRepAlgoAPI_Common algorithm;
      result = run(algorithm);
    }
    if (countSolids(result.shape) == 0) throw KernelError("empty-result", op == 2 ? "the bodies have nothing in common" : "the operation removed the whole body");
  }
  std::vector<StoredShape> parts;
  for (size_t s = 0; s < solids.size(); ++s) {
    if (static_cast<int>(s) == chosen.front()) parts.push_back(result);
    else if (std::find(chosen.begin(), chosen.end(), static_cast<int>(s)) == chosen.end()) parts.push_back(solids[s]);
  }
  StoredShape combined = bodyOf(parts);
  return store().add(combined.shape, std::move(combined.names));
}

int deleteBodies(int bodyId, const std::vector<int>& faceIndices) {
  const StoredShape& body = store().entry(bodyId);
  std::vector<StoredShape> solids = solidsOf(body);
  const std::vector<int32_t> owners = faceSolids(body.shape);
  std::vector<bool> gone(solids.size(), false);
  for (int face : faceIndices) {
    if (face < 0 || face >= static_cast<int>(owners.size())) throw KernelError("operation-failed", "no such face");
    const int solid = owners[static_cast<size_t>(face)];
    if (solid >= 0) gone[static_cast<size_t>(solid)] = true;
  }
  std::vector<StoredShape> parts;
  for (size_t s = 0; s < solids.size(); ++s)
    if (!gone[s]) parts.push_back(solids[s]);
  if (parts.empty()) throw KernelError("empty-result", "every body would be deleted");
  StoredShape result = bodyOf(parts);
  return store().add(result.shape, std::move(result.names));
}

int fillet(int bodyId, const std::vector<int>& edgeIndices, double radius, const std::vector<std::string>& edgeNames, const std::string& name) {
  const TopoDS_Shape& body = store().get(bodyId);
  BRepFilletAPI_MakeFillet maker(body, ChFi3d_Rational);
  const std::vector<TopoDS_Edge> edges = selectEdges(body, edgeIndices);
  for (const TopoDS_Edge& edge : edges) maker.Add(radius, edge);
  return finishEdgeFeature(maker, bodyId, edges, edgeNames, name, "fillet", "fillet could not be computed (radius too large?)");
}

int filletVariable(int bodyId, const std::vector<int>& edgeIndices, double startRadius, double endRadius, bool swap, const std::vector<std::string>& edgeNames,
                   const std::string& name) {
  const TopoDS_Shape& body = store().get(bodyId);
  BRepFilletAPI_MakeFillet maker(body, ChFi3d_Rational);
  const std::vector<TopoDS_Edge> edges = selectEdges(body, edgeIndices);
  for (const TopoDS_Edge& edge : edges) {
    // The start is the end with the smaller coordinates (x, then y, then z), whichever way the edge runs.
    // MakeFillet takes the radii in the direction of the edge's curve, so its orientation is left aside.
    const gp_Pnt first = BRep_Tool::Pnt(TopExp::FirstVertex(edge, false));
    const gp_Pnt last = BRep_Tool::Pnt(TopExp::LastVertex(edge, false));
    const auto before = [](const gp_Pnt& a, const gp_Pnt& b) {
      const double tolerance = 1e-7;
      if (std::abs(a.X() - b.X()) > tolerance) return a.X() < b.X();
      if (std::abs(a.Y() - b.Y()) > tolerance) return a.Y() < b.Y();
      return a.Z() < b.Z();
    };
    const bool firstIsStart = before(first, last) != swap;
    maker.Add(firstIsStart ? startRadius : endRadius, firstIsStart ? endRadius : startRadius, edge);
  }
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

int draftFaces(int bodyId, const std::vector<int>& faceIndices, const std::vector<double>& plane, double angle, const std::string& name) {
  if (plane.size() != 6) throw KernelError("operation-failed", "a plane needs a point and a normal");
  if (faceIndices.empty()) throw KernelError("draft-faces", "no faces to draft");
  const StoredShape& body = store().entry(bodyId);
  const gp_Dir pull(plane[3], plane[4], plane[5]);
  const gp_Pln neutral(gp_Pnt(plane[0], plane[1], plane[2]), pull);
  ShapeMap faces;
  TopExp::MapShapes(body.shape, TopAbs_FACE, faces);
  BRepOffsetAPI_DraftAngle draft(body.shape);
  for (size_t k = 0; k < faceIndices.size(); ++k) {
    const int index = faceIndices[k];
    if (index < 0 || index >= faces.Extent()) throw KernelError("face-missing", "face " + std::to_string(index) + " does not exist");
    draft.Add(TopoDS::Face(faces(index + 1)), pull, angle, neutral);
    if (!draft.AddDone()) throw KernelError("draft-face", std::to_string(k + 1));
  }
  draft.Build();
  if (!draft.IsDone()) throw KernelError("operation-failed", "the draft could not be computed");
  const TopoDS_Shape result = draft.Shape();
  requireValidSolid(result, "draft");
  FaceNamer namer(result);
  // Tilted faces are reported by ModifiedShape(), not Modified(): every face keeps its name.
  for (int f = 1; f <= faces.Extent(); ++f) {
    const std::string& faceName = f <= static_cast<int>(body.names.size()) ? body.names[static_cast<size_t>(f - 1)] : std::string();
    const NCollection_List<TopoDS_Shape>& modified = draft.Modified(faces(f));
    if (!modified.IsEmpty()) {
      for (const TopoDS_Shape& piece : modified) namer.assign(piece, faceName);
    } else {
      const TopoDS_Shape& moved = draft.ModifiedShape(faces(f));
      namer.assign(moved.IsNull() ? faces(f) : moved, faceName);
    }
  }
  namer.rest(faceName(name, "other"));
  return store().add(result, namer.take());
}

namespace {

/** The outward normal of a face where it is nearest to its center of area. */
gp_Dir outwardNormal(const TopoDS_Face& face) {
  GProp_GProps props;
  BRepGProp::SurfaceProperties(face, props);
  const occ::handle<Geom_Surface> surface = BRep_Tool::Surface(face);
  GeomAPI_ProjectPointOnSurf projection(props.CentreOfMass(), surface);
  if (projection.NbPoints() == 0) throw KernelError("operation-failed", "the face has no normal");
  double u = 0, v = 0;
  projection.LowerDistanceParameters(u, v);
  GeomLProp_SLProps local(surface, u, v, 1, Precision::Confusion());
  if (!local.IsNormalDefined()) throw KernelError("operation-failed", "the face has no normal");
  gp_Dir normal = local.Normal();
  if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
  return normal;
}

double volumeOf(const TopoDS_Shape& shape) {
  GProp_GProps props;
  BRepGProp::VolumeProperties(shape, props);
  return props.Mass();
}

}  // namespace

int faceFillet(int bodyId, int faceA, int faceB, double radius, const std::string& name) {
  const StoredShape& body = store().entry(bodyId);
  ShapeMap faces;
  TopExp::MapShapes(body.shape, TopAbs_FACE, faces);
  const auto face = [&](int index) {
    if (index < 0 || index >= faces.Extent()) throw KernelError("face-missing", "face " + std::to_string(index) + " does not exist");
    return TopoDS::Face(faces(index + 1));
  };
  const TopoDS_Face a = face(faceA);
  const TopoDS_Face b = face(faceB);
  const std::optional<gp_Dir> na = planeNormal(a);
  const std::optional<gp_Dir> nb = planeNormal(b);
  if (!na || !nb) throw KernelError("round-planes", "a face fillet needs two planar faces");
  const double k = na->Dot(*nb);
  if (std::abs(k) > 1 - 1e-9) throw KernelError("round-planes", "the faces are parallel");
  const double ha = gp_Vec(BRepAdaptor_Surface(a).Plane().Location().XYZ()).Dot(gp_Vec(*na));
  const double hb = gp_Vec(BRepAdaptor_Surface(b).Plane().Location().XYZ()).Dot(gp_Vec(*nb));
  // Where the planes meet: the point of that line nearest to the origin.
  const gp_Vec va(*na), vb(*nb);
  const double det = 1 - k * k;
  const gp_Vec corner = va * ((ha - hb * k) / det) + vb * ((hb - ha * k) / det);
  const gp_Dir along = na->Crossed(*nb);
  // An outer corner has each face behind the other's plane (material between them); an inner one in front.
  const auto centerOf = [](const TopoDS_Face& f) {
    GProp_GProps props;
    BRepGProp::SurfaceProperties(f, props);
    return gp_Vec(props.CentreOfMass().XYZ());
  };
  const double aBehindB = centerOf(a).Dot(vb) - hb;
  const double bBehindA = centerOf(b).Dot(va) - ha;
  if ((aBehindB < 0) != (bBehindA < 0)) throw KernelError("round-planes", "the faces form no corner to round");
  const bool outer = aBehindB < 0;
  // The axis of the round lies `radius` from both planes: inside the material at an outer corner.
  const double sign = outer ? -1 : 1;
  const gp_Vec axis = corner + (va + vb) * (sign * radius / (1 + k));
  const gp_Vec ta = axis - va * (sign * radius);
  const gp_Vec tb = axis - vb * (sign * radius);

  // The stretch along the corner where both faces are.
  const auto span = [&](const TopoDS_Face& f) {
    gp_Trsf toAlong;
    toAlong.SetTransformation(gp_Ax3(gp_Pnt(0, 0, 0), along));
    Bnd_Box box;
    BRepBndLib::AddOptimal(f.Moved(TopLoc_Location(toAlong)), box, false, false);
    double x0, y0, z0, x1, y1, z1;
    box.Get(x0, y0, z0, x1, y1, z1);
    return std::pair<double, double>(z0, z1);
  };
  const auto [a0, a1] = span(a);
  const auto [b0, b1] = span(b);
  const double from = std::max(a0, b0);
  const double to = std::min(a1, b1);
  if (!(to - from > Precision::Confusion())) throw KernelError("round-planes", "the faces do not run side by side");
  // The round must start on the faces themselves, not past their ends.
  const gp_Vec middle = gp_Vec(along) * ((from + to) / 2);
  const auto onFace = [&](const TopoDS_Face& f, const gp_Vec& p) {
    BRepExtrema_DistShapeShape gap(BRepBuilderAPI_MakeVertex(gp_Pnt((p + middle).XYZ())).Vertex(), f, Extrema_ExtFlag_MIN);
    return gap.IsDone() && gap.Value() < 1e-6 * std::max(1.0, radius);
  };
  if (!onFace(a, ta) || !onFace(b, tb)) {
    throw KernelError("round-radius", "the radius is too large for the faces");
  }

  // The corner region between the faces and the round, over that stretch.
  // All of these lie in the plane through the origin across the corner; the region starts at `from`.
  const auto at = [&](const gp_Vec& p) { return gp_Pnt((p + gp_Vec(along) * from).XYZ()); };
  const gp_Vec cornerPoint = corner;
  const gp_Vec mid = axis + (cornerPoint - axis).Normalized() * radius;
  const occ::handle<Geom_TrimmedCurve> arc = GC_MakeArcOfCircle(at(ta), at(mid), at(tb)).Value();
  const TopoDS_Edge arcEdge = BRepBuilderAPI_MakeEdge(arc).Edge();
  BRepBuilderAPI_MakeWire wire(arcEdge, BRepBuilderAPI_MakeEdge(at(tb), at(cornerPoint)).Edge(), BRepBuilderAPI_MakeEdge(at(cornerPoint), at(ta)).Edge());
  if (!wire.IsDone()) throw KernelError("operation-failed", "the round could not be outlined");
  BRepPrimAPI_MakePrism prism(BRepBuilderAPI_MakeFace(wire.Wire(), true).Face(), gp_Vec(along) * (to - from));
  if (!prism.IsDone()) throw KernelError("operation-failed", "the round could not be built");
  StoredShape tool{prism.Shape(), {}};
  {
    FaceNamer namer(tool.shape);
    namer.generated(prism, arcEdge, faceName(name, "round"));
    namer.rest(faceName(name, "end"));
    tool.names = namer.take();
  }

  const auto run = [&](BRepAlgoAPI_BooleanOperation& algorithm) {
    configure(algorithm, body.shape, tool.shape);
    if (algorithm.HasErrors()) throw KernelError("operation-failed", "the face fillet could not be computed");
    algorithm.SimplifyResult(true, true, 1e-6);
    const TopoDS_Shape result = algorithm.Shape();
    requireValidSolid(result, "face fillet");
    FaceNamer namer(result);
    namer.inherit(algorithm, body.shape, body.names);
    namer.inherit(algorithm, tool.shape, tool.names);
    namer.rest(faceName(name, "round"));
    return store().add(result, namer.take());
  };
  if (outer) {
    BRepAlgoAPI_Cut algorithm;
    return run(algorithm);
  }
  BRepAlgoAPI_Fuse algorithm;
  return run(algorithm);
}

int fullRound(int bodyId, int side1, int center, int side2, const std::string& name) {
  const StoredShape& body = store().entry(bodyId);
  ShapeMap faces;
  TopExp::MapShapes(body.shape, TopAbs_FACE, faces);
  const auto face = [&](int index) {
    if (index < 0 || index >= faces.Extent()) throw KernelError("face-missing", "face " + std::to_string(index) + " does not exist");
    return TopoDS::Face(faces(index + 1));
  };
  const TopoDS_Face a = face(side1);
  const TopoDS_Face b = face(side2);
  const TopoDS_Face c = face(center);
  // The sides: parallel planes facing away from each other, `width` apart.
  const std::optional<gp_Dir> na = planeNormal(a);
  const std::optional<gp_Dir> nb = planeNormal(b);
  if (!na || !nb || na->Dot(*nb) > -1 + 1e-9) throw KernelError("round-sides", "the side faces must be parallel planes facing away from each other");
  const gp_Pnt pa = BRepAdaptor_Surface(a).Plane().Location();
  const gp_Pnt pb = BRepAdaptor_Surface(b).Plane().Location();
  const double width = -gp_Vec(pa, pb).Dot(gp_Vec(*na));
  if (!(width > Precision::Confusion())) throw KernelError("round-sides", "the side faces must face away from each other");
  const gp_Dir n = *na;
  const gp_Pnt middle = pa.Translated(gp_Vec(n) * (-width / 2));
  // Across the sides and out of the center face: the round bulges that way.
  const gp_Vec outward(outwardNormal(c));
  const gp_Vec across = outward - gp_Vec(n) * outward.Dot(gp_Vec(n));
  if (across.Magnitude() < 1e-6) throw KernelError("round-center", "the center face must lie between the side faces");
  const gp_Dir out(across);
  const gp_Dir along = n.Crossed(out);

  // The center face in coordinates x out of it, y along it, z across the sides (from the middle plane).
  const gp_Ax3 frame(middle, n, out);
  gp_Trsf toFrame;
  toFrame.SetTransformation(frame);
  Bnd_Box box;
  BRepBndLib::AddOptimal(c.Moved(TopLoc_Location(toFrame)), box, false, false);
  double x0, y0, z0, x1, y1, z1;
  box.Get(x0, y0, z0, x1, y1, z1);
  const double tolerance = 1e-6 * std::max(1.0, width);
  if (z0 < -width / 2 - tolerance || z1 > width / 2 + tolerance) throw KernelError("round-center", "the center face must lie between the side faces");
  const double length = y1 - y0;
  if (!(length > tolerance)) throw KernelError("round-center", "the center face has no length along the sides");
  // The round touches the outermost point of the center face; its axis lies half the width inside.
  const double axis = x1 - width / 2;
  const double beyond = x1 + 0.05 * width;
  const auto point = [&](double x, double y, double z) { return middle.Translated(gp_Vec(out) * x + gp_Vec(along) * y + gp_Vec(n) * z); };

  // What is taken away: the slab between the sides beyond the axis, as far as the center face goes.
  const TopoDS_Shape slab = BRepPrimAPI_MakeBox(gp_Ax2(point(axis, y0, -width / 2), n, out), beyond - axis, length, width).Shape();
  // What comes back: half a cylinder over the same stretch.
  const occ::handle<Geom_TrimmedCurve> arc = GC_MakeArcOfCircle(point(axis, y0, -width / 2), point(x1, y0, 0), point(axis, y0, width / 2)).Value();
  const TopoDS_Edge arcEdge = BRepBuilderAPI_MakeEdge(arc).Edge();
  BRepBuilderAPI_MakeWire wire(arcEdge, BRepBuilderAPI_MakeEdge(point(axis, y0, width / 2), point(axis, y0, -width / 2)).Edge());
  if (!wire.IsDone()) throw KernelError("operation-failed", "the round could not be outlined");
  BRepPrimAPI_MakePrism prism(BRepBuilderAPI_MakeFace(wire.Wire(), true).Face(), gp_Vec(along) * length);
  if (!prism.IsDone()) throw KernelError("operation-failed", "the round could not be built");
  StoredShape half{prism.Shape(), {}};
  {
    FaceNamer namer(half.shape);
    namer.generated(prism, arcEdge, faceName(name, "round"));
    namer.rest(faceName(name, "end"));
    half.names = namer.take();
  }

  // Faces the slab leaves where the part goes on past the center face are named after the round too.
  BRepAlgoAPI_Cut cut;
  configure(cut, body.shape, slab);
  if (cut.HasErrors()) throw KernelError("operation-failed", "the full round could not be cut");
  StoredShape rest{cut.Shape(), {}};
  {
    FaceNamer namer(rest.shape);
    namer.inherit(cut, body.shape, body.names);
    namer.rest(faceName(name, "end"));
    rest.names = namer.take();
  }

  // Where the slab held more than a plain block (holes, slots), only the material there is rounded.
  StoredShape round = half;
  BRepAlgoAPI_Common inside;
  configure(inside, body.shape, slab);
  if (inside.HasErrors()) throw KernelError("operation-failed", "the full round could not be cut");
  const double block = width * length * (x1 - axis);
  if (std::abs(volumeOf(inside.Shape()) - block) > 1e-6 * block) {
    FaceNamer insideNamer(inside.Shape());
    insideNamer.inherit(inside, body.shape, body.names);
    const FaceNames insideNames = insideNamer.take();
    BRepAlgoAPI_Common rounded;
    configure(rounded, inside.Shape(), half.shape);
    if (rounded.HasErrors()) throw KernelError("operation-failed", "the full round could not be shaped");
    FaceNamer namer(rounded.Shape());
    namer.inherit(rounded, half.shape, half.names);
    namer.inherit(rounded, inside.Shape(), insideNames);
    round = {rounded.Shape(), namer.take()};
  }

  BRepAlgoAPI_Fuse fuse;
  configure(fuse, rest.shape, round.shape);
  if (fuse.HasErrors()) throw KernelError("operation-failed", "the full round could not be joined to the part");
  fuse.SimplifyResult(true, true, 1e-6);
  const TopoDS_Shape result = fuse.Shape();
  requireValidSolid(result, "full round");
  FaceNamer namer(result);
  namer.inherit(fuse, rest.shape, rest.names);
  namer.inherit(fuse, round.shape, round.names);
  namer.rest(faceName(name, "round"));
  return store().add(result, namer.take());
}

int cutThread(int bodyId, int faceIndex, double pitch, double length, bool reverse, bool leftHand, const std::string& name) {
  const StoredShape& body = store().entry(bodyId);
  ShapeMap faces;
  TopExp::MapShapes(body.shape, TopAbs_FACE, faces);
  if (faceIndex < 0 || faceIndex >= faces.Extent()) throw KernelError("face-missing", "face " + std::to_string(faceIndex) + " does not exist");
  const TopoDS_Face face = TopoDS::Face(faces(faceIndex + 1));
  BRepAdaptor_Surface surface(face);
  if (surface.GetType() != GeomAbs_Cylinder) throw KernelError("thread-face", "a thread needs a cylindrical face");
  if (!(pitch > 0) || !(length > 0)) throw KernelError("thread-size", "pitch and length must be above 0");
  const gp_Cylinder cylinder = surface.Cylinder();
  const double radius = cylinder.Radius();
  gp_Ax3 frame = cylinder.Position();
  // Where the face starts and ends along the axis; the thread starts at one end and goes into the face.
  double v0 = surface.FirstVParameter(), v1 = surface.LastVParameter();
  const gp_Dir axisDir = frame.Direction();
  gp_Pnt start = frame.Location().Translated(gp_Vec(axisDir) * (reverse ? v1 : v0));
  gp_Dir along = reverse ? axisDir.Reversed() : axisDir;
  // At most as long as the face.
  length = std::min(length, v1 - v0);
  // A hole has its material outside: the face's outward normal points to the axis.
  gp_Pnt point;
  gp_Vec du, dv;
  surface.D1((surface.FirstUParameter() + surface.LastUParameter()) / 2, (v0 + v1) / 2, point, du, dv);
  gp_Vec normal = du.Crossed(dv);
  if (face.Orientation() == TopAbs_REVERSED) normal.Reverse();
  const gp_Vec fromAxis(frame.Location(), point);
  const gp_Vec radial = fromAxis - gp_Vec(axisDir) * fromAxis.Dot(gp_Vec(axisDir));
  const bool internal = normal.Dot(radial) < 0;

  // The basic ISO profile (fundamental triangle height H): the groove cut into a bolt, or into the wall
  // of a hole, as a trapezoid in a plane through the axis; it reaches a little past the surface.
  const double h = std::sqrt(3.0) / 2 * pitch;
  std::vector<std::pair<double, double>> outline;  // (distance from the axis, position along it)
  if (!internal) {
    const double crest = radius, root = radius - 5 * h / 8;
    outline = {{crest + h / 16, -15 * pitch / 32}, {root, -pitch / 8}, {root, pitch / 8}, {crest + h / 16, 15 * pitch / 32}};
  } else {
    const double minor = radius, major = radius + 5 * h / 8;
    outline = {{minor - h / 16, -13 * pitch / 32}, {major, -pitch / 16}, {major, pitch / 16}, {minor - h / 16, 13 * pitch / 32}};
  }
  // The groove runs one pitch past the start, so it opens out of the end of the face cleanly.
  const double from = -pitch;
  const double to = length;
  const double turns = (to - from) / pitch;
  const gp_Ax3 helixFrame(start, along, frame.XDirection());
  const auto at = [&](double r, double z) { return gp_Pnt(start.XYZ() + helixFrame.XDirection().XYZ() * r + gp_Vec(along).XYZ() * (from + z)); };
  BRepBuilderAPI_MakePolygon polygon;
  for (const auto& [r, z] : outline) polygon.Add(at(r, z));
  polygon.Close();
  const double spineRadius = internal ? radius : radius - 5 * h / 8;
  const occ::handle<Geom_CylindricalSurface> helixSurface = new Geom_CylindricalSurface(helixFrame, spineRadius);
  const gp_Dir2d slope(leftHand ? -2 * M_PI : 2 * M_PI, pitch);
  const occ::handle<Geom2d_Line> line = new Geom2d_Line(gp_Pnt2d(0, from), slope);
  TopoDS_Edge helix = BRepBuilderAPI_MakeEdge(line, helixSurface, 0, turns * std::hypot(2 * M_PI, pitch)).Edge();
  // A tight 3D curve for the helix and a tight sweep: loose approximations make the cut unreliable.
  BRepLib::BuildCurves3d(helix, 1e-7, GeomAbs_C1, 14, std::max(64, static_cast<int>(turns * 16)));
  BRepOffsetAPI_MakePipeShell sweep(BRepBuilderAPI_MakeWire(helix).Wire());
  sweep.SetMode(along);
  sweep.SetTolerance(1e-6, 1e-6, 1e-4);
  sweep.Add(polygon.Wire());
  sweep.Build();
  if (!sweep.IsDone() || !sweep.MakeSolid()) throw KernelError("operation-failed", "the thread could not be swept");
  StoredShape groove{sweep.Shape(), {}};
  {
    FaceNamer namer(groove.shape);
    namer.rest(faceName(name, "thread"));
    groove.names = namer.take();
  }
  BRepAlgoAPI_Cut cut;
  configure(cut, body.shape, groove.shape);
  if (cut.HasErrors()) throw KernelError("operation-failed", "the thread could not be cut");
  cut.SimplifyResult(true, true, 1e-6);
  const TopoDS_Shape result = cut.Shape();
  requireValidSolid(result, "thread");
  FaceNamer namer(result);
  namer.inherit(cut, body.shape, body.names);
  namer.inherit(cut, groove.shape, groove.names);
  namer.rest(faceName(name, "thread"));
  return store().add(result, namer.take());
}

int transformShape(int id, const std::vector<double>& transform) {
  if (transform.size() != 12) throw KernelError("operation-failed", "a transformation needs 12 values");
  const StoredShape& body = store().entry(id);
  const double* m = transform.data();
  gp_Trsf trsf;
  trsf.SetValues(m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8], m[9], m[10], m[11]);
  // Moving keeps the shared geometry and the order of the faces, so the names stay valid.
  return store().add(body.shape.Moved(TopLoc_Location(trsf)), body.names);
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
  result.faceBodies = faceSolids(entry.shape);
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

BoundingBox boundingBox(int id, bool tight) {
  Bnd_Box box;
  if (tight)
    BRepBndLib::AddOptimal(store().get(id), box, false, false);
  else
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
