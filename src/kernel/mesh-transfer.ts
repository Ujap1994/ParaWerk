import type { MeshPayload } from './protocol.ts';

export function meshTransferables(mesh: MeshPayload): ArrayBuffer[] {
  return [mesh.positions, mesh.normals, mesh.indices, mesh.faceRanges, mesh.edgePositions, mesh.edgeRanges, mesh.naming.facePlanes, mesh.naming.edgeFaces, mesh.naming.edgeMidpoints].map(
    (array) => array.buffer as ArrayBuffer,
  );
}
