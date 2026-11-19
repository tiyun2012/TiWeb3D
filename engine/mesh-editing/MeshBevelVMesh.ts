import type { Vector3 } from '@/types';

export interface BevelVMeshIncidentFace {
  faceId: string;
  previousNeighborId: string;
  nextNeighborId: string;
}

export type BevelVMeshFaceReplacement =
  | { kind: 'EDGE_PAIR'; previousNeighborId: string; nextNeighborId: string }
  | { kind: 'EDGE'; neighborId: string }
  | { kind: 'MITER'; faceId: string; previousNeighborId: string; nextNeighborId: string };

export type BevelVMeshBoundarySlot =
  | { kind: 'EDGE'; neighborId: string }
  | { kind: 'MITER'; faceId: string; previousNeighborId: string; nextNeighborId: string };

export interface BevelVMeshCornerPlan {
  vertexId: string;
  orderedNeighborIds: string[];
  orderedFaceIds: string[];
  selectedNeighborIds: string[];
  faceReplacements: Map<string, BevelVMeshFaceReplacement>;
  boundarySlots: BevelVMeshBoundarySlot[];
  meshKind: 'NONE' | 'POLY';
}

const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Orders a closed manifold one-ring around a vertex. Each incident face is an
 * undirected link between the two neighboring vertices that meet at the center.
 * A closed manifold ring therefore gives every neighbor degree 2 and forms one
 * simple cycle.
 */
const orderClosedOneRing = (
  vertexId: string,
  incidentFaces: readonly BevelVMeshIncidentFace[],
): { neighborIds: string[]; faceIds: string[] } => {
  if (incidentFaces.length < 3) {
    throw new Error(`Bevel VMesh at vertex '${vertexId}' requires a closed manifold one-ring with at least three incident faces.`);
  }

  type Link = { to: string; faceId: string };
  const adjacency = new Map<string, Link[]>();
  const pairToFace = new Map<string, string>();
  const add = (from: string, to: string, faceId: string) => {
    const links = adjacency.get(from) ?? [];
    links.push({ to, faceId });
    adjacency.set(from, links);
  };

  for (const face of incidentFaces) {
    const a = face.previousNeighborId;
    const b = face.nextNeighborId;
    if (a === b || a === vertexId || b === vertexId) {
      throw new Error(`Bevel VMesh at vertex '${vertexId}' found a degenerate face corner.`);
    }
    const key = edgeKey(a, b);
    if (pairToFace.has(key)) {
      throw new Error(`Bevel VMesh at vertex '${vertexId}' found duplicate/non-manifold face wedges.`);
    }
    pairToFace.set(key, face.faceId);
    add(a, b, face.faceId);
    add(b, a, face.faceId);
  }

  for (const [neighborId, links] of adjacency) {
    if (links.length !== 2) {
      throw new Error(
        `Bevel VMesh at vertex '${vertexId}' requires a closed manifold one-ring; neighbor '${neighborId}' has fan degree ${links.length}.`,
      );
    }
  }

  const first = incidentFaces[0];
  const start = first.previousNeighborId;
  let previous = start;
  let current = first.nextNeighborId;
  let previousFaceId = first.faceId;
  const orderedNeighborIds = [start, current];
  const orderedFaceIds = [first.faceId];
  const usedFaces = new Set<string>([first.faceId]);
  const guardLimit = incidentFaces.length + 2;

  for (let guard = 0; guard < guardLimit; guard += 1) {
    if (current === start) break;
    const candidates = adjacency.get(current) ?? [];
    const nextLink = candidates.find(link => link.to !== previous && link.faceId !== previousFaceId)
      ?? candidates.find(link => link.to !== previous);
    if (!nextLink) {
      throw new Error(`Bevel VMesh at vertex '${vertexId}' could not continue around the one-ring.`);
    }
    if (nextLink.to === start) {
      if (usedFaces.has(nextLink.faceId)) {
        throw new Error(`Bevel VMesh at vertex '${vertexId}' repeated a face while closing the one-ring.`);
      }
      orderedFaceIds.push(nextLink.faceId);
      usedFaces.add(nextLink.faceId);
      break;
    }
    if (usedFaces.has(nextLink.faceId)) {
      throw new Error(`Bevel VMesh at vertex '${vertexId}' contains a branched/repeated face fan.`);
    }
    previous = current;
    current = nextLink.to;
    previousFaceId = nextLink.faceId;
    orderedNeighborIds.push(current);
    orderedFaceIds.push(nextLink.faceId);
    usedFaces.add(nextLink.faceId);
  }

  if (orderedFaceIds.length !== incidentFaces.length || orderedNeighborIds.length !== incidentFaces.length) {
    throw new Error(`Bevel VMesh at vertex '${vertexId}' one-ring is disconnected or non-manifold.`);
  }

  // Verify every ordered face really lies between the corresponding neighbor pair.
  for (let index = 0; index < orderedNeighborIds.length; index += 1) {
    const a = orderedNeighborIds[index];
    const b = orderedNeighborIds[(index + 1) % orderedNeighborIds.length];
    const faceId = pairToFace.get(edgeKey(a, b));
    if (!faceId || faceId !== orderedFaceIds[index]) {
      throw new Error(`Bevel VMesh at vertex '${vertexId}' could not establish a stable cyclic face order.`);
    }
  }

  return { neighborIds: orderedNeighborIds, faceIds: orderedFaceIds };
};

/**
 * Builds the segment-1 corner topology used by the normal-mesh factor bevel.
 *
 * This follows the same high-level idea as Blender's BevVert/BoundVert/VMesh:
 * the selected edges are not processed one-by-one. Instead the entire manifold
 * one-ring is classified first, one boundary point is planned for every
 * unselected incident edge, one miter point is planned for every face between
 * two selected edges, and the resulting cyclic boundary becomes the local
 * vertex patch (VMesh) when it has three or more vertices.
 */
export const buildBevelVMeshCornerPlan = (args: {
  vertexId: string;
  incidentFaces: readonly BevelVMeshIncidentFace[];
  selectedNeighborIds: ReadonlySet<string>;
}): BevelVMeshCornerPlan => {
  const { vertexId, incidentFaces, selectedNeighborIds } = args;
  if (selectedNeighborIds.size === 0) {
    throw new Error(`Bevel VMesh at vertex '${vertexId}' requires at least one selected incident edge.`);
  }

  const ordered = orderClosedOneRing(vertexId, incidentFaces);
  const orderedNeighborSet = new Set(ordered.neighborIds);
  for (const neighborId of selectedNeighborIds) {
    if (!orderedNeighborSet.has(neighborId)) {
      throw new Error(`Bevel VMesh at vertex '${vertexId}' cannot find selected neighbor '${neighborId}' in the one-ring.`);
    }
  }

  const selected = (neighborId: string): boolean => selectedNeighborIds.has(neighborId);
  const faceReplacements = new Map<string, BevelVMeshFaceReplacement>();
  const boundarySlots: BevelVMeshBoundarySlot[] = [];

  // The boundary is ordered as: edge point for each unselected incident edge,
  // followed (where applicable) by the miter in the face after that edge when
  // both bounding incident edges are selected. This cyclic order makes each
  // VMesh edge correspond to either a reconstructed source-face corner or the
  // endpoint edge of one selected bevel strip.
  for (let index = 0; index < ordered.neighborIds.length; index += 1) {
    const previousNeighborId = ordered.neighborIds[index];
    const nextNeighborId = ordered.neighborIds[(index + 1) % ordered.neighborIds.length];
    const faceId = ordered.faceIds[index];
    const previousSelected = selected(previousNeighborId);
    const nextSelected = selected(nextNeighborId);

    if (!previousSelected) {
      boundarySlots.push({ kind: 'EDGE', neighborId: previousNeighborId });
    }
    if (previousSelected && nextSelected) {
      boundarySlots.push({
        kind: 'MITER',
        faceId,
        previousNeighborId,
        nextNeighborId,
      });
    }

    if (!previousSelected && !nextSelected) {
      faceReplacements.set(faceId, {
        kind: 'EDGE_PAIR',
        previousNeighborId,
        nextNeighborId,
      });
    } else if (!previousSelected && nextSelected) {
      faceReplacements.set(faceId, { kind: 'EDGE', neighborId: previousNeighborId });
    } else if (previousSelected && !nextSelected) {
      faceReplacements.set(faceId, { kind: 'EDGE', neighborId: nextNeighborId });
    } else {
      faceReplacements.set(faceId, {
        kind: 'MITER',
        faceId,
        previousNeighborId,
        nextNeighborId,
      });
    }
  }

  if (boundarySlots.length < 2) {
    throw new Error(`Bevel VMesh at vertex '${vertexId}' could not form a usable corner boundary.`);
  }

  return {
    vertexId,
    orderedNeighborIds: ordered.neighborIds,
    orderedFaceIds: ordered.faceIds,
    selectedNeighborIds: [...selectedNeighborIds],
    faceReplacements,
    boundarySlots,
    meshKind: boundarySlots.length >= 3 ? 'POLY' : 'NONE',
  };
};

export const bevelEdgePointAtFactor = (
  center: Vector3,
  neighbor: Vector3,
  localFactor: number,
): Vector3 => ({
  x: center.x + (neighbor.x - center.x) * localFactor,
  y: center.y + (neighbor.y - center.y) * localFactor,
  z: center.z + (neighbor.z - center.z) * localFactor,
});

/**
 * Segment-1 offset meet for a face bounded by two selected edges. With a
 * normalized factor, the two offset lines are affine parallels of the original
 * incident edges, so their intersection is the sum of the two local setbacks.
 * The result stays in the local face corner plane without requiring a world-axis
 * projection.
 */
export const bevelMiterPointAtFactor = (
  center: Vector3,
  previousNeighbor: Vector3,
  nextNeighbor: Vector3,
  localFactor: number,
): Vector3 => ({
  x: center.x
    + (previousNeighbor.x - center.x) * localFactor
    + (nextNeighbor.x - center.x) * localFactor,
  y: center.y
    + (previousNeighbor.y - center.y) * localFactor
    + (nextNeighbor.y - center.y) * localFactor,
  z: center.z
    + (previousNeighbor.z - center.z) * localFactor
    + (nextNeighbor.z - center.z) * localFactor,
});
