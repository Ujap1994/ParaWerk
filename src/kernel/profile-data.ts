import type { Profile, ProfileEdge, ProfileLoop } from '../shared/model/profile.ts';

/** Edge kinds of the encoded profile (see extrudeProfile in native/kernel/src/core.hpp). */
const EDGE_KIND = { line: 0, arc: 1, circle: 2, ellipse: 3, bspline: 4 } as const;

function pushEdge(out: number[], edge: ProfileEdge): void {
  out.push(EDGE_KIND[edge.kind]);
  switch (edge.kind) {
    case 'line':
      out.push(...edge.from, ...edge.to);
      break;
    case 'arc':
      out.push(...edge.center, edge.radius, edge.start, edge.end, edge.ccw ? 1 : 0);
      break;
    case 'circle':
      out.push(...edge.center, edge.radius, edge.ccw ? 1 : 0);
      break;
    case 'ellipse':
      out.push(...edge.center, ...edge.axis, edge.a, edge.b, edge.ccw ? 1 : 0);
      break;
    case 'bspline':
      out.push(edge.poles.length, ...edge.poles.flat(), edge.knots.length, ...edge.knots);
      break;
  }
}

function pushLoop(out: number[], loop: ProfileLoop): void {
  out.push(loop.edges.length);
  for (const edge of loop.edges) pushEdge(out, edge);
}

/** The regions of a profile as the flat number list the kernel reads. */
export function encodeProfile(profile: Profile): number[] {
  const out: number[] = [profile.regions.length];
  for (const region of profile.regions) {
    out.push(1 + region.holes.length);
    pushLoop(out, region.outer);
    for (const hole of region.holes) pushLoop(out, hole);
  }
  return out;
}

/** One chain of edges (an outline or a path) as the kernel reads one loop: the edge count, then the edges. */
export function encodeEdges(edges: readonly ProfileEdge[]): number[] {
  const out: number[] = [edges.length];
  for (const edge of edges) pushEdge(out, edge);
  return out;
}

/** The sketch curve of every profile edge, in the order of encodeProfile: the kernel names side faces after them. */
export function profileEdgeNames(profile: Profile): string[] {
  return profile.regions.flatMap((region) => [region.outer, ...region.holes].flatMap((loop) => loop.curves));
}
