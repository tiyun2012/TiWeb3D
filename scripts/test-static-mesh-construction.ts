import assert from 'node:assert/strict';

import { assetManager } from '@/engine/AssetManager';
import { assetHistory } from '@/engine/AssetHistory';
import { staticMeshAssetAPI } from '@/engine/api/StaticMeshAssetAPI';
import { GizmoSystem } from '@/engine/GizmoSystem';
import { buildMeshFaceTriangleIndices } from '@/engine/MeshFaceGeometry';
import { editorCommandRegistry, type EditorCommandCapability, type EditorCommandContext } from '@/editor/commands/EditorCommandRegistry';
import '@/editor/commands/StaticMeshCommandCatalogue';
import { resolveStaticMeshShells } from '@/engine/mesh-editing/StaticMeshShells';
import { clearStaticMeshTestFixtures, createStaticMeshTestFixture } from '@/engine/dev/StaticMeshTestFixtures';
import { removeWindowsForDeletedAsset } from '@/editor/assetEditorWindowLifecycle';
import type { StaticMeshAsset } from '@/types';

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
assert.equal(floor.geometry.vertices.length / 3, 8);
assert.equal(floor.topology.faces.length, 6);
assert.equal(floor.geometry.indices.length / 3, 12);
assert.ok(staticMeshAssetAPI.getPoint(floor.id, extrusion.topPointIds[0]));

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
  amount: 0.5,
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
], 'A 0.5 inset of a 4x4 face must create a constant-width 3x3 inner boundary.');

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
  () => staticMeshAssetAPI.insetFace({ assetId: insetAsset.id, faceId: insetSourceFace.id, amount: 10 }),
  /too large/,
  'Inset must reject an amount that collapses or crosses the source face.',
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
  amount: 0.5,
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
  amount: 0.5,
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
assert.equal(transactionAsset.construction?.points.length, 0, 'One undo must revert the whole grouped AI transaction.');
assert.equal(transactionAsset.construction?.faces.length, 0);
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
assert.equal(storedFloor.construction?.faces.length, 6);
assert.equal(storedFloor.construction?.loops.length, 1);

// Manual browser-console fixtures must be deterministic and disposable. The
// fixture itself is a clean baseline, so its setup must not occupy Undo history.
const panelFixture = createStaticMeshTestFixture('panel');
assert.equal(panelFixture.asset.construction?.points.length, 4);
assert.equal(panelFixture.asset.construction?.faces.length, 1);
assert.equal(panelFixture.asset.geometry.vertices.length / 3, 4);
assert.equal(panelFixture.asset.geometry.indices.length / 3, 2);
assert.equal(panelFixture.primaryFaceId, 'face:panel');
assert.equal(staticMeshAssetAPI.getHistoryState(panelFixture.assetId).canUndo, false, 'Fixture setup must leave clean asset history.');

staticMeshAssetAPI.insetFace({
  assetId: panelFixture.assetId,
  faceId: panelFixture.primaryFaceId!,
  id: 'inset:manual-check',
  amount: 0.25,
});
assert.equal(staticMeshAssetAPI.getHistoryState(panelFixture.assetId).undoLabel, 'Inset Construction Face');

const insetFixture = createStaticMeshTestFixture('inset');
assert.equal(assetManager.getAsset(panelFixture.assetId), undefined, 'Creating a new fixture must remove the previous TEST_StaticMesh_* asset.');
assert.equal(insetFixture.asset.construction?.faces.length, 5);
assert.equal(insetFixture.asset.construction?.loops.length, 1);
assert.equal(insetFixture.primaryFaceId, 'face:panel');
assert.equal(staticMeshAssetAPI.getHistoryState(insetFixture.assetId).canUndo, false);
assert.equal(clearStaticMeshTestFixtures(), 1);
assert.equal(assetManager.getAsset(insetFixture.assetId), undefined);

const splitFixture = createStaticMeshTestFixture('split');
assert.equal(splitFixture.asset.construction?.faces.length, 2);
assert.equal(splitFixture.asset.construction?.loops.length, 1);
assert.deepEqual(splitFixture.primaryEdgePointIds, ['A', 'C']);
assert.equal(splitFixture.asset.geometry.vertices.length / 3, 4);
assert.equal(splitFixture.asset.geometry.indices.length / 3, 2);
assert.equal(staticMeshAssetAPI.getHistoryState(splitFixture.assetId).canUndo, false);
assert.equal(clearStaticMeshTestFixtures(), 1);
assert.equal(assetManager.getAsset(splitFixture.assetId), undefined);

const cutFixture = createStaticMeshTestFixture('cut');
assert.equal(cutFixture.asset.construction?.faces.length, 1);
assert.deepEqual(cutFixture.primaryCutPointIds, ['A', 'C']);
assert.equal(cutFixture.asset.geometry.vertices.length / 3, 4);
assert.equal(cutFixture.asset.geometry.indices.length / 3, 2);
assert.equal(staticMeshAssetAPI.getHistoryState(cutFixture.assetId).canUndo, false);
assert.equal(clearStaticMeshTestFixtures(), 1);
assert.equal(assetManager.getAsset(cutFixture.assetId), undefined);

const ringFixture = createStaticMeshTestFixture('ring');
assert.equal(ringFixture.asset.construction?.faces.length, 4);
assert.equal(ringFixture.asset.geometry.vertices.length / 3, 10);
assert.deepEqual(ringFixture.primaryEdgePointIds, ['B2', 'T2']);
const ringB2 = staticMeshAssetAPI.getPoint(ringFixture.assetId, 'B2')!.vertexIds![0];
const ringT2 = staticMeshAssetAPI.getPoint(ringFixture.assetId, 'T2')!.vertexIds![0];
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
assert.deepEqual(new Set(opposite.oppositeEdge.constructionPointIds), new Set(['B1', 'T1']));
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
assert.equal(ringTrace.constructionFaceIds.length, 4);
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

console.log('Static Mesh construction API tests passed.');
console.log(JSON.stringify({
  floor: {
    points: storedFloor.construction?.points.length,
    faces: storedFloor.construction?.faces.length,
    loops: storedFloor.construction?.loops.length,
    vertices: storedFloor.geometry.vertices.length / 3,
    triangles: storedFloor.geometry.indices.length / 3,
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
  topologyQueries: {
    faceKind: ringFaceInfo?.kind,
    oppositeEdge: opposite?.oppositeEdge.constructionPointIds,
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
    staleEditorClosedOnDelete: windowsAfterFixtureDelete[`editor_${ringFixture.assetId}`] === undefined,
  },
}, null, 2));
