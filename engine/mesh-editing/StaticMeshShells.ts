import type { StaticMeshAsset, StaticMeshIdRange, StaticMeshShell } from '@/types';

const countRange = (range: StaticMeshIdRange): number => Math.max(0, range.endExclusive - range.start);

const makeRange = (start: number, endExclusive: number): StaticMeshIdRange => ({
  start: Math.max(0, Math.floor(start)),
  endExclusive: Math.max(Math.max(0, Math.floor(start)), Math.floor(endExclusive)),
});

/**
 * Returns the authored shell list for a Static Mesh. Older/imported assets that
 * predate shell metadata are exposed as one virtual base shell so hierarchy and
 * append code remain backward compatible without duplicating topology data.
 */
export function resolveStaticMeshShells(asset: StaticMeshAsset): StaticMeshShell[] {
  const logicalFaceCount = asset.topology?.faces?.length ?? 0;
  if (Array.isArray(asset.shells) && asset.shells.length > 0) {
    return asset.shells.map(shell => ({
      ...shell,
      vertexIds: makeRange(shell.vertexIds.start, shell.vertexIds.endExclusive),
      triangleIds: makeRange(shell.triangleIds.start, shell.triangleIds.endExclusive),
      faceIds: logicalFaceCount > 0
        ? makeRange(shell.faceIds.start, shell.faceIds.endExclusive)
        : makeRange(shell.triangleIds.start, shell.triangleIds.endExclusive),
    }));
  }

  const vertexCount = Math.floor(asset.geometry.vertices.length / 3);
  const triangleCount = Math.floor(asset.geometry.indices.length / 3);
  const faceCount = logicalFaceCount > 0 ? logicalFaceCount : triangleCount;
  if (vertexCount === 0 && triangleCount === 0 && faceCount === 0) return [];

  return [{
    id: `legacy:${asset.id}:0`,
    name: asset.name,
    vertexIds: { start: 0, endExclusive: vertexCount },
    triangleIds: { start: 0, endExclusive: triangleCount },
    faceIds: { start: 0, endExclusive: faceCount },
  }];
}

export function offsetStaticMeshShell(
  shell: StaticMeshShell,
  offsets: { vertex: number; triangle: number; face: number },
  sourceAssetId?: string,
): StaticMeshShell {
  return {
    ...shell,
    id: crypto.randomUUID(),
    sourceAssetId: shell.sourceAssetId ?? sourceAssetId,
    vertexIds: {
      start: shell.vertexIds.start + offsets.vertex,
      endExclusive: shell.vertexIds.endExclusive + offsets.vertex,
    },
    triangleIds: {
      start: shell.triangleIds.start + offsets.triangle,
      endExclusive: shell.triangleIds.endExclusive + offsets.triangle,
    },
    faceIds: {
      start: shell.faceIds.start + offsets.face,
      endExclusive: shell.faceIds.endExclusive + offsets.face,
    },
  };
}

export function getStaticMeshShellCounts(asset: StaticMeshAsset, shell: StaticMeshShell) {
  const uniqueEdges = new Set<string>();
  const faces = asset.topology?.faces ?? [];
  const faceStart = Math.max(0, shell.faceIds.start);
  const faceEnd = Math.min(faces.length, shell.faceIds.endExclusive);

  for (let faceId = faceStart; faceId < faceEnd; faceId += 1) {
    const face = faces[faceId];
    if (!face || face.length < 2) continue;
    for (let i = 0; i < face.length; i += 1) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      uniqueEdges.add(`${Math.min(a, b)}_${Math.max(a, b)}`);
    }
  }

  // Triangle-only assets are a fallback for legacy meshes without logical faces.
  if (faceEnd <= faceStart) {
    const indices = asset.geometry.indices;
    const triangleStart = Math.max(0, shell.triangleIds.start);
    const triangleEnd = Math.min(Math.floor(indices.length / 3), shell.triangleIds.endExclusive);
    for (let triangleId = triangleStart; triangleId < triangleEnd; triangleId += 1) {
      const offset = triangleId * 3;
      const tri = [indices[offset], indices[offset + 1], indices[offset + 2]];
      for (let i = 0; i < 3; i += 1) {
        const a = tri[i];
        const b = tri[(i + 1) % 3];
        uniqueEdges.add(`${Math.min(a, b)}_${Math.max(a, b)}`);
      }
    }
  }

  return {
    vertices: countRange(shell.vertexIds),
    triangles: countRange(shell.triangleIds),
    faces: countRange(shell.faceIds),
    edges: uniqueEdges.size,
  };
}
