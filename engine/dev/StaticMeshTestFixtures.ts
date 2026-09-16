import { assetManager } from '@/engine/AssetManager';
import { assetHistory } from '@/engine/AssetHistory';
import { staticMeshAssetAPI } from '@/engine/api/StaticMeshAssetAPI';
import type { StaticMeshAsset } from '@/types';

export type StaticMeshTestFixtureKind = 'panel' | 'inset' | 'opening' | 'box' | 'split' | 'cut';

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
  } else if (fixture === 'box') {
    const extrusion = staticMeshAssetAPI.extrudeFace({
      assetId: asset.id,
      faceId: PANEL_FACE_ID,
      id: 'extrude:box',
      distance: 2,
    });
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
