import { assetManager } from '@/engine/AssetManager';
import { assetHistory, type AssetHistoryState } from '@/engine/AssetHistory';
import { MeshTopologyUtils } from '@/engine/MeshTopologyUtils';
import { meshEdgeKey } from '@/engine/MeshEdgeGeometry';
import type {
  LogicalMesh,
  MeshGeometry,
  StaticMeshAsset,
  StaticMeshConstructionData,
  StaticMeshConstructionFace,
  StaticMeshConstructionLoop,
  StaticMeshConstructionPoint,
  StaticMeshConstructionPointRole,
  StaticMeshIdRange,
  Vector3,
} from '@/types';
import { materializeStaticMeshShell, offsetStaticMeshShell, resolveStaticMeshShells } from '@/engine/mesh-editing/StaticMeshShells';
export type { StaticMeshIdRange } from '@/types';

export interface CreateStaticMeshArgs {
  name: string;
  path?: string;
}

export interface AppendStaticMeshArgs {
  targetAssetId: string;
  sourceAssetId: string;
}

export interface AppendStaticMeshesArgs {
  targetAssetId: string;
  sourceAssetIds: string[];
}

export interface StaticMeshCompositionSource {
  id: string;
  name: string;
  path?: string;
  vertexCount: number;
  triangleCount: number;
  faceCount: number;
  shellCount: number;
}

/**
 * ID allocation used when a source mesh is appended into a target mesh.
 * Static Mesh component ids are currently dense array indices, so every
 * source-local vertex/triangle/face id maps by adding the corresponding offset.
 */
export interface StaticMeshAppendAllocation {
  sourceAssetId: string;
  vertexIdOffset: number;
  triangleIdOffset: number;
  faceIdOffset: number;
  vertexIds: StaticMeshIdRange;
  triangleIds: StaticMeshIdRange;
  faceIds: StaticMeshIdRange;
}

export interface StaticMeshAppendResult {
  targetAssetId: string;
  appendedAssetIds: string[];
  verticesAdded: number;
  trianglesAdded: number;
  allocations: StaticMeshAppendAllocation[];
}

export interface StaticMeshReferenceArgs {
  targetAssetId: string;
  sourceAssetIds: string[];
}

export interface AddConstructionPointArgs {
  assetId: string;
  id?: string;
  position: Vector3;
  name?: string;
  role?: StaticMeshConstructionPointRole;
  groupId?: string;
  tags?: string[];
  data?: Record<string, string | number | boolean | null>;
}

export interface MoveConstructionPointArgs {
  assetId: string;
  pointId: string;
  position: Vector3;
}

export interface RemoveConstructionPointArgs {
  assetId: string;
  pointId: string;
}

export interface CreateConstructionFaceArgs {
  assetId: string;
  pointIds: string[];
  id?: string;
  name?: string;
}

export interface CreateConstructionLoopArgs {
  assetId: string;
  pointIds: string[];
  id?: string;
  name?: string;
  closed?: boolean;
}

export interface ExtrudeConstructionFaceArgs {
  assetId: string;
  faceId: string;
  distance: number;
  direction?: Vector3;
  id?: string;
}

export interface BridgeConstructionLoopsArgs {
  assetId: string;
  loopAId: string;
  loopBId: string;
  id?: string;
}

export interface InsetConstructionFaceArgs {
  assetId: string;
  faceId: string;
  /** World-space inset distance measured in the face plane. Must be positive. */
  amount: number;
  id?: string;
}

export interface DeleteConstructionFaceArgs {
  assetId: string;
  /** Stable semantic Construction Face id, not the numeric logical face index. */
  faceId: string;
}

export interface SplitConstructionEdgeArgs {
  assetId: string;
  /** Stable semantic endpoint ids. Raw mesh vertex ids are intentionally not part of the AI-facing contract. */
  pointAId: string;
  pointBId: string;
  /** Position along A -> B. Must stay strictly between 0 and 1. Defaults to 0.5. */
  t?: number;
  /** Optional stable operation prefix used for generated semantic ids. */
  id?: string;
}

export interface ConstructionFaceResult {
  id: string;
  assetId: string;
  pointIds: string[];
  faceId: number;
  vertexIds: number[];
  triangleIds: number[];
}

export interface ExtrudeConstructionFaceResult {
  id: string;
  sourceFaceId: string;
  topFaceId: string;
  topLoopId: string;
  topPointIds: string[];
  sideFaceIds: string[];
}

export interface BridgeConstructionLoopsResult {
  id: string;
  loopAId: string;
  loopBId: string;
  faceIds: string[];
}

export interface InsetConstructionFaceResult {
  id: string;
  /** The input semantic face remains stable and becomes the inset/inner face. */
  sourceFaceId: string;
  innerFaceId: string;
  innerLoopId: string;
  innerPointIds: string[];
  borderFaceIds: string[];
}

export interface DeleteConstructionFaceResult {
  id: string;
  deletedLogicalFaceId: number;
  pointIds: string[];
  vertexIds: number[];
  triangleIds: number[];
}

export interface SplitConstructionEdgeResult {
  id: string;
  sourcePointIds: [string, string];
  pointId: string;
  vertexId: number;
  updatedFaceIds: string[];
  updatedLoopIds: string[];
  edgeIds: [string, string];
  t: number;
}

const unique = (ids: Iterable<string>) => Array.from(new Set(ids));

const computeAABB = (vertices: Float32Array) => {
  if (vertices.length === 0) {
    return {
      min: { x: 0, y: 0, z: 0 },
      max: { x: 0, y: 0, z: 0 },
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i];
    const y = vertices[i + 1];
    const z = vertices[i + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
};

const appendFloatAttribute = (
  target: Float32Array | undefined,
  targetVertexCount: number,
  source: Float32Array | undefined,
  sourceVertexCount: number,
  components: number,
  defaultValue: number,
): Float32Array => {
  const out = new Float32Array((targetVertexCount + sourceVertexCount) * components);

  if (target && target.length >= targetVertexCount * components) {
    out.set(target.subarray(0, targetVertexCount * components), 0);
  } else if (defaultValue !== 0 && targetVertexCount > 0) {
    out.fill(defaultValue, 0, targetVertexCount * components);
  }

  const sourceOffset = targetVertexCount * components;
  if (source && source.length >= sourceVertexCount * components) {
    out.set(source.subarray(0, sourceVertexCount * components), sourceOffset);
  } else if (defaultValue !== 0 && sourceVertexCount > 0) {
    out.fill(defaultValue, sourceOffset, sourceOffset + sourceVertexCount * components);
  }

  return out;
};

const copySiblingGroups = (
  destination: Map<number, number[]>,
  source: Map<number, number[]> | undefined,
  vertexOffset: number,
) => {
  if (!source) return;
  source.forEach((group, vertexId) => {
    destination.set(vertexId + vertexOffset, group.map(id => id + vertexOffset));
  });
};

const rebuildVertexToFaces = (
  faces: number[][],
  siblings: Map<number, number[]> | undefined,
): Map<number, number[]> => {
  const result = new Map<number, number[]>();
  const addFace = (vertexId: number, faceId: number) => {
    let entries = result.get(vertexId);
    if (!entries) {
      entries = [];
      result.set(vertexId, entries);
    }
    if (!entries.includes(faceId)) entries.push(faceId);
  };

  faces.forEach((face, faceId) => {
    face.forEach(vertexId => {
      addFace(vertexId, faceId);
      siblings?.get(vertexId)?.forEach(siblingId => addFace(siblingId, faceId));
    });
  });

  return result;
};

const sourceFaces = (asset: StaticMeshAsset): number[][] => {
  if (asset.topology?.faces?.length) return asset.topology.faces.map(face => [...face]);
  const result: number[][] = [];
  for (let i = 0; i + 2 < asset.geometry.indices.length; i += 3) {
    result.push([
      asset.geometry.indices[i],
      asset.geometry.indices[i + 1],
      asset.geometry.indices[i + 2],
    ]);
  }
  return result;
};

const sourceTriangleToFace = (asset: StaticMeshAsset, faceCount: number): Int32Array => {
  const triangleCount = Math.floor(asset.geometry.indices.length / 3);
  const existing = asset.topology?.triangleToFaceIndex;
  if (existing && existing.length === triangleCount) return new Int32Array(existing);

  const mapping = new Int32Array(triangleCount);
  for (let i = 0; i < triangleCount; i += 1) mapping[i] = Math.min(i, Math.max(0, faceCount - 1));
  return mapping;
};

const requireStaticMesh = (assetId: string, role: 'target' | 'source'): StaticMeshAsset => {
  const asset = assetManager.getAsset(assetId);
  if (!asset || asset.type !== 'MESH') {
    throw new Error(`Static Mesh ${role} '${assetId}' was not found.`);
  }
  return asset as StaticMeshAsset;
};

const compositionSourceDescriptor = (asset: StaticMeshAsset): StaticMeshCompositionSource => ({
  id: asset.id,
  name: asset.name,
  path: asset.path,
  vertexCount: Math.floor(asset.geometry.vertices.length / 3),
  triangleCount: Math.floor(asset.geometry.indices.length / 3),
  faceCount: sourceFaces(asset).length,
  shellCount: resolveStaticMeshShells(asset).length,
});

const makeAppendAllocation = (
  source: StaticMeshAsset,
  vertexIdOffset: number,
  triangleIdOffset: number,
  faceIdOffset: number,
): StaticMeshAppendAllocation => {
  const vertexCount = Math.floor(source.geometry.vertices.length / 3);
  const triangleCount = Math.floor(source.geometry.indices.length / 3);
  const faceCount = sourceFaces(source).length;
  return {
    sourceAssetId: source.id,
    vertexIdOffset,
    triangleIdOffset,
    faceIdOffset,
    vertexIds: { start: vertexIdOffset, endExclusive: vertexIdOffset + vertexCount },
    triangleIds: { start: triangleIdOffset, endExclusive: triangleIdOffset + triangleCount },
    faceIds: { start: faceIdOffset, endExclusive: faceIdOffset + faceCount },
  };
};


const clonePosition = (position: Vector3): Vector3 => ({ x: position.x, y: position.y, z: position.z });

const assertFinitePosition = (position: Vector3, label: string): void => {
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new Error(`${label} must contain finite x/y/z coordinates.`);
  }
};

const cloneConstructionPoint = (point: StaticMeshConstructionPoint): StaticMeshConstructionPoint => ({
  ...point,
  position: clonePosition(point.position),
  tags: point.tags ? [...point.tags] : undefined,
  data: point.data ? { ...point.data } : undefined,
  vertexIds: point.vertexIds ? [...point.vertexIds] : undefined,
});

const cloneConstruction = (asset: StaticMeshAsset): StaticMeshConstructionData => ({
  points: (asset.construction?.points ?? []).map(cloneConstructionPoint),
  faces: (asset.construction?.faces ?? []).map(face => ({ ...face, pointIds: [...face.pointIds] })),
  loops: (asset.construction?.loops ?? []).map(loop => ({ ...loop, pointIds: [...loop.pointIds] })),
});

const makeUniqueConstructionId = (preferred: string | undefined, prefix: string, used: Iterable<string>): string => {
  const taken = new Set(used);
  if (preferred) {
    if (taken.has(preferred)) throw new Error(`Construction id '${preferred}' already exists.`);
    return preferred;
  }
  let index = 1;
  while (taken.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
};

const makeUniqueOperationId = (preferred: string | undefined, prefix: string, used: Iterable<string>): string => {
  const taken = Array.from(used);
  const collides = (candidate: string) => taken.some(id => id === candidate || id.startsWith(`${candidate}.`));
  if (preferred) {
    if (collides(preferred)) throw new Error(`Construction operation id '${preferred}' already exists.`);
    return preferred;
  }
  let index = 1;
  while (collides(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
};

const findConstructionPoint = (construction: StaticMeshConstructionData, pointId: string): StaticMeshConstructionPoint => {
  const point = construction.points.find(candidate => candidate.id === pointId);
  if (!point) throw new Error(`Construction Point '${pointId}' was not found.`);
  return point;
};

const findConstructionFace = (construction: StaticMeshConstructionData, faceId: string): StaticMeshConstructionFace => {
  const face = construction.faces.find(candidate => candidate.id === faceId);
  if (!face) throw new Error(`Construction Face '${faceId}' was not found.`);
  return face;
};

const findConstructionLoop = (construction: StaticMeshConstructionData, loopId: string): StaticMeshConstructionLoop => {
  const loop = construction.loops.find(candidate => candidate.id === loopId);
  if (!loop) throw new Error(`Construction Loop '${loopId}' was not found.`);
  return loop;
};

const findBoundaryEdgeIndex = (
  pointIds: readonly string[],
  pointAId: string,
  pointBId: string,
  closed: boolean,
): number => {
  const segmentCount = closed ? pointIds.length : Math.max(0, pointIds.length - 1);
  for (let index = 0; index < segmentCount; index += 1) {
    const nextIndex = (index + 1) % pointIds.length;
    const a = pointIds[index];
    const b = pointIds[nextIndex];
    if ((a === pointAId && b === pointBId) || (a === pointBId && b === pointAId)) return index;
  }
  return -1;
};

const insertPointOnBoundaryEdge = (
  pointIds: readonly string[],
  pointAId: string,
  pointBId: string,
  newPointId: string,
  closed: boolean,
): string[] | null => {
  const edgeIndex = findBoundaryEdgeIndex(pointIds, pointAId, pointBId, closed);
  if (edgeIndex < 0) return null;
  const result = [...pointIds];
  result.splice(edgeIndex + 1, 0, newPointId);
  return result;
};

type ConstructionMutationState = {
  asset: StaticMeshAsset;
  construction: StaticMeshConstructionData;
  vertices: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
  faces: number[][];
  triangleToFace: number[];
  siblings: Map<number, number[]>;
};

const createConstructionMutationState = (asset: StaticMeshAsset): ConstructionMutationState => {
  const vertexCount = Math.floor(asset.geometry.vertices.length / 3);
  const uvs = Array.from(asset.geometry.uvs ?? []);
  while (uvs.length < vertexCount * 2) uvs.push(0);
  const colors = Array.from(asset.geometry.colors ?? []);
  while (colors.length < vertexCount * 3) colors.push(1);
  const faces = sourceFaces(asset);
  const siblings = new Map<number, number[]>();
  copySiblingGroups(siblings, asset.topology?.siblings, 0);
  return {
    asset,
    construction: cloneConstruction(asset),
    vertices: Array.from(asset.geometry.vertices),
    uvs,
    colors,
    indices: Array.from(asset.geometry.indices),
    faces,
    triangleToFace: Array.from(sourceTriangleToFace(asset, faces.length)),
    siblings,
  };
};

const computeVertexNormals = (vertices: readonly number[], indices: readonly number[]): Float32Array => {
  const normals = new Float32Array(vertices.length);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const ia = indices[i] * 3;
    const ib = indices[i + 1] * 3;
    const ic = indices[i + 2] * 3;
    if (ic + 2 >= vertices.length || ib + 2 >= vertices.length || ia + 2 >= vertices.length) continue;
    const abx = vertices[ib] - vertices[ia];
    const aby = vertices[ib + 1] - vertices[ia + 1];
    const abz = vertices[ib + 2] - vertices[ia + 2];
    const acx = vertices[ic] - vertices[ia];
    const acy = vertices[ic + 1] - vertices[ia + 1];
    const acz = vertices[ic + 2] - vertices[ia + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[ia] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
    normals[ib] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
    normals[ic] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (length > 1e-8) {
      normals[i] /= length;
      normals[i + 1] /= length;
      normals[i + 2] /= length;
    }
  }
  return normals;
};

const ensurePointVertex = (state: ConstructionMutationState, pointId: string): number => {
  const point = findConstructionPoint(state.construction, pointId);
  const vertexCount = Math.floor(state.vertices.length / 3);
  const existing = point.vertexIds?.find(vertexId => Number.isInteger(vertexId) && vertexId >= 0 && vertexId < vertexCount);
  if (existing !== undefined) return existing;

  const vertexId = vertexCount;
  state.vertices.push(point.position.x, point.position.y, point.position.z);
  state.uvs.push(0, 0);
  state.colors.push(1, 1, 1);
  point.vertexIds = [...(point.vertexIds ?? []).filter(id => id >= 0 && id < vertexCount), vertexId];
  return vertexId;
};

const triangleAreaSquared = (state: ConstructionMutationState, a: number, b: number, c: number): number => {
  const ax = state.vertices[a * 3];
  const ay = state.vertices[a * 3 + 1];
  const az = state.vertices[a * 3 + 2];
  const abx = state.vertices[b * 3] - ax;
  const aby = state.vertices[b * 3 + 1] - ay;
  const abz = state.vertices[b * 3 + 2] - az;
  const acx = state.vertices[c * 3] - ax;
  const acy = state.vertices[c * 3 + 1] - ay;
  const acz = state.vertices[c * 3 + 2] - az;
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  return cx * cx + cy * cy + cz * cz;
};

/**
 * Triangulates the current ordered convex Construction Face boundary while
 * tolerating collinear boundary points introduced by Split Edge. Preserve the
 * historical vertex-0 fan whenever it is non-degenerate; otherwise rotate the
 * fan root, then fall back to convex ear clipping for repeated split points.
 */
const triangulateConstructionBoundary = (
  state: ConstructionMutationState,
  vertexIds: readonly number[],
): number[] => {
  if (vertexIds.length < 3) throw new Error('A Construction Face requires at least 3 vertices.');
  const epsilonSq = 1e-20;

  const fanForRoot = (rootIndex: number): number[] | null => {
    const ordered = Array.from({ length: vertexIds.length }, (_, offset) => vertexIds[(rootIndex + offset) % vertexIds.length]);
    const triangles: number[] = [];
    for (let i = 1; i < ordered.length - 1; i += 1) {
      if (triangleAreaSquared(state, ordered[0], ordered[i], ordered[i + 1]) <= epsilonSq) return null;
      triangles.push(ordered[0], ordered[i], ordered[i + 1]);
    }
    return triangles;
  };

  for (let rootIndex = 0; rootIndex < vertexIds.length; rootIndex += 1) {
    const fan = fanForRoot(rootIndex);
    if (fan) return fan;
  }

  const remaining = vertexIds.map((_, index) => index);
  const triangles: number[] = [];
  while (remaining.length > 3) {
    let earPosition = -1;
    for (let position = 0; position < remaining.length; position += 1) {
      const prev = remaining[(position - 1 + remaining.length) % remaining.length];
      const current = remaining[position];
      const next = remaining[(position + 1) % remaining.length];
      if (triangleAreaSquared(state, vertexIds[prev], vertexIds[current], vertexIds[next]) > epsilonSq) {
        earPosition = position;
        triangles.push(vertexIds[prev], vertexIds[current], vertexIds[next]);
        break;
      }
    }
    if (earPosition < 0) throw new Error('Construction Face triangulation is degenerate.');
    remaining.splice(earPosition, 1);
  }

  const [a, b, c] = remaining.map(index => vertexIds[index]);
  if (triangleAreaSquared(state, a, b, c) <= epsilonSq) {
    throw new Error('Construction Face triangulation is degenerate.');
  }
  triangles.push(a, b, c);
  return triangles;
};

const addConstructionFaceToState = (
  state: ConstructionMutationState,
  args: { pointIds: string[]; id?: string; name?: string },
): ConstructionFaceResult => {
  const pointIds = [...args.pointIds];
  if (pointIds.length < 3) throw new Error('A Construction Face requires at least 3 points.');
  if (new Set(pointIds).size !== pointIds.length) throw new Error('A Construction Face cannot repeat a point id.');
  pointIds.forEach(pointId => findConstructionPoint(state.construction, pointId));

  const faceHandleId = makeUniqueConstructionId(
    args.id,
    'face',
    state.construction.faces.map(face => face.id),
  );
  const vertexIds = pointIds.map(pointId => ensurePointVertex(state, pointId));
  if (new Set(vertexIds).size !== vertexIds.length) {
    throw new Error('Construction Face points resolve to duplicate mesh vertices.');
  }

  const faceId = state.faces.length;
  const triangleStart = Math.floor(state.indices.length / 3);
  const triangles = triangulateConstructionBoundary(state, vertexIds);
  state.faces.push(vertexIds);
  for (let i = 0; i < triangles.length; i += 3) {
    state.indices.push(triangles[i], triangles[i + 1], triangles[i + 2]);
    state.triangleToFace.push(faceId);
  }
  const triangleEnd = Math.floor(state.indices.length / 3);
  state.construction.faces.push({ id: faceHandleId, pointIds, faceId, name: args.name });

  const triangleIds: number[] = [];
  for (let triangleId = triangleStart; triangleId < triangleEnd; triangleId += 1) triangleIds.push(triangleId);
  return {
    id: faceHandleId,
    assetId: state.asset.id,
    pointIds,
    faceId,
    vertexIds,
    triangleIds,
  };
};

const deleteConstructionFaceFromState = (
  state: ConstructionMutationState,
  face: StaticMeshConstructionFace,
): DeleteConstructionFaceResult => {
  const deletedLogicalFaceId = face.faceId;
  if (!Number.isInteger(deletedLogicalFaceId) || deletedLogicalFaceId < 0 || deletedLogicalFaceId >= state.faces.length) {
    throw new Error(`Construction Face '${face.id}' has an invalid logical face mapping.`);
  }

  const pointIds = [...face.pointIds];
  const vertexIds = [...state.faces[deletedLogicalFaceId]];
  const triangleIds: number[] = [];
  const nextIndices: number[] = [];
  const nextTriangleToFace: number[] = [];
  const triangleCount = Math.floor(state.indices.length / 3);

  for (let triangleId = 0; triangleId < triangleCount; triangleId += 1) {
    const mappedFaceId = state.triangleToFace[triangleId] ?? -1;
    if (mappedFaceId === deletedLogicalFaceId) {
      triangleIds.push(triangleId);
      continue;
    }
    const offset = triangleId * 3;
    nextIndices.push(state.indices[offset], state.indices[offset + 1], state.indices[offset + 2]);
    nextTriangleToFace.push(mappedFaceId > deletedLogicalFaceId ? mappedFaceId - 1 : mappedFaceId);
  }

  state.indices = nextIndices;
  state.triangleToFace = nextTriangleToFace;
  state.faces.splice(deletedLogicalFaceId, 1);
  state.construction.faces = state.construction.faces
    .filter(candidate => candidate.id !== face.id)
    .map(candidate => ({
      ...candidate,
      pointIds: [...candidate.pointIds],
      faceId: candidate.faceId > deletedLogicalFaceId ? candidate.faceId - 1 : candidate.faceId,
    }));

  return {
    id: face.id,
    deletedLogicalFaceId,
    pointIds,
    vertexIds,
    triangleIds,
  };
};

type Vec2 = { x: number; y: number };

const cross2 = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
const subtract2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/**
 * Replaces the compiled boundary/triangulation of one existing Construction Face
 * without changing its stable semantic id or logical face id. This is the key
 * primitive for operations such as inset where the selected face survives as the
 * new inner face instead of being deleted and rediscovered by numeric ids.
 */
const replaceConstructionFaceBoundaryInState = (
  state: ConstructionMutationState,
  face: StaticMeshConstructionFace,
  pointIds: string[],
): ConstructionFaceResult => {
  if (pointIds.length < 3) throw new Error('A Construction Face requires at least 3 points.');
  if (new Set(pointIds).size !== pointIds.length) throw new Error('A Construction Face cannot repeat a point id.');
  pointIds.forEach(pointId => findConstructionPoint(state.construction, pointId));

  if (!Number.isInteger(face.faceId) || face.faceId < 0 || face.faceId >= state.faces.length) {
    throw new Error(`Construction Face '${face.id}' has an invalid logical face mapping.`);
  }

  const vertexIds = pointIds.map(pointId => ensurePointVertex(state, pointId));
  if (new Set(vertexIds).size !== vertexIds.length) {
    throw new Error('Construction Face points resolve to duplicate mesh vertices.');
  }

  state.faces[face.faceId] = vertexIds;
  face.pointIds = [...pointIds];

  const previousIndices = state.indices;
  const previousTriangleToFace = state.triangleToFace;
  const nextIndices: number[] = [];
  const nextTriangleToFace: number[] = [];
  let inserted = false;
  let triangleStart = -1;

  const replacementTriangles = triangulateConstructionBoundary(state, vertexIds);
  const appendReplacement = () => {
    if (inserted) return;
    inserted = true;
    triangleStart = Math.floor(nextIndices.length / 3);
    for (let i = 0; i < replacementTriangles.length; i += 3) {
      nextIndices.push(replacementTriangles[i], replacementTriangles[i + 1], replacementTriangles[i + 2]);
      nextTriangleToFace.push(face.faceId);
    }
  };

  const triangleCount = Math.floor(previousIndices.length / 3);
  for (let triangleId = 0; triangleId < triangleCount; triangleId += 1) {
    const mappedFaceId = previousTriangleToFace[triangleId] ?? -1;
    if (mappedFaceId === face.faceId) {
      appendReplacement();
      continue;
    }
    const offset = triangleId * 3;
    nextIndices.push(previousIndices[offset], previousIndices[offset + 1], previousIndices[offset + 2]);
    nextTriangleToFace.push(mappedFaceId);
  }
  appendReplacement();

  state.indices = nextIndices;
  state.triangleToFace = nextTriangleToFace;

  const triangleEnd = Math.floor(nextIndices.length / 3);
  const triangleIds: number[] = [];
  const replacementTriangleCount = replacementTriangles.length / 3;
  for (let triangleId = triangleStart; triangleId < triangleStart + replacementTriangleCount && triangleId < triangleEnd; triangleId += 1) {
    triangleIds.push(triangleId);
  }

  return {
    id: face.id,
    assetId: state.asset.id,
    pointIds: [...pointIds],
    faceId: face.faceId,
    vertexIds,
    triangleIds,
  };
};

const dot3 = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const subtract3 = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross3 = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/**
 * Computes a constant-width planar inset for the currently supported polygon
 * contract: ordered, planar, non-self-intersecting convex faces. The calculation
 * happens in a local 2D basis and is lifted back into the original face plane.
 */
const computeInsetPositions = (
  construction: StaticMeshConstructionData,
  pointIds: readonly string[],
  amount: number,
): Vector3[] => {
  if (!Number.isFinite(amount) || amount <= 1e-8) {
    throw new Error('Inset amount must be a finite positive number.');
  }
  if (pointIds.length < 3) throw new Error('Inset requires a face with at least 3 points.');

  const positions = pointIds.map(pointId => clonePosition(findConstructionPoint(construction, pointId).position));
  const normal = computeConstructionFaceNormal(construction, pointIds);
  const origin = positions[0];

  let u: Vector3 | null = null;
  for (let i = 1; i < positions.length; i += 1) {
    const edge = subtract3(positions[i], origin);
    const length = Math.hypot(edge.x, edge.y, edge.z);
    if (length > 1e-8) {
      u = { x: edge.x / length, y: edge.y / length, z: edge.z / length };
      break;
    }
  }
  if (!u) throw new Error('Inset face has no valid edge direction.');
  const vRaw = cross3(normal, u);
  const vLength = Math.hypot(vRaw.x, vRaw.y, vRaw.z);
  if (vLength <= 1e-8) throw new Error('Inset face basis is degenerate.');
  const v = { x: vRaw.x / vLength, y: vRaw.y / vLength, z: vRaw.z / vLength };

  const projected: Vec2[] = positions.map(position => {
    const delta = subtract3(position, origin);
    return { x: dot3(delta, u!), y: dot3(delta, v) };
  });

  const extent = projected.reduce((max, point) => Math.max(max, Math.abs(point.x), Math.abs(point.y)), 1);
  const planeTolerance = Math.max(1e-6, extent * 1e-6);
  for (const position of positions) {
    const planeDistance = Math.abs(dot3(subtract3(position, origin), normal));
    if (planeDistance > planeTolerance) {
      throw new Error('Inset currently requires a planar Construction Face.');
    }
  }

  let twiceArea = 0;
  for (let i = 0; i < projected.length; i += 1) {
    const next = projected[(i + 1) % projected.length];
    twiceArea += cross2(projected[i], next);
  }
  if (Math.abs(twiceArea) <= 1e-10) throw new Error('Inset face area is degenerate.');
  const orientation = twiceArea > 0 ? 1 : -1;

  // Keep the first inset implementation deterministic by enforcing the same
  // convex-polygon contract already documented for createFaceFromPoints().
  for (let i = 0; i < projected.length; i += 1) {
    const a = projected[i];
    const b = projected[(i + 1) % projected.length];
    const c = projected[(i + 2) % projected.length];
    const turn = cross2(subtract2(b, a), subtract2(c, b)) * orientation;
    if (turn < -1e-8) throw new Error('Inset currently supports convex Construction Faces only.');
  }

  const offsetLines = projected.map((point, index) => {
    const next = projected[(index + 1) % projected.length];
    const edge = subtract2(next, point);
    const length = Math.hypot(edge.x, edge.y);
    if (length <= 1e-8) throw new Error('Inset face contains a zero-length edge.');
    const direction = { x: edge.x / length, y: edge.y / length };
    const inward = {
      x: -direction.y * orientation,
      y: direction.x * orientation,
    };
    return {
      point: { x: point.x + inward.x * amount, y: point.y + inward.y * amount },
      direction,
    };
  });

  const inset2d: Vec2[] = [];
  for (let i = 0; i < projected.length; i += 1) {
    const previous = offsetLines[(i - 1 + offsetLines.length) % offsetLines.length];
    const current = offsetLines[i];
    const denominator = cross2(previous.direction, current.direction);
    if (Math.abs(denominator) <= 1e-10) {
      throw new Error('Inset currently requires non-collinear neighboring edges.');
    }
    const delta = subtract2(current.point, previous.point);
    const t = cross2(delta, current.direction) / denominator;
    inset2d.push({
      x: previous.point.x + previous.direction.x * t,
      y: previous.point.y + previous.direction.y * t,
    });
  }

  let insetTwiceArea = 0;
  for (let i = 0; i < inset2d.length; i += 1) {
    insetTwiceArea += cross2(inset2d[i], inset2d[(i + 1) % inset2d.length]);
  }
  if (insetTwiceArea * orientation <= 1e-10) {
    throw new Error('Inset amount is too large for this face.');
  }

  // A valid convex inset must remain inside every authored boundary half-plane.
  for (const point of inset2d) {
    for (let i = 0; i < projected.length; i += 1) {
      const a = projected[i];
      const b = projected[(i + 1) % projected.length];
      const side = cross2(subtract2(b, a), subtract2(point, a)) * orientation;
      if (side < -1e-7) throw new Error('Inset amount is too large for this face.');
    }
  }

  return inset2d.map(point => ({
    x: origin.x + u!.x * point.x + v.x * point.y,
    y: origin.y + u!.y * point.x + v.y * point.y,
    z: origin.z + u!.z * point.x + v.z * point.y,
  }));
};

const normalizeVector = (vector: Vector3, label: string): Vector3 => {
  assertFinitePosition(vector, label);
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length <= 1e-8) throw new Error(`${label} must have non-zero length.`);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
};

const computeConstructionFaceNormal = (
  construction: StaticMeshConstructionData,
  pointIds: readonly string[],
): Vector3 => {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pointIds.length; i += 1) {
    const current = findConstructionPoint(construction, pointIds[i]).position;
    const next = findConstructionPoint(construction, pointIds[(i + 1) % pointIds.length]).position;
    nx += (current.y - next.y) * (current.z + next.z);
    ny += (current.z - next.z) * (current.x + next.x);
    nz += (current.x - next.x) * (current.y + next.y);
  }
  return normalizeVector({ x: nx, y: ny, z: nz }, 'Construction Face normal');
};

const finalizeConstructionMutation = (state: ConstructionMutationState): void => {
  const vertexCount = Math.floor(state.vertices.length / 3);
  const vertices = new Float32Array(state.vertices);
  const indices = vertexCount > 65535 || state.indices.some(index => index > 65535)
    ? new Uint32Array(state.indices)
    : new Uint16Array(state.indices);
  const topology: LogicalMesh = {
    faces: state.faces.map(face => [...face]),
    triangleToFaceIndex: new Int32Array(state.triangleToFace),
    vertexToFaces: rebuildVertexToFaces(state.faces, state.siblings),
    siblings: state.siblings,
  };
  topology.graph = MeshTopologyUtils.buildTopology(topology, vertexCount);

  const geometry: MeshGeometry = {
    ...state.asset.geometry,
    vertices,
    normals: computeVertexNormals(state.vertices, state.indices),
    uvs: new Float32Array(state.uvs.slice(0, vertexCount * 2)),
    colors: new Float32Array(state.colors.slice(0, vertexCount * 3)),
    indices,
    aabb: computeAABB(vertices),
  };

  const shells = resolveStaticMeshShells({
    ...state.asset,
    geometry,
    topology,
    construction: state.construction,
  }).map(shell => materializeStaticMeshShell(shell));

  assetManager.updateAsset(state.asset.id, {
    geometry,
    topology,
    shells,
    construction: state.construction,
  });
};

/**
 * Stable asset-level API for Static Mesh composition. UI surfaces should call
 * this service instead of mutating geometry/editor metadata directly.
 */
class StaticMeshAssetAPIService {
  create(args: CreateStaticMeshArgs): StaticMeshAsset {
    return assetManager.createStaticMesh(args.name, args.path ?? '/Content/Meshes');
  }

  getHistoryState(assetId: string): AssetHistoryState {
    requireStaticMesh(assetId, 'target');
    return assetHistory.getState(assetId);
  }

  undo(assetId: string): boolean {
    requireStaticMesh(assetId, 'target');
    return assetHistory.undo(assetId);
  }

  redo(assetId: string): boolean {
    requireStaticMesh(assetId, 'target');
    return assetHistory.redo(assetId);
  }

  beginTransaction(assetId: string, label = 'Static Mesh Edit'): void {
    requireStaticMesh(assetId, 'target');
    assetHistory.begin(assetId, label);
  }

  commitTransaction(assetId: string): boolean {
    requireStaticMesh(assetId, 'target');
    return assetHistory.commit(assetId);
  }

  cancelTransaction(assetId: string): boolean {
    requireStaticMesh(assetId, 'target');
    return assetHistory.cancel(assetId);
  }

  transaction<T>(assetId: string, label: string, mutation: () => T): T {
    requireStaticMesh(assetId, 'target');
    return assetHistory.transaction(assetId, label, mutation);
  }


  /** Adds a semantic Construction Point. It does not create a mesh vertex. */
  addPoint(args: AddConstructionPointArgs): StaticMeshConstructionPoint {
    return assetHistory.execute(args.assetId, 'Add Construction Point', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      assertFinitePosition(args.position, 'Construction Point position');
      const construction = cloneConstruction(asset);
      const id = makeUniqueConstructionId(args.id, 'point', construction.points.map(point => point.id));
      const point: StaticMeshConstructionPoint = {
        id,
        position: clonePosition(args.position),
        name: args.name,
        role: args.role,
        groupId: args.groupId,
        tags: args.tags ? unique(args.tags) : undefined,
        data: args.data ? { ...args.data } : undefined,
        vertexIds: [],
      };
      construction.points.push(point);
      assetManager.updateAsset(asset.id, { construction });
      return cloneConstructionPoint(point);
    });
  }

  addPoints(args: { assetId: string; points: Omit<AddConstructionPointArgs, 'assetId'>[] }): StaticMeshConstructionPoint[] {
    return assetHistory.execute(args.assetId, 'Add Construction Points', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      const construction = cloneConstruction(asset);
      const created: StaticMeshConstructionPoint[] = [];
      for (const input of args.points) {
        assertFinitePosition(input.position, 'Construction Point position');
        const id = makeUniqueConstructionId(input.id, 'point', construction.points.map(point => point.id));
        const point: StaticMeshConstructionPoint = {
          id,
          position: clonePosition(input.position),
          name: input.name,
          role: input.role,
          groupId: input.groupId,
          tags: input.tags ? unique(input.tags) : undefined,
          data: input.data ? { ...input.data } : undefined,
          vertexIds: [],
        };
        construction.points.push(point);
        created.push(cloneConstructionPoint(point));
      }
      assetManager.updateAsset(asset.id, { construction });
      return created;
    });
  }

  getPoint(assetId: string, pointId: string): StaticMeshConstructionPoint | null {
    const asset = requireStaticMesh(assetId, 'target');
    const point = asset.construction?.points?.find(candidate => candidate.id === pointId);
    return point ? cloneConstructionPoint(point) : null;
  }

  listPoints(assetId: string): StaticMeshConstructionPoint[] {
    const asset = requireStaticMesh(assetId, 'target');
    return (asset.construction?.points ?? []).map(cloneConstructionPoint);
  }

  movePoint(args: MoveConstructionPointArgs): StaticMeshConstructionPoint {
    return assetHistory.execute(args.assetId, 'Move Construction Point', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      assertFinitePosition(args.position, 'Construction Point position');
      const construction = cloneConstruction(asset);
      const point = findConstructionPoint(construction, args.pointId);
      point.position = clonePosition(args.position);

      const boundVertexIds = (point.vertexIds ?? []).filter(vertexId => (
        Number.isInteger(vertexId) && vertexId >= 0 && vertexId < asset.geometry.vertices.length / 3
      ));
      if (boundVertexIds.length === 0) {
        assetManager.updateAsset(asset.id, { construction });
        return cloneConstructionPoint(point);
      }

      const state = createConstructionMutationState(asset);
      state.construction = construction;
      for (const vertexId of boundVertexIds) {
        const offset = vertexId * 3;
        state.vertices[offset] = args.position.x;
        state.vertices[offset + 1] = args.position.y;
        state.vertices[offset + 2] = args.position.z;
      }
      finalizeConstructionMutation(state);
      return cloneConstructionPoint(point);
    });
  }

  removePoint(args: RemoveConstructionPointArgs): boolean {
    const existing = requireStaticMesh(args.assetId, 'target').construction?.points.find(point => point.id === args.pointId);
    if (!existing) return false;
    return assetHistory.execute(args.assetId, 'Remove Construction Point', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      const construction = cloneConstruction(asset);
      const pointIndex = construction.points.findIndex(point => point.id === args.pointId);
      const usedByFace = construction.faces.find(face => face.pointIds.includes(args.pointId));
      if (usedByFace) throw new Error(`Construction Point '${args.pointId}' is used by face '${usedByFace.id}'.`);
      const usedByLoop = construction.loops.find(loop => loop.pointIds.includes(args.pointId));
      if (usedByLoop) throw new Error(`Construction Point '${args.pointId}' is used by loop '${usedByLoop.id}'.`);
      construction.points.splice(pointIndex, 1);
      assetManager.updateAsset(asset.id, { construction });
      return true;
    });
  }

  /**
   * Creates one logical polygon from ordered Construction Points. The current
   * implementation fan-triangulates the polygon, so callers should provide a
   * planar, non-self-intersecting convex boundary in winding order.
   */
  createFaceFromPoints(args: CreateConstructionFaceArgs): ConstructionFaceResult {
    return assetHistory.execute(args.assetId, 'Create Construction Face', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(asset);
      const result = addConstructionFaceToState(state, args);
      finalizeConstructionMutation(state);
      return result;
    });
  }

  createLoop(args: CreateConstructionLoopArgs): StaticMeshConstructionLoop {
    return assetHistory.execute(args.assetId, 'Create Construction Loop', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      const construction = cloneConstruction(asset);
      const pointIds = [...args.pointIds];
      if (pointIds.length < 2) throw new Error('A Construction Loop requires at least 2 points.');
      if (new Set(pointIds).size !== pointIds.length) throw new Error('A Construction Loop cannot repeat a point id.');
      pointIds.forEach(pointId => findConstructionPoint(construction, pointId));
      const closed = args.closed ?? true;
      if (closed && pointIds.length < 3) throw new Error('A closed Construction Loop requires at least 3 points.');
      const id = makeUniqueConstructionId(args.id, 'loop', construction.loops.map(loop => loop.id));
      const loop: StaticMeshConstructionLoop = { id, pointIds, closed, name: args.name };
      construction.loops.push(loop);
      assetManager.updateAsset(asset.id, { construction });
      return { ...loop, pointIds: [...loop.pointIds] };
    });
  }

  /**
   * Maps one rendered/logical edge back to its semantic Construction Point endpoints.
   * This is an editor adapter only: procedural/AI callers should keep using stable
   * Construction Point ids instead of raw mesh vertex ids.
   */
  getConstructionEdgePointIds(assetId: string, vertexAId: number, vertexBId: number): [string, string] | null {
    const asset = requireStaticMesh(assetId, 'target');
    if (!Number.isInteger(vertexAId) || !Number.isInteger(vertexBId) || vertexAId < 0 || vertexBId < 0 || vertexAId === vertexBId) {
      return null;
    }
    const construction = asset.construction;
    if (!construction) return null;
    const pointA = construction.points.find(point => point.vertexIds?.includes(vertexAId));
    const pointB = construction.points.find(point => point.vertexIds?.includes(vertexBId));
    if (!pointA || !pointB || pointA.id === pointB.id) return null;
    const isAuthoredEdge = construction.faces.some(face => findBoundaryEdgeIndex(face.pointIds, pointA.id, pointB.id, true) >= 0);
    return isAuthoredEdge ? [pointA.id, pointB.id] : null;
  }

  /**
   * Splits one authored Construction Edge by inserting a new semantic Point and
   * updating every incident Construction Face/Loop that uses that edge. Faces
   * keep their stable semantic/logical ids; only their ordered boundary grows.
   */
  splitEdge(args: SplitConstructionEdgeArgs): SplitConstructionEdgeResult {
    return assetHistory.execute(args.assetId, 'Split Construction Edge', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(asset);
      if (args.pointAId === args.pointBId) throw new Error('Split Edge requires two different Construction Points.');
      const pointA = findConstructionPoint(state.construction, args.pointAId);
      const pointB = findConstructionPoint(state.construction, args.pointBId);
      const t = args.t ?? 0.5;
      if (!Number.isFinite(t) || t <= 1e-6 || t >= 1 - 1e-6) {
        throw new Error('Split position must be greater than 0 and less than 1.');
      }

      const affectedFaces = state.construction.faces.filter(
        face => findBoundaryEdgeIndex(face.pointIds, pointA.id, pointB.id, true) >= 0,
      );
      if (affectedFaces.length === 0) {
        throw new Error('The Construction Points do not form an authored face edge.');
      }
      if (affectedFaces.length > 2) {
        throw new Error('Split Edge currently supports manifold edges with at most two incident faces.');
      }

      const operationId = makeUniqueOperationId(
        args.id,
        'split',
        [
          ...state.construction.faces.map(face => face.id),
          ...state.construction.loops.map(loop => loop.id),
          ...state.construction.points.map(point => point.id),
        ],
      );
      const pointId = makeUniqueConstructionId(
        `${operationId}.point`,
        'point',
        state.construction.points.map(point => point.id),
      );
      state.construction.points.push({
        id: pointId,
        name: `Split ${pointA.name ?? pointA.id} - ${pointB.name ?? pointB.id}`,
        role: 'GUIDE',
        groupId: pointA.groupId && pointA.groupId === pointB.groupId ? pointA.groupId : undefined,
        data: {
          sourcePointAId: pointA.id,
          sourcePointBId: pointB.id,
          splitT: t,
        },
        position: {
          x: pointA.position.x + (pointB.position.x - pointA.position.x) * t,
          y: pointA.position.y + (pointB.position.y - pointA.position.y) * t,
          z: pointA.position.z + (pointB.position.z - pointA.position.z) * t,
        },
        vertexIds: [],
      });

      const updatedFaceIds: string[] = [];
      for (const face of affectedFaces) {
        const nextBoundary = insertPointOnBoundaryEdge(face.pointIds, pointA.id, pointB.id, pointId, true);
        if (!nextBoundary) continue;
        replaceConstructionFaceBoundaryInState(state, face, nextBoundary);
        updatedFaceIds.push(face.id);
      }

      const updatedLoopIds: string[] = [];
      for (const loop of state.construction.loops) {
        const nextBoundary = insertPointOnBoundaryEdge(loop.pointIds, pointA.id, pointB.id, pointId, loop.closed);
        if (!nextBoundary) continue;
        loop.pointIds = nextBoundary;
        updatedLoopIds.push(loop.id);
      }

      const vertexAId = ensurePointVertex(state, pointA.id);
      const vertexBId = ensurePointVertex(state, pointB.id);
      const vertexId = ensurePointVertex(state, pointId);
      finalizeConstructionMutation(state);

      return {
        id: operationId,
        sourcePointIds: [pointA.id, pointB.id],
        pointId,
        vertexId,
        updatedFaceIds,
        updatedLoopIds,
        edgeIds: [meshEdgeKey(vertexAId, vertexId), meshEdgeKey(vertexId, vertexBId)],
        t,
      };
    });
  }

  /**
   * Deletes one authored Construction Face while preserving its Construction
   * Points and Loops. Logical face ids above the removed face are compacted so
   * face/topology arrays remain dense and every remaining semantic face mapping
   * is updated in the same atomic history step.
   */
  deleteFace(args: DeleteConstructionFaceArgs): DeleteConstructionFaceResult {
    return assetHistory.execute(args.assetId, 'Delete Construction Face', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(asset);
      const face = findConstructionFace(state.construction, args.faceId);
      const result = deleteConstructionFaceFromState(state, face);
      finalizeConstructionMutation(state);
      return result;
    });
  }

  /**
   * Insets one convex planar Construction Face by a constant world-space amount.
   * The input semantic face id is preserved and becomes the inner face, while a
   * ring of new border faces connects the old boundary to the new inner boundary.
   */
  insetFace(args: InsetConstructionFaceArgs): InsetConstructionFaceResult {
    return assetHistory.execute(args.assetId, 'Inset Construction Face', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(asset);
      const sourceFace = findConstructionFace(state.construction, args.faceId);
      const originalPointIds = [...sourceFace.pointIds];
      const insetPositions = computeInsetPositions(state.construction, originalPointIds, args.amount);
      const operationId = makeUniqueOperationId(
        args.id,
        'inset',
        [
          ...state.construction.faces.map(face => face.id),
          ...state.construction.loops.map(loop => loop.id),
          ...state.construction.points.map(point => point.id),
        ],
      );

      const innerPointIds: string[] = [];
      for (let index = 0; index < originalPointIds.length; index += 1) {
        const sourcePoint = findConstructionPoint(state.construction, originalPointIds[index]);
        const pointId = makeUniqueConstructionId(
          `${operationId}.point.${index}`,
          'point',
          state.construction.points.map(point => point.id),
        );
        state.construction.points.push({
          id: pointId,
          name: sourcePoint.name ? `${sourcePoint.name} Inset` : undefined,
          role: sourcePoint.role,
          groupId: sourcePoint.groupId,
          tags: sourcePoint.tags ? [...sourcePoint.tags] : undefined,
          data: sourcePoint.data
            ? { ...sourcePoint.data, sourcePointId: sourcePoint.id }
            : { sourcePointId: sourcePoint.id },
          position: insetPositions[index],
          vertexIds: [],
        });
        innerPointIds.push(pointId);
      }

      // Keep the stable semantic face handle alive. The source face's logical face
      // id also stays stable; only its boundary and triangulation are replaced.
      replaceConstructionFaceBoundaryInState(state, sourceFace, innerPointIds);

      const borderFaceIds: string[] = [];
      for (let i = 0; i < originalPointIds.length; i += 1) {
        const next = (i + 1) % originalPointIds.length;
        const border = addConstructionFaceToState(state, {
          id: `${operationId}.border.${i}`,
          pointIds: [originalPointIds[i], originalPointIds[next], innerPointIds[next], innerPointIds[i]],
        });
        borderFaceIds.push(border.id);
      }

      const innerLoopId = makeUniqueConstructionId(
        `${operationId}.innerLoop`,
        'loop',
        state.construction.loops.map(loop => loop.id),
      );
      state.construction.loops.push({
        id: innerLoopId,
        pointIds: [...innerPointIds],
        closed: true,
        name: `${sourceFace.name ?? sourceFace.id} Inset Loop`,
      });

      finalizeConstructionMutation(state);
      return {
        id: operationId,
        sourceFaceId: sourceFace.id,
        innerFaceId: sourceFace.id,
        innerLoopId,
        innerPointIds,
        borderFaceIds,
      };
      });
  }

  extrudeFace(args: ExtrudeConstructionFaceArgs): ExtrudeConstructionFaceResult {
    return assetHistory.execute(args.assetId, 'Extrude Construction Face', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      if (!Number.isFinite(args.distance) || Math.abs(args.distance) <= 1e-8) {
        throw new Error('Extrude distance must be a finite non-zero number.');
      }
      const state = createConstructionMutationState(asset);
      const sourceFace = findConstructionFace(state.construction, args.faceId);
      const operationId = makeUniqueOperationId(
        args.id,
        'extrude',
        [
          ...state.construction.faces.map(face => face.id),
          ...state.construction.loops.map(loop => loop.id),
          ...state.construction.points.map(point => point.id),
        ],
      );
      const direction = args.direction
        ? normalizeVector(args.direction, 'Extrude direction')
        : computeConstructionFaceNormal(state.construction, sourceFace.pointIds);

      const topPointIds: string[] = [];
      for (let index = 0; index < sourceFace.pointIds.length; index += 1) {
        const sourcePoint = findConstructionPoint(state.construction, sourceFace.pointIds[index]);
        const pointId = makeUniqueConstructionId(
          `${operationId}.point.${index}`,
          'point',
          state.construction.points.map(point => point.id),
        );
        state.construction.points.push({
          id: pointId,
          name: sourcePoint.name ? `${sourcePoint.name} Extruded` : undefined,
          role: sourcePoint.role,
          groupId: sourcePoint.groupId,
          tags: sourcePoint.tags ? [...sourcePoint.tags] : undefined,
          data: sourcePoint.data ? { ...sourcePoint.data, sourcePointId: sourcePoint.id } : { sourcePointId: sourcePoint.id },
          position: {
            x: sourcePoint.position.x + direction.x * args.distance,
            y: sourcePoint.position.y + direction.y * args.distance,
            z: sourcePoint.position.z + direction.z * args.distance,
          },
          vertexIds: [],
        });
        topPointIds.push(pointId);
      }

      const topFace = addConstructionFaceToState(state, {
        id: `${operationId}.top`,
        name: `${sourceFace.name ?? sourceFace.id} Extruded Top`,
        pointIds: topPointIds,
      });
      const sideFaceIds: string[] = [];
      for (let i = 0; i < sourceFace.pointIds.length; i += 1) {
        const next = (i + 1) % sourceFace.pointIds.length;
        const side = addConstructionFaceToState(state, {
          id: `${operationId}.side.${i}`,
          pointIds: [sourceFace.pointIds[i], sourceFace.pointIds[next], topPointIds[next], topPointIds[i]],
        });
        sideFaceIds.push(side.id);
      }
      const topLoopId = makeUniqueConstructionId(
        `${operationId}.topLoop`,
        'loop',
        state.construction.loops.map(loop => loop.id),
      );
      state.construction.loops.push({ id: topLoopId, pointIds: [...topPointIds], closed: true });
      finalizeConstructionMutation(state);
      return {
        id: operationId,
        sourceFaceId: sourceFace.id,
        topFaceId: topFace.id,
        topLoopId,
        topPointIds,
        sideFaceIds,
      };
      });
  }

  bridgeLoops(args: BridgeConstructionLoopsArgs): BridgeConstructionLoopsResult {
    return assetHistory.execute(args.assetId, 'Bridge Construction Loops', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(asset);
      const loopA = findConstructionLoop(state.construction, args.loopAId);
      const loopB = findConstructionLoop(state.construction, args.loopBId);
      if (loopA.pointIds.length !== loopB.pointIds.length) {
        throw new Error('Bridge currently requires loops with the same point count.');
      }
      if (loopA.closed !== loopB.closed) {
        throw new Error('Bridge currently requires both loops to be either closed or open.');
      }
      const operationId = makeUniqueOperationId(
        args.id,
        'bridge',
        [
          ...state.construction.faces.map(face => face.id),
          ...state.construction.loops.map(loop => loop.id),
          ...state.construction.points.map(point => point.id),
        ],
      );
      const segmentCount = loopA.closed ? loopA.pointIds.length : loopA.pointIds.length - 1;
      const faceIds: string[] = [];
      for (let i = 0; i < segmentCount; i += 1) {
        const next = (i + 1) % loopA.pointIds.length;
        const face = addConstructionFaceToState(state, {
          id: `${operationId}.side.${i}`,
          pointIds: [loopA.pointIds[i], loopA.pointIds[next], loopB.pointIds[next], loopB.pointIds[i]],
        });
        faceIds.push(face.id);
      }
      finalizeConstructionMutation(state);
      return { id: operationId, loopAId: loopA.id, loopBId: loopB.id, faceIds };
      });
  }

  /** Lists valid Static Mesh composition inputs independently of Content Browser selection. */
  listCompositionSources(targetAssetId?: string): StaticMeshCompositionSource[] {
    return (assetManager.getAssetsByType('MESH') as StaticMeshAsset[])
      .filter(asset => asset.id !== targetAssetId)
      .map(compositionSourceDescriptor)
      .sort((a, b) => {
        const pathOrder = (a.path ?? '').localeCompare(b.path ?? '');
        return pathOrder !== 0 ? pathOrder : a.name.localeCompare(b.name);
      });
  }

  /**
   * Returns the exact id range a source will receive if appended now. This is
   * useful for agents, tests and future UI previews before committing geometry.
   */
  planAppendMesh(args: AppendStaticMeshArgs): StaticMeshAppendAllocation {
    const target = requireStaticMesh(args.targetAssetId, 'target');
    const source = requireStaticMesh(args.sourceAssetId, 'source');
    if (source.id === target.id) throw new Error('A Static Mesh cannot append itself.');
    return makeAppendAllocation(
      source,
      Math.floor(target.geometry.vertices.length / 3),
      Math.floor(target.geometry.indices.length / 3),
      sourceFaces(target).length,
    );
  }

  appendMesh(args: AppendStaticMeshArgs): StaticMeshAppendResult {
    return this.appendMeshes({
      targetAssetId: args.targetAssetId,
      sourceAssetIds: [args.sourceAssetId],
    });
  }

  appendMeshes(args: AppendStaticMeshesArgs): StaticMeshAppendResult {
    return assetHistory.execute(args.targetAssetId, 'Append Static Meshes', () => {
      const target = requireStaticMesh(args.targetAssetId, 'target');
      const sourceIds = unique(args.sourceAssetIds).filter(id => id !== target.id);
      const sources = sourceIds.map(id => requireStaticMesh(id, 'source'));

      let vertices = new Float32Array(target.geometry.vertices);
      let normals = new Float32Array(target.geometry.normals);
      let uvs = new Float32Array(target.geometry.uvs);
      let colors = target.geometry.colors
        ? new Float32Array(target.geometry.colors)
        : new Float32Array((vertices.length / 3) * 3).fill(1);
      let indices: number[] = Array.from(target.geometry.indices);
      const faces = sourceFaces(target);
      const triToFace: number[] = Array.from(sourceTriangleToFace(target, faces.length));
      const siblings = new Map<number, number[]>();
      copySiblingGroups(siblings, target.topology?.siblings, 0);
      const shells = resolveStaticMeshShells(target).map(shell => materializeStaticMeshShell(shell));

      let vertexCount = Math.floor(vertices.length / 3);
      let triangleCount = Math.floor(indices.length / 3);
      let verticesAdded = 0;
      let trianglesAdded = 0;
      const allocations: StaticMeshAppendAllocation[] = [];

      for (const source of sources) {
        const sourceVertexCount = Math.floor(source.geometry.vertices.length / 3);
        if (sourceVertexCount === 0) continue;

        const sourceFaceList = sourceFaces(source);
        const faceOffset = faces.length;
        const vertexOffset = vertexCount;
        const triangleOffset = triangleCount;
        const allocation = makeAppendAllocation(source, vertexOffset, triangleOffset, faceOffset);

        const nextVertices = new Float32Array(vertices.length + source.geometry.vertices.length);
        nextVertices.set(vertices, 0);
        nextVertices.set(source.geometry.vertices, vertices.length);
        vertices = nextVertices;

        normals = appendFloatAttribute(normals, vertexCount, source.geometry.normals, sourceVertexCount, 3, 0);
        uvs = appendFloatAttribute(uvs, vertexCount, source.geometry.uvs, sourceVertexCount, 2, 0);
        colors = appendFloatAttribute(colors, vertexCount, source.geometry.colors, sourceVertexCount, 3, 1);

        for (const index of source.geometry.indices) indices.push(index + vertexOffset);
        sourceFaceList.forEach(face => faces.push(face.map(vertexId => vertexId + vertexOffset)));

        const sourceTriMap = sourceTriangleToFace(source, sourceFaceList.length);
        for (const faceId of sourceTriMap) triToFace.push(faceId + faceOffset);

        copySiblingGroups(siblings, source.topology?.siblings, vertexOffset);
        resolveStaticMeshShells(source).forEach(shell => {
          shells.push(offsetStaticMeshShell(
            shell,
            { vertex: vertexOffset, triangle: triangleOffset, face: faceOffset },
            source.id,
          ));
        });

        const sourceTriangleCount = Math.floor(source.geometry.indices.length / 3);
        vertexCount += sourceVertexCount;
        triangleCount += sourceTriangleCount;
        verticesAdded += sourceVertexCount;
        trianglesAdded += sourceTriangleCount;
        allocations.push(allocation);
      }

      if (sources.length === 0 || verticesAdded === 0) {
        return {
          targetAssetId: target.id,
          appendedAssetIds: [],
          verticesAdded: 0,
          trianglesAdded: 0,
          allocations: [],
        };
      }

      const useUint32 = vertexCount > 65535 || indices.some(index => index > 65535);
      const nextIndices = useUint32 ? new Uint32Array(indices) : new Uint16Array(indices);
      const topology: LogicalMesh = {
        faces,
        triangleToFaceIndex: new Int32Array(triToFace),
        vertexToFaces: rebuildVertexToFaces(faces, siblings),
        siblings,
      };
      topology.graph = MeshTopologyUtils.buildTopology(topology, vertexCount);

      const geometry: MeshGeometry = {
        ...target.geometry,
        vertices,
        normals,
        uvs,
        colors,
        indices: nextIndices,
        aabb: computeAABB(vertices),
      };

      // Re-detect from the final topology before saving shell metadata. The appended
      // metadata above is provenance/naming input only; connectivity is authoritative.
      const validatedShells = resolveStaticMeshShells({
        ...target,
        geometry,
        topology,
        shells,
      }).map(shell => materializeStaticMeshShell(shell));

      assetManager.updateAsset(target.id, { geometry, topology, shells: validatedShells });

      return {
        targetAssetId: target.id,
        appendedAssetIds: allocations.map(allocation => allocation.sourceAssetId),
        verticesAdded,
        trianglesAdded,
        allocations,
      };
      });
  }

  getReferenceMeshIds(targetAssetId: string): string[] {
    const target = requireStaticMesh(targetAssetId, 'target');
    const ids = target.editor?.referenceMeshIds;
    if (!Array.isArray(ids)) return [];
    return unique(ids.filter((id): id is string => typeof id === 'string' && id !== target.id))
      .filter(id => assetManager.getAsset(id)?.type === 'MESH');
  }

  addReferenceMesh(targetAssetId: string, sourceAssetId: string): string[] {
    return this.addReferenceMeshes({ targetAssetId, sourceAssetIds: [sourceAssetId] });
  }

  addReferenceMeshes(args: StaticMeshReferenceArgs): string[] {
    return assetHistory.execute(args.targetAssetId, 'Add Reference Mesh', () => {
      const target = requireStaticMesh(args.targetAssetId, 'target');
      const current = this.getReferenceMeshIds(target.id);
      const additions = unique(args.sourceAssetIds)
        .filter(id => id !== target.id)
        .filter(id => assetManager.getAsset(id)?.type === 'MESH');
      const next = unique([...current, ...additions]);
      assetManager.updateAsset(target.id, {
        editor: {
          ...target.editor,
          referenceMeshIds: next,
        },
      });
      return next;
      });
  }

  removeReferenceMesh(targetAssetId: string, sourceAssetId: string): string[] {
    return assetHistory.execute(targetAssetId, 'Remove Reference Mesh', () => {
      const target = requireStaticMesh(targetAssetId, 'target');
      const next = this.getReferenceMeshIds(target.id).filter(id => id !== sourceAssetId);
      assetManager.updateAsset(target.id, {
        editor: {
          ...target.editor,
          referenceMeshIds: next,
        },
      });
      return next;
      });
  }

  clearReferenceMeshes(targetAssetId: string): void {
    return assetHistory.execute(targetAssetId, 'Clear Reference Meshes', () => {
      const target = requireStaticMesh(targetAssetId, 'target');
      assetManager.updateAsset(target.id, {
        editor: {
          ...target.editor,
          referenceMeshIds: [],
        },
      });
      });
  }
}

export const staticMeshAssetAPI = new StaticMeshAssetAPIService();
