import type { StaticMeshAsset, Vector3 } from '@/types';
import { meshEdgeKey } from '@/engine/MeshEdgeGeometry';

export interface AABB {
  min: Vector3;
  max: Vector3;
}
import { computePlanarFaceNormal } from '@/engine/mesh-editing/MeshPlanarGeometry';
import { getMeshConnectivity } from '@/engine/mesh-editing/MeshConnectivity';
import { resolveStaticMeshShells } from '@/engine/mesh-editing/StaticMeshShells';
import type { StaticMeshFaceKind } from '@/engine/mesh-editing/StaticMeshTopologyQueries';

export type StaticMeshPrimitiveKind = 'PLANE' | 'BOX' | 'GRID' | 'CYLINDER' | 'PYRAMID';

export interface StaticMeshPrimitiveOptions {
  kind: StaticMeshPrimitiveKind;
  /** World-space dimensions { x: width, y: height, z: depth }. Defaults to { x: 2, y: 2, z: 2 }. */
  size?: Partial<Vector3> | number;
  /** Center offset in local mesh space. Defaults to { x: 0, y: 0, z: 0 }. */
  center?: Partial<Vector3>;
  /** Subdivisions along X for GRID (1..64). Defaults to 2. */
  segmentsX?: number;
  /** Subdivisions along Z for GRID (1..64). Defaults to 2. */
  segmentsZ?: number;
  /** Radial sides for CYLINDER (3..64). Defaults to 12. */
  radialSegments?: number;
  /** Optional explicit radius for CYLINDER (overrides size.x/size.z half-extents). */
  radius?: number;
  /** Whether CYLINDER includes top and bottom polygon caps. Defaults to true. */
  capped?: boolean;
}

export interface BuiltPrimitiveGeometry {
  positions: Vector3[];
  faces: number[][];
  uvs: Array<{ u: number; v: number }>;
}

export type StaticMeshDirectionTag =
  | 'TOP'
  | 'BOTTOM'
  | 'RIGHT'
  | 'LEFT'
  | 'FRONT'
  | 'BACK'
  | 'ANGLED';

export interface StaticMeshInspectedFace {
  faceId: number;
  kind: StaticMeshFaceKind;
  vertexIds: number[];
  canonicalVertexIds: number[];
  edgeIds: string[];
  center: Vector3;
  normal: Vector3;
  area: number;
  directionTag: StaticMeshDirectionTag;
  adjacentFaceIds: number[];
}

export interface StaticMeshInspectedEdge {
  edgeId: string;
  vertexAId: number;
  vertexBId: number;
  vertexIds: [number, number];
  canonicalVertexIds: [number, number];
  length: number;
  midpoint: Vector3;
  incidentFaceIds: number[];
  isBoundary: boolean;
  isManifold: boolean;
}

export interface StaticMeshInspectedVertex {
  vertexId: number;
  canonicalVertexId: number;
  position: Vector3;
  incidentFaceIds: number[];
  valence: number;
}

export interface StaticMeshInspectionReport {
  assetId: string;
  name: string;
  vertexCount: number;
  triangleCount: number;
  faceCount: number;
  edgeCount: number;
  shellCount: number;
  isManifold: boolean;
  isClosedManifold: boolean;
  openEdgeCount: number;
  nonManifoldEdgeCount: number;
  aabb: AABB;
  dimensions: Vector3;
  center: Vector3;
  faces: StaticMeshInspectedFace[];
  edges: StaticMeshInspectedEdge[];
  vertices: StaticMeshInspectedVertex[];
}

export type StaticMeshFaceSortBy =
  | 'ID'
  | 'MAX_Y'
  | 'MIN_Y'
  | 'Y_DESC'
  | 'Y_ASC'
  | 'MAX_X'
  | 'MIN_X'
  | 'X_DESC'
  | 'X_ASC'
  | 'MAX_Z'
  | 'MIN_Z'
  | 'Z_DESC'
  | 'Z_ASC'
  | 'AREA_DESC'
  | 'AREA_ASC'
  | 'MAX_AREA'
  | 'MIN_AREA';

export interface StaticMeshFaceQuery {
  faceIds?: readonly number[];
  directionTag?: StaticMeshDirectionTag | readonly StaticMeshDirectionTag[];
  normalDirection?: Vector3;
  /** Maximum angular deviation in degrees when normalDirection is provided. Defaults to 35. */
  maxAngleDeg?: number;
  kind?: StaticMeshFaceKind | readonly StaticMeshFaceKind[];
  minArea?: number;
  maxArea?: number;
  sortBy?: StaticMeshFaceSortBy;
  limit?: number;
}

export type StaticMeshEdgeSortBy =
  | 'ID'
  | 'MAX_Y'
  | 'MIN_Y'
  | 'Y_DESC'
  | 'Y_ASC'
  | 'MAX_X'
  | 'MIN_X'
  | 'X_DESC'
  | 'X_ASC'
  | 'MAX_Z'
  | 'MIN_Z'
  | 'Z_DESC'
  | 'Z_ASC'
  | 'LENGTH_DESC'
  | 'LENGTH_ASC';

export interface StaticMeshEdgeQuery {
  edgeIds?: readonly string[];
  /** Restrict to edges belonging to a single face ID. */
  faceId?: number;
  /** Restrict to edges belonging to specific face IDs. */
  faceIds?: readonly number[];
  /** Restrict to edges belonging to faces matching this semantic face query. */
  faceQuery?: StaticMeshFaceQuery;
  onlyManifold?: boolean;
  /** Alias for onlyManifold. */
  manifoldOnly?: boolean;
  onlyBoundary?: boolean;
  /** Alias for onlyBoundary. */
  boundaryOnly?: boolean;
  minLength?: number;
  maxLength?: number;
  sortBy?: StaticMeshEdgeSortBy;
  limit?: number;
}

const resolveSize = (
  size: Partial<Vector3> | number | undefined,
  kind: StaticMeshPrimitiveKind,
): Vector3 => {
  const isPlanar = kind === 'PLANE' || kind === 'GRID';
  if (typeof size === 'number') {
    if (!Number.isFinite(size) || size <= 1e-6) {
      throw new Error('Primitive size must be a finite positive number.');
    }
    return { x: size, y: isPlanar ? 0 : size, z: size };
  }
  const sx = size?.x ?? 2;
  const sy = size?.y ?? (isPlanar ? 0 : 2);
  const sz = size?.z ?? 2;
  const yValid = isPlanar ? (Number.isFinite(sy) && sy >= 0) : (Number.isFinite(sy) && sy > 1e-6);
  if (!Number.isFinite(sx) || sx <= 1e-6 || !Number.isFinite(sz) || sz <= 1e-6 || !yValid) {
    throw new Error('Primitive dimensions must be finite positive numbers.');
  }
  return { x: sx, y: sy, z: sz };
};

const resolveCenter = (center: Partial<Vector3> | undefined): Vector3 => {
  const cx = center?.x ?? 0;
  const cy = center?.y ?? 0;
  const cz = center?.z ?? 0;
  if (![cx, cy, cz].every(Number.isFinite)) {
    throw new Error('Primitive center must contain finite coordinates.');
  }
  return { x: cx, y: cy, z: cz };
};

/**
 * Generates clean, welded, manifold LogicalMesh primitive topology suitable for
 * starting a Static Mesh modeling session from scratch without Construction metadata.
 */
export function buildStaticMeshPrimitiveGeometry(options: StaticMeshPrimitiveOptions): BuiltPrimitiveGeometry {
  const size = resolveSize(options.size, options.kind);
  const center = resolveCenter(options.center);
  const hx = size.x * 0.5;
  const hy = size.y * 0.5;
  const hz = size.z * 0.5;

  if (options.kind === 'PLANE') {
    const positions: Vector3[] = [
      { x: center.x - hx, y: center.y, z: center.z - hz },
      { x: center.x - hx, y: center.y, z: center.z + hz },
      { x: center.x + hx, y: center.y, z: center.z + hz },
      { x: center.x + hx, y: center.y, z: center.z - hz },
    ];
    const uvs = [
      { u: 0, v: 0 },
      { u: 0, v: 1 },
      { u: 1, v: 1 },
      { u: 1, v: 0 },
    ];
    return {
      positions,
      faces: [[0, 1, 2, 3]],
      uvs,
    };
  }

  if (options.kind === 'GRID') {
    const segX = Math.floor(options.segmentsX ?? 2);
    const segZ = Math.floor(options.segmentsZ ?? 2);
    if (!Number.isFinite(segX) || !Number.isFinite(segZ) || segX < 1 || segX > 64 || segZ < 1 || segZ > 64) {
      throw new Error('Grid segmentsX and segmentsZ must be integers between 1 and 64.');
    }
    const positions: Vector3[] = [];
    const uvs: Array<{ u: number; v: number }> = [];
    const stride = segX + 1;
    for (let iz = 0; iz <= segZ; iz += 1) {
      const tz = iz / segZ;
      const z = center.z - hz + size.z * tz;
      for (let ix = 0; ix <= segX; ix += 1) {
        const tx = ix / segX;
        const x = center.x - hx + size.x * tx;
        positions.push({ x, y: center.y, z });
        uvs.push({ u: tx, v: tz });
      }
    }
    const faces: number[][] = [];
    for (let iz = 0; iz < segZ; iz += 1) {
      for (let ix = 0; ix < segX; ix += 1) {
        const v00 = iz * stride + ix;
        const v10 = v00 + 1;
        const v01 = (iz + 1) * stride + ix;
        const v11 = v01 + 1;
        // Outward +Y normal winding
        faces.push([v00, v01, v11, v10]);
      }
    }
    return { positions, faces, uvs };
  }

  if (options.kind === 'BOX') {
    // 8 welded corner vertices, 6 consistently wound outward quad faces
    // Bottom ring (y = center.y - hy): 0..3
    // Top ring (y = center.y + hy): 4..7
    const positions: Vector3[] = [
      { x: center.x - hx, y: center.y - hy, z: center.z - hz }, // 0: L B Back
      { x: center.x + hx, y: center.y - hy, z: center.z - hz }, // 1: R B Back
      { x: center.x + hx, y: center.y - hy, z: center.z + hz }, // 2: R B Front
      { x: center.x - hx, y: center.y - hy, z: center.z + hz }, // 3: L B Front
      { x: center.x - hx, y: center.y + hy, z: center.z - hz }, // 4: L T Back
      { x: center.x + hx, y: center.y + hy, z: center.z - hz }, // 5: R T Back
      { x: center.x + hx, y: center.y + hy, z: center.z + hz }, // 6: R T Front
      { x: center.x - hx, y: center.y + hy, z: center.z + hz }, // 7: L T Front
    ];
    const uvs: Array<{ u: number; v: number }> = [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
    ];
    const faces: number[][] = [
      [4, 7, 6, 5], // 0: TOP (+Y)
      [0, 1, 2, 3], // 1: BOTTOM (-Y)
      [3, 2, 6, 7], // 2: FRONT (+Z)
      [1, 0, 4, 5], // 3: BACK (-Z)
      [2, 1, 5, 6], // 4: RIGHT (+X)
      [0, 3, 7, 4], // 5: LEFT (-X)
    ];
    return { positions, faces, uvs };
  }

  if (options.kind === 'PYRAMID') {
    const positions: Vector3[] = [
      { x: center.x - hx, y: center.y - hy, z: center.z - hz }, // 0
      { x: center.x + hx, y: center.y - hy, z: center.z - hz }, // 1
      { x: center.x + hx, y: center.y - hy, z: center.z + hz }, // 2
      { x: center.x - hx, y: center.y - hy, z: center.z + hz }, // 3
      { x: center.x, y: center.y + hy, z: center.z },           // 4: Apex
    ];
    const uvs: Array<{ u: number; v: number }> = [
      { u: 0, v: 0 },
      { u: 1, v: 0 },
      { u: 1, v: 1 },
      { u: 0, v: 1 },
      { u: 0.5, v: 0.5 },
    ];
    const faces: number[][] = [
      [0, 1, 2, 3], // 0: Base (-Y)
      [3, 2, 4],    // 1: Front (+Z)
      [2, 1, 4],    // 2: Right (+X)
      [1, 0, 4],    // 3: Back (-Z)
      [0, 3, 4],    // 4: Left (-X)
    ];
    return { positions, faces, uvs };
  }

  if (options.kind === 'CYLINDER') {
    const radialSegments = Math.floor(options.radialSegments ?? 12);
    if (!Number.isFinite(radialSegments) || radialSegments < 3 || radialSegments > 64) {
      throw new Error('Cylinder radialSegments must be an integer between 3 and 64.');
    }
    const capped = options.capped ?? true;
    const rx = options.radius !== undefined && Number.isFinite(options.radius) && options.radius > 1e-6 ? options.radius : hx;
    const rz = options.radius !== undefined && Number.isFinite(options.radius) && options.radius > 1e-6 ? options.radius : hz;
    const positions: Vector3[] = [];
    const uvs: Array<{ u: number; v: number }> = [];

    // Bottom ring: 0 .. radialSegments - 1
    for (let i = 0; i < radialSegments; i += 1) {
      const angle = (i / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push({
        x: center.x + cos * rx,
        y: center.y - hy,
        z: center.z + sin * rz,
      });
      uvs.push({ u: i / radialSegments, v: 0 });
    }
    // Top ring: radialSegments .. 2 * radialSegments - 1
    for (let i = 0; i < radialSegments; i += 1) {
      const angle = (i / radialSegments) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push({
        x: center.x + cos * rx,
        y: center.y + hy,
        z: center.z + sin * rz,
      });
      uvs.push({ u: i / radialSegments, v: 1 });
    }

    const faces: number[][] = [];
    if (capped) {
      // Top cap (+Y outward): reverse order around top ring so normal points +Y
      const topCap: number[] = [];
      for (let i = radialSegments - 1; i >= 0; i -= 1) {
        topCap.push(radialSegments + i);
      }
      faces.push(topCap);

      // Bottom cap (-Y outward): forward order around bottom ring so normal points -Y
      const bottomCap: number[] = [];
      for (let i = 0; i < radialSegments; i += 1) {
        bottomCap.push(i);
      }
      faces.push(bottomCap);
    }

    // Side quads with outward radial normals
    for (let i = 0; i < radialSegments; i += 1) {
      const next = (i + 1) % radialSegments;
      const b0 = i;
      const b1 = next;
      const t0 = radialSegments + i;
      const t1 = radialSegments + next;
      faces.push([b1, b0, t0, t1]);
    }

    return { positions, faces, uvs };
  }

  throw new Error(`Unsupported Static Mesh primitive kind '${String(options.kind)}'.`);
}

export function classifyNormalDirectionTag(normal: Vector3): StaticMeshDirectionTag {
  const len = Math.hypot(normal.x, normal.y, normal.z);
  if (len <= 1e-8) return 'ANGLED';
  const nx = normal.x / len;
  const ny = normal.y / len;
  const nz = normal.z / len;
  const threshold = 0.85; // ~31.8 degrees from primary axis
  if (ny >= threshold) return 'TOP';
  if (ny <= -threshold) return 'BOTTOM';
  if (nx >= threshold) return 'RIGHT';
  if (nx <= -threshold) return 'LEFT';
  if (nz >= threshold) return 'FRONT';
  if (nz <= -threshold) return 'BACK';
  return 'ANGLED';
}

const computePolygonAreaAndNormal = (positions: readonly Vector3[]): { area: number; normal: Vector3; center: Vector3 } => {
  if (positions.length === 0) {
    return {
      area: 0,
      normal: { x: 0, y: 1, z: 0 },
      center: { x: 0, y: 0, z: 0 },
    };
  }
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of positions) {
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  const center = {
    x: cx / positions.length,
    y: cy / positions.length,
    z: cz / positions.length,
  };

  if (positions.length < 3) {
    return { area: 0, normal: { x: 0, y: 1, z: 0 }, center };
  }

  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < positions.length; i += 1) {
    const current = positions[i];
    const next = positions[(i + 1) % positions.length];
    nx += (current.y - next.y) * (current.z + next.z);
    ny += (current.z - next.z) * (current.x + next.x);
    nz += (current.x - next.x) * (current.y + next.y);
  }
  const doubleArea = Math.hypot(nx, ny, nz);
  if (doubleArea <= 1e-10) {
    return {
      area: 0,
      normal: { x: 0, y: 1, z: 0 },
      center,
    };
  }
  let normal: Vector3;
  try {
    normal = computePlanarFaceNormal(positions);
  } catch {
    normal = { x: nx / doubleArea, y: ny / doubleArea, z: nz / doubleArea };
  }
  return {
    area: doubleArea * 0.5,
    normal,
    center,
  };
};

const classifyFaceKind = (count: number, valid: boolean): StaticMeshFaceKind => {
  if (!valid || count < 3) return 'DEGENERATE';
  if (count === 3) return 'TRIANGLE';
  if (count === 4) return 'QUAD';
  return 'NGON';
};

/**
 * Produces a structured, AI-friendly inspection summary of a Static Mesh asset.
 */
export function inspectStaticMesh(asset: StaticMeshAsset): StaticMeshInspectionReport {
  const verticesBuf = asset.geometry.vertices;
  const vertexCount = Math.floor(verticesBuf.length / 3);
  const triangleCount = Math.floor(asset.geometry.indices.length / 3);
  const rawFaces = asset.topology?.faces ?? [];
  const connectivity = getMeshConnectivity(asset.topology, vertexCount);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const vertices: StaticMeshInspectedVertex[] = [];
  for (let vertexId = 0; vertexId < vertexCount; vertexId += 1) {
    const offset = vertexId * 3;
    const x = verticesBuf[offset] ?? 0;
    const y = verticesBuf[offset + 1] ?? 0;
    const z = verticesBuf[offset + 2] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;

    const canonical = connectivity.canonicalVertex[vertexId] ?? vertexId;
    const incidentFaceIds = [...(connectivity.facesByCanonical.get(canonical) ?? [])].sort((a, b) => a - b);
    const valence = (connectivity.neighborsByCanonical.get(canonical) ?? []).length;
    vertices.push({
      vertexId,
      canonicalVertexId: canonical,
      position: { x, y, z },
      incidentFaceIds,
      valence,
    });
  }

  const aabb: AABB = vertexCount > 0
    ? { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } }
    : { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  const dimensions: Vector3 = {
    x: aabb.max.x - aabb.min.x,
    y: aabb.max.y - aabb.min.y,
    z: aabb.max.z - aabb.min.z,
  };
  const center: Vector3 = {
    x: (aabb.min.x + aabb.max.x) * 0.5,
    y: (aabb.min.y + aabb.max.y) * 0.5,
    z: (aabb.min.z + aabb.max.z) * 0.5,
  };

  const edgeMap = new Map<string, {
    edgeId: string;
    vertexIds: [number, number];
    canonicalVertexIds: [number, number];
    incidentFaces: Set<number>;
  }>();

  const faces: StaticMeshInspectedFace[] = rawFaces.map((faceVerts, faceId) => {
    const validVerts = faceVerts.filter(v => Number.isInteger(v) && v >= 0 && v < vertexCount);
    const canonicalVertexIds = validVerts.map(v => connectivity.canonicalVertex[v]);
    const uniqueCanonical = new Set(canonicalVertexIds);
    const isValid = validVerts.length === faceVerts.length && uniqueCanonical.size === faceVerts.length && faceVerts.length >= 3;

    const positions = validVerts.map(v => vertices[v].position);
    const { area, normal, center: faceCenter } = computePolygonAreaAndNormal(positions);
    const edgeIds: string[] = [];
    const adjacent = new Set<number>();

    for (let i = 0; i < validVerts.length; i += 1) {
      const a = validVerts[i];
      const b = validVerts[(i + 1) % validVerts.length];
      const ca = connectivity.canonicalVertex[a];
      const cb = connectivity.canonicalVertex[b];
      if (ca === cb) continue;
      const edgeId = meshEdgeKey(a, b);
      const canonicalKey = meshEdgeKey(ca, cb);
      edgeIds.push(edgeId);

      const incident = connectivity.edgeFacesByCanonicalEdge.get(canonicalKey) ?? [];
      for (const candidateFaceId of incident) {
        if (candidateFaceId !== faceId) adjacent.add(candidateFaceId);
      }

      let edgeRecord = edgeMap.get(canonicalKey);
      if (!edgeRecord) {
        edgeRecord = {
          edgeId,
          vertexIds: a < b ? [a, b] : [b, a],
          canonicalVertexIds: ca < cb ? [ca, cb] : [cb, ca],
          incidentFaces: new Set<number>(),
        };
        edgeMap.set(canonicalKey, edgeRecord);
      }
      edgeRecord.incidentFaces.add(faceId);
    }

    return {
      faceId,
      kind: classifyFaceKind(faceVerts.length, isValid),
      vertexIds: [...faceVerts],
      canonicalVertexIds,
      edgeIds,
      center: faceCenter,
      normal,
      area,
      directionTag: classifyNormalDirectionTag(normal),
      adjacentFaceIds: Array.from(adjacent).sort((a, b) => a - b),
    };
  });

  let openEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  const edges: StaticMeshInspectedEdge[] = Array.from(edgeMap.values()).map(record => {
    const [va, vb] = record.vertexIds;
    const pa = vertices[va]?.position ?? { x: 0, y: 0, z: 0 };
    const pb = vertices[vb]?.position ?? { x: 0, y: 0, z: 0 };
    const length = Math.hypot(pb.x - pa.x, pb.y - pa.y, pb.z - pa.z);
    const midpoint = {
      x: (pa.x + pb.x) * 0.5,
      y: (pa.y + pb.y) * 0.5,
      z: (pa.z + pb.z) * 0.5,
    };
    const incidentFaceIds = Array.from(record.incidentFaces).sort((a, b) => a - b);
    const isBoundary = incidentFaceIds.length === 1;
    const isManifold = incidentFaceIds.length === 2;
    if (isBoundary) openEdgeCount += 1;
    if (incidentFaceIds.length > 2 || incidentFaceIds.length === 0) nonManifoldEdgeCount += 1;
    return {
      edgeId: record.edgeId,
      vertexAId: record.vertexIds[0],
      vertexBId: record.vertexIds[1],
      vertexIds: record.vertexIds,
      canonicalVertexIds: record.canonicalVertexIds,
      length,
      midpoint,
      incidentFaceIds,
      isBoundary,
      isManifold,
    };
  });

  const shells = resolveStaticMeshShells(asset);
  const isManifold = faces.length > 0 && openEdgeCount === 0 && nonManifoldEdgeCount === 0;

  return {
    assetId: asset.id,
    name: asset.name,
    vertexCount,
    triangleCount,
    faceCount: faces.length,
    edgeCount: edges.length,
    shellCount: shells.length,
    isManifold,
    isClosedManifold: isManifold,
    openEdgeCount,
    nonManifoldEdgeCount,
    aabb,
    dimensions,
    center,
    faces,
    edges,
    vertices,
  };
}

export function queryStaticMeshFaces(
  asset: StaticMeshAsset,
  query: StaticMeshFaceQuery = {},
  precomputedReport?: StaticMeshInspectionReport,
): StaticMeshInspectedFace[] {
  const report = precomputedReport ?? inspectStaticMesh(asset);
  let results = [...report.faces];

  if (query.faceIds && query.faceIds.length > 0) {
    const allowed = new Set(query.faceIds);
    results = results.filter(face => allowed.has(face.faceId));
  }

  if (query.directionTag) {
    const tags = Array.isArray(query.directionTag)
      ? new Set(query.directionTag)
      : new Set([query.directionTag]);
    results = results.filter(face => tags.has(face.directionTag));
  }

  if (query.kind) {
    const kinds = Array.isArray(query.kind)
      ? new Set(query.kind)
      : new Set([query.kind]);
    results = results.filter(face => kinds.has(face.kind));
  }

  if (query.normalDirection) {
    const dir = query.normalDirection;
    const len = Math.hypot(dir.x, dir.y, dir.z);
    if (len > 1e-8) {
      const nx = dir.x / len;
      const ny = dir.y / len;
      const nz = dir.z / len;
      const maxAngleDeg = query.maxAngleDeg ?? 35;
      const minCos = Math.cos((Math.max(0, Math.min(180, maxAngleDeg)) * Math.PI) / 180);
      results = results.filter(face => {
        const dot = face.normal.x * nx + face.normal.y * ny + face.normal.z * nz;
        return dot >= minCos - 1e-6;
      });
    }
  }

  if (query.minArea !== undefined && Number.isFinite(query.minArea)) {
    results = results.filter(face => face.area >= query.minArea!);
  }
  if (query.maxArea !== undefined && Number.isFinite(query.maxArea)) {
    results = results.filter(face => face.area <= query.maxArea!);
  }

  const sortBy = query.sortBy ?? 'ID';
  results.sort((a, b) => {
    switch (sortBy) {
      case 'MAX_Y':
      case 'Y_DESC':
        return b.center.y - a.center.y || a.faceId - b.faceId;
      case 'MIN_Y':
      case 'Y_ASC':
        return a.center.y - b.center.y || a.faceId - b.faceId;
      case 'MAX_X':
      case 'X_DESC':
        return b.center.x - a.center.x || a.faceId - b.faceId;
      case 'MIN_X':
      case 'X_ASC':
        return a.center.x - b.center.x || a.faceId - b.faceId;
      case 'MAX_Z':
      case 'Z_DESC':
        return b.center.z - a.center.z || a.faceId - b.faceId;
      case 'MIN_Z':
      case 'Z_ASC':
        return a.center.z - b.center.z || a.faceId - b.faceId;
      case 'AREA_DESC':
      case 'MAX_AREA':
        return b.area - a.area || a.faceId - b.faceId;
      case 'AREA_ASC':
      case 'MIN_AREA':
        return a.area - b.area || a.faceId - b.faceId;
      case 'ID':
      default:
        return a.faceId - b.faceId;
    }
  });

  if (query.limit !== undefined && Number.isFinite(query.limit) && query.limit >= 0) {
    results = results.slice(0, Math.floor(query.limit));
  }
  return results;
}

export function queryStaticMeshEdges(
  asset: StaticMeshAsset,
  query: StaticMeshEdgeQuery = {},
  precomputedReport?: StaticMeshInspectionReport,
): StaticMeshInspectedEdge[] {
  const report = precomputedReport ?? inspectStaticMesh(asset);
  let results = [...report.edges];

  if (query.edgeIds && query.edgeIds.length > 0) {
    const allowed = new Set(query.edgeIds);
    results = results.filter(edge => allowed.has(edge.edgeId));
  }

  let allowedFaceIds: Set<number> | null = null;
  if (query.faceId !== undefined && Number.isInteger(query.faceId)) {
    allowedFaceIds = new Set([query.faceId]);
  }
  if (query.faceIds && query.faceIds.length > 0) {
    allowedFaceIds = allowedFaceIds
      ? new Set([...allowedFaceIds, ...query.faceIds])
      : new Set(query.faceIds);
  }
  if (query.faceQuery) {
    const matchedFaces = queryStaticMeshFaces(asset, query.faceQuery, report);
    const matchedIds = new Set(matchedFaces.map(face => face.faceId));
    allowedFaceIds = allowedFaceIds
      ? new Set(Array.from(allowedFaceIds).filter(id => matchedIds.has(id)))
      : matchedIds;
  }
  if (allowedFaceIds !== null) {
    results = results.filter(edge => edge.incidentFaceIds.some(faceId => allowedFaceIds!.has(faceId)));
  }

  if (query.onlyManifold || query.manifoldOnly) {
    results = results.filter(edge => edge.isManifold);
  }
  if (query.onlyBoundary || query.boundaryOnly) {
    results = results.filter(edge => edge.isBoundary);
  }
  if (query.minLength !== undefined && Number.isFinite(query.minLength)) {
    results = results.filter(edge => edge.length >= query.minLength!);
  }
  if (query.maxLength !== undefined && Number.isFinite(query.maxLength)) {
    results = results.filter(edge => edge.length <= query.maxLength!);
  }

  const sortBy = query.sortBy ?? 'ID';
  results.sort((a, b) => {
    switch (sortBy) {
      case 'MAX_Y':
      case 'Y_DESC':
        return b.midpoint.y - a.midpoint.y || a.edgeId.localeCompare(b.edgeId);
      case 'MIN_Y':
      case 'Y_ASC':
        return a.midpoint.y - b.midpoint.y || a.edgeId.localeCompare(b.edgeId);
      case 'MAX_X':
      case 'X_DESC':
        return b.midpoint.x - a.midpoint.x || a.edgeId.localeCompare(b.edgeId);
      case 'MIN_X':
      case 'X_ASC':
        return a.midpoint.x - b.midpoint.x || a.edgeId.localeCompare(b.edgeId);
      case 'MAX_Z':
      case 'Z_DESC':
        return b.midpoint.z - a.midpoint.z || a.edgeId.localeCompare(b.edgeId);
      case 'MIN_Z':
      case 'Z_ASC':
        return a.midpoint.z - b.midpoint.z || a.edgeId.localeCompare(b.edgeId);
      case 'LENGTH_DESC': return b.length - a.length || a.edgeId.localeCompare(b.edgeId);
      case 'LENGTH_ASC': return a.length - b.length || a.edgeId.localeCompare(b.edgeId);
      case 'ID':
      default:
        return a.edgeId.localeCompare(b.edgeId);
    }
  });

  if (query.limit !== undefined && Number.isFinite(query.limit) && query.limit >= 0) {
    results = results.slice(0, Math.floor(query.limit));
  }
  return results;
}
