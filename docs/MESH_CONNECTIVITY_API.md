# Mesh Connectivity API

Static Mesh modeling and influence tools share one runtime connectivity contract in
`engine/mesh-editing/MeshConnectivity.ts`.

## Why this exists

A render mesh is triangulated, but modeling tools operate on authored/logical polygon
topology. Triangle index buffers may contain diagonals that are not real modeling
edges. Imported meshes can also contain duplicate render vertices at UV seams or
hard-normal boundaries that still represent one logical point.

Connectivity therefore comes from:

1. `LogicalMesh.faces` for authored polygon boundary edges.
2. `LogicalMesh.siblings` for persistent seam/hard-edge weld groups.

Current vertex positions do not create connectivity. Moving unrelated vertices into the same
position must never weld them automatically. Existing seam/hard-edge sibling welds are a
persistent topology relationship, but direct component deformation can intentionally move only
part of one render-vertex sibling group. At the geometry-edit transaction boundary,
`reconcileMeshSiblingGroupsAfterGeometryEdit(...)` validates those **existing** welds and may
split a group whose members no longer coincide. It never creates a new sibling relationship.

## Runtime cache

`getMeshConnectivity(mesh, vertexCount)` builds and caches:

- raw vertex -> canonical/welded logical vertex
- canonical vertex -> member render vertices
- canonical vertex -> neighboring canonical vertices
- canonical vertex -> incident logical faces
- logical face -> canonical member vertices
- canonical logical edge -> incident logical faces

Position samples during a drag do not invalidate this cache. At mouse-up/finalization, direct
Static Mesh deformation runs sibling reconciliation once; if an existing weld split, the
connectivity cache and propagated `vertexToFaces` map are rebuilt. A future explicit
topology-changing operation such as Extrude, Weld, Delete Face, Connect, Detach, or Cut must
rebuild the logical topology/sibling data and then call:

```ts
MeshConnectivityAPI.invalidate(asset.topology);
```


## Deformation finalization and weld splitting

A generated/imported mesh may use several render vertices for one logical point. The built-in
cube is the common example: 24 render vertices are welded into 8 logical corner groups, so its
six polygon faces form one shell.

If a component edit moves only one side of such a group (for example moving the top face while
its side-face duplicates stay behind), the old sibling record is no longer valid. Static Mesh
finalization therefore performs a **split-only** reconciliation:

1. start from the sibling groups that already exist;
2. partition each existing group by the same positional quantization used by import/generation;
3. keep coincident subsets as sibling groups and drop singleton members;
4. rebuild propagated `vertexToFaces`;
5. invalidate `MeshConnectivity`;
6. let shell resolution rematerialize `StaticMeshAsset.shells`.

This is intentionally not a spatial weld pass. Two independent FBX nodes or appended shells
can occupy exactly the same coordinates and still remain separate until an explicit Weld/Connect
operation changes their topology.

## Public queries

```ts
MeshConnectivityAPI.reconcileExistingSiblingsAfterGeometryEdit(mesh, vertices)
MeshConnectivityAPI.neighbors(mesh, vertexId, vertexCount)
MeshConnectivityAPI.areAdjacent(mesh, a, b, vertexCount)
MeshConnectivityAPI.edgeFaces(mesh, a, b, vertexCount)
MeshConnectivityAPI.sharedFaceEdge(mesh, faceA, faceB, vertexCount)
MeshConnectivityAPI.surfaceDistances(mesh, vertices, sources, maxDistance)
MeshConnectivityAPI.faceAwareSurfaceDistances(mesh, vertices, sources, maxDistance)
MeshConnectivityAPI.connectedMask(mesh, vertices, sources, options)
MeshConnectivityAPI.shortestVertexPath(mesh, vertices, start, end)
```

For a tool that performs several queries against one mesh, use the ergonomic view:

```ts
const connectivity = MeshConnectivityAPI.forMesh(
  asset.topology,
  asset.geometry.vertices,
);

const neighbors = connectivity.neighbors(vertexId);
const path = connectivity.shortestVertexPath(startVertex, endVertex);
const mask = connectivity.connectedMask(selectedVertices, {
  mode: 'FLOOD_WITHIN_RADIUS',
  radius: 1.5,
});
```

## Topology connectivity versus influence distance

These are intentionally separate concepts.

`neighbors()` and loop/modeling operations use **authored polygon edges only**. A
quad's hidden render-triangle diagonal is never promoted into a modeling edge.

Influence tools may use a richer metric without changing topology semantics:

- `surfaceDistances(...)` — Dijkstra on authored polygon edges.
- `faceAwareSurfaceDistances(...)` — Dijkstra plus virtual face-center nodes. This
  lets influence travel through a quad/ngon interior and avoids the strongly
  cross/diamond-shaped expansion of edge-only distance.
- `connectedMask(..., SAME_ISLAND)` — flood the whole connected component.
- `connectedMask(..., FLOOD_WITHIN_RADIUS)` — walk logical neighbors but stop a
  branch when the next vertex lies outside the Euclidean brush radius. This is a
  cheap connected-volume query useful for skinning/deformer/sculpt brushes.

Virtual face-center links are **metric-only**. They must never appear from
`neighbors()`, `edgeFaces()`, Loop selection, valence checks, or topology-editing
commands.

## Soft-selection influence model

Soft selection composes two orthogonal settings:

```ts
Distance: VOLUME | SURFACE | HYBRID
Connectivity: NONE | SAME_ISLAND | FLOOD_WITHIN_RADIUS
```

`HYBRID` blends the final Volume and Surface weights with a `surfaceBlend` value in
`[0, 1]`. Connectivity is then applied as a mask. This avoids creating a different
hard-coded algorithm for every combination.

Surface/Hybrid influence uses `faceAwareSurfaceDistances`. Volume remains Euclidean
distance from the current selection center.

## Loop versus shortest path

A topology **loop** and a **shortest path** are different operations:

- Edge/Face/Vertex Loop follows quad/strip topology and remains in
  `MeshTopologyUtils`.
- Shortest Path minimizes accumulated authored-edge length and lives in
  `MeshConnectivityAPI.shortestVertexPath`.
- Soft-selection Surface distance may use virtual face centers because it is a
  weighting metric, not a topology traversal command.

Do not implement loop selection by repeatedly choosing the geometrically shortest
neighbor; poles, triangles, and irregular valence need explicit loop rules.
