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
import { computePlanarFaceNormal, computeRelativeInsetPositions } from '@/engine/mesh-editing/MeshPlanarGeometry';
import {
  BevelKernelUnsupportedTopologyError,
  buildJointBevelPlan,
  type BevelKernelPlan,
} from '@/engine/mesh-editing/MeshBevelKernel';
import {
  getStaticMeshEdgeFaceIds,
  getStaticMeshFaceInfo,
  getStaticMeshOppositeEdge,
  traceStaticMeshEdgeRing,
  type StaticMeshEdgeRingTraceResult,
  type StaticMeshOppositeEdgeResult,
  type StaticMeshTopologyFaceInfo,
} from '@/engine/mesh-editing/StaticMeshTopologyQueries';
import { invalidateMeshConnectivity } from '@/engine/mesh-editing/MeshConnectivity';
import {
  buildStaticMeshPrimitiveGeometry,
  inspectStaticMesh,
  queryStaticMeshEdges,
  queryStaticMeshFaces,
  type StaticMeshDirectionTag,
  type StaticMeshEdgeQuery,
  type StaticMeshEdgeSortBy,
  type StaticMeshFaceQuery,
  type StaticMeshFaceSortBy,
  type StaticMeshInspectedEdge,
  type StaticMeshInspectedFace,
  type StaticMeshInspectedVertex,
  type StaticMeshInspectionReport,
  type StaticMeshPrimitiveKind,
  type StaticMeshPrimitiveOptions,
} from '@/engine/mesh-editing/StaticMeshPrimitivesAndControl';
export type { StaticMeshIdRange } from '@/types';
export type {
  StaticMeshEdgeRingTraceResult,
  StaticMeshFaceKind,
  StaticMeshOppositeEdgeResult,
  StaticMeshTopologyEdgeInfo,
  StaticMeshTopologyFaceInfo,
  StaticMeshTopologyTraceTermination,
} from '@/engine/mesh-editing/StaticMeshTopologyQueries';
export type {
  StaticMeshDirectionTag,
  StaticMeshEdgeQuery,
  StaticMeshEdgeSortBy,
  StaticMeshFaceQuery,
  StaticMeshFaceSortBy,
  StaticMeshInspectedEdge,
  StaticMeshInspectedFace,
  StaticMeshInspectedVertex,
  StaticMeshInspectionReport,
  StaticMeshPrimitiveKind,
  StaticMeshPrimitiveOptions,
} from '@/engine/mesh-editing/StaticMeshPrimitivesAndControl';

export interface CreateStaticMeshArgs {
  name: string;
  path?: string;
}

export interface AddStaticMeshPrimitiveArgs extends StaticMeshPrimitiveOptions {
  assetId: string;
  /** Replace any existing geometry in the target mesh before adding the primitive. Defaults to false. */
  clearExisting?: boolean;
}

export interface CreateStaticMeshPrimitiveArgs extends StaticMeshPrimitiveOptions {
  name: string;
  path?: string;
}

export interface StaticMeshPrimitiveResult {
  assetId: string;
  kind: StaticMeshPrimitiveKind;
  vertexIds: number[];
  faceIds: number[];
  triangleIds: number[];
  shellId: string;
}

export interface AddLogicalVerticesArgs {
  assetId: string;
  positions: Vector3[];
}

export interface CreateLogicalFaceArgs {
  assetId: string;
  /** Existing vertex IDs in winding order. */
  vertexIds: number[];
}

export interface CreateLogicalFaceResult {
  faceId: number;
  vertexIds: number[];
  triangleIds: number[];
}

export interface ExtrudeLogicalFacesArgs {
  assetId: string;
  faceIds: number[];
  distance: number;
}

export interface ExtrudeLogicalFacesResult {
  results: ExtrudeLogicalFaceResult[];
  topFaceIds: number[];
  sideFaceIds: number[];
}

export interface DeleteLogicalFacesArgs {
  assetId: string;
  faceIds: number[];
  /** Compact vertices that are no longer referenced by any surviving logical face. */
  compactUnusedVertices?: boolean;
}

export interface DeleteLogicalFacesResult {
  deletedFaceIds: number[];
  vertexIds: number[];
  remainingFaceCount: number;
}

export interface MoveLogicalVerticesArgs {
  assetId: string;
  vertices: Array<{
    vertexId: number;
    position: Vector3;
  }>;
  /** Whether to move welded sibling vertices together. Defaults to true. */
  propagateSiblings?: boolean;
}

export interface MoveLogicalVerticesResult {
  movedVertexIds: number[];
}

export interface TransformLogicalFacesArgs {
  assetId: string;
  faceIds: number[];
  /** Optional world-space translation offset. */
  translate?: Vector3;
  /** Optional distance along the face normal(s). */
  normalOffset?: number;
  /** Optional scale factor around the face center (uniform number or per-axis Vector3). */
  scale?: number | Vector3;
  /** Pivot mode when transforming multiple faces. Defaults to 'SELECTION_CENTER'. */
  pivot?: 'SELECTION_CENTER' | 'INDIVIDUAL_FACES';
}

export interface TransformLogicalFacesResult {
  faceIds: number[];
  movedVertexIds: number[];
  center: Vector3;
}

export interface WeldLogicalVerticesArgs {
  assetId: string;
  vertexIds: number[];
  /** Target placement mode when explicit position is not provided. Defaults to 'CENTER' ('AVERAGE'). */
  mode?: 'CENTER' | 'AVERAGE' | 'FIRST';
  /** Optional explicit position for the welded vertex. */
  position?: Vector3;
}

export interface WeldLogicalVerticesResult {
  survivingVertexId: number;
  mergedVertexIds: number[];
  position: Vector3;
  removedDegenerateFaces: number;
}

export interface ConnectLogicalVerticesArgs {
  assetId: string;
  vertexIds: number[];
}

export interface ConnectLogicalVerticesResult {
  cuts: Array<{
    sourceFaceId: number;
    newFaceId: number;
    cutEdgeId: string;
    vertexIds: [number, number];
  }>;
  cutEdgeIds: string[];
  newFaceIds: number[];
}

export interface StaticMeshFaceQueryArgs extends StaticMeshFaceQuery {
  assetId: string;
}

export interface StaticMeshEdgeQueryArgs extends StaticMeshEdgeQuery {
  assetId: string;
}

export type StaticMeshModelingStep =
  | ({ op: 'ADD_PRIMITIVE' } & Omit<AddStaticMeshPrimitiveArgs, 'assetId'>)
  | {
      op: 'ADD_VERTICES';
      positions: Vector3[];
    }
  | {
      op: 'CREATE_FACE';
      vertexIds: number[];
    }
  | {
      op: 'EXTRUDE_FACES';
      faceIds?: number[];
      faceQuery?: StaticMeshFaceQuery;
      distance: number;
    }
  | {
      op: 'INSET_FACES';
      faceIds?: number[];
      faceQuery?: StaticMeshFaceQuery;
      ratio: number;
    }
  | {
      op: 'DELETE_FACES';
      faceIds?: number[];
      faceQuery?: StaticMeshFaceQuery;
      compactUnusedVertices?: boolean;
    }
  | {
      op: 'BEVEL_EDGES';
      edges?: Array<{ vertexAId: number; vertexBId: number }>;
      edgeQuery?: StaticMeshEdgeQuery;
      width: number;
      segments?: number;
      profile?: number;
      clampOverlap?: boolean;
    }
  | {
      op: 'SPLIT_EDGE';
      vertexAId?: number;
      vertexBId?: number;
      edgeQuery?: StaticMeshEdgeQuery;
      t?: number;
    }
  | {
      op: 'CUT_FACE';
      faceId: number;
      vertexAId: number;
      vertexBId: number;
    }
  | {
      op: 'CONNECT_VERTICES';
      vertexIds: number[];
    }
  | {
      op: 'WELD_VERTICES';
      vertexIds: number[];
      mode?: 'CENTER' | 'AVERAGE' | 'FIRST';
      position?: Vector3;
    }
  | {
      op: 'MOVE_VERTICES';
      vertices: MoveLogicalVerticesArgs['vertices'];
      propagateSiblings?: boolean;
    }
  | {
      op: 'TRANSFORM_FACES';
      faceIds?: number[];
      faceQuery?: StaticMeshFaceQuery;
      translate?: Vector3;
      normalOffset?: number;
      scale?: number | Vector3;
      pivot?: 'SELECTION_CENTER' | 'INDIVIDUAL_FACES';
    };

export interface RunStaticMeshModelingStepsArgs {
  assetId: string;
  label?: string;
  steps: StaticMeshModelingStep[];
}

export interface RunStaticMeshModelingStepsResult {
  assetId: string;
  stepsExecuted: number;
  stepResults: unknown[];
  inspection: StaticMeshInspectionReport;
}

export interface AdoptStaticMeshTopologyArgs {
  assetId: string;
  /** Prefixes keep generated semantic handles recognizable and stable. */
  pointPrefix?: string;
  facePrefix?: string;
}

export interface AdoptStaticMeshTopologyResult {
  assetId: string;
  adopted: boolean;
  pointsCreated: number;
  facesCreated: number;
  loopsCreated: number;
  pointIds: string[];
  faceIds: string[];
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

export interface ExtrudeLogicalFaceArgs {
  assetId: string;
  /** Numeric logical face id from StaticMeshAsset.topology.faces. */
  faceId: number;
  distance: number;
}

export interface InsetLogicalFaceArgs {
  assetId: string;
  /** Numeric logical face id from StaticMeshAsset.topology.faces. */
  faceId: number;
  /** Relative movement toward the arithmetic face center. Must be > 0 and < 1. */
  ratio: number;
}

export interface InsetLogicalFacesArgs {
  assetId: string;
  /** Numeric logical face ids. Each face is inset individually with the same ratio. */
  faceIds: number[];
  /** Relative movement toward each face's arithmetic center. Must be > 0 and < 1. */
  ratio: number;
}

export interface DeleteLogicalFaceArgs {
  assetId: string;
  /** Numeric logical face id from StaticMeshAsset.topology.faces. */
  faceId: number;
}

export interface SplitLogicalEdgeArgs {
  assetId: string;
  vertexAId: number;
  vertexBId: number;
  t?: number;
}

export interface CutLogicalFaceArgs {
  assetId: string;
  faceId: number;
  vertexAId: number;
  vertexBId: number;
}

export interface BevelLogicalEdgeArgs {
  assetId: string;
  vertexAId: number;
  vertexBId: number;
  width: number;
  /** Number of polygon strips across the bevel profile. Defaults to 1. */
  segments?: number;
  /** Blender-style superellipse profile shape. 0.5 is circular. Defaults to 0.5. */
  profile?: number;
}

export interface BevelLogicalEdgesArgs {
  assetId: string;
  edges: Array<{ vertexAId: number; vertexBId: number }>;
  width: number;
  /** Reduce width as one network when neighboring bevel boundaries would overlap. Defaults to true. */
  clampOverlap?: boolean;
  /** Number of polygon strips across every selected edge profile. Defaults to 1. */
  segments?: number;
  /** Blender-style superellipse profile shape. 0.5 is circular. Defaults to 0.5. */
  profile?: number;
}

export interface ExtrudeLogicalFaceResult {
  sourceFaceId: number;
  topFaceId: number;
  topVertexIds: number[];
  sideFaceIds: number[];
}

export interface InsetLogicalFaceResult {
  sourceFaceId: number;
  innerFaceId: number;
  innerVertexIds: number[];
  borderFaceIds: number[];
}

export interface InsetLogicalFacesResult {
  results: InsetLogicalFaceResult[];
  innerFaceIds: number[];
  borderFaceIds: number[];
}

export interface DeleteLogicalFaceResult {
  deletedFaceId: number;
  vertexIds: number[];
  triangleIds: number[];
}

export interface SplitLogicalEdgeResult {
  vertexId: number;
  updatedFaceIds: number[];
  edgeIds: [string, string];
  t: number;
}

export interface CutLogicalFaceResult {
  sourceFaceId: number;
  newFaceId: number;
  cutEdgeId: string;
  vertexIds: [number, number];
}

export interface BevelLogicalEdgeResult {
  bevelFaceId: number;
  /** All strip faces for this source edge. Length equals segments. */
  bevelFaceIds: number[];
  /** All corner/cap faces touching either source-edge endpoint; TRI_FAN and ADJ may contribute multiple faces at one endpoint. */
  endpointCapFaceIds: number[];
  updatedFaceIds: number[];
  /** Outer profile rails retained for compatibility with the one-segment API. */
  bevelEdgeIds: [string, string];
  /** Every longitudinal profile rail, including the two outer rails. */
  profileEdgeIds: string[];
  width: number;
  segments: number;
  profile: number;
}

export interface BevelLogicalEdgesResult {
  results: BevelLogicalEdgeResult[];
  bevelFaceIds: number[];
  endpointCapFaceIds: number[];
  /** All generated corner VMesh faces, including segmented TRI_FAN and structured ADJ cells. */
  cornerFaceIds: number[];
  updatedFaceIds: number[];
  bevelEdgeIds: string[];
  /** Effective width after optional overlap clamping. */
  width: number;
  requestedWidth: number;
  clamped: boolean;
  segments: number;
  profile: number;
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
  /** Relative movement toward the arithmetic face center. Must be > 0 and < 1. */
  ratio: number;
  id?: string;
}

export interface DeleteConstructionFaceArgs {
  assetId: string;
  /** Stable semantic Construction Face id, not the numeric logical face index. */
  faceId: string;
}

export interface CutConstructionFaceArgs {
  assetId: string;
  /** Stable authored face handle to split. */
  faceId: string;
  /** Two existing, non-adjacent boundary Construction Point ids. */
  pointAId: string;
  pointBId: string;
  /** Optional stable operation prefix used for the generated second face. */
  id?: string;
}

export interface StaticMeshTopologyEdgeQueryArgs {
  assetId: string;
  vertexAId: number;
  vertexBId: number;
}

export interface StaticMeshTopologyFaceEdgeQueryArgs extends StaticMeshTopologyEdgeQueryArgs {
  faceId: number;
}

export interface StaticMeshEdgeRingQueryArgs extends StaticMeshTopologyEdgeQueryArgs {
  maxSteps?: number;
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

export interface BevelConstructionEdgeArgs {
  assetId: string;
  /** Stable semantic endpoint ids for one manifold authored edge. */
  pointAId: string;
  pointBId: string;
  /** Positive world-space distance measured from each endpoint along its local one-ring edges. */
  width: number;
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
  /** Stable input face handle. After extrusion this face has moved to the new top boundary. */
  sourceFaceId: string;
  /** Same stable semantic handle as sourceFaceId; exposed explicitly for operation chaining. */
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

export interface CutConstructionFaceResult {
  id: string;
  sourceFaceId: string;
  newFaceId: string;
  pointIds: [string, string];
  cutEdgeId: string;
  sourceLogicalFaceId: number;
  newLogicalFaceId: number;
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

export interface BevelConstructionEdgeResult {
  id: string;
  sourcePointIds: [string, string];
  /** Offset points on the first and second incident faces, each ordered A -> B. */
  sidePointIds: [[string, string], [string, string]];
  bevelFaceId: string;
  bevelLogicalFaceId: number;
  /** Optional endpoint cap faces created when an endpoint has valence > 3. */
  endpointCapFaceIds: string[];
  updatedFaceIds: string[];
  /** The two long edges bordering the generated bevel face. */
  bevelEdgeIds: [string, string];
  width: number;
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

const buildCanonicalVertexGroups = (asset: StaticMeshAsset): {
  vertexToCanonical: Map<number, number>;
  groups: Map<number, number[]>;
} => {
  const vertexCount = Math.floor(asset.geometry.vertices.length / 3);
  const parent = Array.from({ length: vertexCount }, (_, index) => index);

  const find = (value: number): number => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    let current = value;
    while (parent[current] !== current) {
      const next = parent[current];
      parent[current] = root;
      current = next;
    }
    return root;
  };

  const union = (a: number, b: number): void => {
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= vertexCount || b >= vertexCount) return;
    const rootA = find(a);
    const rootB = find(b);
    if (rootA === rootB) return;
    const keep = Math.min(rootA, rootB);
    const merge = Math.max(rootA, rootB);
    parent[merge] = keep;
  };

  for (const [vertexId, siblings] of asset.topology?.siblings ?? new Map<number, number[]>()) {
    for (const siblingId of siblings) union(vertexId, siblingId);
  }

  const groups = new Map<number, number[]>();
  const vertexToCanonical = new Map<number, number>();
  for (let vertexId = 0; vertexId < vertexCount; vertexId += 1) {
    const root = find(vertexId);
    let group = groups.get(root);
    if (!group) {
      group = [];
      groups.set(root, group);
    }
    group.push(vertexId);
  }

  // Normalize every group to its smallest render vertex id so generated ids are
  // deterministic even if an imported siblings map is asymmetric.
  const normalized = new Map<number, number[]>();
  for (const group of groups.values()) {
    const canonical = Math.min(...group);
    const sorted = [...group].sort((a, b) => a - b);
    normalized.set(canonical, sorted);
    for (const vertexId of sorted) vertexToCanonical.set(vertexId, canonical);
  }
  return { vertexToCanonical, groups: normalized };
};

const isConstructionTopologyAdopted = (asset: StaticMeshAsset): boolean => {
  const faces = sourceFaces(asset);
  const construction = asset.construction;
  if (faces.length === 0 || !construction) return false;
  if (construction.faces.length !== faces.length) return false;
  const mappedFaceIds = new Set(construction.faces.map(face => face.faceId));
  if (mappedFaceIds.size !== faces.length) return false;
  for (let faceId = 0; faceId < faces.length; faceId += 1) {
    const semanticFace = construction.faces.find(face => face.faceId === faceId);
    if (!semanticFace || semanticFace.pointIds.length !== faces[faceId].length) return false;
  }
  return true;
};

const assertAdoptableSiblingPositions = (
  asset: StaticMeshAsset,
  groups: Map<number, number[]>,
): void => {
  const vertices = asset.geometry.vertices;
  const epsilon = 1e-5;
  for (const [canonical, group] of groups) {
    if (group.length < 2) continue;
    const base = canonical * 3;
    const bx = vertices[base];
    const by = vertices[base + 1];
    const bz = vertices[base + 2];
    for (const vertexId of group) {
      const offset = vertexId * 3;
      if (
        Math.abs(vertices[offset] - bx) > epsilon
        || Math.abs(vertices[offset + 1] - by) > epsilon
        || Math.abs(vertices[offset + 2] - bz) > epsilon
      ) {
        throw new Error(
          `Adopt Topology cannot bind sibling vertices ${canonical} and ${vertexId} because their positions differ.`,
        );
      }
    }
  }
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

interface ConstructionLookupCache {
  pointById: Map<string, StaticMeshConstructionPoint>;
  faceById: Map<string, StaticMeshConstructionFace>;
  loopById: Map<string, StaticMeshConstructionLoop>;
}

const constructionLookupCache = new WeakMap<StaticMeshConstructionData, ConstructionLookupCache>();

const getConstructionLookupCache = (construction: StaticMeshConstructionData): ConstructionLookupCache => {
  let cache = constructionLookupCache.get(construction);
  if (!cache) {
    cache = {
      pointById: new Map(),
      faceById: new Map(),
      loopById: new Map(),
    };
    constructionLookupCache.set(construction, cache);
  }
  return cache;
};

const findConstructionPoint = (construction: StaticMeshConstructionData, pointId: string): StaticMeshConstructionPoint => {
  const cache = getConstructionLookupCache(construction);
  const cached = cache.pointById.get(pointId);
  if (cached && cached.id === pointId && construction.points.includes(cached)) {
    return cached;
  }
  cache.pointById.clear();
  for (const candidate of construction.points) {
    cache.pointById.set(candidate.id, candidate);
  }
  const point = cache.pointById.get(pointId);
  if (!point) throw new Error(`Construction Point '${pointId}' was not found.`);
  return point;
};

const findConstructionFace = (construction: StaticMeshConstructionData, faceId: string): StaticMeshConstructionFace => {
  const cache = getConstructionLookupCache(construction);
  const cached = cache.faceById.get(faceId);
  if (cached && cached.id === faceId && construction.faces.includes(cached)) {
    return cached;
  }
  cache.faceById.clear();
  for (const candidate of construction.faces) {
    cache.faceById.set(candidate.id, candidate);
  }
  const face = cache.faceById.get(faceId);
  if (!face) throw new Error(`Construction Face '${faceId}' was not found.`);
  return face;
};

const findConstructionLoop = (construction: StaticMeshConstructionData, loopId: string): StaticMeshConstructionLoop => {
  const cache = getConstructionLookupCache(construction);
  const cached = cache.loopById.get(loopId);
  if (cached && cached.id === loopId && construction.loops.includes(cached)) {
    return cached;
  }
  cache.loopById.clear();
  for (const candidate of construction.loops) {
    cache.loopById.set(candidate.id, candidate);
  }
  const loop = cache.loopById.get(loopId);
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

const constructionBoundaryPath = (
  pointIds: readonly string[],
  startIndex: number,
  endIndex: number,
): string[] => {
  const result: string[] = [];
  let index = startIndex;
  for (let guard = 0; guard <= pointIds.length; guard += 1) {
    result.push(pointIds[index]);
    if (index === endIndex) return result;
    index = (index + 1) % pointIds.length;
  }
  throw new Error('Cut Face boundary traversal failed.');
};

interface OrientedConstructionEdge {
  index: number;
  startId: string;
  endId: string;
  previousId: string;
  nextId: string;
  matchesRequestedOrder: boolean;
}

const findOrientedConstructionEdge = (
  pointIds: readonly string[],
  pointAId: string,
  pointBId: string,
): OrientedConstructionEdge | null => {
  for (let index = 0; index < pointIds.length; index += 1) {
    const nextIndex = (index + 1) % pointIds.length;
    const startId = pointIds[index];
    const endId = pointIds[nextIndex];
    const matchesRequestedOrder = startId === pointAId && endId === pointBId;
    const matchesReverseOrder = startId === pointBId && endId === pointAId;
    if (!matchesRequestedOrder && !matchesReverseOrder) continue;
    return {
      index,
      startId,
      endId,
      previousId: pointIds[(index - 1 + pointIds.length) % pointIds.length],
      nextId: pointIds[(index + 2) % pointIds.length],
      matchesRequestedOrder,
    };
  }
  return null;
};

const constructionPointAtDistance = (
  construction: StaticMeshConstructionData,
  fromPointId: string,
  towardPointId: string,
  distance: number,
): Vector3 => {
  const from = findConstructionPoint(construction, fromPointId).position;
  const toward = findConstructionPoint(construction, towardPointId).position;
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const dz = toward.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (length <= 1e-8) throw new Error('Bevel neighboring edges must have non-zero length.');
  if (distance >= length - 1e-6) {
    throw new Error('Bevel width is too large for one of the neighboring edges.');
  }
  const scale = distance / length;
  return { x: from.x + dx * scale, y: from.y + dy * scale, z: from.z + dz * scale };
};

/**
 * Blender's terminal-edge bevel has a special edgecount==2 case: the two
 * profile sides cannot both be represented by one point slid along the only
 * unbeveled neighbor. Instead each incident face gets its own point on the
 * selected-edge offset line, then a third artificial point is placed on the
 * lone unbeveled edge to close the endpoint triangle.
 */
const constructionSelectedEdgeOffsetPoint = (
  construction: StaticMeshConstructionData,
  face: StaticMeshConstructionFace,
  endpointId: string,
  selectedOtherId: string,
  distance: number,
): Vector3 => {
  const endpointIndex = face.pointIds.indexOf(endpointId);
  if (endpointIndex < 0 || face.pointIds.length < 3) {
    throw new Error('Bevel Edge could not resolve a terminal endpoint face.');
  }
  const count = face.pointIds.length;
  const previousId = face.pointIds[(endpointIndex - 1 + count) % count];
  const nextId = face.pointIds[(endpointIndex + 1) % count];
  if (selectedOtherId !== previousId && selectedOtherId !== nextId) {
    throw new Error('Bevel Edge terminal endpoint is not incident to the selected edge in one face.');
  }

  const endpoint = findConstructionPoint(construction, endpointId).position;
  const other = findConstructionPoint(construction, selectedOtherId).position;
  // Match MeshBevelKernel.faceOffsetLine(): use the face-boundary direction
  // through the selected edge, then cross the face normal into the face.
  let dx: number;
  let dy: number;
  let dz: number;
  if (selectedOtherId === nextId) {
    dx = other.x - endpoint.x;
    dy = other.y - endpoint.y;
    dz = other.z - endpoint.z;
  } else {
    dx = endpoint.x - other.x;
    dy = endpoint.y - other.y;
    dz = endpoint.z - other.z;
  }
  const edgeLength = Math.hypot(dx, dy, dz);
  if (edgeLength <= 1e-8) throw new Error('Bevel selected edge must have non-zero length.');
  dx /= edgeLength;
  dy /= edgeLength;
  dz /= edgeLength;

  const normal = computeConstructionFaceNormal(construction, face.pointIds);
  let ix = normal.y * dz - normal.z * dy;
  let iy = normal.z * dx - normal.x * dz;
  let iz = normal.x * dy - normal.y * dx;
  const inwardLength = Math.hypot(ix, iy, iz);
  if (inwardLength <= 1e-8) throw new Error('Bevel terminal face is degenerate.');
  ix /= inwardLength;
  iy /= inwardLength;
  iz /= inwardLength;

  return {
    x: endpoint.x + ix * distance,
    y: endpoint.y + iy * distance,
    z: endpoint.z + iz * distance,
  };
};

interface BevelEndpointFanPlan {
  /** Ordered non-selected edges around the endpoint, from one selected face to the other. */
  neighborIds: string[];
  /** Ordered authored faces crossed between consecutive neighbor ids. */
  faceIds: string[];
}

const constructionFaceNeighborsAtPoint = (
  face: StaticMeshConstructionFace,
  pointId: string,
): [string, string] | null => {
  const index = face.pointIds.indexOf(pointId);
  if (index < 0) return null;
  const count = face.pointIds.length;
  if (count < 3) return null;
  return [
    face.pointIds[(index - 1 + count) % count],
    face.pointIds[(index + 1) % count],
  ];
};

/**
 * Resolves the one-ring fan around one bevel endpoint after conceptually removing
 * the selected edge. Interior manifold vertices produce one simple path between
 * the two neighboring edges from the selected incident faces. Valence-3 is the
 * two-neighbor special case; higher valence inserts intermediate neighbors and
 * later receives an endpoint cap polygon.
 *
 * A boundary endpoint with no extra face remains supported (two neighbors, no
 * cap). More complex open/branched endpoint fans reject instead of guessing.
 */
const planBevelEndpointFan = (
  construction: StaticMeshConstructionData,
  endpointId: string,
  selectedOtherId: string,
  startNeighborId: string,
  endNeighborId: string,
  selectedFaceIds: ReadonlySet<string>,
): BevelEndpointFanPlan => {
  const endpointFaces = construction.faces.filter(face => (
    !selectedFaceIds.has(face.id) && face.pointIds.includes(endpointId)
  ));

  if (endpointFaces.length === 0) {
    return { neighborIds: [startNeighborId, endNeighborId], faceIds: [] };
  }

  type FanEdge = { to: string; faceId: string };
  const adjacency = new Map<string, FanEdge[]>();
  const addAdjacency = (from: string, to: string, faceId: string) => {
    const entries = adjacency.get(from) ?? [];
    entries.push({ to, faceId });
    adjacency.set(from, entries);
  };

  for (const face of endpointFaces) {
    const neighbors = constructionFaceNeighborsAtPoint(face, endpointId);
    if (!neighbors) throw new Error('Bevel Edge could not resolve an endpoint face boundary.');
    const [a, b] = neighbors;
    if (a === b || a === endpointId || b === endpointId || a === selectedOtherId || b === selectedOtherId) {
      throw new Error('Bevel Edge endpoint topology is non-manifold or degenerate.');
    }
    addAdjacency(a, b, face.id);
    addAdjacency(b, a, face.id);
  }

  type FanSolution = { neighborIds: string[]; faceIds: string[] };
  const solutions: FanSolution[] = [];
  const usedFaces = new Set<string>();
  const pathNeighbors = [startNeighborId];
  const pathFaces: string[] = [];

  const visit = (neighborId: string) => {
    if (solutions.length > 1) return;
    if (neighborId === endNeighborId) {
      if (usedFaces.size === endpointFaces.length) {
        solutions.push({ neighborIds: [...pathNeighbors], faceIds: [...pathFaces] });
      }
      return;
    }
    for (const edge of adjacency.get(neighborId) ?? []) {
      if (usedFaces.has(edge.faceId)) continue;
      usedFaces.add(edge.faceId);
      pathFaces.push(edge.faceId);
      pathNeighbors.push(edge.to);
      visit(edge.to);
      pathNeighbors.pop();
      pathFaces.pop();
      usedFaces.delete(edge.faceId);
    }
  };
  visit(startNeighborId);

  if (solutions.length === 0) {
    throw new Error('Bevel Edge endpoint fan is open, disconnected, or non-manifold.');
  }
  if (solutions.length > 1) {
    throw new Error('Bevel Edge endpoint fan branches and cannot be resolved uniquely.');
  }

  const plan = solutions[0];
  if (new Set(plan.neighborIds).size !== plan.neighborIds.length) {
    throw new Error('Bevel Edge endpoint fan contains a repeated neighbor.');
  }
  return plan;
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

const compactUnusedConstructionVertices = (state: ConstructionMutationState): void => {
  const usedVertexIds = Array.from(new Set(state.faces.flat())).sort((a, b) => a - b);
  const remap = new Map<number, number>();
  usedVertexIds.forEach((vertexId, nextId) => remap.set(vertexId, nextId));

  const nextVertices: number[] = [];
  const nextUvs: number[] = [];
  const nextColors: number[] = [];
  for (const vertexId of usedVertexIds) {
    nextVertices.push(
      state.vertices[vertexId * 3] ?? 0,
      state.vertices[vertexId * 3 + 1] ?? 0,
      state.vertices[vertexId * 3 + 2] ?? 0,
    );
    nextUvs.push(state.uvs[vertexId * 2] ?? 0, state.uvs[vertexId * 2 + 1] ?? 0);
    nextColors.push(
      state.colors[vertexId * 3] ?? 1,
      state.colors[vertexId * 3 + 1] ?? 1,
      state.colors[vertexId * 3 + 2] ?? 1,
    );
  }

  state.faces = state.faces.map(face => face.map(vertexId => {
    const nextId = remap.get(vertexId);
    if (nextId === undefined) throw new Error('Construction vertex compaction lost a face vertex.');
    return nextId;
  }));
  state.indices = state.indices.map(vertexId => {
    const nextId = remap.get(vertexId);
    if (nextId === undefined) throw new Error('Construction vertex compaction lost an indexed vertex.');
    return nextId;
  });

  for (const point of state.construction.points) {
    point.vertexIds = Array.from(new Set((point.vertexIds ?? [])
      .map(vertexId => remap.get(vertexId))
      .filter((vertexId): vertexId is number => vertexId !== undefined)));
  }

  const nextSiblings = new Map<number, number[]>();
  for (const [vertexId, siblings] of state.siblings.entries()) {
    const nextVertexId = remap.get(vertexId);
    if (nextVertexId === undefined) continue;
    const nextGroup = Array.from(new Set(siblings
      .map(siblingId => remap.get(siblingId))
      .filter((siblingId): siblingId is number => siblingId !== undefined)));
    if (nextGroup.length > 0) nextSiblings.set(nextVertexId, nextGroup);
  }
  state.siblings = nextSiblings;
  state.vertices = nextVertices;
  state.uvs = nextUvs;
  state.colors = nextColors;
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
 * Triangulates an ordered simple Construction Face boundary of arbitrary vertex
 * count. Repeated bevels routinely reconstruct quads as 5/6/8-sided n-gons, so
 * this compiler step must not assume that a non-degenerate triangle fan is a
 * valid triangulation: on a concave polygon such a fan can cross the boundary.
 *
 * Convex polygons keep the historical rotating-fan path (which handles
 * collinear Split Edge points well). Concave polygons use projected 2D ear
 * clipping while preserving the original 3D winding.
 */
const triangulateConstructionBoundary = (
  state: ConstructionMutationState,
  vertexIds: readonly number[],
): number[] => {
  if (vertexIds.length < 3) throw new Error('A Construction Face requires at least 3 vertices.');
  const epsilonSq = 1e-20;
  const epsilon2d = 1e-10;

  const positions: Vector3[] = vertexIds.map(vertexId => ({
    x: state.vertices[vertexId * 3],
    y: state.vertices[vertexId * 3 + 1],
    z: state.vertices[vertexId * 3 + 2],
  }));
  const normal = computePlanarFaceNormal(positions);
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  const projected: Vec2[] = positions.map(position => {
    if (ax >= ay && ax >= az) return { x: position.y, y: position.z };
    if (ay >= ax && ay >= az) return { x: position.x, y: position.z };
    return { x: position.x, y: position.y };
  });

  let twiceArea = 0;
  for (let index = 0; index < projected.length; index += 1) {
    twiceArea += cross2(projected[index], projected[(index + 1) % projected.length]);
  }
  if (Math.abs(twiceArea) <= epsilon2d) throw new Error('Construction Face triangulation is degenerate.');
  const orientation = twiceArea > 0 ? 1 : -1;
  const orientedTurn = (a: Vec2, b: Vec2, c: Vec2): number =>
    cross2(subtract2(b, a), subtract2(c, b)) * orientation;

  const fanForRoot = (rootIndex: number): number[] | null => {
    const ordered = Array.from({ length: vertexIds.length }, (_, offset) => vertexIds[(rootIndex + offset) % vertexIds.length]);
    const triangles: number[] = [];
    for (let i = 1; i < ordered.length - 1; i += 1) {
      if (triangleAreaSquared(state, ordered[0], ordered[i], ordered[i + 1]) <= epsilonSq) return null;
      triangles.push(ordered[0], ordered[i], ordered[i + 1]);
    }
    return triangles;
  };

  // A triangle fan is only topologically valid for a convex boundary. The old
  // implementation returned the first non-degenerate fan even for concave
  // n-gons, which could produce triangles outside the logical face.
  const isConvex = projected.every((point, index) => (
    orientedTurn(
      point,
      projected[(index + 1) % projected.length],
      projected[(index + 2) % projected.length],
    ) >= -epsilon2d
  ));
  if (isConvex) {
    for (let rootIndex = 0; rootIndex < vertexIds.length; rootIndex += 1) {
      const fan = fanForRoot(rootIndex);
      if (fan) return fan;
    }
  }

  const pointInTriangleInclusive = (point: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean => {
    const ab = cross2(subtract2(b, a), subtract2(point, a)) * orientation;
    const bc = cross2(subtract2(c, b), subtract2(point, b)) * orientation;
    const ca = cross2(subtract2(a, c), subtract2(point, c)) * orientation;
    return ab >= -epsilon2d && bc >= -epsilon2d && ca >= -epsilon2d;
  };

  const remaining = vertexIds.map((_, index) => index);
  const triangles: number[] = [];
  let guard = 0;
  while (remaining.length > 3) {
    let earPosition = -1;
    for (let position = 0; position < remaining.length; position += 1) {
      const prevIndex = remaining[(position - 1 + remaining.length) % remaining.length];
      const currentIndex = remaining[position];
      const nextIndex = remaining[(position + 1) % remaining.length];
      const a = projected[prevIndex];
      const b = projected[currentIndex];
      const c = projected[nextIndex];

      if (orientedTurn(a, b, c) <= epsilon2d) continue;
      if (triangleAreaSquared(state, vertexIds[prevIndex], vertexIds[currentIndex], vertexIds[nextIndex]) <= epsilonSq) continue;

      let containsBoundaryPoint = false;
      for (const testIndex of remaining) {
        if (testIndex === prevIndex || testIndex === currentIndex || testIndex === nextIndex) continue;
        if (pointInTriangleInclusive(projected[testIndex], a, b, c)) {
          containsBoundaryPoint = true;
          break;
        }
      }
      if (containsBoundaryPoint) continue;

      earPosition = position;
      triangles.push(vertexIds[prevIndex], vertexIds[currentIndex], vertexIds[nextIndex]);
      break;
    }

    // Fallback for split-edge or slightly warped polygons with near-collinear ears:
    // relax the turn & containment tolerance while still requiring non-degenerate 3D area.
    if (earPosition < 0) {
      let bestTurn = -Infinity;
      for (let position = 0; position < remaining.length; position += 1) {
        const prevIndex = remaining[(position - 1 + remaining.length) % remaining.length];
        const currentIndex = remaining[position];
        const nextIndex = remaining[(position + 1) % remaining.length];
        if (triangleAreaSquared(state, vertexIds[prevIndex], vertexIds[currentIndex], vertexIds[nextIndex]) <= epsilonSq) continue;
        const a = projected[prevIndex];
        const b = projected[currentIndex];
        const c = projected[nextIndex];
        const turn = orientedTurn(a, b, c);
        if (turn < -1e-5) continue;
        let strictlyContainsOther = false;
        for (const testIndex of remaining) {
          if (testIndex === prevIndex || testIndex === currentIndex || testIndex === nextIndex) continue;
          const pt = projected[testIndex];
          const ab = cross2(subtract2(b, a), subtract2(pt, a)) * orientation;
          const bc = cross2(subtract2(c, b), subtract2(pt, b)) * orientation;
          const ca = cross2(subtract2(a, c), subtract2(pt, c)) * orientation;
          if (ab > 1e-6 && bc > 1e-6 && ca > 1e-6) {
            strictlyContainsOther = true;
            break;
          }
        }
        if (!strictlyContainsOther && turn > bestTurn) {
          bestTurn = turn;
          earPosition = position;
        }
      }
      if (earPosition >= 0) {
        const prevIndex = remaining[(earPosition - 1 + remaining.length) % remaining.length];
        const currentIndex = remaining[earPosition];
        const nextIndex = remaining[(earPosition + 1) % remaining.length];
        triangles.push(vertexIds[prevIndex], vertexIds[currentIndex], vertexIds[nextIndex]);
      }
    }

    if (earPosition < 0) {
      throw new Error('Construction Face triangulation requires a simple non-self-intersecting n-gon.');
    }
    remaining.splice(earPosition, 1);
    guard += 1;
    if (guard > vertexIds.length * vertexIds.length) {
      throw new Error('Construction Face triangulation did not converge.');
    }
  }

  const [aIndex, bIndex, cIndex] = remaining;
  if (triangleAreaSquared(state, vertexIds[aIndex], vertexIds[bIndex], vertexIds[cIndex]) <= epsilonSq) {
    throw new Error('Construction Face triangulation is degenerate.');
  }
  triangles.push(vertexIds[aIndex], vertexIds[bIndex], vertexIds[cIndex]);
  if (triangles.length !== (vertexIds.length - 2) * 3) {
    throw new Error('Construction Face triangulation produced an incomplete n-gon triangulation.');
  }
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

/**
 * Legacy Construction adapter for the normal-mesh relative inset implementation.
 * Geometry math is intentionally independent of Construction so ordinary,
 * warped, wall/roof and split-edge boundaries follow the same code path.
 */
const computeInsetPositions = (
  construction: StaticMeshConstructionData,
  pointIds: readonly string[],
  ratio: number,
): Vector3[] => computeRelativeInsetPositions(
  pointIds.map(pointId => clonePosition(findConstructionPoint(construction, pointId).position)),
  ratio,
);

const computeConstructionFaceNormal = (
  construction: StaticMeshConstructionData,
  pointIds: readonly string[],
): Vector3 => computePlanarFaceNormal(
  pointIds.map(pointId => clonePosition(findConstructionPoint(construction, pointId).position)),
);
const activeLogicalModelingDepthByAsset = new Map<string, number>();
const transientLogicalConstructionByAsset = new Map<string, StaticMeshConstructionData>();

const getTransientOrPersistedConstruction = (asset: StaticMeshAsset): StaticMeshConstructionData => {
  const construction = asset.construction ?? transientLogicalConstructionByAsset.get(asset.id);
  if (!construction) {
    throw new Error(`Static Mesh '${asset.id}' does not have an active construction state.`);
  }
  return construction;
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
  invalidateMeshConnectivity(topology);

  const geometry: MeshGeometry = {
    ...state.asset.geometry,
    vertices,
    normals: computeVertexNormals(state.vertices, state.indices),
    uvs: new Float32Array(state.uvs.slice(0, vertexCount * 2)),
    colors: new Float32Array(state.colors.slice(0, vertexCount * 3)),
    indices,
    aabb: vertexCount > 0 ? computeAABB(vertices) : undefined,
  };

  const isTransientLogicalModeling = (activeLogicalModelingDepthByAsset.get(state.asset.id) ?? 0) > 0;
  if (isTransientLogicalModeling) {
    transientLogicalConstructionByAsset.set(state.asset.id, state.construction);
  }

  const shells = resolveStaticMeshShells({
    ...state.asset,
    geometry,
    topology,
    construction: isTransientLogicalModeling ? undefined : state.construction,
  }).map(shell => materializeStaticMeshShell(shell));

  assetManager.updateAsset(state.asset.id, {
    geometry,
    topology,
    shells,
    construction: isTransientLogicalModeling ? undefined : state.construction,
  });
};

interface AppliedJointBevelEdgeResult {
  bevelFaceId: string;
  bevelFaceIds: string[];
  endpointCapFaceIds: string[];
  updatedFaceIds: string[];
  railPointIds: [[string, string], [string, string]];
  profileRailPointIds: Array<[string, string]>;
}

interface AppliedJointBevelResult {
  edgeResults: AppliedJointBevelEdgeResult[];
  cornerFaceIds: string[];
  updatedFaceIds: string[];
}

const bevelPlanCornerKey = (faceId: string, pointId: string): string => `${faceId}\u0000${pointId}`;

const compactCyclicPointIds = (pointIds: readonly string[]): string[] => {
  const compact: string[] = [];
  for (const pointId of pointIds) {
    if (compact[compact.length - 1] !== pointId) compact.push(pointId);
  }
  if (compact.length > 1 && compact[0] === compact[compact.length - 1]) compact.pop();
  return compact;
};

const boundaryDirectedEdge = (pointIds: readonly string[], a: string, b: string): 1 | -1 | 0 => {
  for (let index = 0; index < pointIds.length; index += 1) {
    const current = pointIds[index];
    const next = pointIds[(index + 1) % pointIds.length];
    if (current === a && next === b) return 1;
    if (current === b && next === a) return -1;
  }
  return 0;
};

/**
 * Materializes a joint bevel plan into the temporary Construction adapter in one
 * topology mutation. Original faces are rewritten once, then edge strips and
 * VMesh-style corner patches are added. Numeric mesh ids are resolved only after
 * compaction so editor selections receive stable post-operation ids.
 */
const applyJointBevelPlan = (
  state: ConstructionMutationState,
  plan: BevelKernelPlan,
): AppliedJointBevelResult => {
  const operationId = makeUniqueOperationId(
    undefined,
    'bevel-network',
    [
      ...state.construction.faces.map(face => face.id),
      ...state.construction.loops.map(loop => loop.id),
      ...state.construction.points.map(point => point.id),
    ],
  );

  const semanticPointIdByPlanKey = new Map<string, string>();
  plan.points.forEach((plannedPoint, index) => {
    const sourcePoint = findConstructionPoint(state.construction, plannedPoint.sourcePointId);
    const pointId = makeUniqueConstructionId(
      `${operationId}.point.${index}`,
      'point',
      state.construction.points.map(point => point.id),
    );
    state.construction.points.push({
      id: pointId,
      name: sourcePoint.name ? `${sourcePoint.name} Bevel` : undefined,
      role: 'GUIDE',
      groupId: sourcePoint.groupId,
      tags: sourcePoint.tags ? [...sourcePoint.tags] : undefined,
      data: {
        ...(sourcePoint.data ?? {}),
        sourcePointId: sourcePoint.id,
        bevelOperationId: operationId,
      },
      position: clonePosition(plannedPoint.position),
      vertexIds: [],
    });
    semanticPointIdByPlanKey.set(plannedPoint.key, pointId);
  });

  const resolvePlanPoint = (key: string): string => {
    const pointId = semanticPointIdByPlanKey.get(key);
    if (!pointId) throw new Error(`Bevel network could not resolve planned boundary point '${key}'.`);
    return pointId;
  };

  const originalFaceIds = state.construction.faces.map(face => face.id);
  const updatedFaceIds: string[] = [];
  const updatedFacesBySourcePoint = new Map<string, Set<string>>();
  for (const faceId of originalFaceIds) {
    const face = findConstructionFace(state.construction, faceId);
    const originalBoundary = [...face.pointIds];
    const nextBoundary: string[] = [];
    let changed = false;
    for (const sourcePointId of originalBoundary) {
      const replacementKeys = plan.replacements.get(bevelPlanCornerKey(face.id, sourcePointId));
      if (!replacementKeys) {
        nextBoundary.push(sourcePointId);
        continue;
      }
      changed = true;
      const replacementPointIds = replacementKeys.map(resolvePlanPoint);
      nextBoundary.push(...replacementPointIds);
      const touchedFaces = updatedFacesBySourcePoint.get(sourcePointId) ?? new Set<string>();
      touchedFaces.add(face.id);
      updatedFacesBySourcePoint.set(sourcePointId, touchedFaces);
    }
    if (!changed) continue;
    const compactBoundary = compactCyclicPointIds(nextBoundary);
    if (compactBoundary.length < 3 || new Set(compactBoundary).size !== compactBoundary.length) {
      throw new Error(`Bevel network would create a degenerate logical face '${face.id}'.`);
    }
    replaceConstructionFaceBoundaryInState(state, face, compactBoundary);
    updatedFaceIds.push(face.id);
  }

  const bevelFaceIds: string[] = [];
  const bevelFaceIdsByEdge: string[][] = [];
  for (let index = 0; index < plan.edges.length; index += 1) {
    const edgePlan = plan.edges[index];
    const [profileA, profileB] = edgePlan.profilePointKeys;
    if (profileA.length !== plan.segments + 1 || profileB.length !== plan.segments + 1) {
      throw new Error('Bevel network profile row does not match the requested segment count.');
    }
    const sourceEdgeFaceIds: string[] = [];
    for (let segment = 0; segment < plan.segments; segment += 1) {
      const rawPointIds = [
        resolvePlanPoint(profileA[segment]),
        resolvePlanPoint(profileA[segment + 1]),
        resolvePlanPoint(profileB[segment + 1]),
        resolvePlanPoint(profileB[segment]),
      ];
      const pointIds = compactCyclicPointIds(rawPointIds);
      // Blender's VMesh can intentionally share the same BMVert between adjacent
      // boundary roles. For one segment that turns a nominal bevel quad into a
      // valid triangle at a collapsed endpoint; do not materialize coincident
      // duplicate vertices just to preserve a four-id array.
      if (pointIds.length < 3 || new Set(pointIds).size !== pointIds.length) {
        throw new Error('Bevel network produced a collapsed or self-touching edge strip.');
      }
      const bevelFace = addConstructionFaceToState(state, {
        id: `${operationId}.edge.${index}.segment.${segment}`,
        name: plan.segments === 1
          ? `Bevel Edge ${index + 1}`
          : `Bevel Edge ${index + 1} Segment ${segment + 1}`,
        pointIds: [...pointIds],
      });
      bevelFaceIds.push(bevelFace.id);
      sourceEdgeFaceIds.push(bevelFace.id);
    }
    bevelFaceIdsByEdge.push(sourceEdgeFaceIds);
  }

  const cornerFaceIdsBySourcePoint = new Map<string, string[]>();
  const allCornerFaceIds: string[] = [];

  const normalizeCornerBoundaryOrientation = (inputPointIds: string[]): string[] => {
    let pointIds = [...inputPointIds];
    // A manifold cap must traverse every shared boundary edge opposite to the
    // already-created neighboring face. Use the first shared edge to normalize
    // the cyclic boundary orientation before materializing the corner mesh.
    let shouldReverse = false;
    let foundSharedDirection = false;
    for (let edgeIndex = 0; edgeIndex < pointIds.length && !foundSharedDirection; edgeIndex += 1) {
      const a = pointIds[edgeIndex];
      const b = pointIds[(edgeIndex + 1) % pointIds.length];
      for (const existingFace of state.construction.faces) {
        const relation = boundaryDirectedEdge(existingFace.pointIds, a, b);
        if (relation === 0) continue;
        shouldReverse = relation === 1;
        foundSharedDirection = true;
        break;
      }
    }
    if (shouldReverse) pointIds = [...pointIds].reverse();
    return pointIds;
  };

  for (let index = 0; index < plan.corners.length; index += 1) {
    const corner = plan.corners[index];
    // Blender M_NONE is a semantic no-cap decision, not merely a consequence
    // of having two boundary points. Segmented profiles can contain 3+ samples
    // while the endpoint still owns no corner polygon (notably an open box rim).
    if (corner.meshKind === 'NONE' || corner.boundaryPointKeys.length < 3) continue;
    let pointIds = corner.boundaryPointKeys.map(resolvePlanPoint);
    pointIds = pointIds.filter((pointId, pointIndex) => pointIds.indexOf(pointId) === pointIndex);
    if (pointIds.length < 3) continue;
    pointIds = normalizeCornerBoundaryOrientation(pointIds);

    const createdFaceIds: string[] = [];
    if (corner.meshKind === 'ADJ') {
      if (!corner.adj || corner.adj.facePointKeys.length === 0) {
        throw new Error('Bevel ADJ corner is missing its structured VMesh cells.');
      }

      // M_ADJ cells are authored topology, not render triangulation. Materialize
      // every ring/grid cell as its own logical face so the profile rows continue
      // through the corner exactly as the edge strips do. The first outer cells
      // share edges with already-created bevel/source faces; normalizing each cell
      // against the current mesh then propagates a consistent manifold winding
      // inward through the grid.
      for (let cellIndex = 0; cellIndex < corner.adj.facePointKeys.length; cellIndex += 1) {
        let cellPointIds = corner.adj.facePointKeys[cellIndex].map(resolvePlanPoint);
        cellPointIds = cellPointIds.filter((pointId, pointIndex) => cellPointIds.indexOf(pointId) === pointIndex);
        if (cellPointIds.length < 3) continue;
        cellPointIds = normalizeCornerBoundaryOrientation(cellPointIds);
        const face = addConstructionFaceToState(state, {
          id: `${operationId}.corner.${index}.adj.${cellIndex}`,
          name: `Bevel Corner ${index + 1} Grid ${cellIndex + 1}`,
          pointIds: cellPointIds,
        });
        createdFaceIds.push(face.id);
        allCornerFaceIds.push(face.id);
      }
    }
    else if (corner.meshKind === 'TRI_FAN') {
      if (!corner.fanPointKey) throw new Error('Bevel triangle-fan corner is missing its fan apex.');
      const fanPointId = resolvePlanPoint(corner.fanPointKey);
      const fanIndex = pointIds.indexOf(fanPointId);
      if (fanIndex < 0) throw new Error('Bevel triangle-fan apex is not part of the corner boundary.');

      // Rotate the cyclic boundary so the fan apex is first. All remaining
      // vertices are the segmented profile chain in boundary order. Splitting
      // [fan, p0, p1, ... pn] into [fan, pi, pi+1] matches Blender's
      // bevel_build_trifan() and creates the visible radial edges missing from
      // a single n-gon cap.
      const rotated = [
        ...pointIds.slice(fanIndex),
        ...pointIds.slice(0, fanIndex),
      ];
      if (rotated.length < 3) continue;
      for (let fanSegment = 1; fanSegment < rotated.length - 1; fanSegment += 1) {
        const trianglePointIds = [rotated[0], rotated[fanSegment], rotated[fanSegment + 1]];
        if (new Set(trianglePointIds).size !== 3) continue;
        const face = addConstructionFaceToState(state, {
          id: `${operationId}.corner.${index}.fan.${fanSegment - 1}`,
          name: `Bevel Corner ${index + 1} Fan ${fanSegment}`,
          pointIds: trianglePointIds,
        });
        createdFaceIds.push(face.id);
        allCornerFaceIds.push(face.id);
      }
    }
    else {
      const cap = addConstructionFaceToState(state, {
        id: `${operationId}.corner.${index}`,
        name: `Bevel Corner ${index + 1}`,
        pointIds,
      });
      createdFaceIds.push(cap.id);
      allCornerFaceIds.push(cap.id);
    }

    if (createdFaceIds.length > 0) {
      cornerFaceIdsBySourcePoint.set(corner.sourcePointId, createdFaceIds);
    }
  }

  compactUnusedConstructionVertices(state);
  finalizeConstructionMutation(state);

  const edgeResults: AppliedJointBevelEdgeResult[] = plan.edges.map((edgePlan, index) => ({
    bevelFaceId: bevelFaceIdsByEdge[index][0],
    bevelFaceIds: bevelFaceIdsByEdge[index],
    endpointCapFaceIds: [edgePlan.pointAId, edgePlan.pointBId]
      .flatMap(pointId => cornerFaceIdsBySourcePoint.get(pointId) ?? []),
    updatedFaceIds: Array.from(new Set([
      ...(updatedFacesBySourcePoint.get(edgePlan.pointAId) ?? []),
      ...(updatedFacesBySourcePoint.get(edgePlan.pointBId) ?? []),
    ])),
    railPointIds: edgePlan.railPointKeys.map(([a, b]) => [resolvePlanPoint(a), resolvePlanPoint(b)]) as [[string, string], [string, string]],
    profileRailPointIds: edgePlan.profilePointKeys[0].map((a, profileIndex) => [
      resolvePlanPoint(a),
      resolvePlanPoint(edgePlan.profilePointKeys[1][profileIndex]),
    ] as [string, string]),
  }));

  return {
    edgeResults,
    cornerFaceIds: allCornerFaceIds,
    updatedFaceIds,
  };
};

interface LogicalModelingAdapter {
  construction: StaticMeshConstructionData;
  pointIdByVertex: Map<number, string>;
  faceIdByLogical: Map<number, string>;
}

/**
 * Build a temporary semantic view of the current logical topology. This adapter
 * exists only so the proven Construction algorithms can be reused while the
 * public/editor modeling contract moves to normal numeric mesh ids. It is never
 * persisted by the normal-mesh API path.
 */
const buildLogicalModelingAdapter = (asset: StaticMeshAsset): LogicalModelingAdapter => {
  const faces = sourceFaces(asset);
  const { vertexToCanonical, groups } = buildCanonicalVertexGroups(asset);
  assertAdoptableSiblingPositions(asset, groups);

  const pointIdByCanonical = new Map<number, string>();
  const pointIdByVertex = new Map<number, string>();
  const points: StaticMeshConstructionPoint[] = [];

  for (const canonical of Array.from(groups.keys()).sort((a, b) => a - b)) {
    const group = groups.get(canonical)!;
    const id = `__logical.point.${canonical}`;
    pointIdByCanonical.set(canonical, id);
    for (const vertexId of group) pointIdByVertex.set(vertexId, id);
    const offset = canonical * 3;
    points.push({
      id,
      role: 'CORNER',
      position: {
        x: asset.geometry.vertices[offset],
        y: asset.geometry.vertices[offset + 1],
        z: asset.geometry.vertices[offset + 2],
      },
      vertexIds: [...group],
    });
  }

  const faceIdByLogical = new Map<number, string>();
  const semanticFaces: StaticMeshConstructionFace[] = faces.map((faceVertexIds, faceId) => {
    const id = `__logical.face.${faceId}`;
    faceIdByLogical.set(faceId, id);
    const pointIds = faceVertexIds.map(vertexId => {
      const canonical = vertexToCanonical.get(vertexId);
      if (canonical === undefined) throw new Error(`Logical mesh could not resolve vertex ${vertexId}.`);
      const pointId = pointIdByCanonical.get(canonical);
      if (!pointId) throw new Error(`Logical mesh could not resolve canonical vertex ${canonical}.`);
      return pointId;
    });
    if (new Set(pointIds).size !== pointIds.length) {
      throw new Error(`Logical face ${faceId} is degenerate after explicit sibling welds.`);
    }
    return { id, pointIds, faceId };
  });

  return {
    construction: { points, faces: semanticFaces, loops: [] },
    pointIdByVertex,
    faceIdByLogical,
  };
};

const replaceAllText = (value: string, search: string, replacement: string): string =>
  value.split(search).join(replacement);

const logicalModelingError = (error: unknown): Error => {
  if (!(error instanceof Error)) return new Error(String(error));
  const replacements: ReadonlyArray<readonly [string, string]> = [
    ['Construction Points', 'mesh vertices'],
    ['Construction Point', 'mesh vertex'],
    ['Construction Faces', 'logical faces'],
    ['Construction Face', 'logical face'],
    ['Construction Loop', 'mesh loop'],
    ['authored faces', 'logical faces'],
    ['authored face', 'logical face'],
    ['authored edge', 'logical edge'],
    ['authored vertices', 'mesh vertices'],
  ];
  const message = replacements.reduce(
    (current, [search, replacement]) => replaceAllText(current, search, replacement),
    error.message,
  );
  return message === error.message ? error : new Error(message);
};

const requireLogicalFaceId = (asset: StaticMeshAsset, faceId: number): number => {
  if (!Number.isInteger(faceId) || faceId < 0 || faceId >= sourceFaces(asset).length) {
    throw new Error(`Logical face ${faceId} was not found.`);
  }
  return faceId;
};

const requireLogicalVertexId = (asset: StaticMeshAsset, vertexId: number): number => {
  const vertexCount = Math.floor(asset.geometry.vertices.length / 3);
  if (!Number.isInteger(vertexId) || vertexId < 0 || vertexId >= vertexCount) {
    throw new Error(`Mesh vertex ${vertexId} was not found.`);
  }
  return vertexId;
};

/**
 * Stable asset-level API for Static Mesh composition. UI surfaces should call
 * this service instead of mutating geometry/editor metadata directly.
 */
class StaticMeshAssetAPIService {
  create(args: CreateStaticMeshArgs): StaticMeshAsset {
    return assetManager.createStaticMesh(args.name, args.path ?? '/Content/Meshes');
  }

  /**
   * Adds stable semantic Construction handles to an existing logical Static Mesh
   * without changing geometry, logical faces, triangle mapping, shells or winding.
   * Explicit sibling/weld groups become one Construction Point with multiple
   * bound render vertices; equal XYZ positions alone are never merged.
   *
   * Construction Loops are intentionally not guessed here. A loop is an authored
   * path/region concept, while raw logical topology only guarantees vertices and
   * faces. Modeling operations may create explicit loops later.
   */
  adoptTopology(args: AdoptStaticMeshTopologyArgs): AdoptStaticMeshTopologyResult {
    const asset = requireStaticMesh(args.assetId, 'target');
    const faces = sourceFaces(asset);
    if (faces.length === 0) throw new Error('Adopt Topology requires at least one logical face.');

    if (isConstructionTopologyAdopted(asset)) {
      return {
        assetId: asset.id,
        adopted: false,
        pointsCreated: 0,
        facesCreated: 0,
        loopsCreated: 0,
        pointIds: (asset.construction?.points ?? []).map(point => point.id),
        faceIds: (asset.construction?.faces ?? []).map(face => face.id),
      };
    }

    const existing = asset.construction;
    if (existing && (existing.points.length > 0 || existing.faces.length > 0 || existing.loops.length > 0)) {
      throw new Error('Adopt Topology requires an empty Construction layer; this mesh already contains authored Construction data.');
    }

    return assetHistory.execute(asset.id, 'Adopt Static Mesh Topology', () => {
      const current = requireStaticMesh(args.assetId, 'target');
      const currentFaces = sourceFaces(current);
      const { vertexToCanonical, groups } = buildCanonicalVertexGroups(current);
      assertAdoptableSiblingPositions(current, groups);

      const pointPrefix = args.pointPrefix?.trim() || 'point:auto';
      const facePrefix = args.facePrefix?.trim() || 'face:auto';
      const pointIdByCanonical = new Map<number, string>();
      const points: StaticMeshConstructionPoint[] = [];

      for (const canonical of Array.from(groups.keys()).sort((a, b) => a - b)) {
        const group = groups.get(canonical)!;
        const offset = canonical * 3;
        const id = `${pointPrefix}.${canonical}`;
        pointIdByCanonical.set(canonical, id);
        points.push({
          id,
          role: 'CORNER',
          position: {
            x: current.geometry.vertices[offset],
            y: current.geometry.vertices[offset + 1],
            z: current.geometry.vertices[offset + 2],
          },
          tags: ['adopted-topology'],
          data: { source: 'logical-topology', canonicalVertexId: canonical },
          vertexIds: [...group],
        });
      }

      const constructionFaces: StaticMeshConstructionFace[] = currentFaces.map((faceVertexIds, faceId) => {
        const pointIds = faceVertexIds.map(vertexId => {
          const canonical = vertexToCanonical.get(vertexId);
          if (canonical === undefined) throw new Error(`Adopt Topology could not resolve mesh vertex ${vertexId}.`);
          const pointId = pointIdByCanonical.get(canonical);
          if (!pointId) throw new Error(`Adopt Topology could not resolve canonical mesh vertex ${canonical}.`);
          return pointId;
        });
        if (new Set(pointIds).size !== pointIds.length) {
          throw new Error(`Adopt Topology found a degenerate logical face ${faceId} after applying explicit sibling welds.`);
        }
        return {
          id: `${facePrefix}.${faceId}`,
          name: `Adopted Face ${faceId}`,
          pointIds,
          faceId,
        };
      });

      const construction: StaticMeshConstructionData = {
        points,
        faces: constructionFaces,
        loops: [],
      };
      assetManager.updateAsset(current.id, { construction });
      return {
        assetId: current.id,
        adopted: true,
        pointsCreated: points.length,
        facesCreated: constructionFaces.length,
        loopsCreated: 0,
        pointIds: points.map(point => point.id),
        faceIds: constructionFaces.map(face => face.id),
      };
    });
  }

  isTopologyAdopted(assetId: string): boolean {
    return isConstructionTopologyAdopted(requireStaticMesh(assetId, 'target'));
  }

  canAdoptTopology(assetId: string): boolean {
    const asset = requireStaticMesh(assetId, 'target');
    if (sourceFaces(asset).length === 0 || isConstructionTopologyAdopted(asset)) return false;
    const construction = asset.construction;
    return !construction || (
      construction.points.length === 0
      && construction.faces.length === 0
      && construction.loops.length === 0
    );
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

  /**
   * Normal mesh modeling is authoritative on LogicalMesh numeric ids. The
   * mature legacy Construction algorithms are currently reused through a
   * transient adapter, but that adapter is removed before commit. A human
   * normal-topology edit also invalidates any pre-existing optional planning
   * metadata rather than pretending to keep a second topology synchronized;
   * Undo restores the complete pre-edit snapshot when needed.
   */
  private runLogicalModeling<T>(assetId: string, label: string, mutation: (adapter: LogicalModelingAdapter) => T): T {
    try {
      return assetHistory.transaction(assetId, label, () => {
        const asset = requireStaticMesh(assetId, 'target');
        const adapter = buildLogicalModelingAdapter(asset);
        const prevDepth = activeLogicalModelingDepthByAsset.get(assetId) ?? 0;
        activeLogicalModelingDepthByAsset.set(assetId, prevDepth + 1);
        // Internal bridge only. Do not emit an intermediate ASSET_UPDATED event.
        asset.construction = adapter.construction;
        transientLogicalConstructionByAsset.set(assetId, adapter.construction);
        try {
          const result = mutation(adapter);
          const updated = requireStaticMesh(assetId, 'target');
          if (updated.construction !== undefined) {
            updated.construction = undefined;
          }
          return result;
        } finally {
          const nextDepth = (activeLogicalModelingDepthByAsset.get(assetId) ?? 1) - 1;
          if (nextDepth <= 0) {
            activeLogicalModelingDepthByAsset.delete(assetId);
            transientLogicalConstructionByAsset.delete(assetId);
          } else {
            activeLogicalModelingDepthByAsset.set(assetId, nextDepth);
          }
        }
      });
    } catch (error) {
      throw logicalModelingError(error);
    }
  }

  /**
   * Appends a welded, manifold procedural primitive shell (PLANE, BOX, GRID, CYLINDER, PYRAMID)
   * directly into a normal Static Mesh asset (working on empty scratch meshes or existing meshes).
   */
  addPrimitive(args: AddStaticMeshPrimitiveArgs): StaticMeshPrimitiveResult {
    const target = requireStaticMesh(args.assetId, 'target');
    const label = `Add ${args.kind} Primitive`;
    return assetHistory.execute(target.id, label, () => {
      const current = requireStaticMesh(args.assetId, 'target');
      const primitive = buildStaticMeshPrimitiveGeometry(args);
      const existingVertexCount = Math.floor(current.geometry.vertices.length / 3);
      const existingTriangleCount = Math.floor(current.geometry.indices.length / 3);
      const existingFaces = sourceFaces(current);
      const existingFaceCount = existingFaces.length;

      const primVertexCount = primitive.positions.length;
      const primFaceCount = primitive.faces.length;

      const primVertices = new Float32Array(primVertexCount * 3);
      const primUvs = new Float32Array(primVertexCount * 2);
      const primColors = new Float32Array(primVertexCount * 3).fill(1);
      for (let i = 0; i < primVertexCount; i += 1) {
        const pos = primitive.positions[i];
        primVertices[i * 3] = pos.x;
        primVertices[i * 3 + 1] = pos.y;
        primVertices[i * 3 + 2] = pos.z;
        const uv = primitive.uvs[i];
        if (uv) {
          primUvs[i * 2] = uv.u;
          primUvs[i * 2 + 1] = uv.v;
        }
      }

      const totalVertexCount = existingVertexCount + primVertexCount;
      const vertices = new Float32Array(totalVertexCount * 3);
      vertices.set(current.geometry.vertices, 0);
      vertices.set(primVertices, existingVertexCount * 3);

      const uvs = appendFloatAttribute(
        current.geometry.uvs ?? new Float32Array(0),
        existingVertexCount,
        primUvs,
        primVertexCount,
        2,
        0,
      );
      const colors = appendFloatAttribute(
        current.geometry.colors ?? new Float32Array(0),
        existingVertexCount,
        primColors,
        primVertexCount,
        3,
        1,
      );

      const indicesArray: number[] = Array.from(current.geometry.indices);
      const faces: number[][] = existingFaces.map(f => [...f]);
      const triToFace: number[] = Array.from(sourceTriangleToFace(current, existingFaceCount));

      let primTriangleCount = 0;
      for (let fIdx = 0; fIdx < primitive.faces.length; fIdx += 1) {
        const face = primitive.faces[fIdx].map(v => v + existingVertexCount);
        const faceId = existingFaceCount + fIdx;
        faces.push(face);
        for (let i = 1; i < face.length - 1; i += 1) {
          indicesArray.push(face[0], face[i], face[i + 1]);
          triToFace.push(faceId);
          primTriangleCount += 1;
        }
      }

      const siblings = new Map<number, number[]>();
      copySiblingGroups(siblings, current.topology?.siblings, 0);

      const normals = computeVertexNormals(Array.from(vertices), indicesArray);
      const useUint32 = totalVertexCount > 65535 || indicesArray.some(idx => idx > 65535);
      const indices = useUint32 ? new Uint32Array(indicesArray) : new Uint16Array(indicesArray);

      const topology: LogicalMesh = {
        faces,
        triangleToFaceIndex: new Int32Array(triToFace),
        vertexToFaces: rebuildVertexToFaces(faces, siblings),
        siblings,
      };
      topology.graph = MeshTopologyUtils.buildTopology(topology, totalVertexCount);
      invalidateMeshConnectivity(topology);

      const geometry: MeshGeometry = {
        ...current.geometry,
        vertices,
        normals,
        uvs,
        colors,
        indices,
        aabb: totalVertexCount > 0 ? computeAABB(vertices) : undefined,
      };

      const shells = resolveStaticMeshShells({
        ...current,
        geometry,
        topology,
        construction: undefined,
      }).map(shell => materializeStaticMeshShell(shell));

      assetManager.updateAsset(current.id, {
        geometry,
        topology,
        shells,
        construction: undefined,
      });

      const vertexIds = Array.from({ length: primVertexCount }, (_, idx) => existingVertexCount + idx);
      const faceIds = Array.from({ length: primFaceCount }, (_, idx) => existingFaceCount + idx);
      const triangleIds = Array.from({ length: primTriangleCount }, (_, idx) => existingTriangleCount + idx);
      const newShell = shells.find(
        s => existingFaceCount >= s.faceIds.start && existingFaceCount < s.faceIds.endExclusive,
      );

      return {
        assetId: current.id,
        kind: args.kind,
        vertexIds,
        faceIds,
        triangleIds,
        shellId: newShell?.id ?? shells[shells.length - 1]?.id ?? 'shell-0',
      };
    });
  }

  /**
   * Convenience factory: creates a brand-new Static Mesh asset and populates it
   * with a welded, manifold procedural primitive in a single call.
   */
  createPrimitiveMesh(args: CreateStaticMeshPrimitiveArgs): StaticMeshAsset {
    const asset = this.create({ name: args.name, path: args.path });
    const { name: _name, path: _path, ...primitiveOptions } = args;
    this.addPrimitive({
      assetId: asset.id,
      ...primitiveOptions,
    });
    return requireStaticMesh(asset.id, 'target');
  }

  /**
   * Appends raw 3D vertex coordinates into the mesh without requiring the legacy
   * Construction Point layer. Returns the newly allocated numeric vertex IDs.
   */
  addVertices(args: AddLogicalVerticesArgs): number[] {
    const target = requireStaticMesh(args.assetId, 'target');
    if (!Array.isArray(args.positions) || args.positions.length === 0) {
      throw new Error('addVertices requires at least one vertex position.');
    }
    args.positions.forEach((pos, idx) => assertFinitePosition(pos, `Vertex position [${idx}]`));

    return assetHistory.execute(target.id, 'Add Mesh Vertices', () => {
      const current = requireStaticMesh(args.assetId, 'target');
      const existingVertexCount = Math.floor(current.geometry.vertices.length / 3);
      const addedCount = args.positions.length;
      const totalVertexCount = existingVertexCount + addedCount;

      const vertices = new Float32Array(totalVertexCount * 3);
      vertices.set(current.geometry.vertices, 0);
      const addedNormals = new Float32Array(addedCount * 3);
      const addedUvs = new Float32Array(addedCount * 2);
      const addedColors = new Float32Array(addedCount * 3).fill(1);

      const newVertexIds: number[] = [];
      for (let i = 0; i < addedCount; i += 1) {
        const vId = existingVertexCount + i;
        newVertexIds.push(vId);
        const pos = args.positions[i];
        vertices[vId * 3] = pos.x;
        vertices[vId * 3 + 1] = pos.y;
        vertices[vId * 3 + 2] = pos.z;
        addedNormals[i * 3 + 1] = 1;
      }

      const normals = appendFloatAttribute(current.geometry.normals, existingVertexCount, addedNormals, addedCount, 3, 0);
      const uvs = appendFloatAttribute(current.geometry.uvs, existingVertexCount, addedUvs, addedCount, 2, 0);
      const colors = appendFloatAttribute(current.geometry.colors, existingVertexCount, addedColors, addedCount, 3, 1);

      const faces = sourceFaces(current);
      const siblings = new Map<number, number[]>();
      copySiblingGroups(siblings, current.topology?.siblings, 0);
      const topology: LogicalMesh = {
        faces,
        triangleToFaceIndex: sourceTriangleToFace(current, faces.length),
        vertexToFaces: rebuildVertexToFaces(faces, siblings),
        siblings,
      };
      topology.graph = MeshTopologyUtils.buildTopology(topology, totalVertexCount);
      invalidateMeshConnectivity(topology);

      const geometry: MeshGeometry = {
        ...current.geometry,
        vertices,
        normals,
        uvs,
        colors,
        aabb: totalVertexCount > 0 ? computeAABB(vertices) : undefined,
      };

      assetManager.updateAsset(current.id, {
        geometry,
        topology,
        construction: undefined,
      });

      return newVertexIds;
    });
  }

  /**
   * Creates a new logical polygon face directly from ordered numeric vertex IDs.
   * Supports triangles, quads, and convex/concave planar n-gons.
   */
  createFace(args: CreateLogicalFaceArgs): CreateLogicalFaceResult {
    const target = requireStaticMesh(args.assetId, 'target');
    if (!Array.isArray(args.vertexIds) || args.vertexIds.length < 3) {
      throw new Error('A logical face requires at least 3 vertex IDs.');
    }
    const vertexIds = args.vertexIds.map(vId => requireLogicalVertexId(target, vId));
    if (new Set(vertexIds).size !== vertexIds.length) {
      throw new Error('A logical face cannot repeat a vertex ID.');
    }

    return assetHistory.execute(target.id, 'Create Logical Face', () => {
      const current = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(current);
      const triangles = triangulateConstructionBoundary(state, vertexIds);
      const faceId = state.faces.length;
      const triangleStart = Math.floor(state.indices.length / 3);

      state.faces.push([...vertexIds]);
      for (let i = 0; i < triangles.length; i += 3) {
        state.indices.push(triangles[i], triangles[i + 1], triangles[i + 2]);
        state.triangleToFace.push(faceId);
      }
      const triangleEnd = Math.floor(state.indices.length / 3);
      const triangleIds: number[] = [];
      for (let t = triangleStart; t < triangleEnd; t += 1) triangleIds.push(t);

      const prevDepth = activeLogicalModelingDepthByAsset.get(current.id) ?? 0;
      activeLogicalModelingDepthByAsset.set(current.id, prevDepth + 1);
      try {
        finalizeConstructionMutation(state);
      } finally {
        if (prevDepth <= 0) {
          activeLogicalModelingDepthByAsset.delete(current.id);
          transientLogicalConstructionByAsset.delete(current.id);
        } else {
          activeLogicalModelingDepthByAsset.set(current.id, prevDepth);
        }
      }

      return {
        faceId,
        vertexIds: [...vertexIds],
        triangleIds,
      };
    });
  }

  extrudeFace(args: ExtrudeLogicalFaceArgs): ExtrudeLogicalFaceResult;
  extrudeFace(args: ExtrudeConstructionFaceArgs): ExtrudeConstructionFaceResult;
  extrudeFace(args: ExtrudeLogicalFaceArgs | ExtrudeConstructionFaceArgs): ExtrudeLogicalFaceResult | ExtrudeConstructionFaceResult {
    if (typeof args.faceId === 'string') {
      const constructionArgs: ExtrudeConstructionFaceArgs = {
        assetId: args.assetId,
        faceId: args.faceId,
        distance: args.distance,
        ...('id' in args && args.id !== undefined ? { id: args.id } : {}),
      };
      return this.extrudeConstructionFace(constructionArgs);
    }
    const batch = this.extrudeFaces({
      assetId: args.assetId,
      faceIds: [args.faceId],
      distance: args.distance,
    });
    const first = batch.results[0];
    if (!first) throw new Error('Extrude Face did not produce a face result.');
    return first;
  }

  /**
   * Extrudes one or more logical faces in a single atomic history transaction
   * and single topology rebuild.
   */
  extrudeFaces(args: ExtrudeLogicalFacesArgs): ExtrudeLogicalFacesResult {
    const asset = requireStaticMesh(args.assetId, 'target');
    const faceIds = Array.from(new Set(args.faceIds.map(faceId => requireLogicalFaceId(asset, faceId))));
    if (faceIds.length === 0) throw new Error('Extrude requires at least one selected logical face.');
    if (!Number.isFinite(args.distance) || Math.abs(args.distance) <= 1e-8) {
      throw new Error('Extrude distance must be a finite non-zero number.');
    }

    return this.runLogicalModeling(args.assetId, faceIds.length === 1 ? 'Extrude Face' : 'Extrude Faces', adapter => {
      const semanticFaceIds = faceIds.map(faceId => {
        const semanticFaceId = adapter.faceIdByLogical.get(faceId);
        if (!semanticFaceId) throw new Error(`Logical face ${faceId} was not found.`);
        return semanticFaceId;
      });

      const current = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(current);
      const semanticResults = semanticFaceIds.map(semanticFaceId =>
        this.extrudeConstructionFaceInState(state, {
          assetId: args.assetId,
          faceId: semanticFaceId,
          distance: args.distance,
        }),
      );
      finalizeConstructionMutation(state);
      assetHistory.markDirty(args.assetId);

      const construction = state.construction;
      const logicalFace = (semanticId: string): number => {
        const face = findConstructionFace(construction, semanticId);
        return face.faceId;
      };
      const vertex = (semanticId: string): number => {
        const point = findConstructionPoint(construction, semanticId);
        const vertexId = point.vertexIds?.[0];
        if (vertexId === undefined) throw new Error(`Extrude Faces could not resolve generated mesh vertex '${semanticId}'.`);
        return vertexId;
      };

      const results = semanticResults.map((result, index): ExtrudeLogicalFaceResult => ({
        sourceFaceId: faceIds[index],
        topFaceId: logicalFace(result.topFaceId),
        topVertexIds: result.topPointIds.map(vertex),
        sideFaceIds: result.sideFaceIds.map(logicalFace),
      }));

      return {
        results,
        topFaceIds: results.map(r => r.topFaceId),
        sideFaceIds: results.flatMap(r => r.sideFaceIds),
      };
    });
  }

  insetFace(args: InsetLogicalFaceArgs): InsetLogicalFaceResult;
  insetFace(args: InsetConstructionFaceArgs): InsetConstructionFaceResult;
  insetFace(args: InsetLogicalFaceArgs | InsetConstructionFaceArgs): InsetLogicalFaceResult | InsetConstructionFaceResult {
    if (typeof args.faceId === 'string') {
      const constructionArgs: InsetConstructionFaceArgs = {
        assetId: args.assetId,
        faceId: args.faceId,
        ratio: args.ratio,
        ...('id' in args && args.id !== undefined ? { id: args.id } : {}),
      };
      return this.insetConstructionFace(constructionArgs);
    }
    const batch = this.insetFaces({
      assetId: args.assetId,
      faceIds: [args.faceId],
      ratio: args.ratio,
    });
    const first = batch.results[0];
    if (!first) throw new Error('Inset Face did not produce a face result.');
    return first;
  }

  /**
   * Insets multiple normal LogicalMesh faces as one atomic modeling action
   * and single topology rebuild.
   */
  insetFaces(args: InsetLogicalFacesArgs): InsetLogicalFacesResult {
    const asset = requireStaticMesh(args.assetId, 'target');
    const faceIds = Array.from(new Set(args.faceIds.map(faceId => requireLogicalFaceId(asset, faceId))));
    if (faceIds.length === 0) throw new Error('Inset requires at least one selected logical face.');
    if (!Number.isFinite(args.ratio) || args.ratio <= 0 || args.ratio >= 1) {
      throw new Error('Inset ratio must be greater than 0 and less than 1.');
    }

    return this.runLogicalModeling(args.assetId, faceIds.length === 1 ? 'Inset Face' : 'Inset Faces', adapter => {
      const semanticFaceIds = faceIds.map(faceId => {
        const semanticFaceId = adapter.faceIdByLogical.get(faceId);
        if (!semanticFaceId) throw new Error(`Logical face ${faceId} was not found.`);
        return semanticFaceId;
      });
      const current = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(current);
      const semanticResults = semanticFaceIds.map(faceId =>
        this.insetConstructionFaceInState(state, {
          assetId: args.assetId,
          faceId,
          ratio: args.ratio,
        }),
      );
      finalizeConstructionMutation(state);
      assetHistory.markDirty(args.assetId);

      const construction = state.construction;
      const logicalFace = (semanticId: string): number => {
        const face = findConstructionFace(construction, semanticId);
        return face.faceId;
      };
      const vertex = (semanticId: string): number => {
        const point = findConstructionPoint(construction, semanticId);
        const vertexId = point.vertexIds?.[0];
        if (vertexId === undefined) throw new Error(`Inset Faces could not resolve generated mesh vertex '${semanticId}'.`);
        return vertexId;
      };
      const results = semanticResults.map((result, index): InsetLogicalFaceResult => ({
        sourceFaceId: faceIds[index],
        innerFaceId: logicalFace(result.innerFaceId),
        innerVertexIds: result.innerPointIds.map(vertex),
        borderFaceIds: result.borderFaceIds.map(logicalFace),
      }));
      return {
        results,
        innerFaceIds: results.map(result => result.innerFaceId),
        borderFaceIds: results.flatMap(result => result.borderFaceIds),
      };
    });
  }

  deleteFace(args: DeleteLogicalFaceArgs): DeleteLogicalFaceResult;
  deleteFace(args: DeleteConstructionFaceArgs): DeleteConstructionFaceResult;
  deleteFace(args: DeleteLogicalFaceArgs | DeleteConstructionFaceArgs): DeleteLogicalFaceResult | DeleteConstructionFaceResult {
    if (typeof args.faceId === 'string') {
      const constructionArgs: DeleteConstructionFaceArgs = {
        assetId: args.assetId,
        faceId: args.faceId,
      };
      return this.deleteConstructionFace(constructionArgs);
    }
    const asset = requireStaticMesh(args.assetId, 'target');
    const faceId = requireLogicalFaceId(asset, args.faceId);
    return this.runLogicalModeling(args.assetId, 'Delete Face', adapter => {
      const semanticFaceId = adapter.faceIdByLogical.get(faceId);
      if (!semanticFaceId) throw new Error(`Logical face ${faceId} was not found.`);
      const result = this.deleteConstructionFace({ assetId: args.assetId, faceId: semanticFaceId });
      return {
        deletedFaceId: faceId,
        vertexIds: [...result.vertexIds],
        triangleIds: [...result.triangleIds],
      };
    });
  }

  /**
   * Deletes one or more logical faces in a single atomic modeling operation.
   */
  deleteFaces(args: DeleteLogicalFacesArgs): DeleteLogicalFacesResult {
    const asset = requireStaticMesh(args.assetId, 'target');
    const faceIds = Array.from(new Set(args.faceIds.map(faceId => requireLogicalFaceId(asset, faceId))));
    if (faceIds.length === 0) throw new Error('Delete Faces requires at least one selected logical face.');

    return this.runLogicalModeling(args.assetId, faceIds.length === 1 ? 'Delete Face' : 'Delete Faces', adapter => {
      const semanticFaceIds = faceIds.map(faceId => {
        const semanticFaceId = adapter.faceIdByLogical.get(faceId);
        if (!semanticFaceId) throw new Error(`Logical face ${faceId} was not found.`);
        return semanticFaceId;
      });
      const current = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(current);
      const touchedVertexIds = new Set<number>();

      for (const semanticFaceId of semanticFaceIds) {
        const face = findConstructionFace(state.construction, semanticFaceId);
        const deleted = deleteConstructionFaceFromState(state, face);
        deleted.vertexIds.forEach(v => touchedVertexIds.add(v));
      }

      if (args.compactUnusedVertices) {
        compactUnusedConstructionVertices(state);
      }

      finalizeConstructionMutation(state);
      assetHistory.markDirty(args.assetId);

      return {
        deletedFaceIds: [...faceIds],
        vertexIds: Array.from(touchedVertexIds).sort((a, b) => a - b),
        remainingFaceCount: state.faces.length,
      };
    });
  }

  /**
   * Moves one or more mesh vertices (and any explicitly welded sibling vertices)
   * in a single history transaction, recomputing normals, bounds, and shells.
   */
  moveVertices(args: MoveLogicalVerticesArgs): MoveLogicalVerticesResult {
    const asset = requireStaticMesh(args.assetId, 'target');
    if (!Array.isArray(args.vertices) || args.vertices.length === 0) {
      throw new Error('moveVertices requires at least one vertex update.');
    }

    const updates = args.vertices.map((entry, idx) => {
      const vertexId = requireLogicalVertexId(asset, entry.vertexId);
      assertFinitePosition(entry.position, `Vertex ${vertexId} position [${idx}]`);
      return { vertexId, position: clonePosition(entry.position) };
    });

    return assetHistory.execute(asset.id, 'Move Vertices', () => {
      const current = requireStaticMesh(args.assetId, 'target');
      const propagateSiblings = args.propagateSiblings ?? true;
      const { vertexToCanonical, groups } = buildCanonicalVertexGroups(current);
      const vertices = new Float32Array(current.geometry.vertices);
      const movedSet = new Set<number>();

      for (const update of updates) {
        const targetIds = propagateSiblings
          ? (groups.get(vertexToCanonical.get(update.vertexId) ?? update.vertexId) ?? [update.vertexId])
          : [update.vertexId];
        for (const vId of targetIds) {
          const offset = vId * 3;
          vertices[offset] = update.position.x;
          vertices[offset + 1] = update.position.y;
          vertices[offset + 2] = update.position.z;
          movedSet.add(vId);
        }
      }

      const normals = computeVertexNormals(Array.from(vertices), Array.from(current.geometry.indices));
      const geometry: MeshGeometry = {
        ...current.geometry,
        vertices,
        normals,
        aabb: vertices.length > 0 ? computeAABB(vertices) : undefined,
      };
      if (current.topology) {
        current.topology.bvh = undefined;
        invalidateMeshConnectivity(current.topology);
      }
      const shells = resolveStaticMeshShells({
        ...current,
        geometry,
      }).map(shell => materializeStaticMeshShell(shell));

      assetManager.updateAsset(current.id, { geometry, shells });

      return {
        movedVertexIds: Array.from(movedSet).sort((a, b) => a - b),
      };
    });
  }

  /**
   * Translates, offsets along face normal, and/or scales the vertices belonging
   * to one or more logical faces around their shared centroid (or individual centroids).
   */
  transformFaces(args: TransformLogicalFacesArgs): TransformLogicalFacesResult {
    const asset = requireStaticMesh(args.assetId, 'target');
    const faceIds = Array.from(new Set(args.faceIds.map(faceId => requireLogicalFaceId(asset, faceId))));
    if (faceIds.length === 0) throw new Error('transformFaces requires at least one logical face.');

    const translate = args.translate ?? { x: 0, y: 0, z: 0 };
    assertFinitePosition(translate, 'transformFaces translate');
    const normalOffset = args.normalOffset ?? 0;
    if (!Number.isFinite(normalOffset)) throw new Error('transformFaces normalOffset must be a finite number.');

    const scaleVec: Vector3 = typeof args.scale === 'number'
      ? { x: args.scale, y: args.scale, z: args.scale }
      : (args.scale ?? { x: 1, y: 1, z: 1 });
    assertFinitePosition(scaleVec, 'transformFaces scale');

    const faces = sourceFaces(asset);
    const { vertexToCanonical, groups } = buildCanonicalVertexGroups(asset);
    const pivotMode = args.pivot ?? 'SELECTION_CENTER';

    // Compute per-vertex target position
    const targetByCanonical = new Map<number, Vector3>();

    const readCanonicalPos = (canonical: number): Vector3 => ({
      x: asset.geometry.vertices[canonical * 3],
      y: asset.geometry.vertices[canonical * 3 + 1],
      z: asset.geometry.vertices[canonical * 3 + 2],
    });

    if (pivotMode === 'INDIVIDUAL_FACES') {
      for (const faceId of faceIds) {
        const faceVerts = faces[faceId];
        const canonicals = Array.from(new Set(faceVerts.map(v => vertexToCanonical.get(v) ?? v)));
        const positions = canonicals.map(readCanonicalPos);
        const normal = computePlanarFaceNormal(positions);
        const center = positions.reduce(
          (acc, p) => ({ x: acc.x + p.x / positions.length, y: acc.y + p.y / positions.length, z: acc.z + p.z / positions.length }),
          { x: 0, y: 0, z: 0 },
        );
        for (let i = 0; i < canonicals.length; i += 1) {
          const cId = canonicals[i];
          const p = positions[i];
          targetByCanonical.set(cId, {
            x: center.x + (p.x - center.x) * scaleVec.x + translate.x + normal.x * normalOffset,
            y: center.y + (p.y - center.y) * scaleVec.y + translate.y + normal.y * normalOffset,
            z: center.z + (p.z - center.z) * scaleVec.z + translate.z + normal.z * normalOffset,
          });
        }
      }
    } else {
      const selectedCanonicals = new Set<number>();
      const normals: Vector3[] = [];
      for (const faceId of faceIds) {
        const faceVerts = faces[faceId];
        const canonicals = faceVerts.map(v => vertexToCanonical.get(v) ?? v);
        canonicals.forEach(c => selectedCanonicals.add(c));
        normals.push(computePlanarFaceNormal(canonicals.map(readCanonicalPos)));
      }
      const avgNormalRaw = normals.reduce(
        (acc, n) => ({ x: acc.x + n.x, y: acc.y + n.y, z: acc.z + n.z }),
        { x: 0, y: 0, z: 0 },
      );
      const nLen = Math.hypot(avgNormalRaw.x, avgNormalRaw.y, avgNormalRaw.z);
      const avgNormal = nLen > 1e-8
        ? { x: avgNormalRaw.x / nLen, y: avgNormalRaw.y / nLen, z: avgNormalRaw.z / nLen }
        : { x: 0, y: 1, z: 0 };

      const canonicalList = Array.from(selectedCanonicals);
      const positions = canonicalList.map(readCanonicalPos);
      const center = positions.reduce(
        (acc, p) => ({ x: acc.x + p.x / positions.length, y: acc.y + p.y / positions.length, z: acc.z + p.z / positions.length }),
        { x: 0, y: 0, z: 0 },
      );

      for (let i = 0; i < canonicalList.length; i += 1) {
        const cId = canonicalList[i];
        const p = positions[i];
        targetByCanonical.set(cId, {
          x: center.x + (p.x - center.x) * scaleVec.x + translate.x + avgNormal.x * normalOffset,
          y: center.y + (p.y - center.y) * scaleVec.y + translate.y + avgNormal.y * normalOffset,
          z: center.z + (p.z - center.z) * scaleVec.z + translate.z + avgNormal.z * normalOffset,
        });
      }
    }

    const vertexUpdates = Array.from(targetByCanonical.entries()).map(([vertexId, position]) => ({
      vertexId,
      position,
    }));
    const moved = this.moveVertices({
      assetId: args.assetId,
      vertices: vertexUpdates,
      propagateSiblings: true,
    });

    // Compute final center of moved vertices
    const updated = requireStaticMesh(args.assetId, 'target');
    const finalPositions = Array.from(targetByCanonical.keys()).flatMap(c => groups.get(c) ?? [c]);
    const uniqueVerts = Array.from(new Set(finalPositions));
    const center = uniqueVerts.reduce(
      (acc, vId) => ({
        x: acc.x + updated.geometry.vertices[vId * 3] / Math.max(1, uniqueVerts.length),
        y: acc.y + updated.geometry.vertices[vId * 3 + 1] / Math.max(1, uniqueVerts.length),
        z: acc.z + updated.geometry.vertices[vId * 3 + 2] / Math.max(1, uniqueVerts.length),
      }),
      { x: 0, y: 0, z: 0 },
    );

    return {
      faceIds,
      movedVertexIds: moved.movedVertexIds,
      center,
    };
  }

  /**
   * Welds two or more vertices together into a single shared vertex position,
   * updating face boundaries and removing degenerate faces or unused vertices.
   */
  weldVertices(args: WeldLogicalVerticesArgs): WeldLogicalVerticesResult {
    const asset = requireStaticMesh(args.assetId, 'target');
    const rawVertexIds = Array.from(new Set(args.vertexIds.map(v => requireLogicalVertexId(asset, v))));
    if (rawVertexIds.length < 2) {
      throw new Error('Weld Vertices requires at least 2 distinct mesh vertices.');
    }

    return assetHistory.execute(asset.id, 'Weld Vertices', () => {
      const current = requireStaticMesh(args.assetId, 'target');
      const { vertexToCanonical, groups } = buildCanonicalVertexGroups(current);
      const selectedGroupSet = new Set<number>();
      for (const vId of rawVertexIds) {
        const canonical = vertexToCanonical.get(vId) ?? vId;
        for (const member of groups.get(canonical) ?? [vId]) {
          selectedGroupSet.add(member);
        }
      }
      const weldedGroup = Array.from(selectedGroupSet).sort((a, b) => a - b);
      if (weldedGroup.length < 2) {
        throw new Error('Weld Vertices requires at least 2 distinct mesh vertices.');
      }

      let targetPosition: Vector3;
      if (args.position) {
        assertFinitePosition(args.position, 'Weld target position');
        targetPosition = clonePosition(args.position);
      } else if (args.mode === 'FIRST') {
        const first = rawVertexIds[0];
        targetPosition = {
          x: current.geometry.vertices[first * 3],
          y: current.geometry.vertices[first * 3 + 1],
          z: current.geometry.vertices[first * 3 + 2],
        };
      } else {
        targetPosition = weldedGroup.reduce(
          (acc, vId) => ({
            x: acc.x + current.geometry.vertices[vId * 3] / weldedGroup.length,
            y: acc.y + current.geometry.vertices[vId * 3 + 1] / weldedGroup.length,
            z: acc.z + current.geometry.vertices[vId * 3 + 2] / weldedGroup.length,
          }),
          { x: 0, y: 0, z: 0 },
        );
      }

      const survivorPreCompact = weldedGroup[0];
      const state = createConstructionMutationState(current);
      // Move survivor vertex to targetPosition
      state.vertices[survivorPreCompact * 3] = targetPosition.x;
      state.vertices[survivorPreCompact * 3 + 1] = targetPosition.y;
      state.vertices[survivorPreCompact * 3 + 2] = targetPosition.z;

      // Replace all welded vertices in faces and re-triangulate
      const nextFaces: number[][] = [];
      const nextIndices: number[] = [];
      const nextTriToFace: number[] = [];
      let removedDegenerateFaces = 0;

      for (const face of state.faces) {
        const remapped = face.map(v => (selectedGroupSet.has(v) ? survivorPreCompact : v));
        // Deduplicate consecutive or cyclic repeats
        const deduped: number[] = [];
        for (const v of remapped) {
          if (!deduped.includes(v)) deduped.push(v);
        }
        if (deduped.length < 3) {
          removedDegenerateFaces += 1;
          continue;
        }
        const nextFaceId = nextFaces.length;
        const tris = triangulateConstructionBoundary(state, deduped);
        nextFaces.push(deduped);
        for (let i = 0; i < tris.length; i += 3) {
          nextIndices.push(tris[i], tris[i + 1], tris[i + 2]);
          nextTriToFace.push(nextFaceId);
        }
      }

      state.faces = nextFaces;
      state.indices = nextIndices;
      state.triangleToFace = nextTriToFace;

      // Track where survivorPreCompact lands after compaction
      const usedBeforeCompact = Array.from(new Set(state.faces.flat())).sort((a, b) => a - b);
      const survivingVertexId = Math.max(0, usedBeforeCompact.indexOf(survivorPreCompact));

      compactUnusedConstructionVertices(state);

      const prevDepth = activeLogicalModelingDepthByAsset.get(current.id) ?? 0;
      activeLogicalModelingDepthByAsset.set(current.id, prevDepth + 1);
      try {
        finalizeConstructionMutation(state);
      } finally {
        if (prevDepth <= 0) {
          activeLogicalModelingDepthByAsset.delete(current.id);
          transientLogicalConstructionByAsset.delete(current.id);
        } else {
          activeLogicalModelingDepthByAsset.set(current.id, prevDepth);
        }
      }

      return {
        survivingVertexId,
        mergedVertexIds: weldedGroup,
        position: targetPosition,
        removedDegenerateFaces,
      };
    });
  }

  /**
   * Connects selected boundary vertices across any shared logical faces by
   * cutting those faces along the non-adjacent selected vertices (Blender 'J' / Maya Connect).
   */
  connectVertices(args: ConnectLogicalVerticesArgs): ConnectLogicalVerticesResult {
    const asset = requireStaticMesh(args.assetId, 'target');
    const rawVertexIds = Array.from(new Set(args.vertexIds.map(v => requireLogicalVertexId(asset, v))));
    if (rawVertexIds.length < 2) {
      throw new Error('Connect Vertices requires at least 2 selected mesh vertices.');
    }

    return this.runLogicalModeling(args.assetId, 'Connect Vertices', adapter => {
      const selectedPointIds = new Set<string>();
      for (const vId of rawVertexIds) {
        const ptId = adapter.pointIdByVertex.get(vId);
        if (ptId) selectedPointIds.add(ptId);
      }
      if (selectedPointIds.size < 2) {
        throw new Error('Connect Vertices requires at least 2 distinct topological vertices.');
      }

      const current = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(current);

      // Find all faces that contain at least 2 non-adjacent selected points
      const cuts: Array<{
        sourceFaceId: number;
        newFaceId: number;
        cutEdgeId: string;
        vertexIds: [number, number];
      }> = [];

      // Collect candidate pairs on existing faces
      const candidateFaceIds = state.construction.faces.map(f => f.id);
      for (const semanticFaceId of candidateFaceIds) {
        const face = state.construction.faces.find(f => f.id === semanticFaceId);
        if (!face || face.pointIds.length < 4) continue;
        const matchingPoints = face.pointIds.filter(ptId => selectedPointIds.has(ptId));
        if (matchingPoints.length < 2) continue;

        // Connect consecutive matching points that are non-adjacent on the face boundary
        for (let i = 0; i < matchingPoints.length - 1; i += 1) {
          const pointAId = matchingPoints[i];
          const pointBId = matchingPoints[i + 1];
          const currentFace = state.construction.faces.find(
            f => f.pointIds.includes(pointAId) && f.pointIds.includes(pointBId) && f.pointIds.length >= 4,
          );
          if (!currentFace) continue;
          if (findBoundaryEdgeIndex(currentFace.pointIds, pointAId, pointBId, true) >= 0) continue;

          const pointAIndex = currentFace.pointIds.indexOf(pointAId);
          const pointBIndex = currentFace.pointIds.indexOf(pointBId);
          const sourceBoundary = constructionBoundaryPath(currentFace.pointIds, pointAIndex, pointBIndex);
          const newBoundary = constructionBoundaryPath(currentFace.pointIds, pointBIndex, pointAIndex);
          if (sourceBoundary.length < 3 || newBoundary.length < 3) continue;

          const operationId = makeUniqueOperationId(
            undefined,
            'connect',
            [
              ...state.construction.faces.map(f => f.id),
              ...state.construction.loops.map(l => l.id),
              ...state.construction.points.map(p => p.id),
            ],
          );

          const sourceResult = replaceConstructionFaceBoundaryInState(state, currentFace, sourceBoundary);
          const newFace = addConstructionFaceToState(state, {
            id: `${operationId}.face`,
            name: currentFace.name ? `${currentFace.name} Connect` : undefined,
            pointIds: newBoundary,
          });
          const pointAVertexId = ensurePointVertex(state, pointAId);
          const pointBVertexId = ensurePointVertex(state, pointBId);
          cuts.push({
            sourceFaceId: sourceResult.faceId,
            newFaceId: newFace.faceId,
            cutEdgeId: meshEdgeKey(pointAVertexId, pointBVertexId),
            vertexIds: [pointAVertexId, pointBVertexId],
          });
        }
      }

      if (cuts.length === 0) {
        throw new Error('Connect Vertices requires at least two selected vertices that are non-adjacent on a common face.');
      }

      finalizeConstructionMutation(state);
      assetHistory.markDirty(args.assetId);

      return {
        cuts,
        cutEdgeIds: cuts.map(c => c.cutEdgeId),
        newFaceIds: cuts.map(c => c.newFaceId),
      };
    });
  }

  /**
   * Produces a comprehensive spatial and topological inspection report for an
   * asset so AI agents and procedural tools can discover faces/edges by direction,
   * area, and centroid without guessing numeric IDs.
   */
  inspectMesh(assetId: string): StaticMeshInspectionReport {
    return inspectStaticMesh(requireStaticMesh(assetId, 'target'));
  }

  /**
   * Queries logical faces by semantic direction tag ('TOP', 'BOTTOM', 'FRONT',
   * 'BACK', 'LEFT', 'RIGHT', 'ANGLED'), normal vector, area, vertex count, or
   * spatial sorting.
   */
  findFaces(args: StaticMeshFaceQueryArgs): StaticMeshInspectedFace[] {
    const asset = requireStaticMesh(args.assetId, 'target');
    const { assetId: _assetId, ...query } = args;
    return queryStaticMeshFaces(asset, query);
  }

  /**
   * Queries logical edges by length, boundary/manifold status, incident face IDs,
   * or spatial sorting.
   */
  findEdges(args: StaticMeshEdgeQueryArgs): StaticMeshInspectedEdge[] {
    const asset = requireStaticMesh(args.assetId, 'target');
    const { assetId: _assetId, ...query } = args;
    return queryStaticMeshEdges(asset, query);
  }

  /**
   * Executes a declarative multi-step modeling script (supporting both numeric IDs
   * and semantic `faceQuery` / `edgeQuery` selectors) in a single atomic Undo/Redo
   * transaction. If any step fails, the entire asset rolls back cleanly.
   */
  runModelingSteps(args: RunStaticMeshModelingStepsArgs): RunStaticMeshModelingStepsResult {
    const target = requireStaticMesh(args.assetId, 'target');
    if (!Array.isArray(args.steps) || args.steps.length === 0) {
      throw new Error('runModelingSteps requires at least one step.');
    }

    const label = args.label?.trim() || `AI Modeling Pipeline (${args.steps.length} steps)`;
    return this.transaction(target.id, label, () => {
      const stepResults: unknown[] = [];

      const resolveStepFaceIds = (
        stepIndex: number,
        opName: string,
        faceIds?: number[],
        faceQuery?: StaticMeshFaceQuery,
      ): number[] => {
        if (faceIds && faceIds.length > 0) return faceIds;
        if (faceQuery) {
          const matches = this.findFaces({ assetId: target.id, ...faceQuery });
          if (matches.length === 0) {
            throw new Error(`Step ${stepIndex + 1} (${opName}): faceQuery matched 0 logical faces.`);
          }
          return matches.map(m => m.faceId);
        }
        throw new Error(`Step ${stepIndex + 1} (${opName}) requires either faceIds or faceQuery.`);
      };

      const resolveStepEdges = (
        stepIndex: number,
        opName: string,
        edges?: Array<{ vertexAId: number; vertexBId: number }>,
        edgeQuery?: StaticMeshEdgeQuery,
      ): Array<{ vertexAId: number; vertexBId: number }> => {
        if (edges && edges.length > 0) return edges;
        if (edgeQuery) {
          const matches = this.findEdges({ assetId: target.id, ...edgeQuery });
          if (matches.length === 0) {
            throw new Error(`Step ${stepIndex + 1} (${opName}): edgeQuery matched 0 logical edges.`);
          }
          return matches.map(m => ({ vertexAId: m.vertexAId, vertexBId: m.vertexBId }));
        }
        throw new Error(`Step ${stepIndex + 1} (${opName}) requires either edges or edgeQuery.`);
      };

      for (let i = 0; i < args.steps.length; i += 1) {
        const step = args.steps[i];
        switch (step.op) {
          case 'ADD_PRIMITIVE': {
            const { op: _op, ...primArgs } = step;
            stepResults.push(this.addPrimitive({ assetId: target.id, ...primArgs }));
            break;
          }
          case 'ADD_VERTICES': {
            stepResults.push(this.addVertices({ assetId: target.id, positions: step.positions }));
            break;
          }
          case 'CREATE_FACE': {
            stepResults.push(this.createFace({ assetId: target.id, vertexIds: step.vertexIds }));
            break;
          }
          case 'EXTRUDE_FACES': {
            const faceIds = resolveStepFaceIds(i, step.op, step.faceIds, step.faceQuery);
            stepResults.push(this.extrudeFaces({ assetId: target.id, faceIds, distance: step.distance }));
            break;
          }
          case 'INSET_FACES': {
            const faceIds = resolveStepFaceIds(i, step.op, step.faceIds, step.faceQuery);
            stepResults.push(this.insetFaces({ assetId: target.id, faceIds, ratio: step.ratio }));
            break;
          }
          case 'DELETE_FACES': {
            const faceIds = resolveStepFaceIds(i, step.op, step.faceIds, step.faceQuery);
            stepResults.push(
              this.deleteFaces({
                assetId: target.id,
                faceIds,
                compactUnusedVertices: step.compactUnusedVertices,
              }),
            );
            break;
          }
          case 'BEVEL_EDGES': {
            const edges = resolveStepEdges(i, step.op, step.edges, step.edgeQuery);
            stepResults.push(
              this.bevelEdges({
                assetId: target.id,
                edges,
                width: step.width,
                segments: step.segments,
                profile: step.profile,
                clampOverlap: step.clampOverlap,
              }),
            );
            break;
          }
          case 'SPLIT_EDGE': {
            let edgePair: { vertexAId: number; vertexBId: number };
            if (step.vertexAId !== undefined && step.vertexBId !== undefined) {
              edgePair = { vertexAId: step.vertexAId, vertexBId: step.vertexBId };
            } else {
              const matched = resolveStepEdges(i, step.op, undefined, step.edgeQuery);
              edgePair = matched[0];
            }
            stepResults.push(
              this.splitEdge({
                assetId: target.id,
                vertexAId: edgePair.vertexAId,
                vertexBId: edgePair.vertexBId,
                t: step.t,
              }),
            );
            break;
          }
          case 'CUT_FACE': {
            stepResults.push(
              this.cutFace({
                assetId: target.id,
                faceId: step.faceId,
                vertexAId: step.vertexAId,
                vertexBId: step.vertexBId,
              }),
            );
            break;
          }
          case 'CONNECT_VERTICES': {
            stepResults.push(
              this.connectVertices({
                assetId: target.id,
                vertexIds: step.vertexIds,
              }),
            );
            break;
          }
          case 'WELD_VERTICES': {
            stepResults.push(
              this.weldVertices({
                assetId: target.id,
                vertexIds: step.vertexIds,
                mode: step.mode,
                position: step.position,
              }),
            );
            break;
          }
          case 'MOVE_VERTICES': {
            stepResults.push(
              this.moveVertices({
                assetId: target.id,
                vertices: step.vertices,
                propagateSiblings: step.propagateSiblings,
              }),
            );
            break;
          }
          case 'TRANSFORM_FACES': {
            const faceIds = resolveStepFaceIds(i, step.op, step.faceIds, step.faceQuery);
            stepResults.push(
              this.transformFaces({
                assetId: target.id,
                faceIds,
                translate: step.translate,
                normalOffset: step.normalOffset,
                scale: step.scale,
                pivot: step.pivot,
              }),
            );
            break;
          }
          default: {
            const exhaustive: never = step;
            throw new Error(`Unsupported modeling step: ${JSON.stringify(exhaustive)}`);
          }
        }
      }

      return {
        assetId: target.id,
        stepsExecuted: args.steps.length,
        stepResults,
        inspection: this.inspectMesh(target.id),
      };
    });
  }

  splitEdge(args: SplitLogicalEdgeArgs): SplitLogicalEdgeResult;
  splitEdge(args: SplitConstructionEdgeArgs): SplitConstructionEdgeResult;
  splitEdge(args: SplitLogicalEdgeArgs | SplitConstructionEdgeArgs): SplitLogicalEdgeResult | SplitConstructionEdgeResult {
    if ('pointAId' in args) return this.splitConstructionEdge(args);
    const asset = requireStaticMesh(args.assetId, 'target');
    const vertexAId = requireLogicalVertexId(asset, args.vertexAId);
    const vertexBId = requireLogicalVertexId(asset, args.vertexBId);
    if (vertexAId === vertexBId) throw new Error('Split Edge requires two different mesh vertices.');
    return this.runLogicalModeling(args.assetId, 'Split Edge', adapter => {
      const pointAId = adapter.pointIdByVertex.get(vertexAId);
      const pointBId = adapter.pointIdByVertex.get(vertexBId);
      if (!pointAId || !pointBId || pointAId === pointBId) throw new Error('Split Edge could not resolve the selected logical edge.');
      const result = this.splitConstructionEdge({ assetId: args.assetId, pointAId, pointBId, t: args.t });
      const updated = requireStaticMesh(args.assetId, 'target');
      const construction = getTransientOrPersistedConstruction(updated);
      return {
        vertexId: result.vertexId,
        updatedFaceIds: result.updatedFaceIds.map(semanticId => {
          const face = findConstructionFace(construction, semanticId);
          return face.faceId;
        }),
        edgeIds: result.edgeIds,
        t: result.t,
      };
    });
  }

  cutFace(args: CutLogicalFaceArgs): CutLogicalFaceResult;
  cutFace(args: CutConstructionFaceArgs): CutConstructionFaceResult;
  cutFace(args: CutLogicalFaceArgs | CutConstructionFaceArgs): CutLogicalFaceResult | CutConstructionFaceResult {
    if ('pointAId' in args) return this.cutConstructionFace(args);
    const asset = requireStaticMesh(args.assetId, 'target');
    const faceId = requireLogicalFaceId(asset, args.faceId);
    const vertexAId = requireLogicalVertexId(asset, args.vertexAId);
    const vertexBId = requireLogicalVertexId(asset, args.vertexBId);
    return this.runLogicalModeling(args.assetId, 'Cut Face', adapter => {
      const semanticFaceId = adapter.faceIdByLogical.get(faceId);
      const pointAId = adapter.pointIdByVertex.get(vertexAId);
      const pointBId = adapter.pointIdByVertex.get(vertexBId);
      if (!semanticFaceId || !pointAId || !pointBId) throw new Error('Cut Face could not resolve the selected logical topology.');
      const result = this.cutConstructionFace({ assetId: args.assetId, faceId: semanticFaceId, pointAId, pointBId });
      return {
        sourceFaceId: result.sourceLogicalFaceId,
        newFaceId: result.newLogicalFaceId,
        cutEdgeId: result.cutEdgeId,
        vertexIds: [vertexAId, vertexBId],
      };
    });
  }

  bevelEdge(args: BevelLogicalEdgeArgs): BevelLogicalEdgeResult;
  bevelEdge(args: BevelConstructionEdgeArgs): BevelConstructionEdgeResult;
  bevelEdge(args: BevelLogicalEdgeArgs | BevelConstructionEdgeArgs): BevelLogicalEdgeResult | BevelConstructionEdgeResult {
    if ('pointAId' in args) return this.bevelConstructionEdge(args);
    const result = this.bevelEdges({
      assetId: args.assetId,
      edges: [{ vertexAId: args.vertexAId, vertexBId: args.vertexBId }],
      width: args.width,
      segments: args.segments,
      profile: args.profile,
    });
    const edgeResult = result.results[0];
    if (!edgeResult) throw new Error('Bevel Edge did not produce an edge result.');
    return edgeResult;
  }


  /**
   * Bevels a batch of normal LogicalMesh edges in one history transaction.
   *
   * Supported closed-manifold selections are solved by one Blender-style joint
   * planner even when selected edges are disconnected: every touched vertex is
   * solved once, all original faces are rewritten once, then segmented bevel
   * strips and corner patches are emitted from that shared boundary. Legacy
   * fallback is reserved for endpoint topology the joint planner explicitly
   * does not support yet.
   */
  bevelEdges(args: BevelLogicalEdgesArgs): BevelLogicalEdgesResult {
    const asset = requireStaticMesh(args.assetId, 'target');
    if (!Number.isFinite(args.width) || args.width <= 1e-8) {
      throw new Error('Bevel width must be a finite positive number.');
    }
    const segments = args.segments ?? 1;
    const profile = args.profile ?? 0.5;
    if (!Number.isFinite(segments) || Math.floor(segments) !== segments || segments < 1 || segments > 64) {
      throw new Error('Bevel segments must be an integer from 1 to 64.');
    }
    if (!Number.isFinite(profile) || profile < 0 || profile > 1) {
      throw new Error('Bevel profile must be between 0 and 1.');
    }

    const uniqueEdges = new Map<string, { vertexAId: number; vertexBId: number }>();
    for (const edge of args.edges) {
      const vertexAId = requireLogicalVertexId(asset, edge.vertexAId);
      const vertexBId = requireLogicalVertexId(asset, edge.vertexBId);
      if (vertexAId === vertexBId) throw new Error('Bevel requires two different mesh vertices per edge.');
      uniqueEdges.set(meshEdgeKey(vertexAId, vertexBId), { vertexAId, vertexBId });
    }
    const edges = Array.from(uniqueEdges.values());
    if (edges.length === 0) throw new Error('Bevel requires at least one selected logical edge.');

    return this.runLogicalModeling(args.assetId, edges.length === 1 ? 'Bevel Edge' : 'Bevel Edges', adapter => {
      const selected = edges.map(edge => {
        const pointAId = adapter.pointIdByVertex.get(edge.vertexAId);
        const pointBId = adapter.pointIdByVertex.get(edge.vertexBId);
        if (!pointAId || !pointBId || pointAId === pointBId) {
          throw new Error('Bevel could not resolve one selected logical edge.');
        }
        return { ...edge, pointAId, pointBId };
      });

      const endpointUseCount = new Map<string, number>();
      for (const edge of selected) {
        endpointUseCount.set(edge.pointAId, (endpointUseCount.get(edge.pointAId) ?? 0) + 1);
        endpointUseCount.set(edge.pointBId, (endpointUseCount.get(edge.pointBId) ?? 0) + 1);
      }
      const hasSharedEndpoint = Array.from(endpointUseCount.values()).some(count => count > 1);

      let state: ConstructionMutationState | null = null;
      let plan: BevelKernelPlan | null = null;
      try {
        state = createConstructionMutationState(requireStaticMesh(args.assetId, 'target'));
        plan = buildJointBevelPlan(
          state.construction,
          selected.map(edge => ({ pointAId: edge.pointAId, pointBId: edge.pointBId })),
          args.width,
          args.clampOverlap ?? true,
          segments,
          profile,
        );
      } catch (error) {
        if (!(error instanceof BevelKernelUnsupportedTopologyError) || hasSharedEndpoint) throw error;
      }

      if (!state || !plan) {
        if (segments !== 1) {
          throw new Error('Multi-segment bevel is not yet supported for this legacy endpoint topology. Use Segments = 1 or simplify the local fan.');
        }
        const semanticResults = selected.map(edge => this.bevelConstructionEdge({
          assetId: args.assetId,
          pointAId: edge.pointAId,
          pointBId: edge.pointBId,
          width: args.width,
        }));

        const updated = requireStaticMesh(args.assetId, 'target');
        const construction = getTransientOrPersistedConstruction(updated);
        const faceId = (semanticId: string): number => {
          const face = findConstructionFace(construction, semanticId);
          return face.faceId;
        };
        const vertexId = (semanticId: string): number => {
          const point = findConstructionPoint(construction, semanticId);
          const id = point.vertexIds?.[0];
          if (id === undefined) throw new Error(`Bevel Edges could not resolve mesh vertex '${semanticId}'.`);
          return id;
        };
        const results = semanticResults.map((result): BevelLogicalEdgeResult => {
          const bevelEdgeIds: [string, string] = [
            meshEdgeKey(vertexId(result.sidePointIds[0][0]), vertexId(result.sidePointIds[0][1])),
            meshEdgeKey(vertexId(result.sidePointIds[1][0]), vertexId(result.sidePointIds[1][1])),
          ];
          return {
            bevelFaceId: faceId(result.bevelFaceId),
            bevelFaceIds: [faceId(result.bevelFaceId)],
            endpointCapFaceIds: result.endpointCapFaceIds.map(faceId),
            updatedFaceIds: result.updatedFaceIds.map(faceId),
            bevelEdgeIds,
            profileEdgeIds: [...bevelEdgeIds],
            width: result.width,
            segments: 1,
            profile,
          };
        });
        const endpointCapFaceIds = Array.from(new Set(results.flatMap(result => result.endpointCapFaceIds)));
        return {
          results,
          bevelFaceIds: results.map(result => result.bevelFaceId),
          endpointCapFaceIds,
          cornerFaceIds: endpointCapFaceIds,
          updatedFaceIds: Array.from(new Set(results.flatMap(result => result.updatedFaceIds))),
          bevelEdgeIds: Array.from(new Set(results.flatMap(result => result.profileEdgeIds))),
          width: args.width,
          requestedWidth: args.width,
          clamped: false,
          segments: 1,
          profile,
        };
      }

      const applied = applyJointBevelPlan(state, plan);
      assetHistory.markDirty(args.assetId);

      const construction = state.construction;
      const faceId = (semanticId: string): number => {
        const face = findConstructionFace(construction, semanticId);
        return face.faceId;
      };
      const vertexId = (semanticId: string): number => {
        const point = findConstructionPoint(construction, semanticId);
        const id = point.vertexIds?.[0];
        if (id === undefined) throw new Error(`Bevel Edges could not resolve mesh vertex '${semanticId}'.`);
        return id;
      };

      const results = applied.edgeResults.map((result): BevelLogicalEdgeResult => {
        const bevelEdgeIds: [string, string] = [
          meshEdgeKey(vertexId(result.railPointIds[0][0]), vertexId(result.railPointIds[0][1])),
          meshEdgeKey(vertexId(result.railPointIds[1][0]), vertexId(result.railPointIds[1][1])),
        ];
        return {
          bevelFaceId: faceId(result.bevelFaceId),
          bevelFaceIds: result.bevelFaceIds.map(faceId),
          endpointCapFaceIds: result.endpointCapFaceIds.map(faceId),
          updatedFaceIds: result.updatedFaceIds.map(faceId),
          bevelEdgeIds,
          profileEdgeIds: result.profileRailPointIds.map(([a, b]) => meshEdgeKey(vertexId(a), vertexId(b))),
          width: plan.effectiveWidth,
          segments: plan.segments,
          profile: plan.profile,
        };
      });
      const cornerFaceIds = applied.cornerFaceIds.map(faceId);
      return {
        results,
        bevelFaceIds: results.flatMap(result => result.bevelFaceIds),
        endpointCapFaceIds: Array.from(new Set(results.flatMap(result => result.endpointCapFaceIds))),
        cornerFaceIds,
        updatedFaceIds: applied.updatedFaceIds.map(faceId),
        bevelEdgeIds: Array.from(new Set(results.flatMap(result => result.profileEdgeIds))),
        width: plan.effectiveWidth,
        requestedWidth: plan.requestedWidth,
        clamped: plan.clamped,
        segments: plan.segments,
        profile: plan.profile,
      };
    });
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

  /** Read-only logical-face query. Works for Construction and imported Static Mesh topology. */
  getFaceInfo(assetId: string, faceId: number): StaticMeshTopologyFaceInfo | null {
    return getStaticMeshFaceInfo(requireStaticMesh(assetId, 'target'), faceId);
  }

  isQuadFace(assetId: string, faceId: number): boolean {
    return this.getFaceInfo(assetId, faceId)?.kind === 'QUAD';
  }

  /** Returns all logical faces incident to one mesh edge, seam/sibling aware. */
  getEdgeFaceIds(args: StaticMeshTopologyEdgeQueryArgs): number[] {
    return getStaticMeshEdgeFaceIds(
      requireStaticMesh(args.assetId, 'target'),
      args.vertexAId,
      args.vertexBId,
    );
  }

  /** Returns logical faces across one edge from a specified source face. */
  getAdjacentFacesAcrossEdge(args: StaticMeshTopologyFaceEdgeQueryArgs): number[] {
    return this.getEdgeFaceIds(args).filter(faceId => faceId !== args.faceId);
  }

  /** Manifold convenience: returns exactly one face across the edge, otherwise null. */
  getAdjacentFaceAcrossEdge(args: StaticMeshTopologyFaceEdgeQueryArgs): number | null {
    const adjacent = this.getAdjacentFacesAcrossEdge(args);
    return adjacent.length === 1 ? adjacent[0] : null;
  }

  getFaceBoundary(assetId: string, faceId: number) {
    return this.getFaceInfo(assetId, faceId)?.edges ?? [];
  }

  /** For a quad face, returns the boundary edge directly across from the supplied boundary edge. */
  getOppositeEdge(args: StaticMeshTopologyFaceEdgeQueryArgs): StaticMeshOppositeEdgeResult | null {
    return getStaticMeshOppositeEdge(
      requireStaticMesh(args.assetId, 'target'),
      args.faceId,
      args.vertexAId,
      args.vertexBId,
    );
  }

  /**
   * Traces an edge ring through opposite edges of connected logical quads.
   * The result also contains the ordered quad face strip crossed by the ring.
   */
  traceEdgeRing(args: StaticMeshEdgeRingQueryArgs): StaticMeshEdgeRingTraceResult {
    return traceStaticMeshEdgeRing(
      requireStaticMesh(args.assetId, 'target'),
      args.vertexAId,
      args.vertexBId,
      args.maxSteps,
    );
  }

  /** Face-strip alias for AI/tool callers that care about crossed quads rather than the ring edges. */
  traceFaceStrip(args: StaticMeshEdgeRingQueryArgs): StaticMeshEdgeRingTraceResult {
    return this.traceEdgeRing(args);
  }

  /** Maps one current mesh vertex back to its stable semantic Construction Point. */
  getConstructionPointId(assetId: string, vertexId: number): string | null {
    const asset = requireStaticMesh(assetId, 'target');
    if (!Number.isInteger(vertexId) || vertexId < 0) return null;
    return asset.construction?.points.find(point => point.vertexIds?.includes(vertexId))?.id ?? null;
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
   * Cuts one authored polygon face between two existing non-adjacent boundary
   * Construction Points. The source semantic/logical face survives as one side
   * of the cut and one new semantic face is created for the other side.
   *
   * This deliberately composes with Split Edge: callers can first insert exact
   * boundary points, then cut between those stable point handles.
   */
  cutConstructionFace(args: CutConstructionFaceArgs): CutConstructionFaceResult {
    return assetHistory.execute(args.assetId, 'Cut Construction Face', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(asset);
      const sourceFace = findConstructionFace(state.construction, args.faceId);
      if (args.pointAId === args.pointBId) throw new Error('Cut Face requires two different Construction Points.');

      const pointAIndex = sourceFace.pointIds.indexOf(args.pointAId);
      const pointBIndex = sourceFace.pointIds.indexOf(args.pointBId);
      if (pointAIndex < 0 || pointBIndex < 0) {
        throw new Error('Cut Face points must both lie on the selected Construction Face boundary.');
      }
      if (sourceFace.pointIds.length < 4) {
        throw new Error('Cut Face requires a polygon with at least 4 boundary points.');
      }
      if (findBoundaryEdgeIndex(sourceFace.pointIds, args.pointAId, args.pointBId, true) >= 0) {
        throw new Error('Cut Face points must be non-adjacent boundary points.');
      }

      const sourceBoundary = constructionBoundaryPath(sourceFace.pointIds, pointAIndex, pointBIndex);
      const newBoundary = constructionBoundaryPath(sourceFace.pointIds, pointBIndex, pointAIndex);
      if (sourceBoundary.length < 3 || newBoundary.length < 3) {
        throw new Error('Cut Face would create a degenerate face.');
      }

      const operationId = makeUniqueOperationId(
        args.id,
        'cut',
        [
          ...state.construction.faces.map(face => face.id),
          ...state.construction.loops.map(loop => loop.id),
          ...state.construction.points.map(point => point.id),
        ],
      );

      const sourceResult = replaceConstructionFaceBoundaryInState(state, sourceFace, sourceBoundary);
      const newFace = addConstructionFaceToState(state, {
        id: `${operationId}.face`,
        name: sourceFace.name ? `${sourceFace.name} Cut` : undefined,
        pointIds: newBoundary,
      });
      const pointAVertexId = ensurePointVertex(state, args.pointAId);
      const pointBVertexId = ensurePointVertex(state, args.pointBId);
      const cutEdgeId = meshEdgeKey(pointAVertexId, pointBVertexId);
      finalizeConstructionMutation(state);

      return {
        id: operationId,
        sourceFaceId: sourceFace.id,
        newFaceId: newFace.id,
        pointIds: [args.pointAId, args.pointBId],
        cutEdgeId,
        sourceLogicalFaceId: sourceResult.faceId,
        newLogicalFaceId: newFace.faceId,
      };
    });
  }

  /**
   * Bevels one manifold authored edge. The selected edge must have exactly two
   * consistently wound non-coplanar incident faces. Endpoint valence is not
   * artificially capped: each endpoint is solved independently from its local
   * fan. Interior manifold fans propagate offset points along their incident
   * edges; Blender's edgecount==2 terminal case instead creates two face-side
   * profile points plus an artificial point on the lone unbeveled edge.
   *
   * Width is measured from each selected-edge endpoint along its neighboring
   * authored edges. Unsupported open/branched/non-manifold endpoint fans reject
   * atomically rather than guessing topology.
   */
  bevelConstructionEdge(args: BevelConstructionEdgeArgs): BevelConstructionEdgeResult {
    return assetHistory.execute(args.assetId, 'Bevel Construction Edge', () => {
      if (!Number.isFinite(args.width) || args.width <= 1e-8) {
        throw new Error('Bevel width must be a finite positive number.');
      }

      const asset = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(asset);
      if (args.pointAId === args.pointBId) throw new Error('Bevel Edge requires two different Construction Points.');
      const pointA = findConstructionPoint(state.construction, args.pointAId);
      const pointB = findConstructionPoint(state.construction, args.pointBId);

      const loopsUsingSelectedEdge = state.construction.loops.filter(
        loop => findBoundaryEdgeIndex(loop.pointIds, pointA.id, pointB.id, loop.closed) >= 0,
      );
      if (loopsUsingSelectedEdge.length > 0) {
        throw new Error('Bevel Edge currently does not support a Construction Loop that directly owns the selected edge.');
      }

      const incidentFaces = state.construction.faces.filter(
        face => findBoundaryEdgeIndex(face.pointIds, pointA.id, pointB.id, true) >= 0,
      );
      if (incidentFaces.length !== 2) {
        throw new Error('Bevel Edge requires exactly two incident authored faces.');
      }

      const incidentInfo = incidentFaces.map(face => ({
        face,
        edge: findOrientedConstructionEdge(face.pointIds, pointA.id, pointB.id),
      }));
      if (incidentInfo.some(item => !item.edge)) {
        throw new Error('Bevel Edge could not resolve the selected face boundaries.');
      }

      const forward = incidentInfo.find(item => item.edge!.matchesRequestedOrder);
      const reverse = incidentInfo.find(item => !item.edge!.matchesRequestedOrder);
      if (!forward || !reverse) {
        throw new Error('Bevel Edge requires consistently wound manifold faces with opposite shared-edge directions.');
      }

      const forwardNormal = computeConstructionFaceNormal(state.construction, forward.face.pointIds);
      const reverseNormal = computeConstructionFaceNormal(state.construction, reverse.face.pointIds);
      if (Math.abs(dot3(forwardNormal, reverseNormal)) > 0.9999) {
        throw new Error('Bevel Edge requires a non-coplanar edge.');
      }

      const edgeForward = forward.edge!; // A -> B
      const edgeReverse = reverse.edge!; // B -> A
      const neighborAForward = edgeForward.previousId;
      const neighborBForward = edgeForward.nextId;
      const neighborBReverse = edgeReverse.previousId;
      const neighborAReverse = edgeReverse.nextId;
      const neighborIds = [neighborAForward, neighborBForward, neighborBReverse, neighborAReverse];
      if (neighborIds.some(id => id === pointA.id || id === pointB.id)) {
        throw new Error('Bevel Edge requires non-degenerate neighboring edges.');
      }
      // Blender explicitly supports a terminal bevel vertex with only two total
      // incident edges. In that case both selected faces see the same lone
      // unbeveled neighbor, but they still need distinct profile-side points.
      const endpointATwoEdge = neighborAForward === neighborAReverse;
      const endpointBTwoEdge = neighborBForward === neighborBReverse;

      const selectedFaceIds = new Set([forward.face.id, reverse.face.id]);
      // A cap path is ordered forward-side -> reverse-side so its closing edge
      // pairs with the bevel face's forwardA -> reverseA endpoint edge.
      const endpointAPlan = endpointATwoEdge ? null : planBevelEndpointFan(
        state.construction,
        pointA.id,
        pointB.id,
        neighborAForward,
        neighborAReverse,
        selectedFaceIds,
      );
      // At B the bevel face endpoint edge runs reverseB -> forwardB, therefore
      // order the cap reverse-side -> forward-side so its closing edge pairs.
      const endpointBPlan = endpointBTwoEdge ? null : planBevelEndpointFan(
        state.construction,
        pointB.id,
        pointA.id,
        neighborBReverse,
        neighborBForward,
        selectedFaceIds,
      );

      const operationId = makeUniqueOperationId(
        args.id,
        'bevel',
        [
          ...state.construction.faces.map(face => face.id),
          ...state.construction.loops.map(loop => loop.id),
          ...state.construction.points.map(point => point.id),
        ],
      );

      const makeBevelPointAt = (
        preferredId: string,
        sourcePoint: StaticMeshConstructionPoint,
        position: Vector3,
      ): string => {
        const pointId = makeUniqueConstructionId(
          preferredId,
          'point',
          state.construction.points.map(point => point.id),
        );
        state.construction.points.push({
          id: pointId,
          name: sourcePoint.name ? `${sourcePoint.name} Bevel` : undefined,
          role: 'GUIDE',
          groupId: sourcePoint.groupId,
          tags: sourcePoint.tags ? [...sourcePoint.tags] : undefined,
          data: {
            ...(sourcePoint.data ?? {}),
            sourcePointId: sourcePoint.id,
            bevelOperationId: operationId,
          },
          position: clonePosition(position),
          vertexIds: [],
        });
        return pointId;
      };

      const makeBevelPoint = (
        preferredId: string,
        sourcePoint: StaticMeshConstructionPoint,
        towardPointId: string,
      ): string => makeBevelPointAt(
        preferredId,
        sourcePoint,
        constructionPointAtDistance(state.construction, sourcePoint.id, towardPointId, args.width),
      );

      const createEndpointOffsets = (
        endpoint: StaticMeshConstructionPoint,
        plan: BevelEndpointFanPlan,
        endpointLabel: 'a' | 'b',
      ): Map<string, string> => {
        const offsets = new Map<string, string>();
        plan.neighborIds.forEach((neighborId, index) => {
          offsets.set(
            neighborId,
            makeBevelPoint(`${operationId}.end${endpointLabel}.${index}`, endpoint, neighborId),
          );
        });
        return offsets;
      };

      const offsetsA = endpointATwoEdge
        ? new Map([[
            neighborAForward,
            makeBevelPoint(`${operationId}.enda.leg`, pointA, neighborAForward),
          ]])
        : createEndpointOffsets(pointA, endpointAPlan!, 'a');
      const offsetsB = endpointBTwoEdge
        ? new Map([[
            neighborBForward,
            makeBevelPoint(`${operationId}.endb.leg`, pointB, neighborBForward),
          ]])
        : createEndpointOffsets(pointB, endpointBPlan!, 'b');

      const terminalAForwardId = endpointATwoEdge
        ? makeBevelPointAt(
            `${operationId}.enda.forward`,
            pointA,
            constructionSelectedEdgeOffsetPoint(state.construction, forward.face, pointA.id, pointB.id, args.width),
          )
        : null;
      const terminalAReverseId = endpointATwoEdge
        ? makeBevelPointAt(
            `${operationId}.enda.reverse`,
            pointA,
            constructionSelectedEdgeOffsetPoint(state.construction, reverse.face, pointA.id, pointB.id, args.width),
          )
        : null;
      const terminalBForwardId = endpointBTwoEdge
        ? makeBevelPointAt(
            `${operationId}.endb.forward`,
            pointB,
            constructionSelectedEdgeOffsetPoint(state.construction, forward.face, pointB.id, pointA.id, args.width),
          )
        : null;
      const terminalBReverseId = endpointBTwoEdge
        ? makeBevelPointAt(
            `${operationId}.endb.reverse`,
            pointB,
            constructionSelectedEdgeOffsetPoint(state.construction, reverse.face, pointB.id, pointA.id, args.width),
          )
        : null;

      const forwardAId = terminalAForwardId ?? offsetsA.get(neighborAForward)!;
      const reverseAId = terminalAReverseId ?? offsetsA.get(neighborAReverse)!;
      const reverseBId = terminalBReverseId ?? offsetsB.get(neighborBReverse)!;
      const forwardBId = terminalBForwardId ?? offsetsB.get(neighborBForward)!;

      const boundaryByFace = new Map<string, string[]>(
        state.construction.faces.map(face => [face.id, [...face.pointIds]]),
      );
      const boundaryByLoop = new Map<string, string[]>(
        state.construction.loops.map(loop => [loop.id, [...loop.pointIds]]),
      );
      const insertOnAllAuthoredBoundaries = (edgeAId: string, edgeBId: string, pointId: string) => {
        let touched = 0;
        for (const face of state.construction.faces) {
          const boundary = boundaryByFace.get(face.id)!;
          const next = insertPointOnBoundaryEdge(boundary, edgeAId, edgeBId, pointId, true);
          if (!next) continue;
          boundaryByFace.set(face.id, next);
          touched += 1;
        }
        for (const loop of state.construction.loops) {
          const boundary = boundaryByLoop.get(loop.id)!;
          const next = insertPointOnBoundaryEdge(boundary, edgeAId, edgeBId, pointId, loop.closed);
          if (!next) continue;
          boundaryByLoop.set(loop.id, next);
        }
        if (touched === 0) throw new Error('Bevel Edge could not propagate one offset point into authored topology.');
      };

      for (const [neighborId, pointId] of offsetsA) {
        insertOnAllAuthoredBoundaries(pointA.id, neighborId, pointId);
      }
      for (const [neighborId, pointId] of offsetsB) {
        insertOnAllAuthoredBoundaries(pointB.id, neighborId, pointId);
      }

      const insertTerminalProfilePoint = (
        face: StaticMeshConstructionFace,
        endpointId: string,
        selectedOtherId: string,
        pointId: string,
      ) => {
        const originalIndex = face.pointIds.indexOf(endpointId);
        if (originalIndex < 0) throw new Error(`Bevel Edge could not resolve authored face '${face.id}'.`);
        const count = face.pointIds.length;
        const previousId = face.pointIds[(originalIndex - 1 + count) % count];
        const nextId = face.pointIds[(originalIndex + 1) % count];
        if (selectedOtherId !== previousId && selectedOtherId !== nextId) {
          throw new Error('Bevel Edge could not orient a terminal profile point.');
        }
        const boundary = boundaryByFace.get(face.id);
        if (!boundary) throw new Error(`Bevel Edge could not resolve authored face '${face.id}'.`);
        const endpointIndex = boundary.indexOf(endpointId);
        if (endpointIndex < 0) throw new Error('Bevel Edge lost a terminal endpoint before face reconstruction.');
        const next = [...boundary];
        if (selectedOtherId === nextId) next.splice(endpointIndex + 1, 0, pointId);
        else next.splice(endpointIndex, 0, pointId);
        boundaryByFace.set(face.id, next);
      };

      // edgecount==2 terminal: each selected face needs a different point on
      // its own offset line. Insert those into only their representative face;
      // the shared artificial leg point was inserted above on the sole
      // unbeveled edge. Placement uses the original face winding so both ends
      // may independently be edgecount==2 without fighting over AB adjacency.
      if (endpointATwoEdge) {
        insertTerminalProfilePoint(forward.face, pointA.id, pointB.id, forwardAId);
        insertTerminalProfilePoint(reverse.face, pointA.id, pointB.id, reverseAId);
      }
      if (endpointBTwoEdge) {
        insertTerminalProfilePoint(forward.face, pointB.id, pointA.id, forwardBId);
        insertTerminalProfilePoint(reverse.face, pointB.id, pointA.id, reverseBId);
      }

      const removePointFromFaceBoundary = (faceId: string, pointId: string) => {
        const boundary = boundaryByFace.get(faceId);
        if (!boundary || !boundary.includes(pointId)) return;
        const next = boundary.filter(id => id !== pointId);
        if (next.length < 3 || new Set(next).size !== next.length) {
          throw new Error('Bevel Edge would create a degenerate face boundary.');
        }
        boundaryByFace.set(faceId, next);
      };

      // Every face using A/B belongs to the local one-ring that was validated by
      // the fan planner. Remove the old endpoint after its incident edges have
      // received semantic offset points.
      for (const face of state.construction.faces) {
        if (face.pointIds.includes(pointA.id)) removePointFromFaceBoundary(face.id, pointA.id);
        if (face.pointIds.includes(pointB.id)) removePointFromFaceBoundary(face.id, pointB.id);
      }

      const removeEndpointFromLoops = (endpointId: string, offsetIds: ReadonlySet<string>) => {
        for (const loop of state.construction.loops) {
          let boundary = boundaryByLoop.get(loop.id)!;
          if (!boundary.includes(endpointId)) continue;
          const touchingOffsets = boundary.filter(pointId => offsetIds.has(pointId));
          // A loop that passes through an endpoint owns two incident edges. Both
          // have already received offsets, so the old corner can leave the loop.
          if (touchingOffsets.length >= 2) boundary = boundary.filter(pointId => pointId !== endpointId);
          if (boundary.length < (loop.closed ? 3 : 2) || new Set(boundary).size !== boundary.length) {
            throw new Error('Bevel Edge would create a degenerate Construction Loop.');
          }
          boundaryByLoop.set(loop.id, boundary);
        }
      };
      removeEndpointFromLoops(pointA.id, new Set(offsetsA.values()));
      removeEndpointFromLoops(pointB.id, new Set(offsetsB.values()));
      for (const loop of state.construction.loops) loop.pointIds = boundaryByLoop.get(loop.id)!;

      const updatedFaceIds: string[] = [];
      for (const face of state.construction.faces) {
        const nextBoundary = boundaryByFace.get(face.id)!;
        if (nextBoundary.length === face.pointIds.length
          && nextBoundary.every((pointId, index) => pointId === face.pointIds[index])) {
          continue;
        }
        replaceConstructionFaceBoundaryInState(state, face, nextBoundary);
        updatedFaceIds.push(face.id);
      }

      const endpointCapFaceIds: string[] = [];
      const addEndpointCapPoints = (label: 'a' | 'b', pointIds: string[]) => {
        if (pointIds.length < 3) return;
        const cap = addConstructionFaceToState(state, {
          id: `${operationId}.cap.${label}`,
          name: `Bevel Endpoint ${label.toUpperCase()} Cap`,
          pointIds,
        });
        endpointCapFaceIds.push(cap.id);
      };
      const addEndpointCap = (label: 'a' | 'b', plan: BevelEndpointFanPlan, offsets: Map<string, string>) => {
        addEndpointCapPoints(label, plan.neighborIds.map(neighborId => offsets.get(neighborId)!));
      };
      if (endpointATwoEdge) {
        addEndpointCapPoints('a', [forwardAId, offsetsA.get(neighborAForward)!, reverseAId]);
      } else {
        addEndpointCap('a', endpointAPlan!, offsetsA);
      }
      if (endpointBTwoEdge) {
        addEndpointCapPoints('b', [reverseBId, offsetsB.get(neighborBForward)!, forwardBId]);
      } else {
        addEndpointCap('b', endpointBPlan!, offsetsB);
      }

      const bevelFace = addConstructionFaceToState(state, {
        id: `${operationId}.face`,
        name: `${forward.face.name ?? forward.face.id} / ${reverse.face.name ?? reverse.face.id} Bevel`,
        pointIds: [forwardAId, reverseAId, reverseBId, forwardBId],
      });

      // A/B are no longer part of any logical face after a valid local bevel.
      // Compact those orphan render vertices while preserving the semantic Points
      // themselves as planning/history handles with empty vertex bindings.
      compactUnusedConstructionVertices(state);

      const forwardAVertex = findConstructionPoint(state.construction, forwardAId).vertexIds?.[0];
      const forwardBVertex = findConstructionPoint(state.construction, forwardBId).vertexIds?.[0];
      const reverseAVertex = findConstructionPoint(state.construction, reverseAId).vertexIds?.[0];
      const reverseBVertex = findConstructionPoint(state.construction, reverseBId).vertexIds?.[0];
      if ([forwardAVertex, forwardBVertex, reverseAVertex, reverseBVertex].some(vertexId => vertexId === undefined)) {
        throw new Error('Bevel Edge failed to materialize its offset topology.');
      }

      const bevelEdgeIds: [string, string] = [
        meshEdgeKey(forwardAVertex!, forwardBVertex!),
        meshEdgeKey(reverseAVertex!, reverseBVertex!),
      ];
      finalizeConstructionMutation(state);

      return {
        id: operationId,
        sourcePointIds: [pointA.id, pointB.id],
        sidePointIds: [[forwardAId, forwardBId], [reverseAId, reverseBId]],
        bevelFaceId: bevelFace.id,
        bevelLogicalFaceId: bevelFace.faceId,
        endpointCapFaceIds,
        updatedFaceIds,
        bevelEdgeIds,
        width: args.width,
      };
    });
  }

  /**
   * Splits one authored Construction Edge by inserting a new semantic Point and
   * updating every incident Construction Face/Loop that uses that edge. Faces
   * keep their stable semantic/logical ids; only their ordered boundary grows.
   */
  splitConstructionEdge(args: SplitConstructionEdgeArgs): SplitConstructionEdgeResult {
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
  deleteConstructionFace(args: DeleteConstructionFaceArgs): DeleteConstructionFaceResult {
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
   * Insets one Construction Face by scaling its ordered boundary toward the
   * arithmetic face center. The input semantic face id is preserved and becomes
   * the inner face, while a ring of new border faces connects the old boundary
   * to the new inner boundary. This relative inset does not require planarity.
   */
  private insetConstructionFaceInState(
    state: ConstructionMutationState,
    args: InsetConstructionFaceArgs,
  ): InsetConstructionFaceResult {
    const sourceFace = findConstructionFace(state.construction, args.faceId);
    const originalPointIds = [...sourceFace.pointIds];
    const insetPositions = computeInsetPositions(state.construction, originalPointIds, args.ratio);
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

    return {
      id: operationId,
      sourceFaceId: sourceFace.id,
      innerFaceId: sourceFace.id,
      innerLoopId,
      innerPointIds,
      borderFaceIds,
    };
  }

  /**
   * Insets one Construction Face by scaling its ordered boundary toward the
   * arithmetic face center. The input semantic face id is preserved and becomes
   * the inner face, while a ring of new border faces connects the old boundary
   * to the new inner boundary. This relative inset does not require planarity.
   */
  insetConstructionFace(args: InsetConstructionFaceArgs): InsetConstructionFaceResult {
    return assetHistory.execute(args.assetId, 'Inset Construction Face', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      const state = createConstructionMutationState(asset);
      const result = this.insetConstructionFaceInState(state, args);
      finalizeConstructionMutation(state);
      return result;
    });
  }

  private extrudeConstructionFaceInState(
    state: ConstructionMutationState,
    args: ExtrudeConstructionFaceArgs,
  ): ExtrudeConstructionFaceResult {
    if (!Number.isFinite(args.distance) || Math.abs(args.distance) <= 1e-8) {
      throw new Error('Extrude distance must be a finite non-zero number.');
    }
    const sourceFace = findConstructionFace(state.construction, args.faceId);
    const sourcePointIds = [...sourceFace.pointIds];
    const operationId = makeUniqueOperationId(
      args.id,
      'extrude',
      [
        ...state.construction.faces.map(face => face.id),
        ...state.construction.loops.map(loop => loop.id),
        ...state.construction.points.map(point => point.id),
      ],
    );
    const direction = computeConstructionFaceNormal(state.construction, sourcePointIds);

    const topPointIds: string[] = [];
    for (let index = 0; index < sourcePointIds.length; index += 1) {
      const sourcePoint = findConstructionPoint(state.construction, sourcePointIds[index]);
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

    replaceConstructionFaceBoundaryInState(state, sourceFace, topPointIds);

    const sideFaceIds: string[] = [];
    for (let i = 0; i < sourcePointIds.length; i += 1) {
      const next = (i + 1) % sourcePointIds.length;
      const side = addConstructionFaceToState(state, {
        id: `${operationId}.side.${i}`,
        pointIds: [sourcePointIds[i], sourcePointIds[next], topPointIds[next], topPointIds[i]],
      });
      sideFaceIds.push(side.id);
    }
    const topLoopId = makeUniqueConstructionId(
      `${operationId}.topLoop`,
      'loop',
      state.construction.loops.map(loop => loop.id),
    );
    state.construction.loops.push({ id: topLoopId, pointIds: [...topPointIds], closed: true });

    return {
      id: operationId,
      sourceFaceId: sourceFace.id,
      topFaceId: sourceFace.id,
      topLoopId,
      topPointIds,
      sideFaceIds,
    };
  }

  extrudeConstructionFace(args: ExtrudeConstructionFaceArgs): ExtrudeConstructionFaceResult {
    return assetHistory.execute(args.assetId, 'Extrude Construction Face', () => {
      const asset = requireStaticMesh(args.assetId, 'target');
      if (!Number.isFinite(args.distance) || Math.abs(args.distance) <= 1e-8) {
        throw new Error('Extrude distance must be a finite non-zero number.');
      }
      const state = createConstructionMutationState(asset);
      const result = this.extrudeConstructionFaceInState(state, args);
      finalizeConstructionMutation(state);
      return result;
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

      let vertices: Float32Array = new Float32Array(target.geometry.vertices);
      let normals: Float32Array = new Float32Array(target.geometry.normals);
      let uvs: Float32Array = new Float32Array(target.geometry.uvs);
      let colors: Float32Array = target.geometry.colors
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
