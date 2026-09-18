import { assetManager } from '@/engine/AssetManager';
import { assetHistory } from '@/engine/AssetHistory';
import { staticMeshAssetAPI } from '@/engine/api/StaticMeshAssetAPI';
import type { StaticMeshAsset } from '@/types';

export type StaticMeshTestFixtureKind = 'panel' | 'inset' | 'opening' | 'box' | 'normal' | 'split' | 'cut' | 'ring' | 'bevel' | 'bevel-valence' | 'extrude-normal' | 'inset-orient';

export interface StaticMeshTestFixtureResult {
  fixture: StaticMeshTestFixtureKind;
  assetId: string;
  asset: StaticMeshAsset;
  /** Numeric LogicalMesh face id suitable for the normal Static Mesh API/editor. */
  primaryFaceId?: number;
  /** Numeric mesh vertex ids defining the recommended Edge-mode test edge. */
  primaryEdgeVertexIds?: [number, number];
  /** Numeric mesh vertex ids defining the recommended Vertex-mode face cut. */
  primaryCutVertexIds?: [number, number];
  vertexIds: number[];
  faceIds: number[];
}

const TEST_ASSET_PREFIX = 'TEST_StaticMesh_';
const TEST_ASSET_PATH = '/Content/Meshes';
const PANEL_FACE_ID = 'face:panel';

const fixtureName = (fixture: StaticMeshTestFixtureKind) => (
  `${TEST_ASSET_PREFIX}${fixture[0].toUpperCase()}${fixture.slice(1)}`
);

/**
 * Removes only browser-console Static Mesh test fixtures. User-authored meshes
 * and the automated /Tests assets are intentionally untouched.
 */
export function clearStaticMeshTestFixtures(): number {
  const ids = assetManager.getAllAssets()
    .filter(asset => asset.type === 'MESH' && asset.name.startsWith(TEST_ASSET_PREFIX))
    .map(asset => asset.id);

  for (const id of ids) {
    assetHistory.clear(id);
    assetManager.deleteAsset(id);
  }
  return ids.length;
}

const semanticFaceToLogical = (asset: StaticMeshAsset, semanticFaceId?: string): number | undefined => {
  if (!semanticFaceId) return undefined;
  return asset.construction?.faces.find(face => face.id === semanticFaceId)?.faceId;
};

const semanticPointToVertex = (asset: StaticMeshAsset, pointId?: string): number | undefined => {
  if (!pointId) return undefined;
  return asset.construction?.points.find(point => point.id === pointId)?.vertexIds?.[0];
};

/**
 * Manual fixtures are deliberately NORMAL logical meshes. The helper may use
 * the legacy semantic builder internally because it is concise, but all
 * Construction metadata is stripped before the fixture is returned. This keeps
 * smTest(...) aligned with the human modeller: geometry + LogicalMesh are the
 * only editing source of truth.
 */
const finalizeNormalFixture = (
  fixture: StaticMeshTestFixtureKind,
  asset: StaticMeshAsset,
  semanticTargets: {
    primaryFaceId?: string;
    primaryEdgePointIds?: [string, string];
    primaryCutPointIds?: [string, string];
  } = {},
): StaticMeshTestFixtureResult => {
  const primaryFaceId = semanticFaceToLogical(asset, semanticTargets.primaryFaceId);
  const edgeA = semanticPointToVertex(asset, semanticTargets.primaryEdgePointIds?.[0]);
  const edgeB = semanticPointToVertex(asset, semanticTargets.primaryEdgePointIds?.[1]);
  const cutA = semanticPointToVertex(asset, semanticTargets.primaryCutPointIds?.[0]);
  const cutB = semanticPointToVertex(asset, semanticTargets.primaryCutPointIds?.[1]);

  // The normal Static Mesh editor must never depend on the fixture's semantic
  // scaffolding. Strip it before history is cleared so it is not undoable.
  assetManager.updateAsset(asset.id, { construction: undefined });
  assetHistory.clear(asset.id);

  return {
    fixture,
    assetId: asset.id,
    asset,
    primaryFaceId,
    primaryEdgeVertexIds: edgeA !== undefined && edgeB !== undefined ? [edgeA, edgeB] : undefined,
    primaryCutVertexIds: cutA !== undefined && cutB !== undefined ? [cutA, cutB] : undefined,
    vertexIds: Array.from({ length: Math.floor(asset.geometry.vertices.length / 3) }, (_, vertexId) => vertexId),
    faceIds: asset.topology.faces.map((_, faceId) => faceId),
  };
};

/**
 * Creates one deterministic NORMAL Static Mesh fixture for manual browser/editor
 * testing. Existing TEST_StaticMesh_* fixtures are removed first so repeated
 * calls never accumulate stale runtime data.
 *
 * History is cleared after fixture construction: the generated shape is the
 * test baseline, and Ctrl+Z starts with the user's next modeling action.
 */
export function createStaticMeshTestFixture(
  fixture: StaticMeshTestFixtureKind = 'panel',
): StaticMeshTestFixtureResult {
  clearStaticMeshTestFixtures();

  const asset = staticMeshAssetAPI.create({
    name: fixtureName(fixture),
    path: TEST_ASSET_PATH,
  });


  if (fixture === 'inset-orient') {
    staticMeshAssetAPI.addPoints({
      assetId: asset.id,
      points: [
        // Horizontal quad (face 0)
        { id: 'H0', position: { x: -5, y: 0, z: -1 }, role: 'CORNER' },
        { id: 'H1', position: { x: -5, y: 0, z: 1 }, role: 'CORNER' },
        { id: 'H2', position: { x: -1, y: 0, z: 1 }, role: 'CORNER' },
        { id: 'H3', position: { x: -1, y: 0, z: -1 }, role: 'CORNER' },
        // Vertical quad with an intentional collinear Split-Edge-like boundary point (face 1)
        { id: 'V0', position: { x: 0, y: 0, z: -2 }, role: 'CORNER' },
        { id: 'V1', position: { x: 0, y: 2, z: -2 }, role: 'CORNER' },
        { id: 'V2', position: { x: 0, y: 4, z: -2 }, role: 'CORNER' },
        { id: 'V3', position: { x: 0, y: 4, z: 2 }, role: 'CORNER' },
        { id: 'V4', position: { x: 0, y: 0, z: 2 }, role: 'CORNER' },
        // Warped/sloped quad (face 2)
        { id: 'S0', position: { x: 1, y: 0, z: -1 }, role: 'CORNER' },
        { id: 'S1', position: { x: 1, y: 2, z: 1 }, role: 'CORNER' },
        { id: 'S2', position: { x: 5, y: 2.6, z: 1 }, role: 'CORNER' },
        { id: 'S3', position: { x: 5, y: 0, z: -1 }, role: 'CORNER' },
      ],
    });
    staticMeshAssetAPI.createFaceFromPoints({ assetId: asset.id, id: 'face:orient.horizontal', pointIds: ['H0', 'H1', 'H2', 'H3'] });
    staticMeshAssetAPI.createFaceFromPoints({ assetId: asset.id, id: 'face:orient.vertical', pointIds: ['V0', 'V1', 'V2', 'V3', 'V4'] });
    staticMeshAssetAPI.createFaceFromPoints({ assetId: asset.id, id: 'face:orient.sloped', pointIds: ['S0', 'S1', 'S2', 'S3'] });
    return finalizeNormalFixture(fixture, asset, { primaryFaceId: 'face:orient.vertical' });
  }

  if (fixture === 'ring') {
    const points = [] as Array<{ id: string; position: { x: number; y: number; z: number }; role: 'CORNER' }>;
    for (let column = 0; column <= 4; column += 1) {
      const x = (column - 2) * 2;
      points.push({ id: `B${column}`, position: { x, y: 0, z: -1 }, role: 'CORNER' });
      points.push({ id: `T${column}`, position: { x, y: 0, z: 1 }, role: 'CORNER' });
    }
    staticMeshAssetAPI.addPoints({ assetId: asset.id, points });
    for (let column = 0; column < 4; column += 1) {
      staticMeshAssetAPI.createFaceFromPoints({
        assetId: asset.id,
        id: `face:ring.${column}`,
        name: `Ring Quad ${column}`,
        pointIds: [`B${column}`, `T${column}`, `T${column + 1}`, `B${column + 1}`],
      });
    }
    return finalizeNormalFixture(fixture, asset, {
      primaryFaceId: 'face:ring.1',
      primaryEdgePointIds: ['B2', 'T2'],
    });
  }

  if (fixture === 'extrude-normal') {
    staticMeshAssetAPI.addPoints({
      assetId: asset.id,
      points: [
        { id: 'A', position: { x: -2, y: 0, z: -1 }, role: 'CORNER' },
        { id: 'D', position: { x: -2, y: 2, z: 1 }, role: 'CORNER' },
        { id: 'C', position: { x: 2, y: 2, z: 1 }, role: 'CORNER' },
        { id: 'B', position: { x: 2, y: 0, z: -1 }, role: 'CORNER' },
      ],
    });
    staticMeshAssetAPI.createFaceFromPoints({
      assetId: asset.id,
      id: PANEL_FACE_ID,
      name: 'Tilted Extrude Normal Test',
      pointIds: ['A', 'D', 'C', 'B'],
    });
    return finalizeNormalFixture(fixture, asset, { primaryFaceId: PANEL_FACE_ID });
  }

  staticMeshAssetAPI.addPoints({
    assetId: asset.id,
    points: [
      { id: 'A', position: { x: -2, y: 0, z: -2 }, role: 'CORNER' },
      { id: 'D', position: { x: -2, y: 0, z: 2 }, role: 'CORNER' },
      { id: 'C', position: { x: 2, y: 0, z: 2 }, role: 'CORNER' },
      { id: 'B', position: { x: 2, y: 0, z: -2 }, role: 'CORNER' },
    ],
  });

  let primaryFaceId: string | undefined = PANEL_FACE_ID;
  let primaryEdgePointIds: [string, string] | undefined;
  let primaryCutPointIds: [string, string] | undefined;

  if (fixture === 'split') {
    staticMeshAssetAPI.createFaceFromPoints({
      assetId: asset.id,
      id: PANEL_FACE_ID,
      name: 'Split Test Triangle A',
      pointIds: ['A', 'B', 'C'],
    });
    staticMeshAssetAPI.createFaceFromPoints({
      assetId: asset.id,
      id: 'face:panel-b',
      name: 'Split Test Triangle B',
      pointIds: ['A', 'C', 'D'],
    });
    staticMeshAssetAPI.createLoop({
      assetId: asset.id,
      id: 'loop:split-test',
      pointIds: ['A', 'B', 'C'],
    });
    primaryEdgePointIds = ['A', 'C'];
  } else {
    staticMeshAssetAPI.createFaceFromPoints({
      assetId: asset.id,
      id: PANEL_FACE_ID,
      name: 'Test Panel',
      pointIds: ['A', 'D', 'C', 'B'],
    });
    if (fixture === 'cut') primaryCutPointIds = ['A', 'C'];
  }

  if (fixture === 'inset' || fixture === 'opening') {
    const inset = staticMeshAssetAPI.insetFace({
      assetId: asset.id,
      faceId: PANEL_FACE_ID,
      id: 'inset:panel',
      ratio: 0.25,
    });
    primaryFaceId = inset.innerFaceId;

    if (fixture === 'opening') {
      staticMeshAssetAPI.deleteFace({
        assetId: asset.id,
        faceId: inset.innerFaceId,
      });
      primaryFaceId = undefined;
    }
  } else if (fixture === 'box' || fixture === 'normal' || fixture === 'bevel' || fixture === 'bevel-valence') {
    const isValenceFixture = fixture === 'bevel-valence';
    const extrusion = staticMeshAssetAPI.extrudeFace({
      assetId: asset.id,
      faceId: PANEL_FACE_ID,
      id: fixture === 'bevel' ? 'extrude:bevel-box' : isValenceFixture ? 'extrude:bevel-valence-box' : fixture === 'normal' ? 'extrude:normal-box' : 'extrude:box',
      distance: 2,
    });
    // The production Face Extrude consumes/moves the source surface. These
    // fixtures intentionally represent closed boxes, so add the bottom cap
    // explicitly rather than changing the modelling primitive.
    if (isValenceFixture) {
      // Split both end caps around the logged vertical edge. Each endpoint then
      // belongs to four faces, reproducing the former Bevel v1 error.
      staticMeshAssetAPI.createFaceFromPoints({
        assetId: asset.id,
        id: 'face:bevel-valence-bottom-0',
        name: 'Valence Bottom A',
        pointIds: ['A', 'B', 'C'],
      });
      staticMeshAssetAPI.createFaceFromPoints({
        assetId: asset.id,
        id: 'face:bevel-valence-bottom-1',
        name: 'Valence Bottom B',
        pointIds: ['A', 'C', 'D'],
      });
      staticMeshAssetAPI.cutFace({
        assetId: asset.id,
        faceId: extrusion.topFaceId,
        pointAId: extrusion.topPointIds[0],
        pointBId: extrusion.topPointIds[2],
        id: 'cut:bevel-valence-top',
      });
      primaryEdgePointIds = ['A', extrusion.topPointIds[0]];
    } else {
      staticMeshAssetAPI.createFaceFromPoints({
        assetId: asset.id,
        id: fixture === 'bevel' ? 'face:bevel-bottom' : fixture === 'normal' ? 'face:normal-bottom' : 'face:box-bottom',
        name: 'Fixture Bottom Cap',
        pointIds: ['B', 'C', 'D', 'A'],
      });
      if (fixture === 'bevel') primaryEdgePointIds = ['A', extrusion.topPointIds[0]];
    }
    primaryFaceId = extrusion.topFaceId;
  }

  return finalizeNormalFixture(fixture, asset, {
    primaryFaceId,
    primaryEdgePointIds,
    primaryCutPointIds,
  });
}
