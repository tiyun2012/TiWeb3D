<<<<<<< HEAD
import type { StaticMeshAsset, StaticMeshIdRange, StaticMeshShell } from '@/types';

const countRange = (range: StaticMeshIdRange): number => Math.max(0, range.endExclusive - range.start);
=======
import type { LogicalMesh, StaticMeshAsset, StaticMeshIdRange, StaticMeshShell } from '@/types';
import { meshEdgeKey } from '@/engine/MeshEdgeGeometry';
import { getMeshConnectivity, reconcileMeshSiblingGroupsAfterGeometryEdit } from '@/engine/mesh-editing/MeshConnectivity';

const clampInt = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.floor(value)));
>>>>>>> 22095ed25f234a37a29434ca8482a4279c539820

const makeRange = (start: number, endExclusive: number): StaticMeshIdRange => ({
  start: Math.max(0, Math.floor(start)),
  endExclusive: Math.max(Math.max(0, Math.floor(start)), Math.floor(endExclusive)),
});

<<<<<<< HEAD
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
=======
const rangeFromIds = (ids: readonly number[]): StaticMeshIdRange => {
  if (ids.length === 0) return { start: 0, endExclusive: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const id of ids) {
    if (id < min) min = id;
    if (id > max) max = id;
  }
  return { start: Math.max(0, min), endExclusive: Math.max(0, max + 1) };
};

const idsFromRange = (range: StaticMeshIdRange | undefined, count: number): number[] => {
  if (!range || count <= 0) return [];
  const start = clampInt(range.start, 0, count);
  const end = clampInt(range.endExclusive, start, count);
  const ids: number[] = [];
  for (let id = start; id < end; id += 1) ids.push(id);
  return ids;
};

const sanitizeIds = (ids: readonly number[] | undefined, count: number): number[] => {
  if (!ids || count <= 0) return [];
  const unique = new Set<number>();
  for (const value of ids) {
    if (!Number.isFinite(value)) continue;
    const id = Math.floor(value);
    if (id >= 0 && id < count) unique.add(id);
  }
  return Array.from(unique).sort((a, b) => a - b);
};

const logicalFacesForAsset = (asset: StaticMeshAsset): { faces: number[][]; topology: LogicalMesh } => {
  if (asset.topology?.faces?.length) {
    return { faces: asset.topology.faces, topology: asset.topology };
  }

  // Triangle-only legacy assets still have a valid surface graph. Build a temporary
  // logical face list without mutating the saved asset.
  const faces: number[][] = [];
  for (let i = 0; i + 2 < asset.geometry.indices.length; i += 3) {
    faces.push([
      asset.geometry.indices[i],
      asset.geometry.indices[i + 1],
      asset.geometry.indices[i + 2],
    ]);
  }
  const triangleToFaceIndex = new Int32Array(faces.length);
  for (let i = 0; i < faces.length; i += 1) triangleToFaceIndex[i] = i;
  return {
    faces,
    topology: {
      faces,
      triangleToFaceIndex,
      vertexToFaces: asset.topology?.vertexToFaces ?? new Map(),
      siblings: asset.topology?.siblings,
    },
  };
};

const deriveTriangleToFace = (
  asset: StaticMeshAsset,
  topology: LogicalMesh,
  faceCount: number,
): Int32Array => {
  const triangleCount = Math.floor(asset.geometry.indices.length / 3);
  const existing = asset.topology?.triangleToFaceIndex;
  if (existing && existing.length === triangleCount) {
    let valid = true;
    for (let i = 0; i < existing.length; i += 1) {
      if (existing[i] < 0 || existing[i] >= faceCount) {
        valid = false;
        break;
      }
    }
    if (valid) return new Int32Array(existing);
  }

  const mapping = new Int32Array(triangleCount);
  mapping.fill(-1);
  if (triangleCount === 0 || faceCount === 0) return mapping;

  if (triangleCount === faceCount) {
    for (let i = 0; i < triangleCount; i += 1) mapping[i] = i;
    return mapping;
  }

  const vertexCount = Math.floor(asset.geometry.vertices.length / 3);
  const connectivity = getMeshConnectivity(topology, vertexCount);
  const canonicalFaceSets = topology.faces.map((_, faceId) => new Set(connectivity.faceCanonicalVertices[faceId] ?? []));

  for (let triangleId = 0; triangleId < triangleCount; triangleId += 1) {
    const offset = triangleId * 3;
    const raw = [
      asset.geometry.indices[offset],
      asset.geometry.indices[offset + 1],
      asset.geometry.indices[offset + 2],
    ];
    const canonical = Array.from(new Set(raw
      .filter(id => id >= 0 && id < vertexCount)
      .map(id => connectivity.canonicalVertex[id])));
    if (canonical.length < 3) continue;

    const candidates = connectivity.facesByCanonical.get(canonical[0]) ?? [];
    const match = candidates.find(faceId => canonical.every(id => canonicalFaceSets[faceId]?.has(id)));
    if (match !== undefined) mapping[triangleId] = match;
  }

  return mapping;
};

interface DetectedShellComponent {
  faceIds: number[];
  triangleIds: number[];
  vertexIds: number[];
}

/**
 * Detect actual Mesh Shells from authored topology, not from asset metadata.
 * Faces are connected only through a logical polygon edge. `siblings` are allowed
 * to bridge a render seam only when that relationship was explicitly authored or
 * imported. Coincident XYZ positions never create connectivity. Therefore the
 * built-in 24-vertex Cube (six independent quads, no authored welds) resolves as
 * six Mesh Shells.
 */
function detectStaticMeshShellComponents(asset: StaticMeshAsset): DetectedShellComponent[] {
  const vertexCount = Math.floor(asset.geometry.vertices.length / 3);
  const { faces, topology } = logicalFacesForAsset(asset);
  const faceCount = faces.length;
  if (faceCount === 0 || vertexCount === 0) return [];

  const connectivity = getMeshConnectivity(topology, vertexCount);
  const neighbors = Array.from({ length: faceCount }, () => new Set<number>());

  connectivity.edgeFacesByCanonicalEdge.forEach(edgeFaces => {
    const validFaces = edgeFaces.filter(faceId => faceId >= 0 && faceId < faceCount);
    for (let i = 0; i < validFaces.length; i += 1) {
      for (let j = i + 1; j < validFaces.length; j += 1) {
        neighbors[validFaces[i]].add(validFaces[j]);
        neighbors[validFaces[j]].add(validFaces[i]);
      }
    }
  });

  const components: number[][] = [];
  const visited = new Uint8Array(faceCount);
  for (let seed = 0; seed < faceCount; seed += 1) {
    if (visited[seed]) continue;
    visited[seed] = 1;
    const stack = [seed];
    const component: number[] = [];
    while (stack.length > 0) {
      const faceId = stack.pop()!;
      component.push(faceId);
      neighbors[faceId].forEach(next => {
        if (visited[next]) return;
        visited[next] = 1;
        stack.push(next);
      });
    }
    component.sort((a, b) => a - b);
    components.push(component);
  }

  const triangleToFace = deriveTriangleToFace(asset, topology, faceCount);
  const trianglesByFace = new Map<number, number[]>();
  for (let triangleId = 0; triangleId < triangleToFace.length; triangleId += 1) {
    const faceId = triangleToFace[triangleId];
    if (faceId < 0 || faceId >= faceCount) continue;
    let ids = trianglesByFace.get(faceId);
    if (!ids) {
      ids = [];
      trianglesByFace.set(faceId, ids);
    }
    ids.push(triangleId);
  }

  return components.map(faceIds => {
    const canonicalVertices = new Set<number>();
    const triangleIds: number[] = [];
    faceIds.forEach(faceId => {
      (connectivity.faceCanonicalVertices[faceId] ?? []).forEach(id => canonicalVertices.add(id));
      const triangles = trianglesByFace.get(faceId);
      if (triangles) triangleIds.push(...triangles);
    });

    const vertexIds = new Set<number>();
    canonicalVertices.forEach(canonical => {
      const members = connectivity.membersByCanonical.get(canonical);
      if (members?.length) members.forEach(id => vertexIds.add(id));
      else if (canonical >= 0 && canonical < vertexCount) vertexIds.add(canonical);
    });

    return {
      faceIds,
      triangleIds: Array.from(new Set(triangleIds)).sort((a, b) => a - b),
      vertexIds: Array.from(vertexIds).sort((a, b) => a - b),
    };
  }).sort((a, b) => (a.faceIds[0] ?? 0) - (b.faceIds[0] ?? 0));
}

export interface ResolvedStaticMeshShell {
  id: string;
  name: string;
  vertexIds: number[];
  triangleIds: number[];
  faceIds: number[];
  sourceAssetId?: string;
}

const metadataFaceIds = (shell: StaticMeshShell, faceCount: number): number[] => {
  const exact = sanitizeIds(shell.faceIdsExact, faceCount);
  if (exact.length > 0) return exact;
  return idsFromRange(shell.faceIds, faceCount);
};

const overlapCount = (a: readonly number[], b: readonly number[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  const smaller = a.length <= b.length ? a : b;
  const larger = new Set(a.length <= b.length ? b : a);
  let count = 0;
  for (const id of smaller) if (larger.has(id)) count += 1;
  return count;
};

/**
 * Resolve hierarchy Mesh Shells from actual topology. Saved `asset.shells` data is
 * treated only as naming/provenance metadata and is validated against detected
 * connected components, so stale/imported metadata cannot hide real shells.
 */
export function resolveStaticMeshShells(asset: StaticMeshAsset): ResolvedStaticMeshShell[] {
  const detected = detectStaticMeshShellComponents(asset);
  if (detected.length === 0) return [];

  const faceCount = logicalFacesForAsset(asset).faces.length;
  const metadata = (Array.isArray(asset.shells) ? asset.shells : []).map(shell => ({
    shell,
    faceIds: metadataFaceIds(shell, faceCount),
  }));

  return detected.map((component, index) => {
    let best: typeof metadata[number] | null = null;
    let bestOverlap = 0;
    for (const candidate of metadata) {
      const overlap = overlapCount(component.faceIds, candidate.faceIds);
      if (overlap > bestOverlap) {
        best = candidate;
        bestOverlap = overlap;
      }
    }

    const exactMatch = !!best
      && best.faceIds.length === component.faceIds.length
      && bestOverlap === component.faceIds.length;
    const firstFace = component.faceIds[0] ?? index;
    const baseName = best?.shell.name || asset.name;
    const name = detected.length === 1
      ? baseName
      : exactMatch
        ? baseName
        : `${baseName} · Part ${index + 1}`;

    return {
      id: exactMatch && best
        ? best.shell.id
        : `${best?.shell.id ?? `detected:${asset.id}`}:part:${firstFace}`,
      name,
      vertexIds: component.vertexIds,
      triangleIds: component.triangleIds,
      faceIds: component.faceIds,
      sourceAssetId: best?.shell.sourceAssetId,
    };
  });
}

/** Materialize a resolved Mesh Shell back into saved metadata after composition. */
export function materializeStaticMeshShell(shell: ResolvedStaticMeshShell): StaticMeshShell {
  return {
    id: shell.id,
    name: shell.name,
    vertexIds: rangeFromIds(shell.vertexIds),
    triangleIds: rangeFromIds(shell.triangleIds),
    faceIds: rangeFromIds(shell.faceIds),
    faceIdsExact: [...shell.faceIds],
    sourceAssetId: shell.sourceAssetId,
  };
}

export function offsetStaticMeshShell(
  shell: ResolvedStaticMeshShell,
  offsets: { vertex: number; triangle: number; face: number },
  sourceAssetId?: string,
): StaticMeshShell {
  const offsetIds = (ids: readonly number[], offset: number) => ids.map(id => id + offset);
  const vertexIds = offsetIds(shell.vertexIds, offsets.vertex);
  const triangleIds = offsetIds(shell.triangleIds, offsets.triangle);
  const faceIds = offsetIds(shell.faceIds, offsets.face);
  return {
    id: crypto.randomUUID(),
    name: shell.name,
    sourceAssetId: shell.sourceAssetId ?? sourceAssetId,
    vertexIds: rangeFromIds(vertexIds),
    triangleIds: rangeFromIds(triangleIds),
    faceIds: rangeFromIds(faceIds),
    faceIdsExact: faceIds,
  };
}

export function getStaticMeshShellCounts(asset: StaticMeshAsset, shell: ResolvedStaticMeshShell) {
  const uniqueEdges = new Set<string>();
  const faces = logicalFacesForAsset(asset).faces;
  for (const faceId of shell.faceIds) {
    const face = faces[faceId];
    if (!face || face.length < 2) continue;
    for (let i = 0; i < face.length; i += 1) {
      uniqueEdges.add(meshEdgeKey(face[i], face[(i + 1) % face.length]));
>>>>>>> 22095ed25f234a37a29434ca8482a4279c539820
    }
  }

  return {
<<<<<<< HEAD
    vertices: countRange(shell.vertexIds),
    triangles: countRange(shell.triangleIds),
    faces: countRange(shell.faceIds),
    edges: uniqueEdges.size,
  };
}
=======
    vertices: shell.vertexIds.length,
    triangles: shell.triangleIds.length,
    faces: shell.faceIds.length,
    edges: uniqueEdges.size,
  };
}

export interface StaticMeshShellComponentSelection {
  vertexIds: number[];
  edgeIds: string[];
  faceIds: number[];
}

/** Resolve every editable mesh component ID in the asset. */
export function getStaticMeshComponentSelection(asset: StaticMeshAsset): StaticMeshShellComponentSelection {
  const vertexCount = Math.floor(asset.geometry.vertices.length / 3);
  const vertexIds = Array.from({ length: vertexCount }, (_, id) => id);
  const faceIds: number[] = [];
  const edgeIds = new Set<string>();
  const faces = logicalFacesForAsset(asset).faces;

  faces.forEach((face, faceId) => {
    faceIds.push(faceId);
    if (!face || face.length < 2) return;
    for (let i = 0; i < face.length; i += 1) {
      edgeIds.add(meshEdgeKey(face[i], face[(i + 1) % face.length]));
    }
  });

  return { vertexIds, edgeIds: Array.from(edgeIds), faceIds };
}

/** Union component IDs across multiple resolved Mesh Shells. */
export function getStaticMeshShellsComponentSelection(
  asset: StaticMeshAsset,
  shells: Iterable<ResolvedStaticMeshShell>,
): StaticMeshShellComponentSelection {
  const vertexIds = new Set<number>();
  const edgeIds = new Set<string>();
  const faceIds = new Set<number>();

  for (const shell of shells) {
    const selection = getStaticMeshShellComponentSelection(asset, shell);
    selection.vertexIds.forEach(id => vertexIds.add(id));
    selection.edgeIds.forEach(id => edgeIds.add(id));
    selection.faceIds.forEach(id => faceIds.add(id));
  }

  return {
    vertexIds: Array.from(vertexIds).sort((a, b) => a - b),
    edgeIds: Array.from(edgeIds),
    faceIds: Array.from(faceIds).sort((a, b) => a - b),
  };
}

/**
 * Resolves the existing global component IDs owned by one detected shell. The
 * hierarchy can therefore switch mode + select the shell without maintaining a
 * second copy of topology membership.
 */
export function getStaticMeshShellComponentSelection(
  asset: StaticMeshAsset,
  shell: ResolvedStaticMeshShell,
): StaticMeshShellComponentSelection {
  const edgeIds = new Set<string>();
  const faces = logicalFacesForAsset(asset).faces;
  for (const faceId of shell.faceIds) {
    const face = faces[faceId];
    if (!face || face.length < 2) continue;
    for (let i = 0; i < face.length; i += 1) {
      edgeIds.add(meshEdgeKey(face[i], face[(i + 1) % face.length]));
    }
  }

  return {
    vertexIds: [...shell.vertexIds],
    edgeIds: Array.from(edgeIds),
    faceIds: [...shell.faceIds],
  };
}


/**
 * Transaction-boundary maintenance for direct Static Mesh deformation. Existing
 * render-vertex welds are allowed to split when their members were edited apart,
 * then Mesh Shell metadata is rematerialized from the repaired topology. This never
 * creates new welds from positional contact.
 */
export function finalizeStaticMeshTopologyAfterGeometryEdit(asset: StaticMeshAsset) {
  if (!asset.topology) {
    return { topologyChanged: false, shellCount: resolveStaticMeshShells(asset).length };
  }

  const result = reconcileMeshSiblingGroupsAfterGeometryEdit(asset.topology, asset.geometry.vertices);
  if (result.changed) {
    asset.shells = resolveStaticMeshShells(asset).map(materializeStaticMeshShell);
  }

  return {
    topologyChanged: result.changed,
    shellCount: resolveStaticMeshShells(asset).length,
  };
}
>>>>>>> 22095ed25f234a37a29434ca8482a4279c539820
