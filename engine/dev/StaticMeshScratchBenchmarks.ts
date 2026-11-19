import { assetHistory } from '@/engine/AssetHistory';
import { assetManager } from '@/engine/AssetManager';
import {
  staticMeshAssetAPI,
  type StaticMeshInspectionReport,
} from '@/engine/api/StaticMeshAssetAPI';
import { getMeshConnectivity } from '@/engine/mesh-editing/MeshConnectivity';
import { MeshTopologyUtils } from '@/engine/MeshTopologyUtils';
import type { StaticMeshAsset } from '@/types';

export interface StaticMeshIntegrityReport {
  valid: boolean;
  issues: string[];
  vertexCount: number;
  faceCount: number;
  triangleCount: number;
  shellCount: number;
  boundaryEdgeCount: number;
  nonManifoldEdgeCount: number;
  degenerateTriangleCount: number;
  hasConstructionMetadata: boolean;
  raycastHitCount: number;
}

export interface StaticMeshIntegrityOptions {
  requireClosedManifold?: boolean;
  allowDegenerateTriangles?: boolean;
  minFaces?: number;
  minShells?: number;
}

export interface ScratchBenchmarkCaseResult {
  id: string;
  tier: 'SIMPLE' | 'MEDIUM' | 'COMPLEX' | 'STRESS';
  name: string;
  assetId: string;
  durationMs: number;
  passed: boolean;
  integrity: StaticMeshIntegrityReport;
  inspection: StaticMeshInspectionReport;
  notes: string[];
}

export interface ScratchStabilitySuiteReport {
  passed: boolean;
  totalDurationMs: number;
  cases: ScratchBenchmarkCaseResult[];
  rollbackVerified: boolean;
  undoRedoVerified: boolean;
  adversarialGuardsVerified: boolean;
  errors: string[];
}

const SHOWCASE_PATH = '/Content/Meshes';
const SHOWCASE_PREFIX = 'Scratch_';

function triangleArea(
  vertices: Float32Array,
  i0: number,
  i1: number,
  i2: number,
): number {
  const ax = vertices[i0 * 3];
  const ay = vertices[i0 * 3 + 1];
  const az = vertices[i0 * 3 + 2];
  const bx = vertices[i1 * 3];
  const by = vertices[i1 * 3 + 1];
  const bz = vertices[i1 * 3 + 2];
  const cx = vertices[i2 * 3];
  const cy = vertices[i2 * 3 + 1];
  const cz = vertices[i2 * 3 + 2];
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const crossX = aby * acz - abz * acy;
  const crossY = abz * acx - abx * acz;
  const crossZ = abx * acy - aby * acx;
  return 0.5 * Math.hypot(crossX, crossY, crossZ);
}

/**
 * Runs a strict geometric, topological, and raycast integrity audit on any
 * StaticMeshAsset. Designed to catch subtle modeling-kernel corruptions early.
 */
export function validateStaticMeshIntegrity(
  asset: StaticMeshAsset,
  options: StaticMeshIntegrityOptions = {},
): StaticMeshIntegrityReport {
  const issues: string[] = [];
  const vertices = asset.geometry.vertices;
  const normals = asset.geometry.normals;
  const uvs = asset.geometry.uvs;
  const indices = asset.geometry.indices;

  const vertexCount = Math.floor(vertices.length / 3);
  const triangleCount = Math.floor(indices.length / 3);
  const faces = asset.topology?.faces ?? [];
  const faceCount = faces.length;
  const shellCount = asset.shells?.length ?? 0;
  const hasConstructionMetadata = asset.construction !== undefined;

  if (hasConstructionMetadata) {
    issues.push('Unexpected asset.construction metadata remained on a normal LogicalMesh.');
  }
  if (vertices.length % 3 !== 0) {
    issues.push(`Vertex buffer length (${vertices.length}) is not a multiple of 3.`);
  }
  if (indices.length % 3 !== 0) {
    issues.push(`Index buffer length (${indices.length}) is not a multiple of 3.`);
  }
  if (normals.length !== vertices.length) {
    issues.push(`Normal buffer length (${normals.length}) != vertex buffer length (${vertices.length}).`);
  }
  if (uvs.length !== vertexCount * 2) {
    issues.push(`UV buffer length (${uvs.length}) != vertexCount*2 (${vertexCount * 2}).`);
  }

  for (let i = 0; i < vertices.length; i += 1) {
    if (!Number.isFinite(vertices[i])) {
      issues.push(`Non-finite vertex coordinate at float index ${i}.`);
      break;
    }
  }
  for (let i = 0; i < normals.length; i += 1) {
    if (!Number.isFinite(normals[i])) {
      issues.push(`Non-finite normal component at float index ${i}.`);
      break;
    }
  }
  for (let i = 0; i < uvs.length; i += 1) {
    if (!Number.isFinite(uvs[i])) {
      issues.push(`Non-finite UV coordinate at float index ${i}.`);
      break;
    }
  }

  if (vertexCount > 0 && asset.geometry.aabb) {
    const { min, max } = asset.geometry.aabb;
    const vals = [min.x, min.y, min.z, max.x, max.y, max.z];
    if (vals.some(v => !Number.isFinite(v))) {
      issues.push('AABB contains non-finite bounds.');
    } else if (min.x > max.x + 1e-6 || min.y > max.y + 1e-6 || min.z > max.z + 1e-6) {
      issues.push('AABB min exceeds max.');
    }
  }

  let degenerateTriangleCount = 0;
  for (let t = 0; t < triangleCount; t += 1) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];
    if (
      i0 < 0 || i0 >= vertexCount ||
      i1 < 0 || i1 >= vertexCount ||
      i2 < 0 || i2 >= vertexCount
    ) {
      issues.push(`Triangle ${t} has out-of-range vertex index (${i0}, ${i1}, ${i2}) for vertexCount=${vertexCount}.`);
      break;
    }
    if (i0 === i1 || i1 === i2 || i2 === i0) {
      degenerateTriangleCount += 1;
    } else if (triangleArea(vertices, i0, i1, i2) <= 1e-10) {
      degenerateTriangleCount += 1;
    }
  }

  if (!options.allowDegenerateTriangles && degenerateTriangleCount > 0) {
    issues.push(`Found ${degenerateTriangleCount} degenerate (zero-area) triangles.`);
  }

  if (options.minFaces !== undefined && faceCount < options.minFaces) {
    issues.push(`Expected at least ${options.minFaces} faces, got ${faceCount}.`);
  }
  if (options.minShells !== undefined && shellCount < options.minShells) {
    issues.push(`Expected at least ${options.minShells} shells, got ${shellCount}.`);
  }

  // Validate logical faces & triangleToFaceIndex mapping
  const faceTriCounts = new Int32Array(faceCount);
  for (let f = 0; f < faceCount; f += 1) {
    const face = faces[f];
    if (!Array.isArray(face) || face.length < 3) {
      issues.push(`Logical face ${f} has fewer than 3 vertices.`);
      break;
    }
    const seen = new Set<number>();
    for (const vId of face) {
      if (!Number.isInteger(vId) || vId < 0 || vId >= vertexCount) {
        issues.push(`Logical face ${f} references invalid vertex ${vId}.`);
        break;
      }
      seen.add(vId);
    }
    if (seen.size !== face.length) {
      issues.push(`Logical face ${f} contains duplicate vertex IDs.`);
      break;
    }
  }

  const triToFace = asset.topology?.triangleToFaceIndex;
  if (!triToFace || triToFace.length !== triangleCount) {
    issues.push(`triangleToFaceIndex length (${triToFace?.length ?? 0}) != triangleCount (${triangleCount}).`);
  } else {
    for (let t = 0; t < triangleCount; t += 1) {
      const fId = triToFace[t];
      if (fId < 0 || fId >= faceCount) {
        issues.push(`triangleToFaceIndex[${t}] = ${fId} is outside [0, ${faceCount - 1}].`);
        break;
      }
      faceTriCounts[fId] += 1;
    }
    for (let f = 0; f < faceCount; f += 1) {
      if (faceTriCounts[f] === 0) {
        issues.push(`Logical face ${f} has 0 triangles mapped to it.`);
        break;
      }
    }
  }

  // Connectivity & manifold audit
  let boundaryEdgeCount = 0;
  let nonManifoldEdgeCount = 0;
  try {
    const connectivity = getMeshConnectivity(asset.topology, vertexCount);
    const inspection = staticMeshAssetAPI.inspectMesh(asset.id);
    boundaryEdgeCount = inspection.openEdgeCount;
    nonManifoldEdgeCount = inspection.nonManifoldEdgeCount;
    if (connectivity.faceCanonicalVertices.length !== faceCount) {
      issues.push(`Connectivity faceCount (${connectivity.faceCanonicalVertices.length}) != topology faceCount (${faceCount}).`);
    }
    if (options.requireClosedManifold) {
      if (boundaryEdgeCount !== 0) {
        issues.push(`Expected closed manifold mesh, but found ${boundaryEdgeCount} boundary edges.`);
      }
      if (nonManifoldEdgeCount !== 0) {
        issues.push(`Expected manifold mesh, but found ${nonManifoldEdgeCount} non-manifold edges.`);
      }
    }
  } catch (err) {
    issues.push(`Connectivity/inspection failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Verify topology graph rebuild and BVH raycast never crash
  let raycastHitCount = 0;
  try {
    MeshTopologyUtils.buildTopology(asset.topology, vertexCount);
    if (triangleCount > 0 && asset.geometry.aabb) {
      const cx = (asset.geometry.aabb.min.x + asset.geometry.aabb.max.x) * 0.5;
      const cy = asset.geometry.aabb.max.y + 10;
      const cz = (asset.geometry.aabb.min.z + asset.geometry.aabb.max.z) * 0.5;
      const hit = MeshTopologyUtils.raycastMesh(
        asset.topology,
        asset.geometry.vertices,
        { origin: { x: cx, y: cy, z: cz }, direction: { x: 0, y: -1, z: 0 } },
      );
      if (hit) raycastHitCount = 1;
    }
  } catch (err) {
    issues.push(`Topology/BVH raycast threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    valid: issues.length === 0,
    issues,
    vertexCount,
    faceCount,
    triangleCount,
    shellCount,
    boundaryEdgeCount,
    nonManifoldEdgeCount,
    degenerateTriangleCount,
    hasConstructionMetadata,
    raycastHitCount,
  };
}

export function clearScratchShowcaseMeshes(): number {
  const ids = assetManager
    .getAllAssets()
    .filter(a => a.type === 'MESH' && a.name.startsWith(SHOWCASE_PREFIX))
    .map(a => a.id);
  for (const id of ids) {
    assetHistory.clear(id);
    assetManager.deleteAsset(id);
  }
  return ids.length;
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Tier 1 (Simple): Raw hand-authored closed manifold prism using addVertices +
 * createFace, then splitEdge + cutFace + moveVertices to create a peaked roof.
 */
export function buildScratchSimplePrism(path = SHOWCASE_PATH): ScratchBenchmarkCaseResult {
  const start = nowMs();
  const notes: string[] = [];
  const asset = staticMeshAssetAPI.create({ name: 'Scratch_01_HandAuthoredPrism', path });

  const verts = staticMeshAssetAPI.addVertices({
    assetId: asset.id,
    positions: [
      // Bottom ring (y = 0)
      { x: -1.5, y: 0, z: -1 }, // 0
      { x: 1.5, y: 0, z: -1 },  // 1
      { x: 1.5, y: 0, z: 1 },   // 2
      { x: -1.5, y: 0, z: 1 },  // 3
      // Eave ring (y = 1.4)
      { x: -1.5, y: 1.4, z: -1 }, // 4
      { x: 1.5, y: 1.4, z: -1 },  // 5
      { x: 1.5, y: 1.4, z: 1 },   // 6
      { x: -1.5, y: 1.4, z: 1 },  // 7
    ],
  });
  // Create all 6 faces with outward CCW winding
  staticMeshAssetAPI.createFace({ assetId: asset.id, vertexIds: [verts[0], verts[1], verts[2], verts[3]] }); // bottom (-Y)
  staticMeshAssetAPI.createFace({ assetId: asset.id, vertexIds: [verts[4], verts[7], verts[6], verts[5]] }); // top (+Y)
  staticMeshAssetAPI.createFace({ assetId: asset.id, vertexIds: [verts[3], verts[2], verts[6], verts[7]] }); // front (+Z)
  staticMeshAssetAPI.createFace({ assetId: asset.id, vertexIds: [verts[1], verts[0], verts[4], verts[5]] }); // back (-Z)
  staticMeshAssetAPI.createFace({ assetId: asset.id, vertexIds: [verts[0], verts[3], verts[7], verts[4]] }); // left (-X)
  staticMeshAssetAPI.createFace({ assetId: asset.id, vertexIds: [verts[2], verts[1], verts[5], verts[6]] }); // right (+X)

  // Split the left and right top edges to form a center roof ridge, cut the top face, and raise the ridge!
  const splitLeft = staticMeshAssetAPI.splitEdge({ assetId: asset.id, vertexAId: verts[4], vertexBId: verts[7], t: 0.5 });
  const splitRight = staticMeshAssetAPI.splitEdge({ assetId: asset.id, vertexAId: verts[5], vertexBId: verts[6], t: 0.5 });
  const topFaces = staticMeshAssetAPI.findFaces({ assetId: asset.id, directionTag: 'TOP' });
  if (topFaces.length !== 1) {
    throw new Error(`Expected 1 TOP face on prism, found ${topFaces.length}`);
  }
  staticMeshAssetAPI.cutFace({
    assetId: asset.id,
    faceId: topFaces[0].faceId,
    vertexAId: splitLeft.vertexId,
    vertexBId: splitRight.vertexId,
  });
  staticMeshAssetAPI.moveVertices({
    assetId: asset.id,
    vertices: [
      { vertexId: splitLeft.vertexId, position: { x: -1.5, y: 2.35, z: 0 } },
      { vertexId: splitRight.vertexId, position: { x: 1.5, y: 2.35, z: 0 } },
    ],
  });
  notes.push('Raw addVertices + 6 createFace + 2 splitEdge + cutFace + moveVertices gable ridge');

  const updated = assetManager.getAsset(asset.id) as StaticMeshAsset;
  const integrity = validateStaticMeshIntegrity(updated, { requireClosedManifold: true, minFaces: 7 });
  const inspection = staticMeshAssetAPI.inspectMesh(asset.id);
  return {
    id: 'simple-prism',
    tier: 'SIMPLE',
    name: updated.name,
    assetId: asset.id,
    durationMs: nowMs() - start,
    passed: integrity.valid,
    integrity,
    inspection,
    notes,
  };
}

/**
 * Tier 1 (Simple): Verifies all built-in scratch primitives (BOX, PYRAMID, CYLINDER, GRID).
 */
export function buildScratchPrimitiveGallery(path = SHOWCASE_PATH): ScratchBenchmarkCaseResult {
  const start = nowMs();
  const notes: string[] = [];
  const asset = staticMeshAssetAPI.create({ name: 'Scratch_02_PrimitiveGallery', path });

  staticMeshAssetAPI.addPrimitive({ assetId: asset.id, kind: 'BOX', size: { x: 1.6, y: 1.6, z: 1.6 }, center: { x: -3.2, y: 0.8, z: 0 } });
  staticMeshAssetAPI.addPrimitive({ assetId: asset.id, kind: 'PYRAMID', size: { x: 1.6, y: 1.8, z: 1.6 }, center: { x: -1.1, y: 0.9, z: 0 } });
  staticMeshAssetAPI.addPrimitive({ assetId: asset.id, kind: 'CYLINDER', size: { x: 1.5, y: 1.8, z: 1.5 }, radialSegments: 16, center: { x: 1.1, y: 0.9, z: 0 } });
  staticMeshAssetAPI.addPrimitive({ assetId: asset.id, kind: 'GRID', size: { x: 1.8, y: 0, z: 1.8 }, segmentsX: 4, segmentsZ: 4, center: { x: 3.3, y: 0.05, z: 0 } });
  notes.push('Assembled 4 independent shells: BOX + PYRAMID + 16-seg CYLINDER + 4x4 GRID');

  const updated = assetManager.getAsset(asset.id) as StaticMeshAsset;
  const integrity = validateStaticMeshIntegrity(updated, {
    requireClosedManifold: false, // GRID is open
    minFaces: 6 + 5 + 18 + 16,
    minShells: 4,
  });
  const inspection = staticMeshAssetAPI.inspectMesh(asset.id);
  return {
    id: 'simple-primitives',
    tier: 'SIMPLE',
    name: updated.name,
    assetId: asset.id,
    durationMs: nowMs() - start,
    passed: integrity.valid && inspection.nonManifoldEdgeCount === 0,
    integrity,
    inspection,
    notes,
  };
}

/**
 * Tier 2 (Medium): Industrial Crate with 6-sided recessed inset panels and
 * multi-segment beveled outer silhouette edges.
 */
export function buildScratchIndustrialCrate(path = SHOWCASE_PATH): ScratchBenchmarkCaseResult {
  const start = nowMs();
  const notes: string[] = [];
  const asset = staticMeshAssetAPI.create({ name: 'Scratch_03_IndustrialCrate', path });

  staticMeshAssetAPI.runModelingSteps({
    assetId: asset.id,
    label: 'Build Industrial Crate',
    steps: [
      { op: 'ADD_PRIMITIVE', kind: 'BOX', size: { x: 2.2, y: 2.2, z: 2.2 }, center: { x: 0, y: 1.1, z: 0 } },
      // Bevel all 12 outer box edges with 2 segments for smooth chamfered frame
      { op: 'BEVEL_EDGES', edgeQuery: { manifoldOnly: true }, width: 0.16, segments: 2, profile: 0.5 },
      // Select the 6 large cardinal faces (area > 2.5) and inset + recess them
      { op: 'INSET_FACES', faceQuery: { minArea: 2.5 }, ratio: 0.16 },
      { op: 'EXTRUDE_FACES', faceQuery: { minArea: 1.8 }, distance: -0.14 },
    ],
  });
  notes.push('BOX -> 12-edge 2-segment bevel -> 6-face semantic inset -> 6-face inward recess extrude');

  const updated = assetManager.getAsset(asset.id) as StaticMeshAsset;
  const integrity = validateStaticMeshIntegrity(updated, { requireClosedManifold: true, minFaces: 60 });
  const inspection = staticMeshAssetAPI.inspectMesh(asset.id);
  return {
    id: 'medium-crate',
    tier: 'MEDIUM',
    name: updated.name,
    assetId: asset.id,
    durationMs: nowMs() - start,
    passed: integrity.valid,
    integrity,
    inspection,
    notes,
  };
}

/**
 * Tier 2 (Medium): Stepped Architectural Pedestal with tapered plinth, shaft,
 * flared capital, and recessed top basin built purely via semantic queries.
 */
export function buildScratchSteppedPedestal(path = SHOWCASE_PATH): ScratchBenchmarkCaseResult {
  const start = nowMs();
  const notes: string[] = [];
  const asset = staticMeshAssetAPI.create({ name: 'Scratch_04_SteppedPedestal', path });

  staticMeshAssetAPI.runModelingSteps({
    assetId: asset.id,
    label: 'Build Stepped Pedestal',
    steps: [
      { op: 'ADD_PRIMITIVE', kind: 'BOX', size: { x: 2.6, y: 0.4, z: 2.6 }, center: { x: 0, y: 0.2, z: 0 } },
      { op: 'INSET_FACES', faceQuery: { directionTag: 'TOP', limit: 1 }, ratio: 0.15 },
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'AREA_DESC', limit: 1 }, distance: 0.35 },
      { op: 'TRANSFORM_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, scale: 0.78 },
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, distance: 1.5 },
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, distance: 0.25 },
      { op: 'TRANSFORM_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, scale: 1.24 },
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, distance: 0.28 },
      { op: 'INSET_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, ratio: 0.22 },
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, distance: -0.18 },
    ],
  });
  notes.push('10-step declarative semantic pipeline: plinth -> tapered collar -> shaft -> flared capital -> recessed basin');

  const updated = assetManager.getAsset(asset.id) as StaticMeshAsset;
  const integrity = validateStaticMeshIntegrity(updated, { requireClosedManifold: true, minFaces: 30 });
  const inspection = staticMeshAssetAPI.inspectMesh(asset.id);
  return {
    id: 'medium-pedestal',
    tier: 'MEDIUM',
    name: updated.name,
    assetId: asset.id,
    durationMs: nowMs() - start,
    passed: integrity.valid,
    integrity,
    inspection,
    notes,
  };
}

/**
 * Tier 3 (Complex): Watchtower combining stepped chamfered base, shaft with
 * recessed window alcoves on all 4 cardinal walls, flared battlement crown,
 * cylinder lantern cupola, and pyramid spire roof.
 */
export function buildScratchWatchtower(path = SHOWCASE_PATH): ScratchBenchmarkCaseResult {
  const start = nowMs();
  const notes: string[] = [];
  const asset = staticMeshAssetAPI.create({ name: 'Scratch_05_Watchtower', path });

  staticMeshAssetAPI.runModelingSteps({
    assetId: asset.id,
    label: 'Build Complex Watchtower',
    steps: [
      // 1. Stone foundation plinth
      { op: 'ADD_PRIMITIVE', kind: 'BOX', size: { x: 3.2, y: 0.6, z: 3.2 }, center: { x: 0, y: 0.3, z: 0 } },
      { op: 'INSET_FACES', faceQuery: { directionTag: 'TOP', limit: 1 }, ratio: 0.14 },
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'AREA_DESC', limit: 1 }, distance: 0.45 },
      { op: 'TRANSFORM_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, scale: 0.82 },
      // 2. Main tower shaft
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, distance: 3.2 },
      // 3. Recessed window alcoves on all 4 main shaft walls (largest side faces, area > 5.0)
      { op: 'INSET_FACES', faceQuery: { minArea: 5.0 }, ratio: 0.28 },
      { op: 'EXTRUDE_FACES', faceQuery: { minArea: 2.2, maxArea: 4.5 }, distance: -0.25 },
      // 4. Flared overhanging battlement deck
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, distance: 0.35 },
      { op: 'TRANSFORM_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, scale: 1.22 },
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, distance: 0.55 },
      // 5. Recessed parapet walkway
      { op: 'INSET_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, ratio: 0.2 },
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, distance: -0.32 },
      // 6. Multi-shell lantern cupola + pyramid spire roof
      { op: 'ADD_PRIMITIVE', kind: 'CYLINDER', size: { x: 1.35, y: 1.1, z: 1.35 }, radialSegments: 12, center: { x: 0, y: 5.35, z: 0 } },
      { op: 'ADD_PRIMITIVE', kind: 'PYRAMID', size: { x: 1.9, y: 1.65, z: 1.9 }, center: { x: 0, y: 6.72, z: 0 } },
    ],
  });

  // Also test beveling the top-most spire edges or cupola rim isn't needed; let's verify closed manifold across all 3 shells!
  notes.push('14-step Watchtower: plinth -> tapered collar -> shaft -> 4 recessed windows -> flared parapet -> cylinder cupola + pyramid spire');

  const updated = assetManager.getAsset(asset.id) as StaticMeshAsset;
  const integrity = validateStaticMeshIntegrity(updated, {
    requireClosedManifold: true,
    minFaces: 60,
    minShells: 3,
  });
  const inspection = staticMeshAssetAPI.inspectMesh(asset.id);
  return {
    id: 'complex-watchtower',
    tier: 'COMPLEX',
    name: updated.name,
    assetId: asset.id,
    durationMs: nowMs() - start,
    passed: integrity.valid,
    integrity,
    inspection,
    notes,
  };
}

/**
 * Tier 3 (Complex): Sci-Fi Armored Turret built from scratch with beveled
 * hull, sloped front armor via transformFaces, rear recessed engine vent,
 * cylinder turntable, twin cannon barrels, and sensor pod.
 */
export function buildScratchSciFiTurret(path = SHOWCASE_PATH): ScratchBenchmarkCaseResult {
  const start = nowMs();
  const notes: string[] = [];
  const asset = staticMeshAssetAPI.create({ name: 'Scratch_06_SciFiTurret', path });

  staticMeshAssetAPI.runModelingSteps({
    assetId: asset.id,
    label: 'Build Sci-Fi Turret',
    steps: [
      // Armored main turret housing
      { op: 'ADD_PRIMITIVE', kind: 'BOX', size: { x: 2.2, y: 1.1, z: 2.8 }, center: { x: 0, y: 1.15, z: 0 } },
      // Slope the front armor face slightly down and narrower
      { op: 'TRANSFORM_FACES', faceQuery: { directionTag: 'FRONT', limit: 1 }, scale: { x: 0.72, y: 0.72, z: 1 }, translate: { x: 0, y: -0.08, z: 0.25 } },
      // Bevel all housing edges for clean hard-surface highlights
      { op: 'BEVEL_EDGES', edgeQuery: { manifoldOnly: true }, width: 0.12, segments: 2, profile: 0.55 },
      // Recessed rear exhaust vent
      { op: 'INSET_FACES', faceQuery: { directionTag: 'BACK', sortBy: 'AREA_DESC', limit: 1 }, ratio: 0.25 },
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'BACK', sortBy: 'AREA_DESC', limit: 1 }, distance: -0.18 },
      // Top hatch cupola
      { op: 'INSET_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'AREA_DESC', limit: 1 }, ratio: 0.3 },
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, distance: 0.26 },
      { op: 'TRANSFORM_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 }, scale: 0.82 },
      // Turntable cylinder base
      { op: 'ADD_PRIMITIVE', kind: 'CYLINDER', size: { x: 2.6, y: 0.6, z: 2.6 }, radialSegments: 20, center: { x: 0, y: 0.3, z: 0 } },
      // Twin cannon barrels (boxes extruded forward & scaled into slim barrels)
      { op: 'ADD_PRIMITIVE', kind: 'BOX', size: { x: 0.24, y: 0.24, z: 2.2 }, center: { x: -0.42, y: 1.12, z: 2.35 } },
      { op: 'ADD_PRIMITIVE', kind: 'BOX', size: { x: 0.24, y: 0.24, z: 2.2 }, center: { x: 0.42, y: 1.12, z: 2.35 } },
      // Muzzle brakes via extrude on barrel front tips
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'FRONT', sortBy: 'Z_DESC', limit: 2 }, distance: 0.28 },
      { op: 'TRANSFORM_FACES', faceQuery: { directionTag: 'FRONT', sortBy: 'Z_DESC', limit: 2 }, scale: 1.35, pivot: 'INDIVIDUAL_FACES' },
      { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'FRONT', sortBy: 'Z_DESC', limit: 2 }, distance: 0.22 },
      // Top sensor pyramid pod
      { op: 'ADD_PRIMITIVE', kind: 'PYRAMID', size: { x: 0.55, y: 0.45, z: 0.55 }, center: { x: 0.45, y: 2.15, z: -0.3 } },
    ],
  });
  notes.push('15-step multi-shell Turret: sloped beveled hull + rear vent + top hatch + 20-seg turntable + twin barrels with flared muzzle brakes + sensor pod');

  const updated = assetManager.getAsset(asset.id) as StaticMeshAsset;
  const integrity = validateStaticMeshIntegrity(updated, {
    requireClosedManifold: true,
    minFaces: 90,
    minShells: 5,
  });
  const inspection = staticMeshAssetAPI.inspectMesh(asset.id);
  return {
    id: 'complex-turret',
    tier: 'COMPLEX',
    name: updated.name,
    assetId: asset.id,
    durationMs: nowMs() - start,
    passed: integrity.valid,
    integrity,
    inspection,
    notes,
  };
}

/**
 * Tier 4 (Stress): Chained topology torture test exercising every core modeling
 * operation in sequence on the same evolving mesh:
 * BOX -> Bevel(all 12 edges, seg=2) -> Inset(TOP) -> Extrude(TOP) ->
 * Bevel(newly extruded top rim edges, seg=1) -> SplitEdge -> ConnectVertices ->
 * WeldVertices -> DeleteFaces(opening).
 */
export function buildScratchTopologyTorture(path = SHOWCASE_PATH): ScratchBenchmarkCaseResult {
  const start = nowMs();
  const notes: string[] = [];
  const asset = staticMeshAssetAPI.create({ name: 'Scratch_07_TopologyTorture', path });

  staticMeshAssetAPI.addPrimitive({ assetId: asset.id, kind: 'BOX', size: 2.0 });
  const initialEdges = staticMeshAssetAPI.findEdges({ assetId: asset.id, manifoldOnly: true });
  staticMeshAssetAPI.bevelEdges({
    assetId: asset.id,
    edges: initialEdges.map(e => ({ vertexAId: e.vertexAId, vertexBId: e.vertexBId })),
    width: 0.18,
    segments: 2,
    profile: 0.5,
  });
  notes.push(`Beveled all ${initialEdges.length} box edges (2 segments)`);

  const top1 = staticMeshAssetAPI.findFaces({ assetId: asset.id, directionTag: 'TOP', sortBy: 'AREA_DESC', limit: 1 })[0];
  const inset1 = staticMeshAssetAPI.insetFace({ assetId: asset.id, faceId: top1.faceId, ratio: 0.25 });
  const extrude1 = staticMeshAssetAPI.extrudeFace({ assetId: asset.id, faceId: inset1.innerFaceId, distance: 0.7 });
  notes.push('Inset + Extruded top face');

  // Bevel the 4 edges surrounding the newly extruded top face
  const topRimEdges = staticMeshAssetAPI.findEdges({ assetId: asset.id, faceId: extrude1.topFaceId, manifoldOnly: true });
  staticMeshAssetAPI.bevelEdges({
    assetId: asset.id,
    edges: topRimEdges.map(e => ({ vertexAId: e.vertexAId, vertexBId: e.vertexBId })),
    width: 0.1,
    segments: 1,
  });
  notes.push(`Chained second bevel on ${topRimEdges.length} extruded rim edges`);

  // Find the highest top face, split two opposite edges, connect them via connectVertices
  const top2 = staticMeshAssetAPI.findFaces({ assetId: asset.id, directionTag: 'TOP', sortBy: 'Y_DESC', limit: 1 })[0];
  const topVerts = top2.vertexIds;
  const splitA = staticMeshAssetAPI.splitEdge({
    assetId: asset.id,
    vertexAId: topVerts[0],
    vertexBId: topVerts[1],
    t: 0.5,
  });
  const splitB = staticMeshAssetAPI.splitEdge({
    assetId: asset.id,
    vertexAId: topVerts[2],
    vertexBId: topVerts[3],
    t: 0.5,
  });
  const connected = staticMeshAssetAPI.connectVertices({
    assetId: asset.id,
    vertexIds: [splitA.vertexId, splitB.vertexId],
  });
  notes.push(`Split 2 opposite top edges and connected them (new faces: ${connected.newFaceIds.join(', ')})`);

  // Weld the two newly split midpoint vertices together (collapses the cut edge cleanly)
  const welded = staticMeshAssetAPI.weldVertices({
    assetId: asset.id,
    vertexIds: [splitA.vertexId, splitB.vertexId],
    mode: 'CENTER',
  });
  notes.push(`Welded split midpoints into v${welded.survivingVertexId} (removed ${welded.removedDegenerateFaces} degenerate faces)`);

  // Delete the bottom-most face to verify open-boundary deletion & orphan vertex compaction
  const bottom = staticMeshAssetAPI.findFaces({ assetId: asset.id, directionTag: 'BOTTOM', sortBy: 'AREA_DESC', limit: 1 })[0];
  staticMeshAssetAPI.deleteFaces({
    assetId: asset.id,
    faceIds: [bottom.faceId],
    compactUnusedVertices: true,
  });
  notes.push('Deleted bottom face with compactUnusedVertices=true');

  const updated = assetManager.getAsset(asset.id) as StaticMeshAsset;
  const integrity = validateStaticMeshIntegrity(updated, {
    requireClosedManifold: false, // bottom face was intentionally deleted
    minFaces: 50,
  });
  const inspection = staticMeshAssetAPI.inspectMesh(asset.id);
  return {
    id: 'stress-topology-torture',
    tier: 'STRESS',
    name: updated.name,
    assetId: asset.id,
    durationMs: nowMs() - start,
    passed: integrity.valid && inspection.nonManifoldEdgeCount === 0,
    integrity,
    inspection,
    notes,
  };
}

/**
 * Tier 4 (Stress & Performance): 12x12 Grid (144 quads) -> batch checkerboard
 * inset (72 faces) -> batch extrude (72 faces) -> per-face taper transform.
 */
export function buildScratchHighDensityGrid(path = SHOWCASE_PATH): ScratchBenchmarkCaseResult {
  const start = nowMs();
  const notes: string[] = [];
  const asset = staticMeshAssetAPI.create({ name: 'Scratch_08_HighDensityGrid', path });

  const prim = staticMeshAssetAPI.addPrimitive({
    assetId: asset.id,
    kind: 'GRID',
    size: { x: 6, y: 0, z: 6 },
    segmentsX: 12,
    segmentsZ: 12,
  });

  // Checkerboard select 72 of the 144 quads
  const checkerFaceIds = prim.faceIds.filter((faceId) => {
    const row = Math.floor(faceId / 12);
    const col = faceId % 12;
    return (row + col) % 2 === 0;
  });

  const insetRes = staticMeshAssetAPI.insetFaces({
    assetId: asset.id,
    faceIds: checkerFaceIds,
    ratio: 0.2,
  });
  const extrudeRes = staticMeshAssetAPI.extrudeFaces({
    assetId: asset.id,
    faceIds: insetRes.innerFaceIds,
    distance: 0.35,
  });
  staticMeshAssetAPI.transformFaces({
    assetId: asset.id,
    faceIds: extrudeRes.topFaceIds,
    scale: 0.72,
    pivot: 'INDIVIDUAL_FACES',
  });

  const elapsed = nowMs() - start;
  notes.push(`12x12 grid -> 72-face batch inset -> 72-face batch extrude -> 72-face individual taper in ${elapsed.toFixed(1)}ms`);

  const updated = assetManager.getAsset(asset.id) as StaticMeshAsset;
  const integrity = validateStaticMeshIntegrity(updated, {
    requireClosedManifold: false,
    minFaces: 144 + 72 * 8, // 720 faces
  });
  const inspection = staticMeshAssetAPI.inspectMesh(asset.id);
  return {
    id: 'stress-high-density-grid',
    tier: 'STRESS',
    name: updated.name,
    assetId: asset.id,
    durationMs: elapsed,
    passed: integrity.valid && inspection.nonManifoldEdgeCount === 0,
    integrity,
    inspection,
    notes,
  };
}

/**
 * Tier 3+ (Complex Topology): Genus-1 hollow architectural window frame built
 * from scratch: BOX -> inset FRONT & BACK -> delete inner panes -> bridge the
 * 4 interior tunnel walls via createFace -> bevel outer frame silhouette.
 */
export function buildScratchGenus1WindowFrame(path = SHOWCASE_PATH): ScratchBenchmarkCaseResult {
  const start = nowMs();
  const notes: string[] = [];
  const asset = staticMeshAssetAPI.create({ name: 'Scratch_09_Genus1WindowFrame', path });

  staticMeshAssetAPI.addPrimitive({
    assetId: asset.id,
    kind: 'BOX',
    size: { x: 2.6, y: 2.6, z: 0.7 },
    center: { x: 0, y: 1.3, z: 0 },
  });

  const front = staticMeshAssetAPI.findFaces({ assetId: asset.id, directionTag: 'FRONT', limit: 1 })[0];
  const back = staticMeshAssetAPI.findFaces({ assetId: asset.id, directionTag: 'BACK', limit: 1 })[0];
  const insetRes = staticMeshAssetAPI.insetFaces({
    assetId: asset.id,
    faceIds: [front.faceId, back.faceId],
    ratio: 0.3,
  });

  const frontInner = staticMeshAssetAPI.findFaces({ assetId: asset.id, faceIds: [insetRes.innerFaceIds[0]] })[0];
  const backInner = staticMeshAssetAPI.findFaces({ assetId: asset.id, faceIds: [insetRes.innerFaceIds[1]] })[0];
  const frontLoop = [...frontInner.vertexIds];
  const backLoop = [...backInner.vertexIds];

  // Match each front inner vertex to its closest back inner vertex (same X/Y, opposite Z)
  const currentBeforeDelete = assetManager.getAsset(asset.id) as StaticMeshAsset;
  const posOf = (vId: number) => ({
    x: currentBeforeDelete.geometry.vertices[vId * 3],
    y: currentBeforeDelete.geometry.vertices[vId * 3 + 1],
    z: currentBeforeDelete.geometry.vertices[vId * 3 + 2],
  });
  const pairedBack = frontLoop.map(fv => {
    const fp = posOf(fv);
    let best = backLoop[0];
    let bestDist = Infinity;
    for (const bv of backLoop) {
      const bp = posOf(bv);
      const d = Math.hypot(fp.x - bp.x, fp.y - bp.y);
      if (d < bestDist) {
        bestDist = d;
        best = bv;
      }
    }
    return best;
  });

  // Delete both inner panes without compacting vertices so tunnel boundary vertices stay valid
  staticMeshAssetAPI.deleteFaces({
    assetId: asset.id,
    faceIds: [frontInner.faceId, backInner.faceId],
    compactUnusedVertices: false,
  });

  // Bridge the 4 tunnel walls with consistent inward-facing tunnel winding
  for (let i = 0; i < frontLoop.length; i += 1) {
    const next = (i + 1) % frontLoop.length;
    staticMeshAssetAPI.createFace({
      assetId: asset.id,
      vertexIds: [frontLoop[i], pairedBack[i], pairedBack[next], frontLoop[next]],
    });
  }

  // Bevel the outer perimeter edges (length >= 2.0) to chamfer the window frame!
  const outerEdges = staticMeshAssetAPI.findEdges({
    assetId: asset.id,
    manifoldOnly: true,
    minLength: 2.0,
  });
  staticMeshAssetAPI.bevelEdges({
    assetId: asset.id,
    edges: outerEdges.map(e => ({ vertexAId: e.vertexAId, vertexBId: e.vertexBId })),
    width: 0.1,
    segments: 2,
  });
  notes.push(`Genus-1 watertight frame: inset front/back -> delete panes -> hand-bridge 4 tunnel walls -> 2-seg bevel on ${outerEdges.length} outer edges`);

  const updated = assetManager.getAsset(asset.id) as StaticMeshAsset;
  const integrity = validateStaticMeshIntegrity(updated, {
    requireClosedManifold: true,
    minFaces: 30,
  });
  const inspection = staticMeshAssetAPI.inspectMesh(asset.id);
  return {
    id: 'complex-genus1-frame',
    tier: 'COMPLEX',
    name: updated.name,
    assetId: asset.id,
    durationMs: nowMs() - start,
    passed: integrity.valid,
    integrity,
    inspection,
    notes,
  };
}

/**
 * Tier 4+ (Stress): Concave 6-gon L-bracket authored from scratch (ear-clipping
 * triangulation + extrusion + bottom cap + bevel) combined with a 16-sided
 * Cylinder whose full 16-gon top cap rim is beveled with 2 segments.
 */
export function buildScratchConcaveAndCylinderBevel(path = SHOWCASE_PATH): ScratchBenchmarkCaseResult {
  const start = nowMs();
  const notes: string[] = [];
  const asset = staticMeshAssetAPI.create({ name: 'Scratch_10_ConcaveAndCylinderBevel', path });

  // Shell 1: Concave L-shaped 6-gon authored directly from raw vertices
  const lVerts = staticMeshAssetAPI.addVertices({
    assetId: asset.id,
    positions: [
      { x: -2.4, y: 0, z: -1.0 }, // 0
      { x: -2.4, y: 0, z: 1.0 },  // 1
      { x: -0.4, y: 0, z: 1.0 },  // 2
      { x: -0.4, y: 0, z: 0.2 },  // 3
      { x: -1.5, y: 0, z: 0.2 },  // 4 (reflex concave corner!)
      { x: -1.5, y: 0, z: -1.0 }, // 5
    ],
  });
  const lTop = staticMeshAssetAPI.createFace({ assetId: asset.id, vertexIds: lVerts });
  staticMeshAssetAPI.extrudeFace({ assetId: asset.id, faceId: lTop.faceId, distance: 1.2 });
  // Close bottom of the concave L-bracket with reversed winding
  staticMeshAssetAPI.createFace({ assetId: asset.id, vertexIds: [...lVerts].reverse() });

  // Shell 2: 16-sided Cylinder with full 16-edge top cap rim bevel (segments=2)
  staticMeshAssetAPI.addPrimitive({
    assetId: asset.id,
    kind: 'CYLINDER',
    size: { x: 1.8, y: 1.8, z: 1.8 },
    radialSegments: 16,
    center: { x: 1.5, y: 0.9, z: 0 },
  });
  const cylTopCap = staticMeshAssetAPI.findFaces({
    assetId: asset.id,
    directionTag: 'TOP',
    sortBy: 'X_DESC',
    limit: 1,
  })[0];
  const cylTopRimEdges = staticMeshAssetAPI.findEdges({
    assetId: asset.id,
    faceId: cylTopCap.faceId,
    manifoldOnly: true,
  });
  staticMeshAssetAPI.bevelEdges({
    assetId: asset.id,
    edges: cylTopRimEdges.map(e => ({ vertexAId: e.vertexAId, vertexBId: e.vertexBId })),
    width: 0.14,
    segments: 2,
    profile: 0.5,
  });
  notes.push(`Concave 6-gon L-bracket extrusion + 16-gon Cylinder rim bevel (${cylTopRimEdges.length} edges, 2 segments)`);

  const updated = assetManager.getAsset(asset.id) as StaticMeshAsset;
  const integrity = validateStaticMeshIntegrity(updated, {
    requireClosedManifold: true,
    minFaces: 50,
    minShells: 2,
  });
  const inspection = staticMeshAssetAPI.inspectMesh(asset.id);
  return {
    id: 'stress-concave-and-cyl-bevel',
    tier: 'STRESS',
    name: updated.name,
    assetId: asset.id,
    durationMs: nowMs() - start,
    passed: integrity.valid,
    integrity,
    inspection,
    notes,
  };
}

/**
 * Verifies atomic transaction rollback on failure and multi-step Undo/Redo stability.
 */
export function verifyRollbackAndUndoRedo(): {
  rollbackVerified: boolean;
  undoRedoVerified: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  let rollbackVerified = false;
  let undoRedoVerified = false;

  const asset = staticMeshAssetAPI.create({ name: '__Scratch_RollbackAudit__', path: SHOWCASE_PATH });
  try {
    staticMeshAssetAPI.addPrimitive({ assetId: asset.id, kind: 'BOX', size: 2 });
    const before = assetManager.getAsset(asset.id) as StaticMeshAsset;
    const beforeVerts = before.geometry.vertices.length;
    const beforeFaces = before.topology.faces.length;
    const beforeIndices = before.geometry.indices.length;

    // 1. Atomic rollback test: step 1 & 2 mutate the mesh, step 3 fails intentionally
    let threw = false;
    try {
      staticMeshAssetAPI.runModelingSteps({
        assetId: asset.id,
        label: 'Intentional Failure Rollback Test',
        steps: [
          { op: 'INSET_FACES', faceQuery: { directionTag: 'TOP', limit: 1 }, ratio: 0.25 },
          { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', sortBy: 'AREA_DESC', limit: 1 }, distance: 1.0 },
          { op: 'EXTRUDE_FACES', faceQuery: { directionTag: 'TOP', minArea: 9999 }, distance: 1.0 }, // Must fail!
        ],
      });
    } catch {
      threw = true;
    }

    const afterFail = assetManager.getAsset(asset.id) as StaticMeshAsset;
    const integrityAfterFail = validateStaticMeshIntegrity(afterFail, { requireClosedManifold: true });
    if (
      threw &&
      integrityAfterFail.valid &&
      afterFail.geometry.vertices.length === beforeVerts &&
      afterFail.topology.faces.length === beforeFaces &&
      afterFail.geometry.indices.length === beforeIndices
    ) {
      rollbackVerified = true;
    } else {
      errors.push(
        `Rollback verification failed (threw=${threw}, verts=${afterFail.geometry.vertices.length}/${beforeVerts}, faces=${afterFail.topology.faces.length}/${beforeFaces})`,
      );
    }

    // 2. Multi-step Undo/Redo stability test
    assetHistory.clear(asset.id);
    const step0Faces = (assetManager.getAsset(asset.id) as StaticMeshAsset).topology.faces.length;

    const top = staticMeshAssetAPI.findFaces({ assetId: asset.id, directionTag: 'TOP', limit: 1 })[0];
    const inset = staticMeshAssetAPI.insetFace({ assetId: asset.id, faceId: top.faceId, ratio: 0.25 });
    const step1Faces = (assetManager.getAsset(asset.id) as StaticMeshAsset).topology.faces.length;

    staticMeshAssetAPI.extrudeFace({ assetId: asset.id, faceId: inset.innerFaceId, distance: 0.8 });
    const step2Faces = (assetManager.getAsset(asset.id) as StaticMeshAsset).topology.faces.length;

    assetHistory.undo(asset.id);
    const undo1Asset = assetManager.getAsset(asset.id) as StaticMeshAsset;
    const undo1Ok = undo1Asset.topology.faces.length === step1Faces && validateStaticMeshIntegrity(undo1Asset, { requireClosedManifold: true }).valid;

    assetHistory.undo(asset.id);
    const undo2Asset = assetManager.getAsset(asset.id) as StaticMeshAsset;
    const undo2Ok = undo2Asset.topology.faces.length === step0Faces && validateStaticMeshIntegrity(undo2Asset, { requireClosedManifold: true }).valid;

    assetHistory.redo(asset.id);
    assetHistory.redo(asset.id);
    const redoAsset = assetManager.getAsset(asset.id) as StaticMeshAsset;
    const redoOk = redoAsset.topology.faces.length === step2Faces && validateStaticMeshIntegrity(redoAsset, { requireClosedManifold: true }).valid;

    if (undo1Ok && undo2Ok && redoOk) {
      undoRedoVerified = true;
    } else {
      errors.push(`Undo/Redo verification failed (undo1Ok=${undo1Ok}, undo2Ok=${undo2Ok}, redoOk=${redoOk}).`);
    }
  } finally {
    assetHistory.clear(asset.id);
    assetManager.deleteAsset(asset.id);
  }

  return { rollbackVerified, undoRedoVerified, errors };
}

/**
 * Verifies that invalid/adversarial inputs are rejected cleanly without corrupting
 * the target mesh asset.
 */
export function verifyAdversarialInputGuards(): {
  verified: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const asset = staticMeshAssetAPI.create({ name: '__Scratch_AdversarialGuards__', path: SHOWCASE_PATH });
  try {
    staticMeshAssetAPI.addPrimitive({ assetId: asset.id, kind: 'BOX', size: 2 });
    const expectReject = (label: string, fn: () => void) => {
      let threw = false;
      try {
        fn();
      } catch {
        threw = true;
      }
      if (!threw) {
        errors.push(`Adversarial guard '${label}' did not reject invalid input.`);
      }
    };

    expectReject('NaN vertex position', () => {
      staticMeshAssetAPI.addVertices({ assetId: asset.id, positions: [{ x: Number.NaN, y: 0, z: 0 }] });
    });
    expectReject('Zero extrude distance', () => {
      staticMeshAssetAPI.extrudeFaces({ assetId: asset.id, faceIds: [0], distance: 0 });
    });
    expectReject('Out-of-range inset ratio', () => {
      staticMeshAssetAPI.insetFaces({ assetId: asset.id, faceIds: [0], ratio: 1.5 });
    });
    expectReject('Negative bevel width', () => {
      staticMeshAssetAPI.bevelEdges({ assetId: asset.id, edges: [{ vertexAId: 0, vertexBId: 1 }], width: -0.2 });
    });
    expectReject('Duplicate vertices in createFace', () => {
      staticMeshAssetAPI.createFace({ assetId: asset.id, vertexIds: [0, 1, 1] });
    });
    expectReject('Out-of-range vertex in createFace', () => {
      staticMeshAssetAPI.createFace({ assetId: asset.id, vertexIds: [0, 1, 9999] });
    });
    expectReject('planAppendMesh self-append', () => {
      staticMeshAssetAPI.planAppendMesh({ targetAssetId: asset.id, sourceAssetId: asset.id });
    });
    const selfAppend = staticMeshAssetAPI.appendMesh({ targetAssetId: asset.id, sourceAssetId: asset.id });
    if (selfAppend.verticesAdded !== 0 || selfAppend.trianglesAdded !== 0) {
      errors.push(`appendMesh self-append should be a safe no-op, got verticesAdded=${selfAppend.verticesAdded}`);
    }
    expectReject('Empty runModelingSteps', () => {
      staticMeshAssetAPI.runModelingSteps({ assetId: asset.id, steps: [] });
    });

    const after = assetManager.getAsset(asset.id) as StaticMeshAsset;
    const integrity = validateStaticMeshIntegrity(after, { requireClosedManifold: true });
    if (!integrity.valid || after.topology.faces.length !== 6) {
      errors.push(`Adversarial inputs corrupted target mesh: ${integrity.issues.join('; ')}`);
    }
  } finally {
    assetHistory.clear(asset.id);
    assetManager.deleteAsset(asset.id);
  }

  return { verified: errors.length === 0, errors };
}

/**
 * Runs the full progressive Simple -> Medium -> Complex -> Stress scratch modeling
 * stability suite. By default keeps the generated meshes in /Content/Meshes/ScratchShowcase
 * so they can be visually inspected in the Static Mesh Editor.
 */
export function runStaticMeshScratchStabilitySuite(options: {
  keepAssets?: boolean;
  path?: string;
} = {}): ScratchStabilitySuiteReport {
  const keepAssets = options.keepAssets ?? true;
  const path = options.path ?? SHOWCASE_PATH;
  const suiteStart = nowMs();

  clearScratchShowcaseMeshes();

  const builders = [
    buildScratchSimplePrism,
    buildScratchPrimitiveGallery,
    buildScratchIndustrialCrate,
    buildScratchSteppedPedestal,
    buildScratchWatchtower,
    buildScratchSciFiTurret,
    buildScratchTopologyTorture,
    buildScratchHighDensityGrid,
    buildScratchGenus1WindowFrame,
    buildScratchConcaveAndCylinderBevel,
  ];

  const cases: ScratchBenchmarkCaseResult[] = [];
  const errors: string[] = [];

  for (const builder of builders) {
    try {
      const result = builder(path);
      cases.push(result);
      if (!result.passed) {
        errors.push(`[${result.name}] Integrity failed: ${result.integrity.issues.join('; ')}`);
      }
      if (!keepAssets) {
        assetHistory.clear(result.assetId);
        assetManager.deleteAsset(result.assetId);
      } else {
        assetHistory.clear(result.assetId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`[${builder.name}] Threw exception: ${message}`);
    }
  }

  const audit = verifyRollbackAndUndoRedo();
  const guards = verifyAdversarialInputGuards();
  errors.push(...audit.errors, ...guards.errors);

  const passed =
    errors.length === 0 &&
    cases.length === builders.length &&
    cases.every(c => c.passed) &&
    audit.rollbackVerified &&
    audit.undoRedoVerified &&
    guards.verified;

  return {
    passed,
    totalDurationMs: nowMs() - suiteStart,
    cases,
    rollbackVerified: audit.rollbackVerified,
    undoRedoVerified: audit.undoRedoVerified,
    adversarialGuardsVerified: guards.verified,
    errors,
  };
}
