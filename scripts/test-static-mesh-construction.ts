import assert from 'node:assert/strict';

import { assetManager } from '@/engine/AssetManager';
import { assetHistory } from '@/engine/AssetHistory';
import { staticMeshAssetAPI } from '@/engine/api/StaticMeshAssetAPI';
import { GizmoSystem } from '@/engine/GizmoSystem';
import { resolveStaticMeshShells } from '@/engine/mesh-editing/StaticMeshShells';
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

assert.throws(
  () => staticMeshAssetAPI.insetFace({ assetId: insetAsset.id, faceId: insetSourceFace.id, amount: 10 }),
  /too large/,
  'Inset must reject an amount that collapses or crosses the source face.',
);

const postInsetExtrusion = staticMeshAssetAPI.extrudeFace({
  assetId: insetAsset.id,
  faceId: inset.innerFaceId,
  id: 'extrude:inset-panel',
  distance: 1,
});
assert.equal(postInsetExtrusion.sourceFaceId, insetSourceFace.id, 'The same semantic face handle must remain usable after inset.');
assert.equal(postInsetExtrusion.sideFaceIds.length, 4);

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
localGizmo.renderInSelectTool = true;
localGizmo.render();
assert.equal(renderedGizmoPosition.x, 0, 'Gizmo must initially derive its pivot from the selected vertex.');

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
  history: {
    undoRedoInset: historyAsset.construction?.faces.length === 5,
    groupedTransactionLabel: staticMeshAssetAPI.getHistoryState(transactionAsset.id).undoLabel,
    groupedPointsAfterRedo: transactionAsset.construction?.points.length,
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
}, null, 2));
