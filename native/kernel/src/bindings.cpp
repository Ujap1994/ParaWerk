// WebAssembly bindings of the ParaWerk kernel core (embind).
//
// JavaScript never owns C++ objects: shapes are integer ids, results are plain
// objects and copies of typed arrays, and every exception becomes an error object
// ({ ok: false, code, message }) instead of crossing into JavaScript.

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "core.hpp"

using emscripten::val;

namespace {

template <typename T>
val typedArray(const char* type, const std::vector<T>& data) {
  // Copy into a JavaScript-owned typed array; WebAssembly memory may move later.
  return val::global(type).new_(val(emscripten::typed_memory_view(data.size(), data.data())));
}

val okObject() {
  val result = val::object();
  result.set("ok", true);
  return result;
}

val idResult(int id) {
  val result = okObject();
  result.set("id", id);
  // A cut that removed nothing is not an error, but worth a warning.
  if (parawerk::takeCutMissed()) result.set("missed", true);
  return result;
}

template <typename Body>
val guarded(Body&& body) {
  try {
    return body();
  } catch (...) {
    const auto [code, message] = parawerk::describeException(std::current_exception());
    val result = val::object();
    result.set("ok", false);
    result.set("code", code);
    result.set("message", message);
    return result;
  }
}

std::vector<std::string> toStringVector(const val& array) { return emscripten::vecFromJSArray<std::string>(array); }

std::vector<int> toIntVector(const val& array) {
  const int length = array["length"].as<int>();
  std::vector<int> result(static_cast<size_t>(length));
  for (int i = 0; i < length; ++i) result[static_cast<size_t>(i)] = array[i].as<int>();
  return result;
}

val point(const double (&p)[3]) { return val::array(std::vector<double>{p[0], p[1], p[2]}); }

val meshResult(const parawerk::MeshData& mesh) {
  val result = okObject();
  result.set("positions", typedArray("Float32Array", mesh.positions));
  result.set("normals", typedArray("Float32Array", mesh.normals));
  result.set("indices", typedArray("Uint32Array", mesh.indices));
  result.set("faceRanges", typedArray("Uint32Array", mesh.faceRanges));
  result.set("edgePositions", typedArray("Float32Array", mesh.edgePositions));
  result.set("edgeRanges", typedArray("Uint32Array", mesh.edgeRanges));
  result.set("faceKinds", typedArray("Uint8Array", mesh.faceKinds));
  result.set("faceAreas", typedArray("Float64Array", mesh.faceAreas));
  result.set("faceRadii", typedArray("Float64Array", mesh.faceRadii));
  result.set("facePlanes", typedArray("Float64Array", mesh.facePlanes));
  result.set("edgeKinds", typedArray("Uint8Array", mesh.edgeKinds));
  result.set("edgeLengths", typedArray("Float64Array", mesh.edgeLengths));
  result.set("edgeRadii", typedArray("Float64Array", mesh.edgeRadii));
  result.set("edgeGeometry", typedArray("Float64Array", mesh.edgeGeometry));
  return result;
}

val makeBox(double x, double y, double z, double dx, double dy, double dz, std::string name) {
  return guarded([&] { return idResult(parawerk::makeBox(x, y, z, dx, dy, dz, name)); });
}

val makeCylinder(double px, double py, double pz, double dx, double dy, double dz, double radius, double height, std::string name) {
  return guarded([&] { return idResult(parawerk::makeCylinder(px, py, pz, dx, dy, dz, radius, height, name)); });
}

val booleanOperation(int bodyId, int toolId, int op) {
  return guarded([&] { return idResult(parawerk::booleanOperation(bodyId, toolId, op)); });
}

val extrudeProfile(val profile, val frame, double from, double to, val edgeNames, std::string name) {
  return guarded([&] {
    const std::vector<double> data = emscripten::convertJSArrayToNumberVector<double>(profile);
    const std::vector<double> plane = emscripten::convertJSArrayToNumberVector<double>(frame);
    return idResult(parawerk::extrudeProfile(data, plane, from, to, toStringVector(edgeNames), name));
  });
}

val revolveProfile(val profile, val frame, val axis, double from, double to, val edgeNames, std::string name) {
  return guarded([&] {
    const std::vector<double> data = emscripten::convertJSArrayToNumberVector<double>(profile);
    const std::vector<double> plane = emscripten::convertJSArrayToNumberVector<double>(frame);
    const std::vector<double> line = emscripten::convertJSArrayToNumberVector<double>(axis);
    return idResult(parawerk::revolveProfile(data, plane, line, from, to, toStringVector(edgeNames), name));
  });
}

val cutHoles(int bodyId, val profile, val placements, val edgeNames, std::string name) {
  return guarded([&] {
    const std::vector<double> data = emscripten::convertJSArrayToNumberVector<double>(profile);
    const std::vector<double> places = emscripten::convertJSArrayToNumberVector<double>(placements);
    return idResult(parawerk::cutHoles(bodyId, data, places, toStringVector(edgeNames), name));
  });
}

val trimByPlane(int shapeId, val plane, std::string name) {
  return guarded([&] { return idResult(parawerk::trimByPlane(shapeId, emscripten::convertJSArrayToNumberVector<double>(plane), name)); });
}

val shell(int bodyId, val openFaces, double thickness, bool outward, std::string name) {
  return guarded([&] { return idResult(parawerk::shell(bodyId, toIntVector(openFaces), thickness, outward, name)); });
}

val combineCopies(int bodyId, int toolId, val transforms, int op, std::string name) {
  return guarded([&] {
    const std::vector<double> matrices = emscripten::convertJSArrayToNumberVector<double>(transforms);
    return idResult(parawerk::combineCopies(bodyId, toolId, matrices, op, name));
  });
}

val fillet(int bodyId, val edgeIndices, double radius, val edgeNames, std::string name) {
  return guarded([&] { return idResult(parawerk::fillet(bodyId, toIntVector(edgeIndices), radius, toStringVector(edgeNames), name)); });
}

val chamferUneven(int bodyId, val edgeIndices, double distance, double second, bool byAngle, bool flip, val edgeNames, std::string name) {
  return guarded([&] { return idResult(parawerk::chamferUneven(bodyId, toIntVector(edgeIndices), distance, second, byAngle, flip, toStringVector(edgeNames), name)); });
}

val chamfer(int bodyId, val edgeIndices, double distance, val edgeNames, std::string name) {
  return guarded([&] { return idResult(parawerk::chamfer(bodyId, toIntVector(edgeIndices), distance, toStringVector(edgeNames), name)); });
}

val naming(int id) {
  return guarded([&] {
    const parawerk::Naming naming = parawerk::naming(id);
    val result = okObject();
    result.set("faces", val::array(naming.faces));
    result.set("facePlanes", typedArray("Float64Array", naming.facePlanes));
    result.set("edgeFaces", typedArray("Int32Array", naming.edgeFaces));
    result.set("edgeMidpoints", typedArray("Float64Array", naming.edgeMidpoints));
    result.set("edgeVertices", typedArray("Int32Array", naming.edgeVertices));
    result.set("vertexPositions", typedArray("Float64Array", naming.vertexPositions));
    result.set("vertexFaceOffsets", typedArray("Int32Array", naming.vertexFaceOffsets));
    result.set("vertexFaces", typedArray("Int32Array", naming.vertexFaces));
    return result;
  });
}

template <size_t N>
val numbers(const double (&values)[N]) {
  return val::array(std::vector<double>(std::begin(values), std::end(values)));
}

val faceGeometry(int id, int index) {
  return guarded([&] {
    const parawerk::FaceGeometry face = parawerk::faceGeometry(id, index);
    val result = okObject();
    result.set("kind", face.kind);
    result.set("area", face.area);
    result.set("center", numbers(face.center));
    result.set("plane", numbers(face.plane));
    result.set("axis", numbers(face.axis));
    result.set("radius", face.radius);
    return result;
  });
}

val edgeGeometry(int id, int index) {
  return guarded([&] {
    const parawerk::EdgeGeometry edge = parawerk::edgeGeometry(id, index);
    val result = okObject();
    result.set("kind", edge.kind);
    result.set("length", edge.length);
    result.set("start", numbers(edge.start));
    result.set("end", numbers(edge.end));
    result.set("middle", numbers(edge.middle));
    result.set("center", numbers(edge.center));
    result.set("axis", numbers(edge.axis));
    result.set("radius", edge.radius);
    return result;
  });
}

val distance(int id, int kindA, int indexA, int kindB, int indexB) {
  return guarded([&] {
    const parawerk::Distance distance = parawerk::distance(id, kindA, indexA, kindB, indexB);
    val result = okObject();
    result.set("value", distance.value);
    result.set("from", point(distance.from));
    result.set("to", point(distance.to));
    return result;
  });
}

val counts(int id) {
  return guarded([&] {
    const parawerk::Counts counts = parawerk::counts(id);
    val result = okObject();
    result.set("faces", counts.faces);
    result.set("edges", counts.edges);
    result.set("solids", counts.solids);
    return result;
  });
}

val boundingBox(int id, bool tight) {
  return guarded([&] {
    const parawerk::BoundingBox box = parawerk::boundingBox(id, tight);
    val result = okObject();
    result.set("min", point(box.min));
    result.set("max", point(box.max));
    return result;
  });
}

val massProperties(int id) {
  return guarded([&] {
    const parawerk::MassProperties props = parawerk::massProperties(id);
    val result = okObject();
    result.set("volume", props.volume);
    result.set("area", props.area);
    result.set("center", point(props.center));
    val inertia = val::array();
    for (int i = 0; i < 6; ++i) inertia.call<void>("push", props.inertia[i]);
    result.set("inertia", inertia);
    return result;
  });
}

val mesh(int id, double linear, double angular) {
  return guarded([&] { return meshResult(parawerk::mesh(id, linear, angular)); });
}

val exportMesh(int id, double linear, double angular) {
  return guarded([&] { return meshResult(parawerk::exportMesh(id, linear, angular)); });
}

val exportStep(int id) {
  return guarded([&] {
    const std::string text = parawerk::exportStep(id);
    val result = okObject();
    result.set("data", val::global("Uint8Array").new_(val(emscripten::typed_memory_view(text.size(), reinterpret_cast<const uint8_t*>(text.data())))));
    return result;
  });
}

val importStep(val bytes) {
  return guarded([&] {
    const std::vector<uint8_t> data = emscripten::convertJSArrayToNumberVector<uint8_t>(bytes);
    return idResult(parawerk::importStep(std::string(data.begin(), data.end())));
  });
}

val transformShape(int id, val transform) {
  return guarded([&] { return idResult(parawerk::transformShape(id, emscripten::convertJSArrayToNumberVector<double>(transform))); });
}

val filletVariable(int bodyId, val edgeIndices, double startRadius, double endRadius, bool swap, val edgeNames, std::string name) {
  return guarded([&] { return idResult(parawerk::filletVariable(bodyId, toIntVector(edgeIndices), startRadius, endRadius, swap, toStringVector(edgeNames), name)); });
}

val cutThread(int bodyId, int faceIndex, double pitch, double length, bool reverse, bool leftHand, std::string name) {
  return guarded([&] { return idResult(parawerk::cutThread(bodyId, faceIndex, pitch, length, reverse, leftHand, name)); });
}

val sweepProfile(val profile, val frame, val path, val pathFrame, val edgeNames, std::string name) {
  return guarded([&] {
    const auto numbers = [](const val& array) { return emscripten::convertJSArrayToNumberVector<double>(array); };
    return idResult(parawerk::sweepProfile(numbers(profile), numbers(frame), numbers(path), numbers(pathFrame), toStringVector(edgeNames), name));
  });
}

val sweepAlongHelix(val profile, val frame, val helix, val edgeNames, std::string name) {
  return guarded([&] {
    const auto numbers = [](const val& array) { return emscripten::convertJSArrayToNumberVector<double>(array); };
    return idResult(parawerk::sweepAlongHelix(numbers(profile), numbers(frame), numbers(helix), toStringVector(edgeNames), name));
  });
}

val loftProfiles(val sections, bool ruled, val edgeNames, std::string name) {
  return guarded([&] { return idResult(parawerk::loftProfiles(emscripten::convertJSArrayToNumberVector<double>(sections), ruled, toStringVector(edgeNames), name)); });
}

val draftFaces(int bodyId, val faceIndices, val plane, double angle, std::string name) {
  return guarded([&] { return idResult(parawerk::draftFaces(bodyId, toIntVector(faceIndices), emscripten::convertJSArrayToNumberVector<double>(plane), angle, name)); });
}

val faceFillet(int bodyId, int faceA, int faceB, double radius, std::string name) {
  return guarded([&] { return idResult(parawerk::faceFillet(bodyId, faceA, faceB, radius, name)); });
}

val fullRound(int bodyId, int side1, int center, int side2, std::string name) {
  return guarded([&] { return idResult(parawerk::fullRound(bodyId, side1, center, side2, name)); });
}

val limitToNext(int toolId, int bodyId, int op, val direction, bool reversed, std::string name) {
  return guarded([&] {
    return idResult(parawerk::limitToNext(toolId, bodyId, op, emscripten::convertJSArrayToNumberVector<double>(direction), reversed, name));
  });
}

val limitBySurface(int toolId, int bodyId, int faceIndex, val direction, double offset, bool reversed, std::string name) {
  return guarded([&] {
    return idResult(parawerk::limitBySurface(toolId, bodyId, faceIndex, emscripten::convertJSArrayToNumberVector<double>(direction), offset, reversed, name));
  });
}

val draftSides(int toolId, val frame, double angle, std::string name) {
  return guarded([&] { return idResult(parawerk::draftSides(toolId, emscripten::convertJSArrayToNumberVector<double>(frame), angle, name)); });
}

/** A STEP file as text (ISO 10303-21 is ASCII), with the name its faces are named after. */
val importStepText(const std::string& text, const std::string& name) {
  return guarded([&] { return idResult(parawerk::importStep(text, name)); });
}

std::string version() { return "parawerk-kernel 0.18 / OCCT " PARAWERK_OCCT_VERSION; }

}  // namespace

EMSCRIPTEN_BINDINGS(parawerk_kernel) {
  emscripten::function("version", &version);
  emscripten::function("makeBox", &makeBox);
  emscripten::function("makeCylinder", &makeCylinder);
  emscripten::function("booleanOperation", &booleanOperation);
  emscripten::function("extrudeProfile", &extrudeProfile);
  emscripten::function("revolveProfile", &revolveProfile);
  emscripten::function("cutHoles", &cutHoles);
  emscripten::function("combineCopies", &combineCopies);
  emscripten::function("shell", &shell);
  emscripten::function("trimByPlane", &trimByPlane);
  emscripten::function("fillet", &fillet);
  emscripten::function("chamfer", &chamfer);
  emscripten::function("chamferUneven", &chamferUneven);
  emscripten::function("release", &parawerk::release);
  emscripten::function("shapeCount", &parawerk::shapeCount);
  emscripten::function("naming", &naming);
  emscripten::function("faceGeometry", &faceGeometry);
  emscripten::function("edgeGeometry", &edgeGeometry);
  emscripten::function("distance", &distance);
  emscripten::function("counts", &counts);
  emscripten::function("boundingBox", &boundingBox);
  emscripten::function("massProperties", &massProperties);
  emscripten::function("mesh", &mesh);
  emscripten::function("exportMesh", &exportMesh);
  emscripten::function("exportStep", &exportStep);
  emscripten::function("importStep", &importStep);
  emscripten::function("importStepText", &importStepText);
  emscripten::function("draftSides", &draftSides);
  emscripten::function("limitToNext", &limitToNext);
  emscripten::function("transformShape", &transformShape);
  emscripten::function("fullRound", &fullRound);
  emscripten::function("faceFillet", &faceFillet);
  emscripten::function("draftFaces", &draftFaces);
  emscripten::function("sweepProfile", &sweepProfile);
  emscripten::function("loftProfiles", &loftProfiles);
  emscripten::function("filletVariable", &filletVariable);
  emscripten::function("cutThread", &cutThread);
  emscripten::function("sweepAlongHelix", &sweepAlongHelix);
  emscripten::function("limitBySurface", &limitBySurface);
}
