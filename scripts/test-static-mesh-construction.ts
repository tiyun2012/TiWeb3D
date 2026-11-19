import assert from 'node:assert/strict';

import { assetManager } from '@/engine/AssetManager';
import { assetHistory } from '@/engine/AssetHistory';
import { staticMeshAssetAPI } from '@/engine/api/StaticMeshAssetAPI';
import { GizmoSystem } from '@/engine/GizmoSystem';
import { buildMeshFaceTriangleIndices } from '@/engine/MeshFaceGeometry';
import { meshEdgePairFromKey } from '@/engine/MeshEdgeGeometry';
import { buildFaceNormalLines, buildVertexNormalLines } from '@/engine/MeshNormalGeometry';
import { editorCommandRegistry, type EditorCommandCapability, type EditorCommandContext } from '@/editor/commands/EditorCommandRegistry';
import '@/editor/commands/StaticMeshCommandCatalogue';
import { resolveStaticMeshShells } from '@/engine/mesh-editing/StaticMeshShells';
import { clearStaticMeshTestFixtures, createStaticMeshTestFixture } from '@/engine/dev/StaticMeshTestFixtures';
import { removeWindowsForDeletedAsset } from '@/editor/assetEditorWindowLifecycle';
import type { StaticMeshAsset } from '@/types';


const assertNearlyEqual = (actual: number, expected: number, message: string, epsilon = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${message} (expected ${expected}, got ${actual})`);
};

const floor = staticMeshAssetAPI.create({ name: 'Construction API Floor Test', path: '/Tests' });
const floorPoints = staticMeshAssetAPI.addPoints({
  assetId: floor.id,
  points: [
    { id: 'house.A', position: { x: 0, y: 0, z: 0 }, role: 'CORNER' },
    { id: 'house.D', position: { x: 0, y: 0, z: 4 }, role: 'CORNER' },
    { id: 'house.C', position: { x: 4, y: 0, z: 4 }, role: 'CORNER' },
    { id: 'house.B', position: { x: 4, y: 0, z: 0 }, role: 'CORNER' },
  ],
});
assert.equal(floorPoints.length, 4);
assert.equal(floor.geometry.vertices.length, 0, 'Construction Points must not create mesh vertices by themselves.');

const floorFace = staticMeshAssetAPI.createFaceFromPoints({
  assetId: floor.id,
  id: 'face:ground-floor',
  name: 'Ground Floor',
  pointIds: ['house.A', 'house.D', 'house.C', 'house.B'],
});
assert.equal(floorFace.vertexIds.length, 4);
assert.equal(floor.geometry.vertices.length / 3, 4);
assert.equal(floor.geometry.indices.length / 3, 2);
assert.equal(floor.topology.faces.length, 1);
assert.deepEqual(floor.topology.faces[0], floorFace.vertexIds);

staticMeshAssetAPI.movePoint({
  assetId: floor.id,
  pointId: 'house.A',
  position: { x: -1, y: 0, z: 0 },
});
const movedA = staticMeshAssetAPI.getPoint(floor.id, 'house.A');
assert.ok(movedA);
assert.equal(movedA.position.x, -1);
assert.ok((movedA.vertexIds?.length ?? 0) > 0);
for (const vertexId of movedA.vertexIds ?? []) {
  assert.equal(floor.geometry.vertices[vertexId * 3], -1, 'Moving a semantic point must move every bound mesh vertex.');
}

const extrusion = staticMeshAssetAPI.extrudeFace({
  assetId: floor.id,
  faceId: floorFace.id,
  id: 'extrude:walls',
  distance: 3,
});
assert.equal(extrusion.topPointIds.length, 4);
assert.equal(extrusion.sideFaceIds.length, 4);
assert.equal(extrusion.topFaceId, floorFace.id, 'Extrude must keep the selected semantic face handle on the moved top face.');
assert.equal(floor.geometry.vertices.length / 3, 8);
assert.equal(floor.topology.faces.length, 5, 'Modeller-style face extrusion must not leave a source cap behind.');
assert.equal(floor.geometry.indices.length / 3, 10);
assert.ok(staticMeshAssetAPI.getPoint(floor.id, extrusion.topPointIds[0]));
const movedFloorFace = floor.construction?.faces.find(face => face.id === floorFace.id);
assert.deepEqual(movedFloorFace?.pointIds, extrusion.topPointIds, 'The source face boundary must move to the extruded top points.');

// Face Extrude must always follow the selected logical face normal rather than
// a fixed world/ground axis. This tilted quad has normal (0, +Y, -Z) / sqrt(2),
// so every generated top point must receive exactly that world-space offset.
const normalExtrudeAsset = staticMeshAssetAPI.create({ name: 'Construction API Face Normal Extrude Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: normalExtrudeAsset.id,
  points: [
    { id: 'nA', position: { x: -2, y: 0, z: -1 } },
    { id: 'nD', position: { x: -2, y: 2, z: 1 } },
    { id: 'nC', position: { x: 2, y: 2, z: 1 } },
    { id: 'nB', position: { x: 2, y: 0, z: -1 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: normalExtrudeAsset.id,
  id: 'face:tilted',
  pointIds: ['nA', 'nD', 'nC', 'nB'],
});
const sourceNormalPositions = ['nA', 'nD', 'nC', 'nB'].map(pointId => ({
  ...staticMeshAssetAPI.getPoint(normalExtrudeAsset.id, pointId)!.position,
}));
const normalDistance = 1.5;
const normalExtrusion = staticMeshAssetAPI.extrudeFace({
  assetId: normalExtrudeAsset.id,
  faceId: 'face:tilted',
  id: 'extrude:normal',
  distance: normalDistance,
});
const invSqrt2 = 1 / Math.sqrt(2);
const expectedNormalOffset = { x: 0, y: invSqrt2 * normalDistance, z: -invSqrt2 * normalDistance };
normalExtrusion.topPointIds.forEach((pointId, index) => {
  const top = staticMeshAssetAPI.getPoint(normalExtrudeAsset.id, pointId)!.position;
  const source = sourceNormalPositions[index];
  assertNearlyEqual(top.x - source.x, expectedNormalOffset.x, 'Extrude X offset must follow the face normal.');
  assertNearlyEqual(top.y - source.y, expectedNormalOffset.y, 'Extrude Y offset must follow the face normal.');
  assertNearlyEqual(top.z - source.z, expectedNormalOffset.z, 'Extrude Z offset must follow the face normal.');
});
assert.ok(
  staticMeshAssetAPI.getPoint(normalExtrudeAsset.id, normalExtrusion.topPointIds[0])!.position.y > sourceNormalPositions[0].y,
  'A positive extrusion on the tilted test face must lift the new face away from the ground along its +Y normal component.',
);

assert.throws(
  () => staticMeshAssetAPI.removePoint({ assetId: floor.id, pointId: 'house.A' }),
  /used by face/,
  'Referenced Construction Points must not be silently deleted.',
);

// Inset is intentionally face-centric: the selected semantic face survives as
// the new inner face. That lets an AI immediately feed the same stable face id
// into the next operation (for example extrude) without rediscovering topology.
const insetAsset = staticMeshAssetAPI.create({ name: 'Construction API Inset Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: insetAsset.id,
  points: [
    { id: 'panel.A', position: { x: 0, y: 0, z: 0 } },
    { id: 'panel.D', position: { x: 0, y: 0, z: 4 } },
    { id: 'panel.C', position: { x: 4, y: 0, z: 4 } },
    { id: 'panel.B', position: { x: 4, y: 0, z: 0 } },
  ],
});
const insetSourceFace = staticMeshAssetAPI.createFaceFromPoints({
  assetId: insetAsset.id,
  id: 'face:panel',
  pointIds: ['panel.A', 'panel.D', 'panel.C', 'panel.B'],
});
const inset = staticMeshAssetAPI.insetFace({
  assetId: insetAsset.id,
  faceId: insetSourceFace.id,
  id: 'inset:panel',
  ratio: 0.25,
});
assert.equal(inset.innerFaceId, insetSourceFace.id, 'Inset must preserve the selected semantic face handle.');
assert.equal(inset.innerPointIds.length, 4);
assert.equal(inset.borderFaceIds.length, 4);
assert.equal(insetAsset.construction?.points.length, 8);
assert.equal(insetAsset.construction?.faces.length, 5);
assert.equal(insetAsset.construction?.loops.length, 1);
assert.equal(insetAsset.geometry.vertices.length / 3, 8);
assert.equal(insetAsset.geometry.indices.length / 3, 10);
assert.equal(resolveStaticMeshShells(insetAsset).length, 1);

const insetInnerPositions = inset.innerPointIds.map(pointId => staticMeshAssetAPI.getPoint(insetAsset.id, pointId)!.position);
const insetCoordinatePairs = insetInnerPositions
  .map(position => [Number(position.x.toFixed(6)), Number(position.z.toFixed(6))])
  .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
assert.deepEqual(insetCoordinatePairs, [
  [0.5, 0.5],
  [0.5, 3.5],
  [3.5, 0.5],
  [3.5, 3.5],
], 'A 0.25 relative inset of a 4x4 face must move each corner 25% toward the center.');

const storedInsetFace = insetAsset.construction!.faces.find(face => face.id === insetSourceFace.id)!;
assert.deepEqual(storedInsetFace.pointIds, inset.innerPointIds, 'The source semantic face boundary must become the inset points.');
assert.equal(storedInsetFace.faceId, insetSourceFace.faceId, 'Inset must preserve the logical face id as well as the semantic handle.');

const insetPoint0 = staticMeshAssetAPI.getPoint(insetAsset.id, inset.innerPointIds[0])!;
const insetPoint1 = staticMeshAssetAPI.getPoint(insetAsset.id, inset.innerPointIds[1])!;
const insetVertex0 = insetPoint0.vertexIds![0];
const insetVertex1 = insetPoint1.vertexIds![0];
const insetInnerHalfEdge = insetAsset.topology.graph?.halfEdges.find(edge => {
  const prev = insetAsset.topology.graph!.halfEdges[edge.prev];
  return prev.vertex === insetVertex0 && edge.vertex === insetVertex1;
});
assert.ok(insetInnerHalfEdge);
assert.notEqual(insetInnerHalfEdge.pair, -1, 'Inset inner face edges must pair with the surrounding border ring.');

const insetBeforeRejectedOperation = {
  points: insetAsset.construction?.points.length,
  faces: insetAsset.construction?.faces.length,
  loops: insetAsset.construction?.loops.length,
  vertices: insetAsset.geometry.vertices.length,
  indices: insetAsset.geometry.indices.length,
  sourcePointIds: [...storedInsetFace.pointIds],
};
assert.throws(
  () => staticMeshAssetAPI.insetFace({ assetId: insetAsset.id, faceId: insetSourceFace.id, ratio: 1 }),
  /Inset ratio/,
  'Inset must reject a ratio outside the open 0..1 interval.',
);
assert.deepEqual({
  points: insetAsset.construction?.points.length,
  faces: insetAsset.construction?.faces.length,
  loops: insetAsset.construction?.loops.length,
  vertices: insetAsset.geometry.vertices.length,
  indices: insetAsset.geometry.indices.length,
  sourcePointIds: [...storedInsetFace.pointIds],
}, insetBeforeRejectedOperation, 'Rejected inset validation must leave authored topology and geometry unchanged.');

const postInsetExtrusion = staticMeshAssetAPI.extrudeFace({
  assetId: insetAsset.id,
  faceId: inset.innerFaceId,
  id: 'extrude:inset-panel',
  distance: 1,
});
assert.equal(postInsetExtrusion.sourceFaceId, insetSourceFace.id, 'The same semantic face handle must remain usable after inset.');
assert.equal(postInsetExtrusion.topFaceId, insetSourceFace.id, 'Extrude keeps the inset face handle stable on the moved top surface.');
assert.equal(postInsetExtrusion.sideFaceIds.length, 4);

// Delete Face is an opening primitive: it removes only the authored surface.
// Semantic points and loops stay available, while logical face ids compact so
// later operations never inherit sparse/stale numeric topology ids.
const deleteAsset = staticMeshAssetAPI.create({ name: 'Construction API Delete Face Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: deleteAsset.id,
  points: [
    { id: 'dA', position: { x: 0, y: 0, z: 0 } },
    { id: 'dD', position: { x: 0, y: 0, z: 4 } },
    { id: 'dC', position: { x: 4, y: 0, z: 4 } },
    { id: 'dB', position: { x: 4, y: 0, z: 0 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: deleteAsset.id,
  id: 'face:delete-panel',
  pointIds: ['dA', 'dD', 'dC', 'dB'],
});
const deleteInset = staticMeshAssetAPI.insetFace({
  assetId: deleteAsset.id,
  faceId: 'face:delete-panel',
  id: 'inset:delete-panel',
  ratio: 0.5,
});
assert.equal(deleteAsset.construction?.faces.length, 5);
assert.equal(deleteAsset.geometry.indices.length / 3, 10);
const deletedFace = staticMeshAssetAPI.deleteFace({
  assetId: deleteAsset.id,
  faceId: deleteInset.innerFaceId,
});
assert.equal(deletedFace.id, 'face:delete-panel');
assert.equal(deletedFace.deletedLogicalFaceId, 0);
assert.deepEqual(deletedFace.triangleIds, [0, 1]);
assert.equal(deleteAsset.construction?.points.length, 8, 'Deleting a face must preserve semantic Construction Points.');
assert.equal(deleteAsset.construction?.loops.length, 1, 'Deleting a face must preserve semantic Construction Loops.');
assert.equal(deleteAsset.construction?.faces.length, 4);
assert.equal(deleteAsset.topology.faces.length, 4);
assert.equal(deleteAsset.geometry.indices.length / 3, 8);
assert.equal(resolveStaticMeshShells(deleteAsset).length, 1, 'The remaining inset border ring must stay one Mesh Shell.');
assert.deepEqual(
  deleteAsset.construction?.faces.map(face => face.faceId),
  [0, 1, 2, 3],
  'Remaining semantic faces must remap to dense logical face ids after deletion.',
);
assert.deepEqual(
  Array.from(deleteAsset.topology.triangleToFaceIndex),
  [0, 0, 1, 1, 2, 2, 3, 3],
  'Triangle-to-face mapping must compact with the deleted logical face.',
);
assert.equal(staticMeshAssetAPI.getHistoryState(deleteAsset.id).undoLabel, 'Delete Construction Face');
assert.equal(staticMeshAssetAPI.undo(deleteAsset.id), true);
assert.equal(deleteAsset.construction?.faces.length, 5, 'Undo Delete Face must restore the authored inner face.');
assert.equal(deleteAsset.geometry.indices.length / 3, 10);
assert.equal(staticMeshAssetAPI.redo(deleteAsset.id), true);
assert.equal(deleteAsset.construction?.faces.length, 4);
assert.equal(deleteAsset.geometry.indices.length / 3, 8);

// Asset history snapshots geometry, topology and Construction data together.
// Undoing the inset must restore the exact pre-inset authored face, while redo
// re-applies the whole operation without recomputing it from unstable raw ids.
const historyAsset = staticMeshAssetAPI.create({ name: 'Construction API History Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: historyAsset.id,
  points: [
    { id: 'hA', position: { x: 0, y: 0, z: 0 } },
    { id: 'hD', position: { x: 0, y: 0, z: 4 } },
    { id: 'hC', position: { x: 4, y: 0, z: 4 } },
    { id: 'hB', position: { x: 4, y: 0, z: 0 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: historyAsset.id,
  id: 'face:history-panel',
  pointIds: ['hA', 'hD', 'hC', 'hB'],
});
staticMeshAssetAPI.insetFace({
  assetId: historyAsset.id,
  faceId: 'face:history-panel',
  id: 'inset:history-panel',
  ratio: 0.5,
});
assert.equal(staticMeshAssetAPI.getHistoryState(historyAsset.id).undoLabel, 'Inset Construction Face');
assert.equal(historyAsset.construction?.points.length, 8);
assert.equal(historyAsset.construction?.faces.length, 5);
assert.equal(staticMeshAssetAPI.undo(historyAsset.id), true);
assert.equal(historyAsset.construction?.points.length, 4, 'Undo inset must restore the original four Construction Points.');
assert.equal(historyAsset.construction?.faces.length, 1, 'Undo inset must remove the border ring.');
assert.equal(historyAsset.geometry.vertices.length / 3, 4, 'Undo inset must restore mesh geometry with the asset snapshot.');
assert.equal(historyAsset.geometry.indices.length / 3, 2);
assert.equal(staticMeshAssetAPI.getHistoryState(historyAsset.id).redoLabel, 'Inset Construction Face');
assert.equal(staticMeshAssetAPI.redo(historyAsset.id), true);
assert.equal(historyAsset.construction?.points.length, 8);
assert.equal(historyAsset.construction?.faces.length, 5);
assert.equal(historyAsset.geometry.vertices.length / 3, 8);
assert.equal(historyAsset.geometry.indices.length / 3, 10);

// An AI can group several primitive calls into one semantic undo step.
const transactionAsset = staticMeshAssetAPI.create({ name: 'Construction API Transaction Test', path: '/Tests' });
staticMeshAssetAPI.beginTransaction(transactionAsset.id, 'Build Panel');
staticMeshAssetAPI.addPoints({
  assetId: transactionAsset.id,
  points: [
    { id: 'tA', position: { x: 0, y: 0, z: 0 } },
    { id: 'tD', position: { x: 0, y: 0, z: 2 } },
    { id: 'tC', position: { x: 2, y: 0, z: 2 } },
    { id: 'tB', position: { x: 2, y: 0, z: 0 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: transactionAsset.id,
  id: 'face:transaction-panel',
  pointIds: ['tA', 'tD', 'tC', 'tB'],
});
assert.equal(staticMeshAssetAPI.commitTransaction(transactionAsset.id), true);
assert.equal(staticMeshAssetAPI.getHistoryState(transactionAsset.id).undoLabel, 'Build Panel');
assert.equal(transactionAsset.construction?.points.length, 4);
assert.equal(transactionAsset.geometry.vertices.length / 3, 4);
assert.equal(staticMeshAssetAPI.undo(transactionAsset.id), true);
assert.equal(transactionAsset.construction?.points.length ?? 0, 0, 'One undo must revert the whole grouped AI transaction.');
assert.equal(transactionAsset.construction?.faces.length ?? 0, 0);
assert.equal(transactionAsset.geometry.vertices.length, 0);
assert.equal(staticMeshAssetAPI.redo(transactionAsset.id), true);
assert.equal(transactionAsset.construction?.points.length, 4);
assert.equal(transactionAsset.construction?.faces.length, 1);
assert.equal(transactionAsset.geometry.vertices.length / 3, 4);

// The editor command catalogue exposes the same primitive names used by the
// Static Mesh dock. This verifies that UI dispatch stays on the API/tool command
// path rather than growing a second topology implementation in React.
let topologyCommandInvocation: string | null = null;
const topologyCommandContext: EditorCommandContext = {
  capabilities: new Set<EditorCommandCapability>(['STATIC_MESH_COMPONENT_EDIT']),
  meshComponentMode: 'FACE' as const,
  selectionCounts: { object: 1, vertices: 0, edges: 0, faces: 1 },
  services: {
    topologyCommand: (command: 'EXTRUDE' | 'INSET' | 'BEVEL' | 'WELD' | 'CONNECT' | 'DELETE_FACE' | 'SPLIT_EDGE' | 'CUT_FACE') => {
      topologyCommandInvocation = command;
    },
  },
};
assert.equal(editorCommandRegistry.resolve('staticMesh.inset', topologyCommandContext)?.isEnabled, true);
assert.equal(editorCommandRegistry.execute('staticMesh.inset', topologyCommandContext), true);
assert.equal(topologyCommandInvocation, 'INSET');
assert.equal(editorCommandRegistry.execute('staticMesh.deleteFace', topologyCommandContext), true);
assert.equal(topologyCommandInvocation, 'DELETE_FACE');

const splitCommandContext: EditorCommandContext = {
  ...topologyCommandContext,
  meshComponentMode: 'EDGE' as const,
  selectionCounts: { object: 1, vertices: 0, edges: 1, faces: 0 },
};
assert.equal(editorCommandRegistry.resolve('staticMesh.splitEdge', splitCommandContext)?.isEnabled, true);
assert.equal(editorCommandRegistry.execute('staticMesh.splitEdge', splitCommandContext), true);
assert.equal(topologyCommandInvocation, 'SPLIT_EDGE');

assert.equal(editorCommandRegistry.resolve('staticMesh.bevel', splitCommandContext)?.isEnabled, true);
assert.equal(editorCommandRegistry.execute('staticMesh.bevel', splitCommandContext), true);
assert.equal(topologyCommandInvocation, 'BEVEL');

const cutCommandContext: EditorCommandContext = {
  ...topologyCommandContext,
  meshComponentMode: 'VERTEX' as const,
  selectionCounts: { object: 1, vertices: 2, edges: 0, faces: 0 },
};
assert.equal(editorCommandRegistry.resolve('staticMesh.cutFace', cutCommandContext)?.isEnabled, true);
assert.equal(editorCommandRegistry.execute('staticMesh.cutFace', cutCommandContext), true);
assert.equal(topologyCommandInvocation, 'CUT_FACE');

let selectionQueryInvocation: string | null = null;
const topologyQueryCommandContext: EditorCommandContext = {
  ...topologyCommandContext,
  meshComponentMode: 'EDGE' as const,
  selectionCounts: { object: 1, vertices: 0, edges: 1, faces: 0 },
  services: {
    selectRing: () => { selectionQueryInvocation = 'RING'; },
    selectQuadStrip: () => { selectionQueryInvocation = 'QUAD_STRIP'; },
  },
};
assert.equal(editorCommandRegistry.resolve('staticMesh.selection.ring', topologyQueryCommandContext)?.isEnabled, true);
assert.equal(editorCommandRegistry.execute('staticMesh.selection.ring', topologyQueryCommandContext), true);
assert.equal(selectionQueryInvocation, 'RING');
assert.equal(editorCommandRegistry.resolve('staticMesh.selection.quadStrip', topologyQueryCommandContext)?.isEnabled, true);
assert.equal(editorCommandRegistry.execute('staticMesh.selection.quadStrip', topologyQueryCommandContext), true);
assert.equal(selectionQueryInvocation, 'QUAD_STRIP');

// Gizmo/history synchronization invariant: the gizmo owns no persistent
// transform state. The host asset transaction restores an unfinished drag and
// the same selected vertex drives the gizmo again after a committed Undo.
const gizmoAsset = staticMeshAssetAPI.create({ name: 'Gizmo History Sync Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: gizmoAsset.id,
  points: [
    { id: 'gA', position: { x: 0, y: 0, z: 0 } },
    { id: 'gB', position: { x: 2, y: 0, z: 0 } },
    { id: 'gC', position: { x: 0, y: 2, z: 0 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({ assetId: gizmoAsset.id, id: 'face:gizmo', pointIds: ['gA', 'gB', 'gC'] });
assetHistory.clear(gizmoAsset.id);

const gizmoVertexId = staticMeshAssetAPI.getPoint(gizmoAsset.id, 'gA')!.vertexIds![0];
const gizmoMeshIntId = assetManager.getMeshID(gizmoAsset.id);
const identityVp = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);
let renderedGizmoPosition = { x: Number.NaN, y: Number.NaN, z: Number.NaN };
let renderedGizmoCount = 0;
let dragStartX = 0;
const selectedVertexIds = new Set<number>([gizmoVertexId]);
const fakeGizmoEngine = {
  ecs: {
    store: {
      ids: ['preview:gizmo-test'],
      meshType: new Int32Array([gizmoMeshIntId]),
      worldMatrix: identityVp.slice(),
    },
    idToIndex: new Map([['preview:gizmo-test', 0]]),
    getEntityIndex: (id: string) => id === 'preview:gizmo-test' ? 0 : undefined,
  },
  sceneGraph: {
    getWorldMatrix: () => identityVp,
    getWorldPosition: () => ({ x: 0, y: 0, z: 0 }),
    getParentId: () => null,
    setDirty: () => {},
  },
  selectionSystem: {
    selectedIndices: new Set<number>([0]),
    subSelection: {
      vertexIds: selectedVertexIds,
      edgeIds: new Set<string>(),
      faceIds: new Set<number>(),
    },
    getSelectionAsVertices: () => selectedVertexIds,
  },
  meshComponentMode: 'VERTEX',
  currentCameraPos: { x: 0, y: 0, z: 10 },
  currentViewProj: identityVp,
  renderer: {
    renderGizmos: (_vp: Float32Array, position: { x: number; y: number; z: number }) => {
      renderedGizmoPosition = { ...position };
      renderedGizmoCount += 1;
    },
  },
  syncTransforms: () => {},
  notifyUI: () => {},
  pushUndoState: () => {},
  startVertexDrag: () => {
    dragStartX = gizmoAsset.geometry.vertices[gizmoVertexId * 3];
    assetHistory.begin(gizmoAsset.id, 'Move Mesh Components');
  },
  updateVertexDrag: (_entityId: string, delta: { x: number; y: number; z: number }) => {
    gizmoAsset.geometry.vertices[gizmoVertexId * 3] = dragStartX + delta.x;
  },
  endVertexDrag: () => {
    assetHistory.markDirty(gizmoAsset.id);
    assetHistory.commit(gizmoAsset.id);
  },
  cancelVertexDrag: () => {
    assetHistory.cancel(gizmoAsset.id);
  },
};
const localGizmo = new GizmoSystem(fakeGizmoEngine);
// SELECT is selection-only: an actionable component selection must not make a
// transform gizmo appear until the user explicitly activates a transform tool.
localGizmo.render();
assert.equal(renderedGizmoCount, 0, 'SELECT tool must keep the transform gizmo hidden.');
localGizmo.setTool('MOVE');
localGizmo.render();
assert.equal(renderedGizmoCount, 1, 'MOVE must explicitly activate the transform gizmo.');
assert.equal(renderedGizmoPosition.x, 0, 'Gizmo must derive its pivot from the selected vertex once activated.');

// Center-screen ray hits the VIEW handle at the selected origin and begins a
// component drag. Cancelling invokes the host's asset-transaction rollback.
localGizmo.update(0, 50, 50, 100, 100, true, false);
assert.equal(localGizmo.isActiveDrag(), true);
assert.equal(staticMeshAssetAPI.getHistoryState(gizmoAsset.id).inTransaction, true);
fakeGizmoEngine.updateVertexDrag('preview:gizmo-test', { x: 1, y: 0, z: 0 });
assert.equal(gizmoAsset.geometry.vertices[gizmoVertexId * 3], 1);
assert.equal(localGizmo.cancelActiveDrag(), true);
assert.equal(gizmoAsset.geometry.vertices[gizmoVertexId * 3], 0, 'Esc/cancel must restore the drag-start geometry.');
assert.equal(staticMeshAssetAPI.getHistoryState(gizmoAsset.id).inTransaction, false);
assert.equal(staticMeshAssetAPI.getHistoryState(gizmoAsset.id).canUndo, false, 'Cancelled drag must create no history entry.');
const cancelledDragCreatedUndo = staticMeshAssetAPI.getHistoryState(gizmoAsset.id).canUndo;
assert.equal(selectedVertexIds.has(gizmoVertexId), true, 'Cancel must not own or clear component selection.');

// Complete one drag, then undo the asset snapshot. Selection is viewport state,
// so it remains selected and the next render derives the gizmo from restored geometry.
localGizmo.update(0, 50, 50, 100, 100, true, false);
fakeGizmoEngine.updateVertexDrag('preview:gizmo-test', { x: 1, y: 0, z: 0 });
localGizmo.update(0, 50, 50, 100, 100, false, true);
assert.equal(staticMeshAssetAPI.getHistoryState(gizmoAsset.id).undoLabel, 'Move Mesh Components');
assert.equal(gizmoAsset.geometry.vertices[gizmoVertexId * 3], 1);
assert.equal(staticMeshAssetAPI.undo(gizmoAsset.id), true);
localGizmo.resetInteraction();
assert.equal(gizmoAsset.geometry.vertices[gizmoVertexId * 3], 0);
assert.equal(selectedVertexIds.has(gizmoVertexId), true, 'Undo must not require a separate gizmo-selection history.');
localGizmo.render();
assert.equal(renderedGizmoPosition.x, 0, 'Gizmo must follow the restored selected vertex after Undo.');
localGizmo.setTool('SELECT');
localGizmo.render();
assert.equal(renderedGizmoCount, 2, 'Returning to SELECT must hide the gizmo without clearing selection.');
assert.equal(selectedVertexIds.has(gizmoVertexId), true, 'Hiding the gizmo in SELECT must preserve component selection.');

const bridgeAsset = staticMeshAssetAPI.create({ name: 'Construction API Bridge Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: bridgeAsset.id,
  points: [
    { id: 'a0', position: { x: -1, y: 0, z: -1 } },
    { id: 'a1', position: { x: -1, y: 0, z: 1 } },
    { id: 'a2', position: { x: 1, y: 0, z: 1 } },
    { id: 'a3', position: { x: 1, y: 0, z: -1 } },
    { id: 'b0', position: { x: -1, y: 2, z: -1 } },
    { id: 'b1', position: { x: -1, y: 2, z: 1 } },
    { id: 'b2', position: { x: 1, y: 2, z: 1 } },
    { id: 'b3', position: { x: 1, y: 2, z: -1 } },
  ],
});
const loopA = staticMeshAssetAPI.createLoop({ assetId: bridgeAsset.id, id: 'loop:bottom', pointIds: ['a0', 'a1', 'a2', 'a3'] });
const loopB = staticMeshAssetAPI.createLoop({ assetId: bridgeAsset.id, id: 'loop:top', pointIds: ['b0', 'b1', 'b2', 'b3'] });
const bridge = staticMeshAssetAPI.bridgeLoops({ assetId: bridgeAsset.id, loopAId: loopA.id, loopBId: loopB.id, id: 'bridge:sides' });
assert.equal(bridge.faceIds.length, 4);
assert.equal(bridgeAsset.geometry.vertices.length / 3, 8);
assert.equal(bridgeAsset.topology.faces.length, 4);
assert.equal(bridgeAsset.geometry.indices.length / 3, 8);


// Face-core topology invariant: adjacent Construction Faces that reuse the same
// semantic Construction Points must compile to the same actual mesh vertex IDs.
// A shared edge also needs opposite winding in the two faces so the half-edge
// graph can pair the two directed boundary edges.
const adjacentFacesAsset = staticMeshAssetAPI.create({ name: 'Adjacent Face Shared Vertex Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: adjacentFacesAsset.id,
  points: [
    { id: 'A', position: { x: 0, y: 0, z: 0 } },
    { id: 'B', position: { x: 1, y: 0, z: 0 } },
    { id: 'C', position: { x: 0, y: 1, z: 0 } },
    { id: 'D', position: { x: 1, y: 1, z: 0 } },
  ],
});
const adjacentFaceA = staticMeshAssetAPI.createFaceFromPoints({
  assetId: adjacentFacesAsset.id,
  id: 'face:adjacent-a',
  pointIds: ['A', 'B', 'C'],
});
const adjacentFaceB = staticMeshAssetAPI.createFaceFromPoints({
  assetId: adjacentFacesAsset.id,
  id: 'face:adjacent-b',
  // Shared edge B-C is reversed here (C -> B) so the half-edge pair is valid.
  pointIds: ['C', 'B', 'D'],
});
const adjacentPointB = staticMeshAssetAPI.getPoint(adjacentFacesAsset.id, 'B');
const adjacentPointC = staticMeshAssetAPI.getPoint(adjacentFacesAsset.id, 'C');
assert.ok(adjacentPointB && adjacentPointC);
const vertexB = adjacentPointB.vertexIds?.[0];
const vertexC = adjacentPointC.vertexIds?.[0];
assert.notEqual(vertexB, undefined);
assert.notEqual(vertexC, undefined);
assert.ok(adjacentFaceA.vertexIds.includes(vertexB!));
assert.ok(adjacentFaceB.vertexIds.includes(vertexB!));
assert.ok(adjacentFaceA.vertexIds.includes(vertexC!));
assert.ok(adjacentFaceB.vertexIds.includes(vertexC!));
assert.equal(
  adjacentFacesAsset.geometry.vertices.length / 3,
  4,
  'Two adjacent triangles built from four semantic points must compile to four shared mesh vertices, not six duplicated vertices.',
);
assert.deepEqual(
  adjacentFacesAsset.topology.vertexToFaces.get(vertexB!),
  [adjacentFaceA.faceId, adjacentFaceB.faceId],
  'A shared mesh vertex must report both incident logical faces.',
);
assert.deepEqual(
  adjacentFacesAsset.topology.vertexToFaces.get(vertexC!),
  [adjacentFaceA.faceId, adjacentFaceB.faceId],
  'Both vertices on the shared edge must report both incident logical faces.',
);
const sharedHalfEdge = adjacentFacesAsset.topology.graph?.halfEdges.find(edge => {
  const prev = adjacentFacesAsset.topology.graph!.halfEdges[edge.prev];
  return prev.vertex === vertexB && edge.vertex === vertexC;
});
assert.ok(sharedHalfEdge, 'Expected the directed B -> C half-edge to exist.');
assert.notEqual(sharedHalfEdge.pair, -1, 'Oppositely wound adjacent faces must pair their shared half-edge.');
const pairedHalfEdge = adjacentFacesAsset.topology.graph!.halfEdges[sharedHalfEdge.pair];
const pairedPrev = adjacentFacesAsset.topology.graph!.halfEdges[pairedHalfEdge.prev];
assert.equal(pairedPrev.vertex, vertexC);
assert.equal(pairedHalfEdge.vertex, vertexB);
assert.equal(
  resolveStaticMeshShells(adjacentFacesAsset).length,
  1,
  'Adjacent faces sharing an authored edge must resolve as one Mesh Shell.',
);

// Split Edge is semantic-point based: one new Construction Point is inserted
// into every incident authored face/loop, so adjacent faces keep sharing actual
// topology instead of independently creating coincident vertices.
const splitAsset = staticMeshAssetAPI.create({ name: 'Construction API Split Edge Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: splitAsset.id,
  points: [
    { id: 'sA', position: { x: 0, y: 0, z: 0 } },
    { id: 'sB', position: { x: 2, y: 0, z: 0 } },
    { id: 'sC', position: { x: 0, y: 2, z: 0 } },
    { id: 'sD', position: { x: 2, y: 2, z: 0 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({ assetId: splitAsset.id, id: 'face:split-a', pointIds: ['sA', 'sB', 'sC'] });
staticMeshAssetAPI.createFaceFromPoints({ assetId: splitAsset.id, id: 'face:split-b', pointIds: ['sC', 'sB', 'sD'] });
staticMeshAssetAPI.createLoop({ assetId: splitAsset.id, id: 'loop:split-a', pointIds: ['sA', 'sB', 'sC'] });
assetHistory.clear(splitAsset.id);
const splitVertexB = staticMeshAssetAPI.getPoint(splitAsset.id, 'sB')!.vertexIds![0];
const splitVertexC = staticMeshAssetAPI.getPoint(splitAsset.id, 'sC')!.vertexIds![0];
assert.deepEqual(
  staticMeshAssetAPI.getConstructionEdgePointIds(splitAsset.id, splitVertexB, splitVertexC),
  ['sB', 'sC'],
  'Editor edge selection must resolve back to stable Construction Point endpoints.',
);
const split = staticMeshAssetAPI.splitEdge({
  assetId: splitAsset.id,
  pointAId: 'sB',
  pointBId: 'sC',
  id: 'split:shared',
  t: 0.25,
});
assert.equal(split.updatedFaceIds.length, 2, 'A shared edge split must update both incident Construction Faces.');
assert.deepEqual(split.updatedLoopIds, ['loop:split-a'], 'Construction Loops using the edge must receive the same split point.');
assert.equal(splitAsset.construction?.points.length, 5);
assert.equal(splitAsset.geometry.vertices.length / 3, 5, 'One semantic split point must compile to one shared mesh vertex.');
assert.equal(splitAsset.topology.faces.length, 2, 'Split Edge must preserve logical face identity/count.');
assert.deepEqual(splitAsset.construction?.faces.map(face => face.faceId), [0, 1]);
assert.deepEqual(splitAsset.construction?.faces.map(face => face.pointIds.length), [4, 4]);
assert.equal(splitAsset.geometry.indices.length / 3, 4, 'Two split triangles become two logical quads (four render triangles).');
for (let triangleId = 0; triangleId < splitAsset.geometry.indices.length / 3; triangleId += 1) {
  const ia = splitAsset.geometry.indices[triangleId * 3] * 3;
  const ib = splitAsset.geometry.indices[triangleId * 3 + 1] * 3;
  const ic = splitAsset.geometry.indices[triangleId * 3 + 2] * 3;
  const abx = splitAsset.geometry.vertices[ib] - splitAsset.geometry.vertices[ia];
  const aby = splitAsset.geometry.vertices[ib + 1] - splitAsset.geometry.vertices[ia + 1];
  const abz = splitAsset.geometry.vertices[ib + 2] - splitAsset.geometry.vertices[ia + 2];
  const acx = splitAsset.geometry.vertices[ic] - splitAsset.geometry.vertices[ia];
  const acy = splitAsset.geometry.vertices[ic + 1] - splitAsset.geometry.vertices[ia + 1];
  const acz = splitAsset.geometry.vertices[ic + 2] - splitAsset.geometry.vertices[ia + 2];
  const cx = aby * acz - abz * acy;
  const cy = abz * acx - abx * acz;
  const cz = abx * acy - aby * acx;
  assert.ok(cx * cx + cy * cy + cz * cz > 1e-12, `Split Edge must not emit degenerate render triangle ${triangleId}.`);
}
const splitPoint = staticMeshAssetAPI.getPoint(splitAsset.id, split.pointId)!;
assert.deepEqual(
  [Number(splitPoint.position.x.toFixed(6)), Number(splitPoint.position.y.toFixed(6)), Number(splitPoint.position.z.toFixed(6))],
  [1.5, 0.5, 0],
  'Split position must interpolate along pointA -> pointB by t.',
);
assert.deepEqual(splitAsset.construction?.loops[0].pointIds, ['sA', 'sB', split.pointId, 'sC']);
assert.equal(resolveStaticMeshShells(splitAsset).length, 1);
const splitGraph = splitAsset.topology.graph!;
for (const edgeId of split.edgeIds) {
  const halfEdge = splitGraph.halfEdges.find(edge => edge.edgeKey === edgeId);
  assert.ok(halfEdge, `Expected split edge '${edgeId}' in half-edge topology.`);
  assert.notEqual(halfEdge.pair, -1, 'Both halves of a shared split edge must remain paired across adjacent faces.');
}
assert.equal(staticMeshAssetAPI.getHistoryState(splitAsset.id).undoLabel, 'Split Construction Edge');
assert.equal(staticMeshAssetAPI.undo(splitAsset.id), true);
assert.equal(splitAsset.construction?.points.length, 4);
assert.equal(splitAsset.geometry.vertices.length / 3, 4);
assert.equal(splitAsset.geometry.indices.length / 3, 2);
assert.deepEqual(splitAsset.construction?.loops[0].pointIds, ['sA', 'sB', 'sC']);
assert.equal(staticMeshAssetAPI.redo(splitAsset.id), true);
assert.equal(splitAsset.construction?.points.length, 5);
assert.equal(splitAsset.geometry.vertices.length / 3, 5);
assert.equal(splitAsset.geometry.indices.length / 3, 4);

// Bevel Edge composes authored manifold topology without inventing raw ids.
// A vertical box edge has two side faces plus one endpoint face at each end;
// beveling it should replace the edge with one quad chamfer, update the top loop,
// compact the two orphan render vertices, and remain one Mesh Shell.
const bevelAsset = staticMeshAssetAPI.create({ name: 'Construction API Bevel Edge Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: bevelAsset.id,
  points: [
    { id: 'bA', position: { x: -2, y: 0, z: -2 } },
    { id: 'bD', position: { x: -2, y: 0, z: 2 } },
    { id: 'bC', position: { x: 2, y: 0, z: 2 } },
    { id: 'bB', position: { x: 2, y: 0, z: -2 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: bevelAsset.id,
  id: 'face:bevel-base',
  pointIds: ['bA', 'bD', 'bC', 'bB'],
});
const bevelBox = staticMeshAssetAPI.extrudeFace({
  assetId: bevelAsset.id,
  faceId: 'face:bevel-base',
  id: 'extrude:bevel-test',
  distance: 2,
});
// Face Extrude intentionally leaves the original boundary open. The bevel
// regression needs a closed box, so the fixture/test adds an explicit bottom
// cap rather than relying on Extrude to create an internal/source cap.
staticMeshAssetAPI.createFaceFromPoints({
  assetId: bevelAsset.id,
  id: 'face:bevel-bottom',
  pointIds: ['bB', 'bC', 'bD', 'bA'],
});
assetHistory.clear(bevelAsset.id);
const bevelTopA = bevelBox.topPointIds[0];
assert.throws(
  () => staticMeshAssetAPI.bevelEdge({
    assetId: bevelAsset.id,
    pointAId: 'bA',
    pointBId: bevelTopA,
    width: 5,
  }),
  /too large/,
  'Bevel Edge must reject widths that run past a neighboring edge.',
);
assert.equal(staticMeshAssetAPI.getHistoryState(bevelAsset.id).canUndo, false, 'Rejected Bevel Edge must not create history.');
const bevel = staticMeshAssetAPI.bevelEdge({
  assetId: bevelAsset.id,
  pointAId: 'bA',
  pointBId: bevelTopA,
  width: 0.25,
  id: 'bevel:vertical',
});
assert.equal(bevel.sidePointIds.length, 2);
assert.equal(bevel.updatedFaceIds.length, 4, 'One cube edge bevel must update its two side faces plus top/bottom endpoint faces.');
assert.equal(bevelAsset.construction?.faces.length, 7);
assert.equal(bevelAsset.topology.faces.length, 7);
assert.equal(bevelAsset.construction?.points.length, 12, 'Bevel keeps source semantic points and adds four offset planning points.');
assert.equal(bevelAsset.geometry.vertices.length / 3, 10, 'Two unused source render vertices must be compacted after adding four bevel vertices.');
assert.equal(bevelAsset.geometry.indices.length / 3, 16);
assert.equal(resolveStaticMeshShells(bevelAsset).length, 1);
assert.deepEqual(staticMeshAssetAPI.getPoint(bevelAsset.id, 'bA')?.vertexIds, [], 'Original bevel endpoints stay semantic but no longer own orphan render vertices.');
assert.deepEqual(staticMeshAssetAPI.getPoint(bevelAsset.id, bevelTopA)?.vertexIds, []);
const bevelTopLoop = bevelAsset.construction?.loops.find(loop => loop.id === bevelBox.topLoopId);
assert.ok(bevelTopLoop);
assert.equal(bevelTopLoop.pointIds.length, 5, 'The generated top Construction Loop must follow the beveled corner.');
assert.equal(bevelTopLoop.pointIds.includes(bevelTopA), false, 'The removed top endpoint must leave the top loop boundary.');
const bevelFace = bevelAsset.construction?.faces.find(face => face.id === bevel.bevelFaceId);
assert.ok(bevelFace);
assert.equal(bevelFace.faceId, bevel.bevelLogicalFaceId);
const bevelGraph = bevelAsset.topology.graph!;
const bevelFaceVertexIds = bevelFace.pointIds.map(pointId => staticMeshAssetAPI.getPoint(bevelAsset.id, pointId)!.vertexIds![0]);
for (let i = 0; i < bevelFaceVertexIds.length; i += 1) {
  const edgeId = `${Math.min(bevelFaceVertexIds[i], bevelFaceVertexIds[(i + 1) % bevelFaceVertexIds.length])}-${Math.max(bevelFaceVertexIds[i], bevelFaceVertexIds[(i + 1) % bevelFaceVertexIds.length])}`;
  const halfEdge = bevelGraph.halfEdges.find(edge => edge.edgeKey === edgeId);
  assert.ok(halfEdge, `Expected bevel face edge '${edgeId}' in half-edge topology.`);
  assert.notEqual(halfEdge.pair, -1, 'Every bevel face edge on the closed box must pair with a neighboring face.');
}
assert.equal(staticMeshAssetAPI.getHistoryState(bevelAsset.id).undoLabel, 'Bevel Construction Edge');
assert.equal(staticMeshAssetAPI.undo(bevelAsset.id), true);
assert.equal(bevelAsset.construction?.faces.length, 6);
assert.equal(bevelAsset.geometry.vertices.length / 3, 8);
assert.equal(bevelAsset.geometry.indices.length / 3, 12);
assert.equal(staticMeshAssetAPI.redo(bevelAsset.id), true);
assert.equal(bevelAsset.construction?.faces.length, 7);
assert.equal(bevelAsset.geometry.vertices.length / 3, 10);
assert.equal(bevelAsset.geometry.indices.length / 3, 16);

// Higher-valence endpoint regression: split both end caps of one vertical box
// edge so each endpoint belongs to four authored faces. Bevel must resolve the
// local one-ring, add endpoint cap faces, and keep the closed manifold paired.
const bevelValenceAsset = staticMeshAssetAPI.create({ name: 'Construction API High Valence Bevel Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: bevelValenceAsset.id,
  points: [
    { id: 'vA', position: { x: -2, y: 0, z: -2 } },
    { id: 'vD', position: { x: -2, y: 0, z: 2 } },
    { id: 'vC', position: { x: 2, y: 0, z: 2 } },
    { id: 'vB', position: { x: 2, y: 0, z: -2 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: bevelValenceAsset.id,
  id: 'face:valence-top-source',
  pointIds: ['vA', 'vD', 'vC', 'vB'],
});
const valenceExtrusion = staticMeshAssetAPI.extrudeFace({
  assetId: bevelValenceAsset.id,
  faceId: 'face:valence-top-source',
  id: 'extrude:valence-box',
  distance: 2,
});
const [vATop, , vCTop] = valenceExtrusion.topPointIds;
// Two downward-wound bottom triangles make bottom endpoint vA valence 4.
staticMeshAssetAPI.createFaceFromPoints({
  assetId: bevelValenceAsset.id,
  id: 'face:valence-bottom-0',
  pointIds: ['vA', 'vB', 'vC'],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: bevelValenceAsset.id,
  id: 'face:valence-bottom-1',
  pointIds: ['vA', 'vC', 'vD'],
});
// Splitting the moved top quad across the same corner makes the top endpoint
// valence 4 as well, while preserving paired topology on the diagonal.
staticMeshAssetAPI.cutFace({
  assetId: bevelValenceAsset.id,
  faceId: valenceExtrusion.topFaceId,
  pointAId: vATop,
  pointBId: vCTop,
  id: 'cut:valence-top',
});
const endpointAValence = bevelValenceAsset.construction!.faces.filter(face => face.pointIds.includes('vA')).length;
const endpointBValence = bevelValenceAsset.construction!.faces.filter(face => face.pointIds.includes(vATop)).length;
assert.equal(endpointAValence, 4);
assert.equal(endpointBValence, 4);
assetHistory.clear(bevelValenceAsset.id);
const highValenceBevel = staticMeshAssetAPI.bevelEdge({
  assetId: bevelValenceAsset.id,
  pointAId: 'vA',
  pointBId: vATop,
  width: 0.25,
  id: 'bevel:valence4',
});
assert.equal(highValenceBevel.endpointCapFaceIds.length, 2, 'Valence-4 endpoints must receive one local cap face each.');
assert.equal(highValenceBevel.updatedFaceIds.length, 6, 'The two selected faces plus two endpoint faces at each end must be rewritten.');
assert.equal(bevelValenceAsset.construction?.faces.length, 11);
assert.equal(bevelValenceAsset.geometry.vertices.length / 3, 12);
assert.equal(resolveStaticMeshShells(bevelValenceAsset).length, 1);
assert.deepEqual(staticMeshAssetAPI.getPoint(bevelValenceAsset.id, 'vA')?.vertexIds, []);
assert.deepEqual(staticMeshAssetAPI.getPoint(bevelValenceAsset.id, vATop)?.vertexIds, []);
const highValenceGraph = bevelValenceAsset.topology.graph!;
assert.ok(
  highValenceGraph.halfEdges.every(edge => edge.pair !== -1),
  'A closed valence-4 box bevel must keep every half-edge paired.',
);
assert.equal(staticMeshAssetAPI.getHistoryState(bevelValenceAsset.id).undoLabel, 'Bevel Construction Edge');
assert.equal(staticMeshAssetAPI.undo(bevelValenceAsset.id), true);
assert.equal(bevelValenceAsset.construction?.faces.length, 8);
assert.equal(staticMeshAssetAPI.redo(bevelValenceAsset.id), true);
assert.equal(bevelValenceAsset.construction?.faces.length, 11);

// Cut Face composes with semantic boundary points: two existing non-adjacent
// points split one authored polygon into two faces that share the new diagonal.
// The source semantic/logical face stays stable and the operation is one Undo step.
const cutAsset = staticMeshAssetAPI.create({ name: 'Construction API Cut Face Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: cutAsset.id,
  points: [
    { id: 'cA', position: { x: 0, y: 0, z: 0 } },
    { id: 'cB', position: { x: 2, y: 0, z: 0 } },
    { id: 'cC', position: { x: 2, y: 2, z: 0 } },
    { id: 'cD', position: { x: 0, y: 2, z: 0 } },
  ],
});
const cutSource = staticMeshAssetAPI.createFaceFromPoints({
  assetId: cutAsset.id,
  id: 'face:cut-source',
  pointIds: ['cA', 'cB', 'cC', 'cD'],
});
assetHistory.clear(cutAsset.id);
const cutVertexA = staticMeshAssetAPI.getPoint(cutAsset.id, 'cA')!.vertexIds![0];
const cutVertexC = staticMeshAssetAPI.getPoint(cutAsset.id, 'cC')!.vertexIds![0];
assert.equal(staticMeshAssetAPI.getConstructionPointId(cutAsset.id, cutVertexA), 'cA');
assert.equal(staticMeshAssetAPI.getConstructionPointId(cutAsset.id, cutVertexC), 'cC');
assert.throws(
  () => staticMeshAssetAPI.cutFace({ assetId: cutAsset.id, faceId: cutSource.id, pointAId: 'cA', pointBId: 'cB' }),
  /non-adjacent/,
  'Cut Face must reject an existing boundary edge instead of creating a degenerate face.',
);
assert.equal(staticMeshAssetAPI.getHistoryState(cutAsset.id).canUndo, false, 'Rejected Cut Face must not create history.');
const cut = staticMeshAssetAPI.cutFace({
  assetId: cutAsset.id,
  faceId: cutSource.id,
  pointAId: 'cA',
  pointBId: 'cC',
  id: 'cut:diagonal',
});
assert.equal(cut.sourceFaceId, cutSource.id);
assert.equal(cutAsset.construction?.faces.length, 2);
assert.equal(cutAsset.topology.faces.length, 2);
assert.equal(cutAsset.geometry.vertices.length / 3, 4, 'Cut Face between existing points must not create extra vertices.');
assert.equal(cutAsset.geometry.indices.length / 3, 2);
assert.equal(resolveStaticMeshShells(cutAsset).length, 1);
assert.deepEqual(cutAsset.construction?.faces.find(face => face.id === cut.sourceFaceId)?.pointIds, ['cA', 'cB', 'cC']);
assert.deepEqual(cutAsset.construction?.faces.find(face => face.id === cut.newFaceId)?.pointIds, ['cC', 'cD', 'cA']);
const cutHalfEdge = cutAsset.topology.graph?.halfEdges.find(edge => edge.edgeKey === cut.cutEdgeId);
assert.ok(cutHalfEdge, 'Expected Cut Face to create the new shared diagonal edge.');
assert.notEqual(cutHalfEdge.pair, -1, 'The new Cut Face diagonal must pair across the two resulting faces.');
assert.equal(staticMeshAssetAPI.getHistoryState(cutAsset.id).undoLabel, 'Cut Construction Face');
assert.equal(staticMeshAssetAPI.undo(cutAsset.id), true);
assert.equal(cutAsset.construction?.faces.length, 1);
assert.equal(cutAsset.geometry.indices.length / 3, 2);
assert.equal(staticMeshAssetAPI.redo(cutAsset.id), true);
assert.equal(cutAsset.construction?.faces.length, 2);
assert.equal(cutAsset.topology.faces.length, 2);

// Mesh Shell connectivity is vertex-based, not edge-only. Two triangles that
// share one actual mesh vertex must resolve as one shell.
const sharedVertexAsset = staticMeshAssetAPI.create({ name: 'Shared Vertex Shell Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: sharedVertexAsset.id,
  points: [
    { id: 'shared', position: { x: 0, y: 0, z: 0 } },
    { id: 'leftA', position: { x: -1, y: 0, z: 0 } },
    { id: 'leftB', position: { x: 0, y: 1, z: 0 } },
    { id: 'rightA', position: { x: 1, y: 0, z: 0 } },
    { id: 'rightB', position: { x: 0, y: -1, z: 0 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: sharedVertexAsset.id,
  id: 'face:left',
  pointIds: ['shared', 'leftA', 'leftB'],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: sharedVertexAsset.id,
  id: 'face:right',
  pointIds: ['shared', 'rightA', 'rightB'],
});
assert.equal(
  resolveStaticMeshShells(sharedVertexAsset).length,
  1,
  'Faces sharing one actual/canonical vertex must belong to the same Mesh Shell.',
);

// Positional coincidence alone must not merge shells. These triangles touch at
// the same XYZ coordinate but use different Construction Points / mesh vertices.
const coincidentOnlyAsset = staticMeshAssetAPI.create({ name: 'Coincident Vertex Shell Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: coincidentOnlyAsset.id,
  points: [
    { id: 'a.sharedLike', position: { x: 0, y: 0, z: 0 } },
    { id: 'a1', position: { x: -1, y: 0, z: 0 } },
    { id: 'a2', position: { x: 0, y: 1, z: 0 } },
    { id: 'b.sharedLike', position: { x: 0, y: 0, z: 0 } },
    { id: 'b1', position: { x: 1, y: 0, z: 0 } },
    { id: 'b2', position: { x: 0, y: -1, z: 0 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: coincidentOnlyAsset.id,
  id: 'face:a',
  pointIds: ['a.sharedLike', 'a1', 'a2'],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: coincidentOnlyAsset.id,
  id: 'face:b',
  pointIds: ['b.sharedLike', 'b1', 'b2'],
});
assert.equal(
  resolveStaticMeshShells(coincidentOnlyAsset).length,
  2,
  'Faces with separate vertices at the same XYZ position must remain separate Mesh Shells.',
);

const storedFloor = assetManager.getAsset(floor.id) as StaticMeshAsset;
assert.equal(storedFloor.construction?.points.length, 8);
assert.equal(storedFloor.construction?.faces.length, 5);
assert.equal(storedFloor.construction?.loops.length, 1);


// Human/normal modeling intentionally invalidates optional semantic planning
// metadata rather than trying to keep a second topology identity synchronized.
// Undo restores the complete pre-edit asset, including that optional metadata.
const planningInvalidationAsset = staticMeshAssetAPI.create({ name: 'Normal Edit Invalidates Planning Metadata', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: planningInvalidationAsset.id,
  points: [
    { id: 'pA', position: { x: -1, y: 0, z: -1 } },
    { id: 'pD', position: { x: -1, y: 0, z: 1 } },
    { id: 'pC', position: { x: 1, y: 0, z: 1 } },
    { id: 'pB', position: { x: 1, y: 0, z: -1 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({ assetId: planningInvalidationAsset.id, id: 'face:planning', pointIds: ['pA', 'pD', 'pC', 'pB'] });
assetHistory.clear(planningInvalidationAsset.id);
assert.equal(planningInvalidationAsset.construction?.faces.length, 1);
staticMeshAssetAPI.insetFace({ assetId: planningInvalidationAsset.id, faceId: 0, ratio: 0.1 });
assert.equal(planningInvalidationAsset.construction, undefined, 'Normal human editing must drop stale optional planning metadata.');
assert.equal(staticMeshAssetAPI.undo(planningInvalidationAsset.id), true);
const restoredPlanningInvalidationAsset = assetManager.getAsset(planningInvalidationAsset.id) as StaticMeshAsset;
const planningMetadataRestored = restoredPlanningInvalidationAsset.construction?.faces.length === 1;
assert.equal(planningMetadataRestored, true, 'Undo must restore optional planning metadata from the pre-edit snapshot.');

// Manual browser-console fixtures are NORMAL logical meshes. The fixture helper
// may use legacy semantic builders internally, but Construction metadata must be
// stripped before the fixture is returned. Human modeling therefore exercises
// the same numeric LogicalMesh API as an imported/ordinary Static Mesh.
const panelFixture = createStaticMeshTestFixture('panel');
assert.equal(panelFixture.asset.construction, undefined);
assert.equal(panelFixture.asset.topology.faces.length, 1);
assert.equal(panelFixture.asset.geometry.vertices.length / 3, 4);
assert.equal(panelFixture.asset.geometry.indices.length / 3, 2);
assert.equal(panelFixture.primaryFaceId, 0);
assert.equal(staticMeshAssetAPI.getHistoryState(panelFixture.assetId).canUndo, false, 'Fixture setup must leave clean asset history.');

const panelNormalInset = staticMeshAssetAPI.insetFace({
  assetId: panelFixture.assetId,
  faceId: panelFixture.primaryFaceId!,
  ratio: 0.25,
});
assert.equal(panelNormalInset.innerFaceId, panelFixture.primaryFaceId);
assert.equal(panelFixture.asset.construction, undefined, 'Normal Inset must not persist semantic Construction metadata.');
assert.equal(panelFixture.asset.topology.faces.length, 5);
assert.equal(staticMeshAssetAPI.getHistoryState(panelFixture.assetId).undoLabel, 'Inset Face');
assert.equal(staticMeshAssetAPI.undo(panelFixture.assetId), true);
assert.equal(panelFixture.asset.topology.faces.length, 1);
assert.equal(panelFixture.asset.construction, undefined);
assert.equal(staticMeshAssetAPI.redo(panelFixture.assetId), true);
assert.equal(panelFixture.asset.topology.faces.length, 5);
assert.equal(panelFixture.asset.construction, undefined);

// Relative Inset regression. Each run starts from the same normal mesh fixture
// and exercises the PUBLIC numeric LogicalMesh API. Face 1 contains a collinear
// boundary vertex and face 2 is intentionally warped/non-planar.
const insetOrientationResults: Array<{ faceId: number; innerVertices: number }> = [];
for (const faceId of [0, 1, 2]) {
  const orientationFixture = createStaticMeshTestFixture('inset-orient');
  assert.equal(orientationFixture.asset.construction, undefined);
  const sourceVertexIds = [...orientationFixture.asset.topology.faces[faceId]];
  const sourcePositions = sourceVertexIds.map(vertexId => ({
    x: orientationFixture.asset.geometry.vertices[vertexId * 3],
    y: orientationFixture.asset.geometry.vertices[vertexId * 3 + 1],
    z: orientationFixture.asset.geometry.vertices[vertexId * 3 + 2],
  }));
  const center = sourcePositions.reduce((sum, position) => ({
    x: sum.x + position.x,
    y: sum.y + position.y,
    z: sum.z + position.z,
  }), { x: 0, y: 0, z: 0 });
  center.x /= sourcePositions.length;
  center.y /= sourcePositions.length;
  center.z /= sourcePositions.length;

  const ratio = 0.2;
  const result = staticMeshAssetAPI.insetFace({
    assetId: orientationFixture.assetId,
    faceId,
    ratio,
  });
  assert.equal(result.innerFaceId, faceId);
  assert.equal(orientationFixture.asset.construction, undefined);
  assert.equal(result.borderFaceIds.length, sourceVertexIds.length);
  assert.equal(result.innerVertexIds.length, sourceVertexIds.length);
  result.innerVertexIds.forEach((innerVertexId, index) => {
    const source = sourcePositions[index];
    const expected = {
      x: source.x + (center.x - source.x) * ratio,
      y: source.y + (center.y - source.y) * ratio,
      z: source.z + (center.z - source.z) * ratio,
    };
    assertNearlyEqual(orientationFixture.asset.geometry.vertices[innerVertexId * 3], expected.x, `Inset face ${faceId} inner X must follow center ratio.`);
    assertNearlyEqual(orientationFixture.asset.geometry.vertices[innerVertexId * 3 + 1], expected.y, `Inset face ${faceId} inner Y must follow center ratio.`);
    assertNearlyEqual(orientationFixture.asset.geometry.vertices[innerVertexId * 3 + 2], expected.z, `Inset face ${faceId} inner Z must follow center ratio.`);
  });
  insetOrientationResults.push({ faceId, innerVertices: result.innerVertexIds.length });
}

const normalDisplayFixture = createStaticMeshTestFixture('inset-orient');
const faceNormalLines = buildFaceNormalLines(
  normalDisplayFixture.asset.geometry.vertices,
  normalDisplayFixture.asset.topology.faces,
  0.5,
);
const vertexNormalLines = buildVertexNormalLines(
  normalDisplayFixture.asset.geometry.vertices,
  normalDisplayFixture.asset.geometry.normals,
  0.5,
);
assert.equal(faceNormalLines.length / 6, 3, 'Display overlay must create one normal line per logical face.');
assert.equal(
  vertexNormalLines.length / 6,
  normalDisplayFixture.asset.geometry.vertices.length / 3,
  'Display overlay must create one normal line per mesh vertex.',
);

const insetFixture = createStaticMeshTestFixture('inset');
assert.equal(assetManager.getAsset(panelFixture.assetId), undefined, 'Creating a new fixture must remove the previous TEST_StaticMesh_* asset.');
assert.equal(insetFixture.asset.construction, undefined);
assert.equal(insetFixture.asset.topology.faces.length, 5);
assert.equal(insetFixture.primaryFaceId, 0);
assert.equal(staticMeshAssetAPI.getHistoryState(insetFixture.assetId).canUndo, false);
const normalDeleteResult = staticMeshAssetAPI.deleteFace({
  assetId: insetFixture.assetId,
  faceId: insetFixture.primaryFaceId!,
});
assert.equal(normalDeleteResult.deletedFaceId, 0);
assert.equal(insetFixture.asset.construction, undefined, 'Normal Delete Face must not persist semantic metadata.');
assert.equal(insetFixture.asset.topology.faces.length, 4);
assert.equal(staticMeshAssetAPI.undo(insetFixture.assetId), true);
assert.equal(insetFixture.asset.topology.faces.length, 5);
assert.equal(clearStaticMeshTestFixtures(), 1);
assert.equal(assetManager.getAsset(insetFixture.assetId), undefined);

const splitFixture = createStaticMeshTestFixture('split');
assert.equal(splitFixture.asset.construction, undefined);
assert.equal(splitFixture.asset.topology.faces.length, 2);
assert.ok(splitFixture.primaryEdgeVertexIds);
assert.equal(splitFixture.asset.geometry.vertices.length / 3, 4);
assert.equal(splitFixture.asset.geometry.indices.length / 3, 2);
assert.equal(staticMeshAssetAPI.getHistoryState(splitFixture.assetId).canUndo, false);
const normalSplitResult = staticMeshAssetAPI.splitEdge({
  assetId: splitFixture.assetId,
  vertexAId: splitFixture.primaryEdgeVertexIds![0],
  vertexBId: splitFixture.primaryEdgeVertexIds![1],
  t: 0.5,
});
assert.equal(normalSplitResult.updatedFaceIds.length, 2);
assert.equal(splitFixture.asset.geometry.vertices.length / 3, 5);
assert.equal(splitFixture.asset.geometry.indices.length / 3, 4);
assert.equal(splitFixture.asset.construction, undefined, 'Normal Split Edge must not persist semantic metadata.');
assert.equal(clearStaticMeshTestFixtures(), 1);
assert.equal(assetManager.getAsset(splitFixture.assetId), undefined);

const cutFixture = createStaticMeshTestFixture('cut');
assert.equal(cutFixture.asset.construction, undefined);
assert.ok(cutFixture.primaryCutVertexIds);
assert.equal(cutFixture.asset.topology.faces.length, 1);
assert.equal(cutFixture.asset.geometry.vertices.length / 3, 4);
assert.equal(cutFixture.asset.geometry.indices.length / 3, 2);
assert.equal(staticMeshAssetAPI.getHistoryState(cutFixture.assetId).canUndo, false);
const normalCutResult = staticMeshAssetAPI.cutFace({
  assetId: cutFixture.assetId,
  faceId: cutFixture.primaryFaceId!,
  vertexAId: cutFixture.primaryCutVertexIds![0],
  vertexBId: cutFixture.primaryCutVertexIds![1],
});
assert.equal(cutFixture.asset.topology.faces.length, 2);
assert.equal(cutFixture.asset.construction, undefined, 'Normal Cut Face must not persist semantic metadata.');
assert.ok(cutFixture.asset.topology.graph?.halfEdges.some(edge => edge.pair !== -1));
assert.equal(clearStaticMeshTestFixtures(), 1);
assert.equal(assetManager.getAsset(cutFixture.assetId), undefined);

const boxFixture = createStaticMeshTestFixture('box');
assert.equal(boxFixture.asset.construction, undefined);
assert.equal(boxFixture.asset.topology.faces.length, 6, 'Closed box fixture must contain six normal logical faces.');
assert.equal(boxFixture.asset.geometry.vertices.length / 3, 8);
assert.equal(boxFixture.asset.geometry.indices.length / 3, 12);
assert.equal(staticMeshAssetAPI.getHistoryState(boxFixture.assetId).canUndo, false);
const secondBoxExtrusion = staticMeshAssetAPI.extrudeFace({
  assetId: boxFixture.assetId,
  faceId: boxFixture.primaryFaceId!,
  distance: 1,
});
assert.equal(secondBoxExtrusion.topFaceId, boxFixture.primaryFaceId, 'Repeated normal face extrusion must keep the same logical top-face id.');
assert.equal(boxFixture.asset.topology.faces.length, 10, 'Extruding one quad on a closed box must add only four side faces, not an internal source cap.');
assert.equal(boxFixture.asset.geometry.indices.length / 3, 20);
assert.equal(boxFixture.asset.construction, undefined, 'Normal Extrude must not persist semantic metadata.');
assert.ok(boxFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Extruding a manifold box face must keep the resulting shell manifold.');
assert.equal(clearStaticMeshTestFixtures(), 1);
assert.equal(assetManager.getAsset(boxFixture.assetId), undefined);

const bevelFixture = createStaticMeshTestFixture('bevel');
assert.equal(bevelFixture.asset.construction, undefined);
assert.equal(bevelFixture.asset.topology.faces.length, 6);
assert.equal(bevelFixture.asset.geometry.vertices.length / 3, 8);
assert.ok(bevelFixture.primaryEdgeVertexIds);
assert.equal(staticMeshAssetAPI.getHistoryState(bevelFixture.assetId).canUndo, false);
const normalBevelResult = staticMeshAssetAPI.bevelEdge({
  assetId: bevelFixture.assetId,
  vertexAId: bevelFixture.primaryEdgeVertexIds![0],
  vertexBId: bevelFixture.primaryEdgeVertexIds![1],
  width: 0.25,
});
assert.equal(normalBevelResult.bevelFaceId >= 0, true);
assert.equal(bevelFixture.asset.construction, undefined, 'Normal Bevel must not persist semantic metadata.');
assert.equal(bevelFixture.asset.topology.faces.length, 7);
assert.equal(resolveStaticMeshShells(bevelFixture.asset).length, 1);
assert.equal(clearStaticMeshTestFixtures(), 1);
assert.equal(assetManager.getAsset(bevelFixture.assetId), undefined);

// Segmented bevel regression: Segments is the number of polygon strips across
// the profile, so a five-segment bevel creates five edge faces and six
// longitudinal profile rails. Profile 0.5 follows Blender's circular default.
const segmentedBevelFixture = createStaticMeshTestFixture('bevel');
assert.ok(segmentedBevelFixture.primaryEdgeVertexIds);
const segmentedBevel = staticMeshAssetAPI.bevelEdge({
  assetId: segmentedBevelFixture.assetId,
  vertexAId: segmentedBevelFixture.primaryEdgeVertexIds![0],
  vertexBId: segmentedBevelFixture.primaryEdgeVertexIds![1],
  width: 0.25,
  segments: 5,
  profile: 0.5,
});
assert.equal(segmentedBevel.segments, 5);
assert.equal(segmentedBevel.profile, 0.5);
assert.equal(segmentedBevel.bevelFaceIds.length, 5, 'Segments=5 must create five bevel strip faces for one source edge.');
assert.equal(segmentedBevel.profileEdgeIds.length, 6, 'Segments=5 must create six longitudinal profile rails.');
assert.equal(segmentedBevelFixture.asset.topology.faces.length, 11, 'A six-face box plus five bevel strips must have eleven logical faces.');
assert.equal(resolveStaticMeshShells(segmentedBevelFixture.asset).length, 1);
assert.ok(segmentedBevelFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Segmented bevel must keep the closed box manifold.');
assert.equal(staticMeshAssetAPI.getHistoryState(segmentedBevelFixture.assetId).undoLabel, 'Bevel Edge');
assert.equal(staticMeshAssetAPI.undo(segmentedBevelFixture.assetId), true);
assert.equal(segmentedBevelFixture.asset.topology.faces.length, 6);
assert.equal(staticMeshAssetAPI.redo(segmentedBevelFixture.assetId), true);
assert.equal(segmentedBevelFixture.asset.topology.faces.length, 11);
assert.equal(clearStaticMeshTestFixtures(), 1);
assert.equal(assetManager.getAsset(segmentedBevelFixture.assetId), undefined);

// Blender-style terminal profile-plane regression. On a skewed prism the
// selected edge is slanted, but each segmented profile row must terminate in
// the endpoint-face plane. Without the move_profile_plane-equivalent projection
// the interior profile samples bow away from y=0 / y=2 even though the two
// boundary rails themselves are correct.
const terminalProfilePlaneAsset = staticMeshAssetAPI.create({ name: 'Terminal Profile Plane Bevel Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: terminalProfilePlaneAsset.id,
  points: [
    { id: 'tp.a', position: { x: -1, y: 0, z: -1 } },
    { id: 'tp.b', position: { x: 1, y: 0, z: -1 } },
    { id: 'tp.c', position: { x: 1, y: 0, z: 1 } },
    { id: 'tp.d', position: { x: -1, y: 0, z: 1 } },
    { id: 'tp.A', position: { x: -0.2, y: 2, z: -0.7 } },
    { id: 'tp.B', position: { x: 1.8, y: 2, z: -0.7 } },
    { id: 'tp.C', position: { x: 1.8, y: 2, z: 1.3 } },
    { id: 'tp.D', position: { x: -0.2, y: 2, z: 1.3 } },
  ],
});
for (const [id, pointIds] of [
  ['face:tp.bottom', ['tp.a', 'tp.d', 'tp.c', 'tp.b']],
  ['face:tp.top', ['tp.A', 'tp.B', 'tp.C', 'tp.D']],
  ['face:tp.front', ['tp.a', 'tp.b', 'tp.B', 'tp.A']],
  ['face:tp.right', ['tp.b', 'tp.c', 'tp.C', 'tp.B']],
  ['face:tp.back', ['tp.c', 'tp.d', 'tp.D', 'tp.C']],
  ['face:tp.left', ['tp.d', 'tp.a', 'tp.A', 'tp.D']],
] as const) {
  staticMeshAssetAPI.createFaceFromPoints({ assetId: terminalProfilePlaneAsset.id, id, pointIds: [...pointIds] });
}
const terminalProfilePlaneA = staticMeshAssetAPI.getPoint(terminalProfilePlaneAsset.id, 'tp.a')!.vertexIds![0];
const terminalProfilePlaneB = staticMeshAssetAPI.getPoint(terminalProfilePlaneAsset.id, 'tp.A')!.vertexIds![0];
assetManager.updateAsset(terminalProfilePlaneAsset.id, { construction: undefined });
assetHistory.clear(terminalProfilePlaneAsset.id);
const terminalProfilePlaneBevel = staticMeshAssetAPI.bevelEdge({
  assetId: terminalProfilePlaneAsset.id,
  vertexAId: terminalProfilePlaneA,
  vertexBId: terminalProfilePlaneB,
  width: 0.25,
  segments: 5,
  profile: 0.5,
});
let terminalProfilePlaneMaxError = 0;
for (const profileEdgeId of terminalProfilePlaneBevel.profileEdgeIds) {
  const pair = meshEdgePairFromKey(profileEdgeId);
  assert.ok(pair, `Segmented bevel profile rail '${profileEdgeId}' must decode to a mesh edge.`);
  const yValues = pair!.map(vertexId => terminalProfilePlaneAsset.geometry.vertices[vertexId * 3 + 1]).sort((a, b) => a - b);
  terminalProfilePlaneMaxError = Math.max(
    terminalProfilePlaneMaxError,
    Math.abs(yValues[0] - 0),
    Math.abs(yValues[1] - 2),
  );
}
assert.ok(terminalProfilePlaneMaxError <= 1e-6, 'Every segmented terminal profile station must remain in its endpoint-face plane.');
assert.equal(resolveStaticMeshShells(terminalProfilePlaneAsset).length, 1);
assert.ok(terminalProfilePlaneAsset.topology.graph?.halfEdges.every(edge => edge.pair !== -1));
assetManager.deleteAsset(terminalProfilePlaneAsset.id);

const bevelValenceFixture = createStaticMeshTestFixture('bevel-valence');
assert.equal(bevelValenceFixture.asset.construction, undefined);
assert.equal(bevelValenceFixture.asset.topology.faces.length, 8);
assert.equal(bevelValenceFixture.asset.geometry.vertices.length / 3, 8);
assert.ok(bevelValenceFixture.primaryEdgeVertexIds);
const bevelValenceFixtureA = bevelValenceFixture.primaryEdgeVertexIds![0];
const bevelValenceFixtureB = bevelValenceFixture.primaryEdgeVertexIds![1];
const normalEndpointAValence = bevelValenceFixture.asset.topology.faces.filter(face => face.includes(bevelValenceFixtureA)).length;
const normalEndpointBValence = bevelValenceFixture.asset.topology.faces.filter(face => face.includes(bevelValenceFixtureB)).length;
assert.equal(normalEndpointAValence, 4);
assert.equal(normalEndpointBValence, 4);
const normalHighValenceBevel = staticMeshAssetAPI.bevelEdge({
  assetId: bevelValenceFixture.assetId,
  vertexAId: bevelValenceFixtureA,
  vertexBId: bevelValenceFixtureB,
  width: 0.2,
});
assert.equal(normalHighValenceBevel.endpointCapFaceIds.length, 2);
assert.equal(bevelValenceFixture.asset.construction, undefined);
assert.ok(bevelValenceFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1));
assert.equal(clearStaticMeshTestFixtures(), 1);
assert.equal(assetManager.getAsset(bevelValenceFixture.assetId), undefined);

// Blender terminal-edge regression: the selected edge endpoints do not need
// matching incident-edge counts. A has only two total connected edges (AB, AC)
// while B has three (BA, BX, BY). The two non-planar n-gons share AB/AC, so AB
// still has exactly two incident faces. Blender's edgecount==2 terminal branch
// creates two face-side points plus one artificial point on AC instead of
// collapsing both sides to the same neighbor point.
const asymmetricTerminalAsset = staticMeshAssetAPI.create({ name: 'Asymmetric 2-to-3 Bevel Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: asymmetricTerminalAsset.id,
  points: [
    { id: 'atA', position: { x: 0, y: 0, z: 0 } },
    { id: 'atB', position: { x: 2, y: 0, z: 0 } },
    { id: 'atC', position: { x: 0, y: 2, z: 0 } },
    { id: 'atX', position: { x: 2, y: 2, z: 1 } },
    { id: 'atY', position: { x: 2, y: 2, z: -1 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: asymmetricTerminalAsset.id,
  id: 'face:at.forward',
  pointIds: ['atA', 'atB', 'atX', 'atC'],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: asymmetricTerminalAsset.id,
  id: 'face:at.reverse',
  pointIds: ['atB', 'atA', 'atC', 'atY'],
});
const atA = staticMeshAssetAPI.getPoint(asymmetricTerminalAsset.id, 'atA')!.vertexIds![0];
const atB = staticMeshAssetAPI.getPoint(asymmetricTerminalAsset.id, 'atB')!.vertexIds![0];
assetManager.updateAsset(asymmetricTerminalAsset.id, { construction: undefined });
assetHistory.clear(asymmetricTerminalAsset.id);
const logicalVertexDegree = (asset: StaticMeshAsset, vertexId: number): number => {
  const neighbors = new Set<number>();
  for (const face of asset.topology.faces) {
    const index = face.indexOf(vertexId);
    if (index < 0) continue;
    neighbors.add(face[(index - 1 + face.length) % face.length]);
    neighbors.add(face[(index + 1) % face.length]);
  }
  return neighbors.size;
};
const atADegree = logicalVertexDegree(asymmetricTerminalAsset, atA);
const atBDegree = logicalVertexDegree(asymmetricTerminalAsset, atB);
assert.equal(atADegree, 2);
assert.equal(atBDegree, 3);
const asymmetricTerminalBevel = staticMeshAssetAPI.bevelEdges({
  assetId: asymmetricTerminalAsset.id,
  edges: [{ vertexAId: atA, vertexBId: atB }],
  width: 0.2,
});
assert.equal(asymmetricTerminalBevel.results.length, 1);
assert.equal(asymmetricTerminalBevel.endpointCapFaceIds.length, 1, 'The valence-2 endpoint needs Blender-style terminal triangle patch.');
assert.equal(asymmetricTerminalAsset.topology.faces.length, 4, '2 reconstructed faces + bevel strip + terminal triangle.');
assert.equal(resolveStaticMeshShells(asymmetricTerminalAsset).length, 1);
assert.equal(asymmetricTerminalAsset.construction, undefined);
assert.equal(staticMeshAssetAPI.getHistoryState(asymmetricTerminalAsset.id).undoLabel, 'Bevel Edge');
assetManager.deleteAsset(asymmetricTerminalAsset.id);

// Blender face-chain regression: the selected edge itself is manifold (two
// faces), but both touched vertices live on OPEN one-rings. At B the face fan
// continues past one side of the selected edge, so this is not the old simple
// two-face boundary endpoint. Blender orders the one-face boundary edges as
// the ends of one face chain and bevels the terminal edge inside that chain.
const openTerminalFanAsset = staticMeshAssetAPI.create({ name: 'Open Terminal Face Fan Bevel Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: openTerminalFanAsset.id,
  points: [
    { id: 'ofA', position: { x: 0, y: 0, z: 0 } },
    { id: 'ofB', position: { x: 2, y: 0, z: 0 } },
    { id: 'ofX', position: { x: 0.2, y: 1.2, z: 0.2 } },
    { id: 'ofY', position: { x: 1.8, y: 1.1, z: -0.25 } },
    { id: 'ofZ', position: { x: 2.7, y: 1.5, z: -0.1 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: openTerminalFanAsset.id,
  id: 'face:open-fan-0',
  pointIds: ['ofA', 'ofB', 'ofX'],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: openTerminalFanAsset.id,
  id: 'face:open-fan-1',
  pointIds: ['ofB', 'ofA', 'ofY'],
});
staticMeshAssetAPI.createFaceFromPoints({
  assetId: openTerminalFanAsset.id,
  id: 'face:open-fan-2',
  pointIds: ['ofB', 'ofY', 'ofZ'],
});
const openFanA = staticMeshAssetAPI.getPoint(openTerminalFanAsset.id, 'ofA')!.vertexIds![0];
const openFanB = staticMeshAssetAPI.getPoint(openTerminalFanAsset.id, 'ofB')!.vertexIds![0];
assetManager.updateAsset(openTerminalFanAsset.id, { construction: undefined });
assetHistory.clear(openTerminalFanAsset.id);
const openTerminalFanBevel = staticMeshAssetAPI.bevelEdges({
  assetId: openTerminalFanAsset.id,
  edges: [{ vertexAId: openFanA, vertexBId: openFanB }],
  width: 0.15,
});
assert.equal(openTerminalFanBevel.results.length, 1);
assert.equal(openTerminalFanBevel.cornerFaceIds.length, 1, 'The richer open endpoint should receive one terminal polygon patch.');
assert.equal(openTerminalFanAsset.topology.faces.length, 5, '3 reconstructed source faces + bevel strip + open-fan corner patch.');
assert.equal(resolveStaticMeshShells(openTerminalFanAsset).length, 1, 'Open terminal fan must remain one connected Mesh Shell.');
assert.ok(
  openTerminalFanAsset.topology.graph?.halfEdges.some(edge => edge.pair === -1),
  'The test fixture intentionally remains an open surface after beveling.',
);
const openTerminalFanFaceCount = openTerminalFanAsset.topology.faces.length;
assetManager.deleteAsset(openTerminalFanAsset.id);

// Blender M_NONE regression for the common open-box rim: one selected vertical
// edge has two incident side faces, while its top endpoint is an open degree-3
// face chain (there is no top face). Segments must subdivide the bevel strip but
// must NOT turn the two-point terminal boundary into a synthetic cap polygon.
// The profile samples at the top simply form part of the intentional open rim.
const openRimNoCapAsset = staticMeshAssetAPI.create({ name: 'Open Rim M_NONE Bevel Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: openRimNoCapAsset.id,
  points: [
    { id: 'or.a', position: { x: 0, y: 0, z: 0 } },
    { id: 'or.b', position: { x: 2, y: 0, z: 0 } },
    { id: 'or.c', position: { x: 2, y: 0, z: 2 } },
    { id: 'or.d', position: { x: 0, y: 0, z: 2 } },
    { id: 'or.e', position: { x: 0, y: 2, z: 0 } },
    { id: 'or.f', position: { x: 2, y: 2, z: 0 } },
    { id: 'or.g', position: { x: 2, y: 2, z: 2 } },
    { id: 'or.h', position: { x: 0, y: 2, z: 2 } },
  ],
});
for (const [id, pointIds] of [
  ['face:or.bottom', ['or.a', 'or.d', 'or.c', 'or.b']],
  ['face:or.front', ['or.a', 'or.b', 'or.f', 'or.e']],
  ['face:or.right', ['or.b', 'or.c', 'or.g', 'or.f']],
  ['face:or.back', ['or.d', 'or.h', 'or.g', 'or.c']],
  ['face:or.left', ['or.a', 'or.e', 'or.h', 'or.d']],
] as const) {
  staticMeshAssetAPI.createFaceFromPoints({ assetId: openRimNoCapAsset.id, id, pointIds: [...pointIds] });
}
const openRimBottom = staticMeshAssetAPI.getPoint(openRimNoCapAsset.id, 'or.a')!.vertexIds![0];
const openRimTop = staticMeshAssetAPI.getPoint(openRimNoCapAsset.id, 'or.e')!.vertexIds![0];
assetManager.updateAsset(openRimNoCapAsset.id, { construction: undefined });
assetHistory.clear(openRimNoCapAsset.id);
const openRimNoCapBevel = staticMeshAssetAPI.bevelEdges({
  assetId: openRimNoCapAsset.id,
  edges: [{ vertexAId: openRimBottom, vertexBId: openRimTop }],
  width: 0.2,
  segments: 5,
  profile: 0.5,
});
assert.equal(openRimNoCapBevel.bevelFaceIds.length, 5, 'Segments=5 should create five longitudinal bevel strips.');
assert.equal(openRimNoCapBevel.cornerFaceIds.length, 0, 'A two-boundary-point M_NONE terminal must not gain a cap when profile samples are added.');
assert.equal(openRimNoCapAsset.topology.faces.length, 10, '5 reconstructed source faces + 5 profile strips; no terminal corner face.');
assert.equal(resolveStaticMeshShells(openRimNoCapAsset).length, 1, 'Open-rim bevel must remain one connected Mesh Shell.');
assert.ok(
  openRimNoCapAsset.topology.graph?.halfEdges.some(edge => edge.pair === -1),
  'The open box rim must remain an intentional mesh boundary after beveling.',
);
const openRimNoCapFaceCount = openRimNoCapAsset.topology.faces.length;
assetManager.deleteAsset(openRimNoCapAsset.id);

// Blender M_TRI_FAN regression: a single selected edge reaches a terminal
// vertex with three effective VMesh boundary verts (two profile sides plus one
// extra point on a non-adjacent unselected edge). With Segments > 1 Blender
// materializes a triangle fan, so every intermediate profile sample gets a
// real radial edge to the terminal apex. A single n-gon cap is topologically
// valid but visibly wrong because those authored fan edges are missing.
const segmentedTerminalTriFanAsset = staticMeshAssetAPI.create({ name: 'Segmented Terminal TRI_FAN Bevel Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: segmentedTerminalTriFanAsset.id,
  points: [
    { id: 'tf.a', position: { x: 0, y: 0, z: 0 } },
    { id: 'tf.b', position: { x: 2, y: 0, z: 0 } },
    { id: 'tf.u1', position: { x: 0, y: 1, z: 0 } },
    { id: 'tf.u2', position: { x: 0, y: 1, z: 1 } },
    { id: 'tf.u3', position: { x: 0, y: 0, z: 1 } },
  ],
});
for (const [id, pointIds] of [
  ['face:tf.0', ['tf.a', 'tf.b', 'tf.u1']],
  ['face:tf.1', ['tf.a', 'tf.u1', 'tf.u2']],
  ['face:tf.2', ['tf.a', 'tf.u2', 'tf.u3']],
  ['face:tf.3', ['tf.b', 'tf.a', 'tf.u3']],
] as const) {
  staticMeshAssetAPI.createFaceFromPoints({ assetId: segmentedTerminalTriFanAsset.id, id, pointIds: [...pointIds] });
}
const triFanA = staticMeshAssetAPI.getPoint(segmentedTerminalTriFanAsset.id, 'tf.a')!.vertexIds![0];
const triFanB = staticMeshAssetAPI.getPoint(segmentedTerminalTriFanAsset.id, 'tf.b')!.vertexIds![0];
assetManager.updateAsset(segmentedTerminalTriFanAsset.id, { construction: undefined });
assetHistory.clear(segmentedTerminalTriFanAsset.id);
const segmentedTerminalTriFanBevel = staticMeshAssetAPI.bevelEdges({
  assetId: segmentedTerminalTriFanAsset.id,
  edges: [{ vertexAId: triFanA, vertexBId: triFanB }],
  width: 0.2,
  segments: 3,
  profile: 0.5,
});
assert.equal(segmentedTerminalTriFanBevel.bevelFaceIds.length, 3, 'Segments=3 should create three longitudinal bevel strips.');
assert.equal(segmentedTerminalTriFanBevel.cornerFaceIds.length, 3, 'A three-boundary terminal with Segments=3 must create three TRI_FAN faces.');
assert.equal(segmentedTerminalTriFanBevel.endpointCapFaceIds.length, 3, 'All terminal fan triangles must be exposed as endpoint cap faces.');
const triFanFaces = segmentedTerminalTriFanBevel.cornerFaceIds.map(faceId => segmentedTerminalTriFanAsset.topology.faces[faceId]);
assert.ok(triFanFaces.every(face => face.length === 3), 'Segmented terminal TRI_FAN must materialize authored triangles, not one n-gon cap.');
const commonTriFanVertices = triFanFaces[0].filter(vertexId => triFanFaces.every(face => face.includes(vertexId)));
assert.equal(commonTriFanVertices.length, 1, 'All terminal TRI_FAN triangles must share exactly one fan apex.');
assert.equal(segmentedTerminalTriFanAsset.topology.faces.length, 10, '4 reconstructed source faces + 3 bevel strips + 3 terminal fan triangles.');
assert.equal(resolveStaticMeshShells(segmentedTerminalTriFanAsset).length, 1, 'Segmented terminal fan must remain one connected Mesh Shell.');
const segmentedTerminalTriFanFaceCount = segmentedTerminalTriFanBevel.cornerFaceIds.length;
assetManager.deleteAsset(segmentedTerminalTriFanAsset.id);

const extrudeNormalFixture = createStaticMeshTestFixture('extrude-normal');
assert.equal(extrudeNormalFixture.asset.construction, undefined);
assert.equal(extrudeNormalFixture.asset.topology.faces.length, 1);
assert.equal(extrudeNormalFixture.asset.geometry.vertices.length / 3, 4);
assert.equal(extrudeNormalFixture.primaryFaceId, 0);
assert.equal(staticMeshAssetAPI.getHistoryState(extrudeNormalFixture.assetId).canUndo, false);
const normalFaceBoundaryBefore = [...extrudeNormalFixture.asset.topology.faces[extrudeNormalFixture.primaryFaceId!]];
const normalFacePositionsBefore = normalFaceBoundaryBefore.map(vertexId => ({
  x: extrudeNormalFixture.asset.geometry.vertices[vertexId * 3],
  y: extrudeNormalFixture.asset.geometry.vertices[vertexId * 3 + 1],
  z: extrudeNormalFixture.asset.geometry.vertices[vertexId * 3 + 2],
}));
const normalFixtureExtrusionDistance = 1.5;
const normalFixtureExtrusion = staticMeshAssetAPI.extrudeFace({
  assetId: extrudeNormalFixture.assetId,
  faceId: extrudeNormalFixture.primaryFaceId!,
  distance: normalFixtureExtrusionDistance,
});
normalFixtureExtrusion.topVertexIds.forEach((vertexId, index) => {
  const source = normalFacePositionsBefore[index];
  assertNearlyEqual(extrudeNormalFixture.asset.geometry.vertices[vertexId * 3] - source.x, 0, 'Normal-mesh Extrude X offset must follow face normal.');
  assertNearlyEqual(extrudeNormalFixture.asset.geometry.vertices[vertexId * 3 + 1] - source.y, invSqrt2 * normalFixtureExtrusionDistance, 'Normal-mesh Extrude Y offset must follow face normal.');
  assertNearlyEqual(extrudeNormalFixture.asset.geometry.vertices[vertexId * 3 + 2] - source.z, -invSqrt2 * normalFixtureExtrusionDistance, 'Normal-mesh Extrude Z offset must follow face normal.');
});
assert.equal(extrudeNormalFixture.asset.construction, undefined);
assert.equal(clearStaticMeshTestFixtures(), 1);
assert.equal(assetManager.getAsset(extrudeNormalFixture.assetId), undefined);

const ringFixture = createStaticMeshTestFixture('ring');
assert.equal(ringFixture.asset.construction, undefined);
assert.equal(ringFixture.asset.topology.faces.length, 4);
assert.equal(ringFixture.asset.geometry.vertices.length / 3, 10);
assert.ok(ringFixture.primaryEdgeVertexIds);
const [ringB2, ringT2] = ringFixture.primaryEdgeVertexIds!;
const ringFaceInfo = staticMeshAssetAPI.getFaceInfo(ringFixture.assetId, 1);
assert.ok(ringFaceInfo);
assert.equal(ringFaceInfo.kind, 'QUAD');
assert.equal(ringFaceInfo.edges.length, 4);
assert.equal(staticMeshAssetAPI.isQuadFace(ringFixture.assetId, 1), true);
assert.deepEqual(staticMeshAssetAPI.getEdgeFaceIds({
  assetId: ringFixture.assetId,
  vertexAId: ringB2,
  vertexBId: ringT2,
}), [1, 2]);
assert.deepEqual(staticMeshAssetAPI.getAdjacentFacesAcrossEdge({
  assetId: ringFixture.assetId,
  faceId: 1,
  vertexAId: ringB2,
  vertexBId: ringT2,
}), [2]);
assert.equal(staticMeshAssetAPI.getAdjacentFaceAcrossEdge({
  assetId: ringFixture.assetId,
  faceId: 1,
  vertexAId: ringB2,
  vertexBId: ringT2,
}), 2);
const opposite = staticMeshAssetAPI.getOppositeEdge({
  assetId: ringFixture.assetId,
  faceId: 1,
  vertexAId: ringB2,
  vertexBId: ringT2,
});
assert.ok(opposite);
assert.notDeepEqual(new Set(opposite.oppositeEdge.vertexIds), new Set([ringB2, ringT2]));
const ringTrace = staticMeshAssetAPI.traceEdgeRing({
  assetId: ringFixture.assetId,
  vertexAId: ringB2,
  vertexBId: ringT2,
});
assert.equal(ringTrace.edgeIds.length, 5, 'Four connected quads must expose all five cross-strip ring edges.');
assert.deepEqual(new Set(ringTrace.faceIds), new Set([0, 1, 2, 3]));
assert.equal(ringTrace.closed, false);
assert.equal(ringTrace.startTermination, 'BOUNDARY');
assert.equal(ringTrace.endTermination, 'BOUNDARY');
const faceStripTrace = staticMeshAssetAPI.traceFaceStrip({
  assetId: ringFixture.assetId,
  vertexAId: ringB2,
  vertexBId: ringT2,
});
assert.deepEqual(faceStripTrace.faceIds, ringTrace.faceIds);
assert.equal(staticMeshAssetAPI.getHistoryState(ringFixture.assetId).canUndo, false, 'Read-only topology queries must not create history.');

// Face-mode fill highlighting must follow logical-face identity rather than
// treating render triangles as independent selectable faces. Two logical quads
// in the ring fixture therefore resolve to four render triangles.
const highlightedRingFaces = buildMeshFaceTriangleIndices(
  ringFixture.asset.geometry.indices,
  ringFixture.asset.topology.triangleToFaceIndex,
  [1, 2],
);
assert.equal(highlightedRingFaces.triangleCount, 4);
assert.equal(highlightedRingFaces.indices.length, 12);
const hoveredRingFace = buildMeshFaceTriangleIndices(
  ringFixture.asset.geometry.indices,
  ringFixture.asset.topology.triangleToFaceIndex,
  [2],
);
assert.equal(hoveredRingFace.triangleCount, 2);
assert.equal(clearStaticMeshTestFixtures(), 1);
assert.equal(assetManager.getAsset(ringFixture.assetId), undefined);

// Asset editor windows must not outlive the asset UUID captured by their
// content. This is the regression behind repeated smTest(...) calls leaving a
// stale StaticMeshEditor that displayed "Mesh asset could not be loaded."
const mockAssetWindows = {
  [`editor_${ringFixture.assetId}`]: { assetId: ringFixture.assetId, title: 'Deleted Ring' },
  inspector: { title: 'Inspector' },
  otherAsset: { assetId: 'keep-me', title: 'Other Asset' },
};
const windowsAfterFixtureDelete = removeWindowsForDeletedAsset(mockAssetWindows, ringFixture.assetId);
assert.equal(windowsAfterFixtureDelete[`editor_${ringFixture.assetId}`], undefined);
assert.equal(windowsAfterFixtureDelete.inspector, mockAssetWindows.inspector);
assert.equal(windowsAfterFixtureDelete.otherAsset, mockAssetWindows.otherAsset);

// Legacy semantic adoption remains available only as a compatibility/planning
// API. The normal editor no longer exposes an Adopt Topology step, and normal
// modeling above already proves that no adoption is required.
const normalFixture = createStaticMeshTestFixture('normal');
const normalAsset = normalFixture.asset;
assert.equal(normalAsset.construction, undefined, 'Normal fixtures must contain only normal Logical Mesh data.');
assert.equal(staticMeshAssetAPI.canAdoptTopology(normalAsset.id), true);
const normalBefore = {
  vertices: Array.from(normalAsset.geometry.vertices),
  indices: Array.from(normalAsset.geometry.indices),
  faces: normalAsset.topology.faces.map(face => [...face]),
  triangleToFace: Array.from(normalAsset.topology.triangleToFaceIndex),
  shells: resolveStaticMeshShells(normalAsset).map(shell => [...shell.faceIds]),
};
const adoption = staticMeshAssetAPI.adoptTopology({ assetId: normalAsset.id });
assert.equal(adoption.adopted, true);
assert.equal(adoption.pointsCreated, 8);
assert.equal(adoption.facesCreated, 6);
assert.equal(adoption.loopsCreated, 0);
const adoptedNormalAsset = assetManager.getAsset(normalAsset.id) as StaticMeshAsset;
assert.deepEqual(Array.from(adoptedNormalAsset.geometry.vertices), normalBefore.vertices, 'Legacy adoption must not move or rebuild vertices.');
assert.deepEqual(Array.from(adoptedNormalAsset.geometry.indices), normalBefore.indices, 'Legacy adoption must not change render triangle indices.');
assert.deepEqual(adoptedNormalAsset.topology.faces.map(face => [...face]), normalBefore.faces, 'Legacy adoption must preserve logical faces.');
assert.deepEqual(Array.from(adoptedNormalAsset.topology.triangleToFaceIndex), normalBefore.triangleToFace);
assert.deepEqual(resolveStaticMeshShells(adoptedNormalAsset).map(shell => [...shell.faceIds]), normalBefore.shells);
assert.equal(staticMeshAssetAPI.undo(normalAsset.id), true, 'Undo must remove optional semantic adoption.');
const originalNormalAsset = assetManager.getAsset(normalAsset.id) as StaticMeshAsset;
assert.equal(originalNormalAsset.construction, undefined);
assert.deepEqual(Array.from(originalNormalAsset.geometry.vertices), normalBefore.vertices);
assert.equal(staticMeshAssetAPI.redo(normalAsset.id), true, 'Redo must restore optional semantic adoption.');
const redoneNormalAsset = assetManager.getAsset(normalAsset.id) as StaticMeshAsset;
assert.equal(redoneNormalAsset.construction?.faces.length, 6);
assert.equal(clearStaticMeshTestFixtures(), 1);

// Multi-face normal inset regression: two adjacent LogicalMesh quads must be
// inset independently in one atomic action, preserving one connected shell.
const multiInsetAsset = staticMeshAssetAPI.create({ name: 'Normal Multi Face Inset Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: multiInsetAsset.id,
  points: [
    { id: 'mi0', position: { x: -2, y: 0, z: -1 } },
    { id: 'mi1', position: { x: 0, y: 0, z: -1 } },
    { id: 'mi2', position: { x: 2, y: 0, z: -1 } },
    { id: 'mi3', position: { x: -2, y: 0, z: 1 } },
    { id: 'mi4', position: { x: 0, y: 0, z: 1 } },
    { id: 'mi5', position: { x: 2, y: 0, z: 1 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({ assetId: multiInsetAsset.id, id: 'face:mi.0', pointIds: ['mi0', 'mi3', 'mi4', 'mi1'] });
staticMeshAssetAPI.createFaceFromPoints({ assetId: multiInsetAsset.id, id: 'face:mi.1', pointIds: ['mi1', 'mi4', 'mi5', 'mi2'] });
assetManager.updateAsset(multiInsetAsset.id, { construction: undefined });
assetHistory.clear(multiInsetAsset.id);
const multiInsetResult = staticMeshAssetAPI.insetFaces({ assetId: multiInsetAsset.id, faceIds: [0, 1], ratio: 0.2 });
assert.equal(multiInsetResult.results.length, 2);
assert.deepEqual(multiInsetResult.innerFaceIds, [0, 1]);
assert.equal(multiInsetResult.borderFaceIds.length, 8);
assert.equal(multiInsetAsset.construction, undefined, 'Normal multi-face Inset must not persist the transient semantic adapter.');
assert.equal(multiInsetAsset.topology.faces.length, 10);
assert.equal(resolveStaticMeshShells(multiInsetAsset).length, 1);
assert.equal(staticMeshAssetAPI.getHistoryState(multiInsetAsset.id).undoLabel, 'Inset Faces');
assert.equal(staticMeshAssetAPI.undo(multiInsetAsset.id), true);
assert.equal(multiInsetAsset.topology.faces.length, 2);
assert.equal(staticMeshAssetAPI.redo(multiInsetAsset.id), true);
assert.equal(multiInsetAsset.topology.faces.length, 10);

// Multi-edge normal bevel regression: four vertex-disjoint vertical cube edges
// are one typical Edge Ring selection. Resolve the complete selection before
// mutation and bevel all of them in one Undo step.
const multiBevelAsset = staticMeshAssetAPI.create({ name: 'Normal Multi Edge Bevel Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: multiBevelAsset.id,
  points: [
    { id: 'mbA', position: { x: -2, y: 0, z: -2 } },
    { id: 'mbD', position: { x: -2, y: 0, z: 2 } },
    { id: 'mbC', position: { x: 2, y: 0, z: 2 } },
    { id: 'mbB', position: { x: 2, y: 0, z: -2 } },
  ],
});
staticMeshAssetAPI.createFaceFromPoints({ assetId: multiBevelAsset.id, id: 'face:mb.base', pointIds: ['mbA', 'mbD', 'mbC', 'mbB'] });
const multiBevelBox = staticMeshAssetAPI.extrudeFace({ assetId: multiBevelAsset.id, faceId: 'face:mb.base', id: 'extrude:mb', distance: 2 });
staticMeshAssetAPI.createFaceFromPoints({ assetId: multiBevelAsset.id, id: 'face:mb.bottom', pointIds: ['mbB', 'mbC', 'mbD', 'mbA'] });
const bottomPointIds = ['mbA', 'mbD', 'mbC', 'mbB'];
const verticalEdges = bottomPointIds.map((bottomPointId, index) => {
  const bottomVertexId = staticMeshAssetAPI.getPoint(multiBevelAsset.id, bottomPointId)!.vertexIds![0];
  const topVertexId = staticMeshAssetAPI.getPoint(multiBevelAsset.id, multiBevelBox.topPointIds[index])!.vertexIds![0];
  return { vertexAId: bottomVertexId, vertexBId: topVertexId };
});
assetManager.updateAsset(multiBevelAsset.id, { construction: undefined });
assetHistory.clear(multiBevelAsset.id);
const multiBevelResult = staticMeshAssetAPI.bevelEdges({ assetId: multiBevelAsset.id, edges: verticalEdges, width: 0.2 });
assert.equal(multiBevelResult.results.length, 4);
assert.equal(multiBevelResult.bevelFaceIds.length, 4);
assert.equal(multiBevelResult.bevelEdgeIds.length, 8);
assert.equal(multiBevelAsset.construction, undefined, 'Normal multi-edge Bevel must not persist the transient semantic adapter.');
assert.equal(resolveStaticMeshShells(multiBevelAsset).length, 1);
assert.ok(multiBevelAsset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Closed box Edge Ring bevel must remain manifold.');
assert.equal(staticMeshAssetAPI.getHistoryState(multiBevelAsset.id).undoLabel, 'Bevel Edges');
assert.equal(staticMeshAssetAPI.undo(multiBevelAsset.id), true);
assert.equal(multiBevelAsset.topology.faces.length, 6);
assert.equal(staticMeshAssetAPI.redo(multiBevelAsset.id), true);
assert.equal(multiBevelAsset.topology.faces.length, 10);

const findMeshVertexAt = (asset: StaticMeshAsset, x: number, y: number, z: number): number => {
  const vertexCount = asset.geometry.vertices.length / 3;
  for (let vertexId = 0; vertexId < vertexCount; vertexId += 1) {
    const offset = vertexId * 3;
    if (
      Math.abs(asset.geometry.vertices[offset] - x) <= 1e-6
      && Math.abs(asset.geometry.vertices[offset + 1] - y) <= 1e-6
      && Math.abs(asset.geometry.vertices[offset + 2] - z) <= 1e-6
    ) return vertexId;
  }
  throw new Error(`Could not find fixture vertex at (${x}, ${y}, ${z}).`);
};

// More common closed-manifold asymmetric valence: one end of the vertical cube
// edge keeps degree 3 while a diagonal cut raises the other end to degree 4.
const asymmetricValenceFixture = createStaticMeshTestFixture('box');
const avBottom = findMeshVertexAt(asymmetricValenceFixture.asset, -2, 0, -2);
const avTop = findMeshVertexAt(asymmetricValenceFixture.asset, -2, 2, -2);
const avTopOpposite = findMeshVertexAt(asymmetricValenceFixture.asset, 2, 2, 2);
staticMeshAssetAPI.cutFace({
  assetId: asymmetricValenceFixture.assetId,
  faceId: asymmetricValenceFixture.primaryFaceId!,
  vertexAId: avTop,
  vertexBId: avTopOpposite,
});
const avBottomDegree = logicalVertexDegree(asymmetricValenceFixture.asset, avBottom);
const avTopDegree = logicalVertexDegree(asymmetricValenceFixture.asset, avTop);
assert.equal(avBottomDegree, 3);
assert.equal(avTopDegree, 4);
const asymmetricValenceBevel = staticMeshAssetAPI.bevelEdges({
  assetId: asymmetricValenceFixture.assetId,
  edges: [{ vertexAId: avBottom, vertexBId: avTop }],
  width: 0.2,
});
assert.equal(asymmetricValenceBevel.results.length, 1);
assert.equal(asymmetricValenceBevel.endpointCapFaceIds.length, 1, 'Only the degree-4 endpoint should need a polygon cap.');
assert.equal(resolveStaticMeshShells(asymmetricValenceFixture.asset).length, 1);
assert.ok(asymmetricValenceFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Closed asymmetric 3-to-4 bevel must remain manifold.');
assert.equal(clearStaticMeshTestFixtures(), 1);

// Selected-edge-count asymmetry regression: the shared edge A-D has two
// selected edges meeting at A, but three selected edges meeting at D. Blender
// keeps selcount per BevVert, so the two endpoints must be solved independently.
const asymmetricSelectedFixture = createStaticMeshTestFixture('box');
const asA = findMeshVertexAt(asymmetricSelectedFixture.asset, -2, 0, -2);
const asD = findMeshVertexAt(asymmetricSelectedFixture.asset, -2, 0, 2);
const asB = findMeshVertexAt(asymmetricSelectedFixture.asset, 2, 0, -2);
const asC = findMeshVertexAt(asymmetricSelectedFixture.asset, 2, 0, 2);
const asTopD = findMeshVertexAt(asymmetricSelectedFixture.asset, -2, 2, 2);
const asymmetricSelectedBevel = staticMeshAssetAPI.bevelEdges({
  assetId: asymmetricSelectedFixture.assetId,
  edges: [
    { vertexAId: asA, vertexBId: asD },
    { vertexAId: asA, vertexBId: asB },
    { vertexAId: asD, vertexBId: asC },
    { vertexAId: asD, vertexBId: asTopD },
  ],
  width: 0.2,
});
assert.equal(asymmetricSelectedBevel.results.length, 4);
assert.equal(asymmetricSelectedBevel.cornerFaceIds.length, 1, 'Only the selcount=3 endpoint should require a corner patch.');
assert.equal(resolveStaticMeshShells(asymmetricSelectedFixture.asset).length, 1);
assert.ok(asymmetricSelectedFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Selected-count 2-to-3 bevel must remain manifold.');
assert.equal(clearStaticMeshTestFixtures(), 1);

// Connected bevel regression: two selected cube edges share A. This selection
// was rejected by the old batch API because repeated single-edge mutation would
// double-offset the common endpoint. The joint planner must solve A once.
const connectedTwoFixture = createStaticMeshTestFixture('box');
const c2A = findMeshVertexAt(connectedTwoFixture.asset, -2, 0, -2);
const c2D = findMeshVertexAt(connectedTwoFixture.asset, -2, 0, 2);
const c2B = findMeshVertexAt(connectedTwoFixture.asset, 2, 0, -2);
const connectedTwoBevel = staticMeshAssetAPI.bevelEdges({
  assetId: connectedTwoFixture.assetId,
  edges: [
    { vertexAId: c2A, vertexBId: c2D },
    { vertexAId: c2A, vertexBId: c2B },
  ],
  width: 0.25,
});
assert.equal(connectedTwoBevel.results.length, 2);
assert.equal(connectedTwoBevel.bevelFaceIds.length, 2);
assert.equal(connectedTwoBevel.cornerFaceIds.length, 0, 'Two selected edges at a cube corner should weld directly without a separate VMesh cap.');
assert.equal(connectedTwoFixture.asset.topology.faces.length, 8);
assert.equal(connectedTwoFixture.asset.construction, undefined);
assert.equal(resolveStaticMeshShells(connectedTwoFixture.asset).length, 1);
assert.ok(connectedTwoFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Two-edge connected bevel must remain a closed manifold.');
const connectedTwoFaceCount = connectedTwoFixture.asset.topology.faces.length;
assert.equal(clearStaticMeshTestFixtures(), 1);

// Three selected edges at A require the first real corner VMesh patch: one
// triangular cap shared by all three edge strips.
const connectedThreeFixture = createStaticMeshTestFixture('box');
const c3A = findMeshVertexAt(connectedThreeFixture.asset, -2, 0, -2);
const c3D = findMeshVertexAt(connectedThreeFixture.asset, -2, 0, 2);
const c3B = findMeshVertexAt(connectedThreeFixture.asset, 2, 0, -2);
const c3TopA = findMeshVertexAt(connectedThreeFixture.asset, -2, 2, -2);
const connectedThreeBevel = staticMeshAssetAPI.bevelEdges({
  assetId: connectedThreeFixture.assetId,
  edges: [
    { vertexAId: c3A, vertexBId: c3D },
    { vertexAId: c3A, vertexBId: c3B },
    { vertexAId: c3A, vertexBId: c3TopA },
  ],
  width: 0.25,
});
assert.equal(connectedThreeBevel.results.length, 3);
assert.equal(connectedThreeBevel.cornerFaceIds.length, 1, 'Three selected edges at one cube corner require one triangular corner patch.');
assert.equal(connectedThreeBevel.endpointCapFaceIds.length, 1);
assert.equal(connectedThreeFixture.asset.topology.faces.length, 10);
assert.equal(resolveStaticMeshShells(connectedThreeFixture.asset).length, 1);
assert.ok(connectedThreeFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Three-edge connected bevel must remain a closed manifold.');
const connectedThreeFaceCount = connectedThreeFixture.asset.topology.faces.length;
assert.equal(clearStaticMeshTestFixtures(), 1);

// Valence-4 regression: combine the fixture's high-valence vertical edge with
// one adjacent edge from the same endpoint fan. This exercises a general corner
// boundary rather than only the cube's ordinary valence-3 vertices.
const connectedValenceFixture = createStaticMeshTestFixture('bevel-valence');
const [cvA, cvB] = connectedValenceFixture.primaryEdgeVertexIds!;
const cvSharedFace = connectedValenceFixture.asset.topology.faces.find(face => face.includes(cvA) && face.includes(cvB));
assert.ok(cvSharedFace);
const cvAIndex = cvSharedFace.indexOf(cvA);
const cvPrevious = cvSharedFace[(cvAIndex - 1 + cvSharedFace.length) % cvSharedFace.length];
const cvNext = cvSharedFace[(cvAIndex + 1) % cvSharedFace.length];
const cvNeighbor = cvPrevious === cvB ? cvNext : cvPrevious;
assert.notEqual(cvNeighbor, cvB);
const connectedValenceBevel = staticMeshAssetAPI.bevelEdges({
  assetId: connectedValenceFixture.assetId,
  edges: [
    { vertexAId: cvA, vertexBId: cvB },
    { vertexAId: cvA, vertexBId: cvNeighbor },
  ],
  width: 0.15,
});
assert.equal(connectedValenceBevel.results.length, 2);
assert.ok(connectedValenceBevel.cornerFaceIds.length >= 1, 'Valence-4 connected bevel should generate at least one general corner patch.');
assert.equal(resolveStaticMeshShells(connectedValenceFixture.asset).length, 1);
assert.ok(connectedValenceFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Valence-4 connected bevel must remain a closed manifold.');
const connectedValenceCornerCount = connectedValenceBevel.cornerFaceIds.length;
assert.equal(clearStaticMeshTestFixtures(), 1);

// A complete four-edge bottom loop has shared endpoints at every corner. It
// should be solved as one network, with each valence-2 selected corner welded.
const connectedLoopFixture = createStaticMeshTestFixture('box');
const clA = findMeshVertexAt(connectedLoopFixture.asset, -2, 0, -2);
const clD = findMeshVertexAt(connectedLoopFixture.asset, -2, 0, 2);
const clC = findMeshVertexAt(connectedLoopFixture.asset, 2, 0, 2);
const clB = findMeshVertexAt(connectedLoopFixture.asset, 2, 0, -2);
const connectedLoopBevel = staticMeshAssetAPI.bevelEdges({
  assetId: connectedLoopFixture.assetId,
  edges: [
    { vertexAId: clA, vertexBId: clD },
    { vertexAId: clD, vertexBId: clC },
    { vertexAId: clC, vertexBId: clB },
    { vertexAId: clB, vertexBId: clA },
  ],
  width: 0.25,
});
assert.equal(connectedLoopBevel.results.length, 4);
assert.equal(connectedLoopBevel.cornerFaceIds.length, 0);
assert.equal(connectedLoopFixture.asset.topology.faces.length, 10);
assert.equal(resolveStaticMeshShells(connectedLoopFixture.asset).length, 1);
assert.ok(connectedLoopFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Connected bevel loop must remain a closed manifold.');
const connectedLoopFaceCount = connectedLoopFixture.asset.topology.faces.length;
assert.equal(clearStaticMeshTestFixtures(), 1);

// Segmented connected-loop smoke test: profile subdivision must preserve the
// joint corner ownership rules instead of treating each selected edge as an
// independent chamfer.
const segmentedLoopFixture = createStaticMeshTestFixture('box');
const slA = findMeshVertexAt(segmentedLoopFixture.asset, -2, 0, -2);
const slD = findMeshVertexAt(segmentedLoopFixture.asset, -2, 0, 2);
const slC = findMeshVertexAt(segmentedLoopFixture.asset, 2, 0, 2);
const slB = findMeshVertexAt(segmentedLoopFixture.asset, 2, 0, -2);
const segmentedLoopBevel = staticMeshAssetAPI.bevelEdges({
  assetId: segmentedLoopFixture.assetId,
  edges: [
    { vertexAId: slA, vertexBId: slD },
    { vertexAId: slD, vertexBId: slC },
    { vertexAId: slC, vertexBId: slB },
    { vertexAId: slB, vertexBId: slA },
  ],
  width: 0.25,
  segments: 3,
  profile: 0.3,
});
assert.equal(segmentedLoopBevel.bevelFaceIds.length, 12);
assert.equal(segmentedLoopBevel.bevelEdgeIds.length, 16);
assert.equal(
  segmentedLoopBevel.cornerFaceIds.length,
  0,
  'A face-loop corner with selcount=2 and two effective BoundVerts is Blender M_NONE/weld, not a segmented cap.',
);
assert.equal(
  segmentedLoopFixture.asset.topology.faces.length,
  18,
  '6 reconstructed cube faces + 4 source edges x 3 strips; the four loop corners add no cap faces.',
);
assert.equal(resolveStaticMeshShells(segmentedLoopFixture.asset).length, 1);
assert.ok(segmentedLoopFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Segmented connected loop must remain manifold.');
const segmentedLoopFaceCount = segmentedLoopFixture.asset.topology.faces.length;
const segmentedLoopCornerFaceCount = segmentedLoopBevel.cornerFaceIds.length;
assert.equal(clearStaticMeshTestFixtures(), 1);

// General segmented-corner regression captured from the editor/Blender
// comparison: three selected cube edges meet at one vertex with Segments=3,
// Profile=.3, Width=.25. The shared corner must use M_ADJ instead of one
// triangulated/pole-style cap. For odd Segments=3 this is six quads plus a
// center triangle; the three remote single-selected endpoints remain M_NONE.
const segmentedAdjFixture = createStaticMeshTestFixture('box');
const saA = findMeshVertexAt(segmentedAdjFixture.asset, -2, 0, -2);
const saD = findMeshVertexAt(segmentedAdjFixture.asset, -2, 0, 2);
const saB = findMeshVertexAt(segmentedAdjFixture.asset, 2, 0, -2);
const saTopA = findMeshVertexAt(segmentedAdjFixture.asset, -2, 2, -2);
const segmentedAdjBevel = staticMeshAssetAPI.bevelEdges({
  assetId: segmentedAdjFixture.assetId,
  edges: [
    { vertexAId: saA, vertexBId: saD },
    { vertexAId: saA, vertexBId: saB },
    { vertexAId: saA, vertexBId: saTopA },
  ],
  width: 0.25,
  segments: 3,
  profile: 0.3,
});
assert.equal(segmentedAdjBevel.bevelFaceIds.length, 9, 'Three source edges x Segments=3 must create nine strip faces.');
assert.equal(segmentedAdjBevel.cornerFaceIds.length, 7, 'The shared Segments=3 corner must materialize seven M_ADJ cells.');
const segmentedAdjCornerFaces = segmentedAdjBevel.cornerFaceIds.map(faceId => segmentedAdjFixture.asset.topology.faces[faceId]);
assert.equal(segmentedAdjCornerFaces.filter(face => face.length === 4).length, 6, 'M_ADJ Segments=3 corner must have six ring quads.');
assert.equal(segmentedAdjCornerFaces.filter(face => face.length === 3).length, 1, 'Odd Segments=3 M_ADJ corner must have one center triangle.');
assert.equal(segmentedAdjFixture.asset.topology.faces.length, 22, '6 reconstructed faces + 9 strips + 7 M_ADJ cells.');
assert.equal(resolveStaticMeshShells(segmentedAdjFixture.asset).length, 1);
assert.ok(segmentedAdjFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'M_ADJ Segments=3 corner must remain a closed manifold.');
const segmentedAdjCornerFaceCount = segmentedAdjBevel.cornerFaceIds.length;
assert.equal(clearStaticMeshTestFixtures(), 1);

// Even-segment M_ADJ parity regression: Segments=4 converges to one shared
// center vertex and therefore needs only quads (no odd-parity center n-gon).
const segmentedAdjEvenFixture = createStaticMeshTestFixture('box');
const saeA = findMeshVertexAt(segmentedAdjEvenFixture.asset, -2, 0, -2);
const saeD = findMeshVertexAt(segmentedAdjEvenFixture.asset, -2, 0, 2);
const saeB = findMeshVertexAt(segmentedAdjEvenFixture.asset, 2, 0, -2);
const saeTopA = findMeshVertexAt(segmentedAdjEvenFixture.asset, -2, 2, -2);
const segmentedAdjEvenBevel = staticMeshAssetAPI.bevelEdges({
  assetId: segmentedAdjEvenFixture.assetId,
  edges: [
    { vertexAId: saeA, vertexBId: saeD },
    { vertexAId: saeA, vertexBId: saeB },
    { vertexAId: saeA, vertexBId: saeTopA },
  ],
  width: 0.25,
  segments: 4,
  profile: 0.3,
});
assert.equal(segmentedAdjEvenBevel.bevelFaceIds.length, 12);
assert.equal(segmentedAdjEvenBevel.cornerFaceIds.length, 12, 'Three-sector Segments=4 M_ADJ corner should contain twelve quads.');
const segmentedAdjEvenCornerFaces = segmentedAdjEvenBevel.cornerFaceIds.map(faceId => segmentedAdjEvenFixture.asset.topology.faces[faceId]);
assert.ok(segmentedAdjEvenCornerFaces.every(face => face.length === 4), 'Even-segment M_ADJ must converge through quads without a center n-gon.');
assert.equal(segmentedAdjEvenFixture.asset.topology.faces.length, 30, '6 reconstructed faces + 12 strips + 12 M_ADJ quads.');
assert.equal(resolveStaticMeshShells(segmentedAdjEvenFixture.asset).length, 1);
assert.ok(segmentedAdjEvenFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Even-segment M_ADJ corner must remain manifold.');
const segmentedAdjEvenCornerFaceCount = segmentedAdjEvenBevel.cornerFaceIds.length;
assert.equal(clearStaticMeshTestFixtures(), 1);

// Full cube bevel regression: every one of the 12 manifold edges is selected.
// Each of the 8 cube vertices has selcount=3, so this is the compact test for
// the classic Blender-style "bevel the whole cube" operation.
const fullCubeFixture = createStaticMeshTestFixture('box');
const fullCubeEdgesByKey = new Map<string, { vertexAId: number; vertexBId: number }>();
for (const face of fullCubeFixture.asset.topology.faces) {
  for (let index = 0; index < face.length; index += 1) {
    const vertexAId = face[index];
    const vertexBId = face[(index + 1) % face.length];
    const key = vertexAId < vertexBId ? `${vertexAId}:${vertexBId}` : `${vertexBId}:${vertexAId}`;
    if (!fullCubeEdgesByKey.has(key)) fullCubeEdgesByKey.set(key, { vertexAId, vertexBId });
  }
}
assert.equal(fullCubeEdgesByKey.size, 12);
const fullCubeBevel = staticMeshAssetAPI.bevelEdges({
  assetId: fullCubeFixture.assetId,
  edges: Array.from(fullCubeEdgesByKey.values()),
  width: 0.2,
});
assert.equal(fullCubeBevel.results.length, 12);
assert.equal(fullCubeBevel.cornerFaceIds.length, 8, 'Full one-segment cube bevel needs one triangular patch at every original corner.');
assert.equal(fullCubeFixture.asset.topology.faces.length, 26, '6 reconstructed faces + 12 edge strips + 8 corner patches.');
assert.equal(resolveStaticMeshShells(fullCubeFixture.asset).length, 1);
assert.ok(fullCubeFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Full cube bevel must remain a closed manifold.');
const fullCubeFaceCount = fullCubeFixture.asset.topology.faces.length;
assert.equal(clearStaticMeshTestFixtures(), 1);

// Segmented full-cube regression: every selected edge receives `segments`
// strip faces and every three-way shared corner is a structured M_ADJ VMesh.
// With Segments=3, Blender's odd-parity ring pattern gives six quads plus one
// center triangle per cube corner (7 authored corner faces x 8 corners).
const segmentedCubeFixture = createStaticMeshTestFixture('box');
const segmentedCubeEdgesByKey = new Map<string, { vertexAId: number; vertexBId: number }>();
for (const face of segmentedCubeFixture.asset.topology.faces) {
  for (let index = 0; index < face.length; index += 1) {
    const vertexAId = face[index];
    const vertexBId = face[(index + 1) % face.length];
    const key = vertexAId < vertexBId ? `${vertexAId}:${vertexBId}` : `${vertexBId}:${vertexAId}`;
    if (!segmentedCubeEdgesByKey.has(key)) segmentedCubeEdgesByKey.set(key, { vertexAId, vertexBId });
  }
}
const segmentedCubeBevel = staticMeshAssetAPI.bevelEdges({
  assetId: segmentedCubeFixture.assetId,
  edges: Array.from(segmentedCubeEdgesByKey.values()),
  width: 0.2,
  segments: 3,
  profile: 0.5,
});
assert.equal(segmentedCubeBevel.results.length, 12);
assert.equal(segmentedCubeBevel.bevelFaceIds.length, 36, '12 source edges x Segments=3 must create 36 bevel strip faces.');
assert.equal(segmentedCubeBevel.cornerFaceIds.length, 56, 'Segments=3 full-cube bevel needs 7 M_ADJ cells at each of 8 original corners.');
assert.equal(segmentedCubeFixture.asset.topology.faces.length, 98, '6 reconstructed faces + 36 edge strips + 56 M_ADJ corner cells.');
const segmentedCubeCornerFaces = segmentedCubeBevel.cornerFaceIds.map(faceId => segmentedCubeFixture.asset.topology.faces[faceId]);
assert.equal(segmentedCubeCornerFaces.filter(face => face.length === 4).length, 48, 'Each Segments=3 M_ADJ cube corner needs six quads.');
assert.equal(segmentedCubeCornerFaces.filter(face => face.length === 3).length, 8, 'Each odd-segment M_ADJ cube corner needs one center triangle.');
assert.equal(resolveStaticMeshShells(segmentedCubeFixture.asset).length, 1);
assert.ok(segmentedCubeFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Segmented full cube must remain a closed manifold.');
const segmentedCubeFaceCount = segmentedCubeFixture.asset.topology.faces.length;
assert.equal(clearStaticMeshTestFixtures(), 1);

// Repeated bevel regression: after one ordinary edge bevel the two source
// faces are already 5-gons and the editor selects the two new longitudinal
// rails. Blender solves those disconnected rails as one bevel graph. Repeating
// the command must therefore clamp the whole selection instead of sending each
// rail through the old fixed-distance single-edge path (which used to fail on
// pass 2 with "width is too large for one of the neighboring edges").
const repeatedBevelFixture = createStaticMeshTestFixture('bevel');
let repeatedEdges = [{
  vertexAId: repeatedBevelFixture.primaryEdgeVertexIds![0],
  vertexBId: repeatedBevelFixture.primaryEdgeVertexIds![1],
}];
const repeatedPass1 = staticMeshAssetAPI.bevelEdges({
  assetId: repeatedBevelFixture.assetId,
  edges: repeatedEdges,
  width: 0.15,
});
assert.ok(repeatedBevelFixture.asset.topology.faces.some(face => face.length === 5), 'First bevel should reconstruct source quads as n-gons.');
repeatedEdges = repeatedPass1.bevelEdgeIds.map(edgeId => {
  const [vertexAId, vertexBId] = edgeId.split('-').map(Number);
  return { vertexAId, vertexBId };
});
const repeatedPass2 = staticMeshAssetAPI.bevelEdges({
  assetId: repeatedBevelFixture.assetId,
  edges: repeatedEdges,
  width: 0.15,
});
assert.equal(repeatedPass2.clamped, true, 'Second bevel over the generated rails should clamp as one network.');
assert.ok(repeatedBevelFixture.asset.topology.faces.some(face => face.length >= 7), 'Second bevel should preserve larger reconstructed n-gons.');
repeatedEdges = repeatedPass2.bevelEdgeIds.map(edgeId => {
  const [vertexAId, vertexBId] = edgeId.split('-').map(Number);
  return { vertexAId, vertexBId };
});
const repeatedPass3 = staticMeshAssetAPI.bevelEdges({
  assetId: repeatedBevelFixture.assetId,
  edges: repeatedEdges,
  width: 0.15,
});
assert.equal(repeatedPass3.clamped, true);
assert.ok(repeatedBevelFixture.asset.topology.faces.some(face => face.length >= 11), 'Third bevel should remain valid with 10+ vertex source n-gons.');
assert.equal(resolveStaticMeshShells(repeatedBevelFixture.asset).length, 1);
assert.ok(repeatedBevelFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Repeated n-gon bevel must remain a closed manifold.');
assert.equal(staticMeshAssetAPI.getHistoryState(repeatedBevelFixture.assetId).undoLabel, 'Bevel Edges');
const repeatedNgonMaxVertices = Math.max(...repeatedBevelFixture.asset.topology.faces.map(face => face.length));
const repeatedEffectiveWidth = repeatedPass3.width;
assert.equal(clearStaticMeshTestFixtures(), 1);

// Non-planar/reflex bevel regression: the whole logical face normal is not a
// stable offset plane for a strongly warped corner. The former solver could
// report a parallel terminal corner or put the offset meeting point behind the
// neighboring edge. Blender's offset_meet instead uses the local incident-edge
// plane and treats out-of-segment zero-offset meets as endpoint fallbacks.
const warpedBevelAsset = staticMeshAssetAPI.create({ name: 'Warped Reflex Bevel Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: warpedBevelAsset.id,
  points: [
    { id: 'wb0', position: { x: 0, y: 0, z: 0 } },
    { id: 'wb1', position: { x: 2, y: 0, z: 0 } },
    { id: 'wb2', position: { x: 2, y: 0, z: 2 } },
    { id: 'wb3', position: { x: 0, y: 0, z: 2 } },
    { id: 'wb4', position: { x: -1.4, y: 0.46, z: 1.84 } },
    { id: 'wb5', position: { x: 2.69, y: 0.4, z: 2.88 } },
    { id: 'wb6', position: { x: 2.82, y: 2.39, z: 2.55 } },
    { id: 'wb7', position: { x: -0.85, y: 0.61, z: 0.59 } },
  ],
});
for (const [id, pointIds] of [
  ['face:wb.bottom', ['wb0', 'wb3', 'wb2', 'wb1']],
  ['face:wb.top', ['wb4', 'wb5', 'wb6', 'wb7']],
  ['face:wb.front', ['wb0', 'wb1', 'wb5', 'wb4']],
  ['face:wb.right', ['wb1', 'wb2', 'wb6', 'wb5']],
  ['face:wb.back', ['wb2', 'wb3', 'wb7', 'wb6']],
  ['face:wb.left', ['wb3', 'wb0', 'wb4', 'wb7']],
] as const) {
  staticMeshAssetAPI.createFaceFromPoints({ assetId: warpedBevelAsset.id, id, pointIds: [...pointIds] });
}
const warpedStart = staticMeshAssetAPI.getPoint(warpedBevelAsset.id, 'wb7')!.vertexIds![0];
const warpedEnd = staticMeshAssetAPI.getPoint(warpedBevelAsset.id, 'wb4')!.vertexIds![0];
assetManager.updateAsset(warpedBevelAsset.id, { construction: undefined });
assetHistory.clear(warpedBevelAsset.id);
const warpedBevelResult = staticMeshAssetAPI.bevelEdges({
  assetId: warpedBevelAsset.id,
  edges: [{ vertexAId: warpedStart, vertexBId: warpedEnd }],
  width: 0.35,
});
assert.equal(warpedBevelResult.results.length, 1);
assert.equal(resolveStaticMeshShells(warpedBevelAsset).length, 1, 'Warped bevel must stay in one shell.');
assert.ok(warpedBevelAsset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Warped bevel must remain manifold.');
assert.ok(warpedBevelAsset.topology.faces.some(face => face.length === 5), 'Warped source faces should rebuild as valid n-gons.');
assert.equal(warpedBevelAsset.geometry.indices.length % 3, 0);
assert.equal(staticMeshAssetAPI.getHistoryState(warpedBevelAsset.id).undoLabel, 'Bevel Edge');
const warpedBevelFaceCount = warpedBevelAsset.topology.faces.length;
assetManager.deleteAsset(warpedBevelAsset.id);

// Flared/obtuse selected-edge regression. Both endpoint side edges move away
// from the selected edge's longitudinal interval, so the valid bevel boundary
// projects behind the original endpoint. Blender permits this: negative
// longitudinal projection is not itself an inversion; only positive progress
// toward the opposite endpoint consumes overlap room. The previous joint
// planner rejected this exact class with "invert along the selected edge".
const flaredBevelAsset = staticMeshAssetAPI.create({ name: 'Flared Endpoint Bevel Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: flaredBevelAsset.id,
  points: [
    { id: 'fb.a', position: { x: 0, y: 0, z: 0 } },
    { id: 'fb.b', position: { x: 4, y: 0, z: 0 } },
    { id: 'fb.c', position: { x: 5, y: 2, z: 0 } },
    { id: 'fb.d', position: { x: -1, y: 2, z: 0 } },
    { id: 'fb.e', position: { x: -1, y: 0, z: 2 } },
    { id: 'fb.f', position: { x: 5, y: 0, z: 2 } },
    { id: 'fb.g', position: { x: 6, y: 2, z: 2 } },
    { id: 'fb.h', position: { x: -2, y: 2, z: 2 } },
  ],
});
for (const [id, pointIds] of [
  ['face:fb.bottom', ['fb.a', 'fb.d', 'fb.c', 'fb.b']],
  ['face:fb.front', ['fb.a', 'fb.b', 'fb.f', 'fb.e']],
  ['face:fb.right', ['fb.b', 'fb.c', 'fb.g', 'fb.f']],
  ['face:fb.back', ['fb.d', 'fb.h', 'fb.g', 'fb.c']],
  ['face:fb.left', ['fb.a', 'fb.e', 'fb.h', 'fb.d']],
  ['face:fb.top', ['fb.e', 'fb.f', 'fb.g', 'fb.h']],
] as const) {
  staticMeshAssetAPI.createFaceFromPoints({ assetId: flaredBevelAsset.id, id, pointIds: [...pointIds] });
}
const flaredStart = staticMeshAssetAPI.getPoint(flaredBevelAsset.id, 'fb.a')!.vertexIds![0];
const flaredEnd = staticMeshAssetAPI.getPoint(flaredBevelAsset.id, 'fb.b')!.vertexIds![0];
assetManager.updateAsset(flaredBevelAsset.id, { construction: undefined });
assetHistory.clear(flaredBevelAsset.id);
const flaredBevelResult = staticMeshAssetAPI.bevelEdges({
  assetId: flaredBevelAsset.id,
  edges: [{ vertexAId: flaredStart, vertexBId: flaredEnd }],
  width: 0.25,
});
assert.equal(flaredBevelResult.clamped, false, 'A flared endpoint should not be mistaken for selected-edge overlap.');
assertNearlyEqual(flaredBevelResult.width, 0.25, 'Flared endpoint bevel should preserve the requested width.');
assert.equal(flaredBevelResult.bevelFaceIds.length, 1);
assert.equal(flaredBevelAsset.topology.faces.length, 7);
assert.equal(resolveStaticMeshShells(flaredBevelAsset).length, 1, 'Flared endpoint bevel must stay in one shell.');
assert.ok(flaredBevelAsset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Flared endpoint bevel must remain manifold.');
const flaredBevelWidth = flaredBevelResult.width;
assetManager.deleteAsset(flaredBevelAsset.id);

// Straight-terminal regression. This is a common post-modeling topology: one
// side of the selected edge ends at a boundary vertex that merely subdivides a
// straight logical face edge, while the other side has a real branch/loop.
// Blender's selcount==1 terminal path keeps a perpendicular offset point at the
// collinear side; it does not collapse that bevel rail back to the source
// vertex. Collapsing here makes the strip taper to zero and can leave coincident
// vertices after repeated edits.
const straightTerminalPoints: Array<{ id: string; position: { x: number; y: number; z: number } }> = [];
for (const y of [-1, 0, 1]) {
  for (const x of [-1, 1]) {
    for (const z of [-1, 1]) {
      straightTerminalPoints.push({ id: `st.${x}.${y}.${z}`, position: { x, y, z } });
    }
  }
}
const straightTerminalFaceDefinitions = [
  ['face:st.top', ['st.-1.1.-1', 'st.-1.1.1', 'st.1.1.1', 'st.1.1.-1']],
  ['face:st.bottom', ['st.-1.-1.-1', 'st.1.-1.-1', 'st.1.-1.1', 'st.-1.-1.1']],
  // One whole side intentionally keeps the y=0 points as collinear n-gon
  // boundary vertices instead of splitting the face there.
  ['face:st.front', ['st.-1.-1.-1', 'st.-1.0.-1', 'st.-1.1.-1', 'st.1.1.-1', 'st.1.0.-1', 'st.1.-1.-1']],
  ['face:st.back.upper', ['st.-1.0.1', 'st.1.0.1', 'st.1.1.1', 'st.-1.1.1']],
  ['face:st.back.lower', ['st.-1.-1.1', 'st.1.-1.1', 'st.1.0.1', 'st.-1.0.1']],
  ['face:st.left.upper', ['st.-1.0.-1', 'st.-1.0.1', 'st.-1.1.1', 'st.-1.1.-1']],
  ['face:st.left.lower', ['st.-1.-1.-1', 'st.-1.-1.1', 'st.-1.0.1', 'st.-1.0.-1']],
  ['face:st.right.upper', ['st.1.0.-1', 'st.1.1.-1', 'st.1.1.1', 'st.1.0.1']],
  ['face:st.right.lower', ['st.1.-1.-1', 'st.1.0.-1', 'st.1.0.1', 'st.1.-1.1']],
] as const;
const createStraightTerminalAsset = (name: string) => {
  const asset = staticMeshAssetAPI.create({ name, path: '/Tests' });
  staticMeshAssetAPI.addPoints({
    assetId: asset.id,
    points: straightTerminalPoints.map(point => ({ id: point.id, position: { ...point.position } })),
  });
  for (const [id, pointIds] of straightTerminalFaceDefinitions) {
    staticMeshAssetAPI.createFaceFromPoints({ assetId: asset.id, id, pointIds: [...pointIds] });
  }
  return asset;
};

const straightTerminalAsset = createStraightTerminalAsset('Straight Terminal Bevel Test');
const straightTerminalStart = staticMeshAssetAPI.getPoint(straightTerminalAsset.id, 'st.1.1.-1')!.vertexIds![0];
const straightTerminalEnd = staticMeshAssetAPI.getPoint(straightTerminalAsset.id, 'st.1.0.-1')!.vertexIds![0];
assetManager.updateAsset(straightTerminalAsset.id, { construction: undefined });
assetHistory.clear(straightTerminalAsset.id);
const straightTerminalBevel = staticMeshAssetAPI.bevelEdges({
  assetId: straightTerminalAsset.id,
  edges: [{ vertexAId: straightTerminalStart, vertexBId: straightTerminalEnd }],
  width: 0.25,
});
assert.equal(straightTerminalBevel.clamped, false);
assertNearlyEqual(straightTerminalBevel.width, 0.25, 'Straight terminal should preserve the requested width.');
assert.equal(resolveStaticMeshShells(straightTerminalAsset).length, 1, 'Straight-terminal bevel must remain one shell.');
assert.ok(straightTerminalAsset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Straight-terminal bevel must remain manifold.');
const straightTerminalSource = { x: 1, y: 0, z: -1 };
const straightTerminalCoincidentSourceVertices = Array.from(
  { length: straightTerminalAsset.geometry.vertices.length / 3 },
  (_, vertexId) => vertexId,
).filter(vertexId => Math.hypot(
  straightTerminalAsset.geometry.vertices[vertexId * 3] - straightTerminalSource.x,
  straightTerminalAsset.geometry.vertices[vertexId * 3 + 1] - straightTerminalSource.y,
  straightTerminalAsset.geometry.vertices[vertexId * 3 + 2] - straightTerminalSource.z,
) <= 1e-7).length;
assert.equal(straightTerminalCoincidentSourceVertices, 0, 'A straight terminal must offset away from the source split vertex instead of leaving a zero-width rail there.');
const straightTerminalHasPerpendicularPoint = Array.from(
  { length: straightTerminalAsset.geometry.vertices.length / 3 },
  (_, vertexId) => vertexId,
).some(vertexId => Math.hypot(
  straightTerminalAsset.geometry.vertices[vertexId * 3] - 0.75,
  straightTerminalAsset.geometry.vertices[vertexId * 3 + 1] - 0,
  straightTerminalAsset.geometry.vertices[vertexId * 3 + 2] - (-1),
) <= 1e-7);
assert.equal(straightTerminalHasPerpendicularPoint, true, 'Straight terminal should keep the Blender-style perpendicular boundary point.');
const straightTerminalFaceCount = straightTerminalAsset.topology.faces.length;
assetManager.deleteAsset(straightTerminalAsset.id);

// Segmented straight-chain regression matching a selected vertical edge that
// has already been split by another loop. The y=0 vertex is not a bevel corner:
// the two selected edge halves are collinear and the profile must continue
// through that station. The old segmented path inserted both endpoint arcs into
// a synthetic corner cap, producing a zero-area polygon and aborting with
// "Face normal is degenerate." for Segments > 1.
const straightChainAsset = createStraightTerminalAsset('Segmented Straight Selected Chain Test');
const straightChainTop = staticMeshAssetAPI.getPoint(straightChainAsset.id, 'st.1.1.-1')!.vertexIds![0];
const straightChainMiddle = staticMeshAssetAPI.getPoint(straightChainAsset.id, 'st.1.0.-1')!.vertexIds![0];
const straightChainBottom = staticMeshAssetAPI.getPoint(straightChainAsset.id, 'st.1.-1.-1')!.vertexIds![0];
assetManager.updateAsset(straightChainAsset.id, { construction: undefined });
assetHistory.clear(straightChainAsset.id);
const straightChainBevel = staticMeshAssetAPI.bevelEdges({
  assetId: straightChainAsset.id,
  edges: [
    { vertexAId: straightChainTop, vertexBId: straightChainMiddle },
    { vertexAId: straightChainMiddle, vertexBId: straightChainBottom },
  ],
  width: 0.25,
  segments: 5,
  profile: 0.5,
});
assert.equal(straightChainBevel.bevelFaceIds.length, 10, 'Two selected source-edge halves with Segments=5 must create ten strips.');
assert.equal(straightChainAsset.topology.faces.length, 19, 'A straight selected split must not create a synthetic corner cap at the middle station.');
assert.equal(resolveStaticMeshShells(straightChainAsset).length, 1, 'Segmented straight selected chain must remain one shell.');
assert.ok(straightChainAsset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Segmented straight selected chain must remain manifold.');
const straightChainFaceCount = straightChainAsset.topology.faces.length;
assetManager.deleteAsset(straightChainAsset.id);
// Collapsed boundary / weld regression. At endpoint 'b' both zero-offset
// neighboring-edge meets clamp to the same source position. The old planner
// emitted two different semantic/mesh vertices at that coordinate, so the
// reconstructed n-gon/edge strip became a zero-width bow tie and triangulation
// failed. Blender's VMesh shares one BMVert for equivalent/collapsed boundary
// roles. The joint planner must do the same, allowing the nominal bevel quad to
// become a valid triangle at the collapsed endpoint.
const weldedEndpointAsset = staticMeshAssetAPI.create({ name: 'Collapsed Bevel Boundary Weld Test', path: '/Tests' });
const weldedEndpointPositions = [
  { x: -0.0007633603978319803, y: -0.5536323168133095, z: -1.1670326272696 },
  { x: -0.154629558128363, y: 0.7662764776556287, z: -0.1753640365088358 },
  { x: 1.9705838914203924, y: -0.8809350338051445, z: 0.4251098165710573 },
  { x: -0.4674169823489137, y: -0.22547342300422316, z: 1.9138888694709748 },
  { x: -0.7691584831365617, y: 2.1626740250663716, z: 0.15234693994716508 },
  { x: 1.43066709670602, y: 1.9431477703710698, z: -0.7164225785587405 },
  { x: 1.0239161243844137, y: 1.8201160062890267, z: -0.06211708579794517 },
  { x: 0.12129708599532019, y: 1.4671131754890667, z: 1.3575688318182073 },
];
const weldedEndpointPointIds = ['we.a', 'we.b', 'we.c', 'we.d', 'we.e', 'we.f', 'we.g', 'we.h'];
staticMeshAssetAPI.addPoints({
  assetId: weldedEndpointAsset.id,
  points: weldedEndpointPointIds.map((id, index) => ({ id, position: weldedEndpointPositions[index] })),
});
for (const [id, pointIds] of [
  ['face:we.bottom', ['we.a', 'we.d', 'we.c', 'we.b']],
  ['face:we.top', ['we.e', 'we.f', 'we.g', 'we.h']],
  ['face:we.front', ['we.a', 'we.b', 'we.f', 'we.e']],
  ['face:we.right', ['we.b', 'we.c', 'we.g', 'we.f']],
  ['face:we.back', ['we.d', 'we.h', 'we.g', 'we.c']],
  ['face:we.left', ['we.a', 'we.e', 'we.h', 'we.d']],
] as const) {
  staticMeshAssetAPI.createFaceFromPoints({ assetId: weldedEndpointAsset.id, id, pointIds: [...pointIds] });
}
const weldedEndpointStart = staticMeshAssetAPI.getPoint(weldedEndpointAsset.id, 'we.a')!.vertexIds![0];
const weldedEndpointEnd = staticMeshAssetAPI.getPoint(weldedEndpointAsset.id, 'we.b')!.vertexIds![0];
assetManager.updateAsset(weldedEndpointAsset.id, { construction: undefined });
assetHistory.clear(weldedEndpointAsset.id);
const weldedEndpointResult = staticMeshAssetAPI.bevelEdges({
  assetId: weldedEndpointAsset.id,
  edges: [{ vertexAId: weldedEndpointStart, vertexBId: weldedEndpointEnd }],
  width: 0.35,
});
assert.equal(weldedEndpointResult.clamped, false);
assertNearlyEqual(weldedEndpointResult.width, 0.35, 'Collapsed endpoint weld should preserve a valid requested width.');
assert.equal(resolveStaticMeshShells(weldedEndpointAsset).length, 1, 'Welded bevel endpoint must remain one shell.');
assert.ok(weldedEndpointAsset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Welded bevel endpoint must remain manifold.');
assert.ok(weldedEndpointAsset.topology.faces.some(face => face.length === 3), 'A collapsed bevel endpoint should materialize a triangular strip instead of a quad with coincident vertices.');
let weldedEndpointCoincidentPairs = 0;
for (let a = 0; a < weldedEndpointAsset.geometry.vertices.length / 3; a += 1) {
  for (let b = a + 1; b < weldedEndpointAsset.geometry.vertices.length / 3; b += 1) {
    const distance = Math.hypot(
      weldedEndpointAsset.geometry.vertices[a * 3] - weldedEndpointAsset.geometry.vertices[b * 3],
      weldedEndpointAsset.geometry.vertices[a * 3 + 1] - weldedEndpointAsset.geometry.vertices[b * 3 + 1],
      weldedEndpointAsset.geometry.vertices[a * 3 + 2] - weldedEndpointAsset.geometry.vertices[b * 3 + 2],
    );
    if (distance <= 1e-7) weldedEndpointCoincidentPairs += 1;
  }
}
assert.equal(weldedEndpointCoincidentPairs, 0, 'Bevel must not leave coincident generated mesh vertices at a collapsed endpoint.');
const weldedEndpointFaceCount = weldedEndpointAsset.topology.faces.length;
assetManager.deleteAsset(weldedEndpointAsset.id);

// General n-gon compiler regression: a concave simple pentagon must keep one
// logical face while compiling to exactly n-2 render triangles. A naive fan
// from the first vertex crosses outside this polygon.
const concaveNgonAsset = staticMeshAssetAPI.create({ name: 'Concave Ngon Triangulation Test', path: '/Tests' });
staticMeshAssetAPI.addPoints({
  assetId: concaveNgonAsset.id,
  points: [
    { id: 'ng0', position: { x: 0, y: 0, z: 0 } },
    { id: 'ng1', position: { x: 3, y: 0, z: 0 } },
    { id: 'ng2', position: { x: 3, y: 0, z: 3 } },
    { id: 'ng3', position: { x: 1.5, y: 0, z: 1 } },
    { id: 'ng4', position: { x: 0, y: 0, z: 3 } },
  ],
});
const concaveNgonFace = staticMeshAssetAPI.createFaceFromPoints({
  assetId: concaveNgonAsset.id,
  id: 'face:concave-ngon',
  pointIds: ['ng0', 'ng4', 'ng3', 'ng2', 'ng1'],
});
assert.equal(concaveNgonFace.vertexIds.length, 5);
assert.equal(concaveNgonAsset.topology.faces[concaveNgonFace.faceId].length, 5);
assert.equal(concaveNgonAsset.geometry.indices.length / 3, 3, 'A simple pentagon must compile to exactly three triangles.');
assetManager.deleteAsset(concaveNgonAsset.id);

// Turning clamp off converts the same collision into an atomic validation
// failure. The transaction must restore the untouched six-face cube and create
// no undo entry.
const unclampedFixture = createStaticMeshTestFixture('box');
const ucA = findMeshVertexAt(unclampedFixture.asset, -2, 0, -2);
const ucD = findMeshVertexAt(unclampedFixture.asset, -2, 0, 2);
const ucB = findMeshVertexAt(unclampedFixture.asset, 2, 0, -2);
const ucTopA = findMeshVertexAt(unclampedFixture.asset, -2, 2, -2);
assert.throws(
  () => staticMeshAssetAPI.bevelEdges({
    assetId: unclampedFixture.assetId,
    edges: [
      { vertexAId: ucA, vertexBId: ucD },
      { vertexAId: ucA, vertexBId: ucB },
      { vertexAId: ucA, vertexBId: ucTopA },
    ],
    width: 10,
    clampOverlap: false,
  }),
  /overlapping corner geometry/i,
);
assert.equal(unclampedFixture.asset.topology.faces.length, 6);
assert.equal(staticMeshAssetAPI.getHistoryState(unclampedFixture.assetId).canUndo, false);
assert.equal(clearStaticMeshTestFixtures(), 1);

// Oversized connected bevels are reduced as one network instead of letting
// opposite endpoint boundaries cross through each other.
const clampedFixture = createStaticMeshTestFixture('box');
const ccA = findMeshVertexAt(clampedFixture.asset, -2, 0, -2);
const ccD = findMeshVertexAt(clampedFixture.asset, -2, 0, 2);
const ccB = findMeshVertexAt(clampedFixture.asset, 2, 0, -2);
const ccTopA = findMeshVertexAt(clampedFixture.asset, -2, 2, -2);
const clampedBevel = staticMeshAssetAPI.bevelEdges({
  assetId: clampedFixture.assetId,
  edges: [
    { vertexAId: ccA, vertexBId: ccD },
    { vertexAId: ccA, vertexBId: ccB },
    { vertexAId: ccA, vertexBId: ccTopA },
  ],
  width: 10,
});
assert.equal(clampedBevel.requestedWidth, 10);
assert.equal(clampedBevel.clamped, true);
assert.ok(clampedBevel.width < clampedBevel.requestedWidth);
assert.ok(clampedFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1), 'Clamped connected bevel must remain manifold.');
const clampedEffectiveWidth = clampedBevel.width;
assert.equal(clearStaticMeshTestFixtures(), 1);

// ---------------------------------------------------------------------------
// Scratch Primitive Modeling, Vertex/Face Authoring, Weld/Connect, & AI Control
// ---------------------------------------------------------------------------
const scratchBox = staticMeshAssetAPI.createPrimitiveMesh({
  name: 'Scratch_Box',
  path: '/Tests',
  kind: 'BOX',
  size: { x: 2, y: 2, z: 2 },
});
assert.equal(scratchBox.construction, undefined, 'Scratch primitive must not persist construction metadata.');
assert.equal(scratchBox.geometry.vertices.length / 3, 8, 'Welded scratch box must have 8 shared vertices.');
assert.equal(scratchBox.topology.faces.length, 6, 'Welded scratch box must have 6 quad faces.');
assert.ok(
  scratchBox.topology.graph?.halfEdges.every(edge => edge.pair !== -1),
  'Welded scratch box must have closed manifold half-edge pairing.',
);

const scratchCylinder = staticMeshAssetAPI.createPrimitiveMesh({
  name: 'Scratch_Cylinder',
  path: '/Tests',
  kind: 'CYLINDER',
  radialSegments: 12,
  radius: 1,
  size: { x: 2, y: 3, z: 2 },
});
assert.equal(scratchCylinder.topology.faces.length, 14, '12-sided cylinder must have 12 side quads + 2 cap n-gons.');
assert.ok(
  scratchCylinder.topology.graph?.halfEdges.every(edge => edge.pair !== -1),
  'Welded scratch cylinder must have closed manifold half-edge pairing.',
);

const scratchPyramid = staticMeshAssetAPI.createPrimitiveMesh({
  name: 'Scratch_Pyramid',
  path: '/Tests',
  kind: 'PYRAMID',
});
assert.equal(scratchPyramid.topology.faces.length, 5, 'Scratch pyramid must have 1 base quad + 4 side triangles.');
assert.ok(
  scratchPyramid.topology.graph?.halfEdges.every(edge => edge.pair !== -1),
  'Welded scratch pyramid must have closed manifold half-edge pairing.',
);

const scratchGrid = staticMeshAssetAPI.createPrimitiveMesh({
  name: 'Scratch_Grid',
  path: '/Tests',
  kind: 'GRID',
  segmentsX: 3,
  segmentsZ: 2,
});
assert.equal(scratchGrid.topology.faces.length, 6, '3x2 grid must have 6 welded quad faces.');

// Raw vertex + face authoring from an empty mesh
const rawScratchMesh = staticMeshAssetAPI.create({ name: 'Raw_Scratch_Mesh', path: '/Tests' });
const rawVerts = staticMeshAssetAPI.addVertices({
  assetId: rawScratchMesh.id,
  positions: [
    { x: -1, y: 0, z: -1 },
    { x: -1, y: 0, z: 1 },
    { x: 1, y: 0, z: 1 },
    { x: 1, y: 0, z: -1 },
  ],
});
assert.deepEqual(rawVerts, [0, 1, 2, 3]);
const rawFace = staticMeshAssetAPI.createFace({
  assetId: rawScratchMesh.id,
  vertexIds: rawVerts,
});
assert.equal(rawFace.faceId, 0);
assert.equal(rawFace.triangleIds.length, 2);

// Connect two opposite vertices on rawScratchMesh and then weld them
const connectResult = staticMeshAssetAPI.connectVertices({
  assetId: rawScratchMesh.id,
  vertexIds: [0, 2],
});
assert.equal(connectResult.cuts.length, 1);
assert.equal(rawScratchMesh.topology.faces.length, 2);

const weldResult = staticMeshAssetAPI.weldVertices({
  assetId: rawScratchMesh.id,
  vertexIds: [0, 1],
  mode: 'AVERAGE',
});
assert.equal(weldResult.removedDegenerateFaces, 1, 'Welding an edge of a triangle collapses that triangle cleanly.');
assert.equal(rawScratchMesh.topology.faces.length, 1, 'The remaining triangle face survives after weld.');

// Declarative AI multi-step modeling pipeline with semantic queries
const aiTowerAsset = staticMeshAssetAPI.create({ name: 'AI_Tower_Pipeline', path: '/Tests' });
const pipelineResult = staticMeshAssetAPI.runModelingSteps({
  assetId: aiTowerAsset.id,
  label: 'Build AI Tower',
  steps: [
    {
      op: 'ADD_PRIMITIVE',
      kind: 'BOX',
      size: { x: 2, y: 2, z: 2 },
    },
    {
      op: 'INSET_FACES',
      faceQuery: { directionTag: 'TOP', limit: 1 },
      ratio: 0.25,
    },
    {
      op: 'EXTRUDE_FACES',
      faceQuery: { directionTag: 'TOP', sortBy: 'MIN_AREA', limit: 1 },
      distance: 1.5,
    },
    {
      op: 'TRANSFORM_FACES',
      faceQuery: { directionTag: 'TOP', sortBy: 'MAX_Y', limit: 1 },
      scale: 0.75,
      normalOffset: 0.25,
    },
  ],
});
assert.equal(pipelineResult.stepsExecuted, 4);
assert.equal(pipelineResult.inspection.faceCount, 14, 'Box (6) + Inset (4) + Extrude (4) = 14 logical faces.');
assert.equal(pipelineResult.inspection.isClosedManifold, true, 'AI tower pipeline must remain a closed manifold mesh.');
assert.equal(aiTowerAsset.construction, undefined, 'AI modeling pipeline must not leave construction metadata.');

// Verify atomic rollback when a later step in runModelingSteps fails
assert.throws(
  () =>
    staticMeshAssetAPI.runModelingSteps({
      assetId: aiTowerAsset.id,
      label: 'Invalid AI Step Rollback',
      steps: [
        {
          op: 'INSET_FACES',
          faceQuery: { directionTag: 'TOP', sortBy: 'MAX_Y', limit: 1 },
          ratio: 0.2,
        },
        {
          op: 'EXTRUDE_FACES',
          faceQuery: { directionTag: 'TOP', minArea: 999999 }, // matches 0 faces -> throws
          distance: 1.0,
        },
      ],
    }),
  /matched 0 logical faces/i,
);
const towerAfterRollback = assetManager.getAsset(aiTowerAsset.id) as StaticMeshAsset;
assert.equal(towerAfterRollback.topology.faces.length, 14, 'Failed runModelingSteps transaction must roll back all earlier steps.');

assetManager.deleteAsset(scratchBox.id);
assetManager.deleteAsset(scratchCylinder.id);
assetManager.deleteAsset(scratchPyramid.id);
assetManager.deleteAsset(scratchGrid.id);
assetManager.deleteAsset(rawScratchMesh.id);
assetManager.deleteAsset(aiTowerAsset.id);

console.log('Static Mesh modeling API tests passed.');
console.log(JSON.stringify({
  floor: {
    points: storedFloor.construction?.points.length,
    faces: storedFloor.construction?.faces.length,
    loops: storedFloor.construction?.loops.length,
    vertices: storedFloor.geometry.vertices.length / 3,
    triangles: storedFloor.geometry.indices.length / 3,
  },
  extrudeNormal: {
    distance: normalDistance,
    offset: expectedNormalOffset,
    topFaceId: normalExtrusion.topFaceId,
    followsFaceNormal: true,
  },
  inset: {
    stableFaceId: inset.innerFaceId,
    innerPoints: inset.innerPointIds.length,
    borderFaces: inset.borderFaceIds.length,
    shells: resolveStaticMeshShells(insetAsset).length,
    postInsetExtrudeUsesSameFace: postInsetExtrusion.sourceFaceId === inset.innerFaceId,
  },
  deleteFace: {
    remainingFaces: deleteAsset.construction?.faces.length,
    remainingTriangles: deleteAsset.geometry.indices.length / 3,
    shells: resolveStaticMeshShells(deleteAsset).length,
    undoRedo: staticMeshAssetAPI.getHistoryState(deleteAsset.id).undoLabel === 'Delete Construction Face',
  },
  history: {
    undoRedoInset: historyAsset.construction?.faces.length === 5,
    groupedTransactionLabel: staticMeshAssetAPI.getHistoryState(transactionAsset.id).undoLabel,
    groupedPointsAfterRedo: transactionAsset.construction?.points.length,
  },
  uiCommands: {
    inset: editorCommandRegistry.resolve('staticMesh.inset', topologyCommandContext)?.isEnabled === true,
    deleteFace: editorCommandRegistry.resolve('staticMesh.deleteFace', topologyCommandContext)?.isEnabled === true,
    splitEdge: editorCommandRegistry.resolve('staticMesh.splitEdge', splitCommandContext)?.isEnabled === true,
    bevel: editorCommandRegistry.resolve('staticMesh.bevel', splitCommandContext)?.isEnabled === true,
    cutFace: editorCommandRegistry.resolve('staticMesh.cutFace', cutCommandContext)?.isEnabled === true,
    edgeRing: editorCommandRegistry.resolve('staticMesh.selection.ring', topologyQueryCommandContext)?.isEnabled === true,
    quadStrip: editorCommandRegistry.resolve('staticMesh.selection.quadStrip', topologyQueryCommandContext)?.isEnabled === true,
  },
  splitEdge: {
    pointId: split.pointId,
    updatedFaces: split.updatedFaceIds.length,
    updatedLoops: split.updatedLoopIds.length,
    vertices: splitAsset.geometry.vertices.length / 3,
    triangles: splitAsset.geometry.indices.length / 3,
    shells: resolveStaticMeshShells(splitAsset).length,
    undoRedo: staticMeshAssetAPI.getHistoryState(splitAsset.id).undoLabel === 'Split Construction Edge',
  },
  bevelEdge: {
    bevelFaceId: bevel.bevelFaceId,
    offsetPoints: bevel.sidePointIds.flat().length,
    faces: bevelAsset.construction?.faces.length,
    vertices: bevelAsset.geometry.vertices.length / 3,
    triangles: bevelAsset.geometry.indices.length / 3,
    shells: resolveStaticMeshShells(bevelAsset).length,
    undoRedo: staticMeshAssetAPI.getHistoryState(bevelAsset.id).undoLabel === 'Bevel Construction Edge',
  },
  segmentedBevel: {
    segments: segmentedBevel.segments,
    profile: segmentedBevel.profile,
    stripFaces: segmentedBevel.bevelFaceIds.length,
    profileRails: segmentedBevel.profileEdgeIds.length,
    terminalProfilePlaneMaxError,
    manifoldPaired: segmentedBevelFixture.asset.topology.graph?.halfEdges.every(edge => edge.pair !== -1) ?? false,
  },
  bevelHighValence: {
    endpointValence: [endpointAValence, endpointBValence],
    endpointCaps: highValenceBevel.endpointCapFaceIds.length,
    faces: bevelValenceAsset.construction?.faces.length,
    vertices: bevelValenceAsset.geometry.vertices.length / 3,
    shells: resolveStaticMeshShells(bevelValenceAsset).length,
    manifoldPaired: highValenceGraph.halfEdges.every(edge => edge.pair !== -1),
  },
  cutFace: {
    sourceFaceId: cut.sourceFaceId,
    newFaceId: cut.newFaceId,
    faces: cutAsset.construction?.faces.length,
    vertices: cutAsset.geometry.vertices.length / 3,
    triangles: cutAsset.geometry.indices.length / 3,
    shells: resolveStaticMeshShells(cutAsset).length,
    sharedCutEdgePaired: cutHalfEdge?.pair !== -1,
    undoRedo: staticMeshAssetAPI.getHistoryState(cutAsset.id).undoLabel === 'Cut Construction Face',
  },
  faceHighlight: {
    selectedLogicalFaces: 2,
    selectedRenderTriangles: highlightedRingFaces.triangleCount,
    hoveredRenderTriangles: hoveredRingFace.triangleCount,
  },
  normalModeling: {
    requiresAdoption: false,
    constructionPersisted: false,
    insetDirect: panelNormalInset.innerFaceId === 0,
    deleteDirect: normalDeleteResult.deletedFaceId === 0,
    splitDirect: normalSplitResult.updatedFaceIds.length === 2,
    cutDirect: normalCutResult.newFaceId >= 0,
    extrudeDirect: secondBoxExtrusion.topFaceId === boxFixture.primaryFaceId,
    bevelDirect: normalBevelResult.bevelFaceId >= 0,
    highValenceBevelDirect: normalHighValenceBevel.endpointCapFaceIds.length === 2,
    undoRedo: true,
    invalidatesStalePlanningMetadata: planningMetadataRestored,
  },
  insetOrientation: {
    horizontal: insetOrientationResults[0]?.innerVertices === 4,
    verticalCollinear: insetOrientationResults[1]?.innerVertices === 5,
    warpedSloped: insetOrientationResults[2]?.innerVertices === 4,
    faceNormalLines: faceNormalLines.length / 6,
    vertexNormalLines: vertexNormalLines.length / 6,
  },
  multiFaceInset: {
    selectedFaces: multiInsetResult.results.length,
    innerFaces: multiInsetResult.innerFaceIds.length,
    borderFaces: multiInsetResult.borderFaceIds.length,
    shells: resolveStaticMeshShells(multiInsetAsset).length,
    undoRedo: staticMeshAssetAPI.getHistoryState(multiInsetAsset.id).undoLabel === 'Inset Faces',
  },
  multiEdgeBevel: {
    selectedEdges: multiBevelResult.results.length,
    bevelFaces: multiBevelResult.bevelFaceIds.length,
    resultingEdges: multiBevelResult.bevelEdgeIds.length,
    shells: resolveStaticMeshShells(multiBevelAsset).length,
    manifoldPaired: multiBevelAsset.topology.graph?.halfEdges.every(edge => edge.pair !== -1) ?? false,
    undoRedo: staticMeshAssetAPI.getHistoryState(multiBevelAsset.id).undoLabel === 'Bevel Edges',
  },
  connectedBevel: {
    twoEdgeFaces: connectedTwoFaceCount,
    threeEdgeFaces: connectedThreeFaceCount,
    valence4CornerFaces: connectedValenceCornerCount,
    loopFaces: connectedLoopFaceCount,
    segmentedLoopFaces: segmentedLoopFaceCount,
    segmentedLoopCornerFaces: segmentedLoopCornerFaceCount,
    segmentedAdjCornerFaces: segmentedAdjCornerFaceCount,
    segmentedAdjEvenCornerFaces: segmentedAdjEvenCornerFaceCount,
    fullCubeFaces: fullCubeFaceCount,
    segmentedCubeFaces: segmentedCubeFaceCount,
    clampedEffectiveWidth,
    repeatedNgonMaxVertices,
    repeatedEffectiveWidth,
    warpedFaceCount: warpedBevelFaceCount,
    flaredEndpointWidth: flaredBevelWidth,
    straightTerminalFaces: straightTerminalFaceCount,
    segmentedStraightChainFaces: straightChainFaceCount,
    openTerminalFanFaces: openTerminalFanFaceCount,
    openRimNoCapFaces: openRimNoCapFaceCount,
    segmentedTerminalTriFanFaces: segmentedTerminalTriFanFaceCount,
    weldedCollapsedEndpointFaces: weldedEndpointFaceCount,
    weldedCoincidentPairs: weldedEndpointCoincidentPairs,
    jointCornerPatch: connectedThreeBevel.cornerFaceIds.length === 1,
  },
  legacyAdoptCompatibility: {
    points: adoption.pointsCreated,
    faces: adoption.facesCreated,
    loops: adoption.loopsCreated,
    geometryUnchanged: true,
    undoRedo: redoneNormalAsset.construction?.faces.length === 6,
  },
  topologyQueries: {
    faceKind: ringFaceInfo?.kind,
    oppositeEdge: opposite?.oppositeEdge.vertexIds,
    ringEdges: ringTrace.edgeIds.length,
    quadStripFaces: ringTrace.faceIds.length,
    closed: ringTrace.closed,
    termination: [ringTrace.startTermination, ringTrace.endTermination],
  },
  gizmoHistory: {
    cancelRestoresGeometry: gizmoAsset.geometry.vertices[gizmoVertexId * 3] === 0,
    cancelCreatesNoUndo: !cancelledDragCreatedUndo,
    selectionPreserved: selectedVertexIds.has(gizmoVertexId),
    restoredGizmoX: renderedGizmoPosition.x,
  },
  bridge: {
    points: bridgeAsset.construction?.points.length,
    faces: bridgeAsset.construction?.faces.length,
    loops: bridgeAsset.construction?.loops.length,
    vertices: bridgeAsset.geometry.vertices.length / 3,
    triangles: bridgeAsset.geometry.indices.length / 3,
  },
  faceCore: {
    adjacentFaces: adjacentFacesAsset.topology.faces.length,
    vertices: adjacentFacesAsset.geometry.vertices.length / 3,
    shells: resolveStaticMeshShells(adjacentFacesAsset).length,
    sharedHalfEdgePaired: sharedHalfEdge?.pair !== -1,
  },
  shells: {
    sharedVertex: resolveStaticMeshShells(sharedVertexAsset).length,
    coincidentOnly: resolveStaticMeshShells(coincidentOnlyAsset).length,
  },
  manualFixture: {
    command: 'smTest()',
    cleanBaselineHistory: true,
    replacesPreviousFixture: true,
    splitReady: true,
    cutReady: true,
    ringReady: true,
    boxReady: true,
    bevelReady: true,
    bevelHighValenceReady: true,
    extrudeNormalReady: true,
    insetOrientationReady: true,
    normalMeshDirectEditing: true,
    constructionHiddenFromManualFixtures: true,
    staleEditorClosedOnDelete: windowsAfterFixtureDelete[`editor_${ringFixture.assetId}`] === undefined,
  },
}, null, 2));
