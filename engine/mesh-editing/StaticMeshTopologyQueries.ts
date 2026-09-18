import type { StaticMeshAsset } from '@/types';
import { meshEdgeKey } from '@/engine/MeshEdgeGeometry';
import { getMeshConnectivity } from '@/engine/mesh-editing/MeshConnectivity';

export type StaticMeshFaceKind = 'TRIANGLE' | 'QUAD' | 'NGON' | 'DEGENERATE';
export type StaticMeshTopologyTraceTermination =
  | 'BOUNDARY'
  | 'NON_QUAD'
  | 'BRANCH'
  | 'CYCLE'
  | 'INVALID_TOPOLOGY'
  | 'MAX_STEPS';

export interface StaticMeshTopologyEdgeInfo {
  id: string;
  vertexIds: [number, number];
  canonicalVertexIds: [number, number];
  constructionPointIds?: [string, string];
}

export interface StaticMeshTopologyFaceInfo {
  faceId: number;
  kind: StaticMeshFaceKind;
  vertexIds: number[];
  canonicalVertexIds: number[];
  edges: StaticMeshTopologyEdgeInfo[];
  adjacentFaceIds: number[];
  constructionFaceId?: string;
  constructionPointIds?: string[];
}

export interface StaticMeshOppositeEdgeResult {
  faceId: number;
  sourceEdge: StaticMeshTopologyEdgeInfo;
  oppositeEdge: StaticMeshTopologyEdgeInfo;
}

export interface StaticMeshEdgeRingTraceResult {
  seedEdge: StaticMeshTopologyEdgeInfo;
  edges: StaticMeshTopologyEdgeInfo[];
  edgeIds: string[];
  faceIds: number[];
  constructionFaceIds: string[];
  closed: boolean;
  startTermination: StaticMeshTopologyTraceTermination;
  endTermination: StaticMeshTopologyTraceTermination;
}

const vertexCountFor = (asset: StaticMeshAsset) => Math.floor(asset.geometry.vertices.length / 3);

const faceKind = (vertexCount: number): StaticMeshFaceKind => {
  if (vertexCount < 3) return 'DEGENERATE';
  if (vertexCount === 3) return 'TRIANGLE';
  if (vertexCount === 4) return 'QUAD';
  return 'NGON';
};

const constructionPointIdForCanonical = (
  asset: StaticMeshAsset,
  canonicalVertexId: number,
  canonicalVertex: Int32Array,
): string | undefined => {
  const points = asset.construction?.points ?? [];
  return points.find(point => (point.vertexIds ?? []).some(vertexId => (
    vertexId >= 0
    && vertexId < canonicalVertex.length
    && canonicalVertex[vertexId] === canonicalVertexId
  )))?.id;
};

const edgeInfo = (
  asset: StaticMeshAsset,
  a: number,
  b: number,
): StaticMeshTopologyEdgeInfo | null => {
  const vertexCount = vertexCountFor(asset);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= vertexCount || b >= vertexCount || a === b) {
    return null;
  }
  const connectivity = getMeshConnectivity(asset.topology, vertexCount);
  const ca = connectivity.canonicalVertex[a];
  const cb = connectivity.canonicalVertex[b];
  if (ca === cb) return null;
  const pointA = constructionPointIdForCanonical(asset, ca, connectivity.canonicalVertex);
  const pointB = constructionPointIdForCanonical(asset, cb, connectivity.canonicalVertex);
  return {
    id: meshEdgeKey(a, b),
    vertexIds: [a, b],
    canonicalVertexIds: [ca, cb],
    constructionPointIds: pointA && pointB && pointA !== pointB ? [pointA, pointB] : undefined,
  };
};

const canonicalEdgeKeyFor = (asset: StaticMeshAsset, a: number, b: number): string | null => {
  const vertexCount = vertexCountFor(asset);
  if (a < 0 || b < 0 || a >= vertexCount || b >= vertexCount || a === b) return null;
  const connectivity = getMeshConnectivity(asset.topology, vertexCount);
  const ca = connectivity.canonicalVertex[a];
  const cb = connectivity.canonicalVertex[b];
  if (ca === cb) return null;
  return meshEdgeKey(ca, cb);
};

const findFaceBoundaryEdgeIndex = (
  asset: StaticMeshAsset,
  faceId: number,
  a: number,
  b: number,
): number => {
  const face = asset.topology.faces[faceId];
  if (!face || face.length < 2) return -1;
  const requestedKey = canonicalEdgeKeyFor(asset, a, b);
  if (!requestedKey) return -1;
  for (let index = 0; index < face.length; index += 1) {
    const edgeKey = canonicalEdgeKeyFor(asset, face[index], face[(index + 1) % face.length]);
    if (edgeKey === requestedKey) return index;
  }
  return -1;
};

export const getStaticMeshEdgeFaceIds = (
  asset: StaticMeshAsset,
  vertexAId: number,
  vertexBId: number,
): number[] => {
  const vertexCount = vertexCountFor(asset);
  if (vertexAId < 0 || vertexBId < 0 || vertexAId >= vertexCount || vertexBId >= vertexCount) return [];
  const connectivity = getMeshConnectivity(asset.topology, vertexCount);
  const ca = connectivity.canonicalVertex[vertexAId];
  const cb = connectivity.canonicalVertex[vertexBId];
  if (ca === cb) return [];
  return [...(connectivity.edgeFacesByCanonicalEdge.get(meshEdgeKey(ca, cb)) ?? [])];
};

export const getStaticMeshFaceInfo = (
  asset: StaticMeshAsset,
  faceId: number,
): StaticMeshTopologyFaceInfo | null => {
  if (!Number.isInteger(faceId) || faceId < 0 || faceId >= asset.topology.faces.length) return null;
  const face = asset.topology.faces[faceId];
  if (!face) return null;
  const vertexCount = vertexCountFor(asset);
  const connectivity = getMeshConnectivity(asset.topology, vertexCount);
  const canonicalVertexIds = face.map(vertexId => (
    vertexId >= 0 && vertexId < vertexCount ? connectivity.canonicalVertex[vertexId] : -1
  ));
  const uniqueCanonical = new Set(canonicalVertexIds.filter(vertexId => vertexId >= 0));
  const validBoundary = uniqueCanonical.size === face.length;
  const edges: StaticMeshTopologyEdgeInfo[] = [];
  const adjacent = new Set<number>();
  for (let index = 0; index < face.length; index += 1) {
    const edge = edgeInfo(asset, face[index], face[(index + 1) % face.length]);
    if (!edge) continue;
    edges.push(edge);
    getStaticMeshEdgeFaceIds(asset, edge.vertexIds[0], edge.vertexIds[1]).forEach(candidate => {
      if (candidate !== faceId) adjacent.add(candidate);
    });
  }
  const constructionFace = asset.construction?.faces.find(faceRecord => faceRecord.faceId === faceId);
  return {
    faceId,
    kind: validBoundary ? faceKind(face.length) : 'DEGENERATE',
    vertexIds: [...face],
    canonicalVertexIds,
    edges,
    adjacentFaceIds: Array.from(adjacent).sort((a, b) => a - b),
    constructionFaceId: constructionFace?.id,
    constructionPointIds: constructionFace ? [...constructionFace.pointIds] : undefined,
  };
};

export const getStaticMeshOppositeEdge = (
  asset: StaticMeshAsset,
  faceId: number,
  vertexAId: number,
  vertexBId: number,
): StaticMeshOppositeEdgeResult | null => {
  const info = getStaticMeshFaceInfo(asset, faceId);
  if (!info || info.kind !== 'QUAD') return null;
  const edgeIndex = findFaceBoundaryEdgeIndex(asset, faceId, vertexAId, vertexBId);
  if (edgeIndex < 0) return null;
  const face = asset.topology.faces[faceId];
  const oppositeIndex = (edgeIndex + 2) % 4;
  const sourceEdge = edgeInfo(asset, face[edgeIndex], face[(edgeIndex + 1) % 4]);
  const oppositeEdge = edgeInfo(asset, face[oppositeIndex], face[(oppositeIndex + 1) % 4]);
  if (!sourceEdge || !oppositeEdge) return null;
  return { faceId, sourceEdge, oppositeEdge };
};

type RingSideResult = {
  edges: StaticMeshTopologyEdgeInfo[];
  faceIds: number[];
  termination: StaticMeshTopologyTraceTermination;
};

const walkRingSide = (
  asset: StaticMeshAsset,
  seedCanonicalEdgeKey: string,
  startEdge: [number, number],
  startFaceId: number,
  maxSteps: number,
): RingSideResult => {
  const edges: StaticMeshTopologyEdgeInfo[] = [];
  const faceIds: number[] = [];
  const visitedFaces = new Set<number>();
  let currentEdge = startEdge;
  let currentFaceId = startFaceId;

  for (let step = 0; step < maxSteps; step += 1) {
    if (visitedFaces.has(currentFaceId)) {
      return { edges, faceIds, termination: 'CYCLE' };
    }
    const faceInfo = getStaticMeshFaceInfo(asset, currentFaceId);
    if (!faceInfo) return { edges, faceIds, termination: 'INVALID_TOPOLOGY' };
    if (faceInfo.kind !== 'QUAD') return { edges, faceIds, termination: 'NON_QUAD' };

    const opposite = getStaticMeshOppositeEdge(asset, currentFaceId, currentEdge[0], currentEdge[1]);
    if (!opposite) return { edges, faceIds, termination: 'INVALID_TOPOLOGY' };

    visitedFaces.add(currentFaceId);
    faceIds.push(currentFaceId);
    const oppositeCanonicalKey = meshEdgeKey(
      opposite.oppositeEdge.canonicalVertexIds[0],
      opposite.oppositeEdge.canonicalVertexIds[1],
    );
    if (oppositeCanonicalKey === seedCanonicalEdgeKey) {
      return { edges, faceIds, termination: 'CYCLE' };
    }
    edges.push(opposite.oppositeEdge);

    const nextFaces = getStaticMeshEdgeFaceIds(
      asset,
      opposite.oppositeEdge.vertexIds[0],
      opposite.oppositeEdge.vertexIds[1],
    ).filter(faceId => faceId !== currentFaceId);
    if (nextFaces.length === 0) return { edges, faceIds, termination: 'BOUNDARY' };
    if (nextFaces.length > 1) return { edges, faceIds, termination: 'BRANCH' };
    currentEdge = opposite.oppositeEdge.vertexIds;
    currentFaceId = nextFaces[0];
  }

  return { edges, faceIds, termination: 'MAX_STEPS' };
};

const uniqueOrdered = <T,>(values: T[]): T[] => Array.from(new Set(values));

export const traceStaticMeshEdgeRing = (
  asset: StaticMeshAsset,
  vertexAId: number,
  vertexBId: number,
  requestedMaxSteps?: number,
): StaticMeshEdgeRingTraceResult => {
  const seedEdge = edgeInfo(asset, vertexAId, vertexBId);
  if (!seedEdge) {
    throw new Error('Edge Ring requires two different valid mesh vertex ids.');
  }
  const incidentFaces = getStaticMeshEdgeFaceIds(asset, vertexAId, vertexBId);
  const seedCanonicalEdgeKey = meshEdgeKey(seedEdge.canonicalVertexIds[0], seedEdge.canonicalVertexIds[1]);
  const maxSteps = Math.max(
    1,
    Math.min(
      10000,
      Number.isFinite(requestedMaxSteps) && (requestedMaxSteps ?? 0) > 0
        ? Math.floor(requestedMaxSteps!)
        : Math.max(16, asset.topology.faces.length * 2 + 4),
    ),
  );

  if (incidentFaces.length === 0) {
    return {
      seedEdge,
      edges: [seedEdge],
      edgeIds: [seedEdge.id],
      faceIds: [],
      constructionFaceIds: [],
      closed: false,
      startTermination: 'INVALID_TOPOLOGY',
      endTermination: 'INVALID_TOPOLOGY',
    };
  }
  if (incidentFaces.length > 2) {
    return {
      seedEdge,
      edges: [seedEdge],
      edgeIds: [seedEdge.id],
      faceIds: [],
      constructionFaceIds: [],
      closed: false,
      startTermination: 'BRANCH',
      endTermination: 'BRANCH',
    };
  }

  const first = walkRingSide(asset, seedCanonicalEdgeKey, seedEdge.vertexIds, incidentFaces[0], maxSteps);
  if (first.termination === 'CYCLE') {
    const edges = [seedEdge, ...first.edges];
    const faceIds = uniqueOrdered(first.faceIds);
    const constructionFaceIds = faceIds
      .map(faceId => asset.construction?.faces.find(face => face.faceId === faceId)?.id)
      .filter((id): id is string => Boolean(id));
    return {
      seedEdge,
      edges,
      edgeIds: edges.map(edge => edge.id),
      faceIds,
      constructionFaceIds,
      closed: true,
      startTermination: 'CYCLE',
      endTermination: 'CYCLE',
    };
  }

  if (incidentFaces.length === 1) {
    const edges = [seedEdge, ...first.edges];
    const faceIds = uniqueOrdered(first.faceIds);
    const constructionFaceIds = faceIds
      .map(faceId => asset.construction?.faces.find(face => face.faceId === faceId)?.id)
      .filter((id): id is string => Boolean(id));
    return {
      seedEdge,
      edges,
      edgeIds: edges.map(edge => edge.id),
      faceIds,
      constructionFaceIds,
      closed: false,
      startTermination: 'BOUNDARY',
      endTermination: first.termination,
    };
  }

  const second = walkRingSide(asset, seedCanonicalEdgeKey, seedEdge.vertexIds, incidentFaces[1], maxSteps);
  const secondEdges = [...second.edges].reverse();
  const edges = [...secondEdges, seedEdge, ...first.edges];
  const faceIds = uniqueOrdered([...second.faceIds].reverse().concat(first.faceIds));
  const constructionFaceIds = faceIds
    .map(faceId => asset.construction?.faces.find(face => face.faceId === faceId)?.id)
    .filter((id): id is string => Boolean(id));
  return {
    seedEdge,
    edges,
    edgeIds: uniqueOrdered(edges.map(edge => edge.id)),
    faceIds,
    constructionFaceIds,
    closed: false,
    startTermination: second.termination,
    endTermination: first.termination,
  };
};
