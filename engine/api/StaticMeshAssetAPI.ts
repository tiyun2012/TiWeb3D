import { assetManager } from '@/engine/AssetManager';
import { MeshTopologyUtils } from '@/engine/MeshTopologyUtils';
import type { LogicalMesh, MeshGeometry, StaticMeshAsset, StaticMeshIdRange } from '@/types';
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

/**
 * Stable asset-level API for Static Mesh composition. UI surfaces should call
 * this service instead of mutating geometry/editor metadata directly.
 */
class StaticMeshAssetAPIService {
  create(args: CreateStaticMeshArgs): StaticMeshAsset {
    return assetManager.createStaticMesh(args.name, args.path ?? '/Content/Meshes');
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
  }

  removeReferenceMesh(targetAssetId: string, sourceAssetId: string): string[] {
    const target = requireStaticMesh(targetAssetId, 'target');
    const next = this.getReferenceMeshIds(target.id).filter(id => id !== sourceAssetId);
    assetManager.updateAsset(target.id, {
      editor: {
        ...target.editor,
        referenceMeshIds: next,
      },
    });
    return next;
  }

  clearReferenceMeshes(targetAssetId: string): void {
    const target = requireStaticMesh(targetAssetId, 'target');
    assetManager.updateAsset(target.id, {
      editor: {
        ...target.editor,
        referenceMeshIds: [],
      },
    });
  }
}

export const staticMeshAssetAPI = new StaticMeshAssetAPIService();
