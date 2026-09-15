import assert from 'node:assert/strict';

import { assetManager } from '@/engine/AssetManager';
import { staticMeshAssetAPI } from '@/engine/api/StaticMeshAssetAPI';
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
