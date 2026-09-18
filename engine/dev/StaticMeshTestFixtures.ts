import { assetManager } from '@/engine/AssetManager';
import { assetHistory } from '@/engine/AssetHistory';
import { staticMeshAssetAPI } from '@/engine/api/StaticMeshAssetAPI';
import type { StaticMeshAsset } from '@/types';

export type StaticMeshTestFixtureKind = 'panel' | 'inset' | 'opening' | 'box' | 'split' | 'cut' | 'ring' | 'bevel' | 'bevel-valence' | 'extrude-normal';

export interface StaticMeshTestFixtureResult {
  fixture: StaticMeshTestFixtureKind;
  assetId: string;
  asset: StaticMeshAsset;
  primaryFaceId?: string;
  primaryEdgePointIds?: [string, string];
  primaryCutPointIds?: [string, string];
  pointIds: string[];
  faceIds: string[];
  loopIds: string[];
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

/**
 * Creates one deterministic authored mesh fixture for manual browser/editor
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
    assetHistory.clear(asset.id);
    return {
      fixture,
      assetId: asset.id,
      asset,
      primaryFaceId: 'face:ring.1',
      primaryEdgePointIds: ['B2', 'T2'],
      pointIds: (asset.construction?.points ?? []).map(point => point.id),
      faceIds: (asset.construction?.faces ?? []).map(face => face.id),
      loopIds: (asset.construction?.loops ?? []).map(loop => loop.id),
    };
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
    assetHistory.clear(asset.id);
    return {
      fixture,
      assetId: asset.id,
      asset,
      primaryFaceId: PANEL_FACE_ID,
      pointIds: (asset.construction?.points ?? []).map(point => point.id),
      faceIds: (asset.construction?.faces ?? []).map(face => face.id),
      loopIds: (asset.construction?.loops ?? []).map(loop => loop.id),
    };
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
      amount: 0.5,
    });
    primaryFaceId = inset.innerFaceId;

    if (fixture === 'opening') {
      staticMeshAssetAPI.deleteFace({
        assetId: asset.id,
        faceId: inset.innerFaceId,
      });
      primaryFaceId = undefined;
    }
  } else if (fixture === 'box' || fixture === 'bevel' || fixture === 'bevel-valence') {
    const isValenceFixture = fixture === 'bevel-valence';
    const extrusion = staticMeshAssetAPI.extrudeFace({
      assetId: asset.id,
      faceId: PANEL_FACE_ID,
      id: fixture === 'bevel' ? 'extrude:bevel-box' : isValenceFixture ? 'extrude:bevel-valence-box' : 'extrude:box',
      distance: 2,
    });
    // The production Face Extrude consumes/moves the source surface. These
    // fixtures intentionally represent closed boxes, so add the bottom cap
    // explicitly rather than changing the modelling primitive.
    if (isValenceFixture) {
      // Split both end caps around the logged vertical edge. Each endpoint then
      // belongs to four authored faces, reproducing the former Bevel v1 error.
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
        id: fixture === 'bevel' ? 'face:bevel-bottom' : 'face:box-bottom',
        name: 'Fixture Bottom Cap',
        pointIds: ['B', 'C', 'D', 'A'],
      });
      if (fixture === 'bevel') primaryEdgePointIds = ['A', extrusion.topPointIds[0]];
    }
    primaryFaceId = extrusion.topFaceId;
  }

  // Fixture generation establishes the baseline. Manual actions performed after
  // this point should be the first entries visible to Asset Undo/Redo.
  assetHistory.clear(asset.id);

  return {
    fixture,
    assetId: asset.id,
    asset,
    primaryFaceId,
    primaryEdgePointIds,
    primaryCutPointIds,
    pointIds: (asset.construction?.points ?? []).map(point => point.id),
    faceIds: (asset.construction?.faces ?? []).map(face => face.id),
    loopIds: (asset.construction?.loops ?? []).map(loop => loop.id),
  };
}
