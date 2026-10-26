import type { MeshPayload } from './protocol.ts';

export function meshTransferables(mesh: MeshPayload): ArrayBuffer[] {
  const { naming } = mesh;
  return [
    mesh.positions,
    mesh.normals,
    mesh.indices,
    mesh.faceRanges,
    mesh.edgePositions,
    mesh.edgeRanges,
    naming.facePlanes,
    naming.edgeFaces,
    naming.edgeMidpoints,
    naming.edgeVertices,
    naming.vertexPositions,
    naming.vertexFaceOffsets,
    naming.vertexFaces,
    ...(naming.faceBodies ? [naming.faceBodies] : []),
  ].map((array) => array.buffer as ArrayBuffer);
}
