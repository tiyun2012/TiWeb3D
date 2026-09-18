# Static Mesh Normal Modeling API

## Purpose

The normal Static Mesh modeller is authoritative on **MeshGeometry + LogicalMesh**. Human editing must not
require a second semantic/Construction topology layer.

```text
StaticMeshAsset
├─ geometry                  render vertex/index buffers
├─ topology: LogicalMesh     authoritative polygon topology
│  ├─ faces                  logical polygon boundaries
│  ├─ triangleToFaceIndex    render-triangle -> logical-face mapping
│  ├─ siblings               explicit logical weld/seam identity
│  └─ graph                  half-edge/connectivity cache
└─ shells                    derived naming/provenance metadata
```

The Static Mesh editor, component selection, Mesh Shells, topology queries, modeling commands, gizmo,
and Undo/Redo all operate from this normal mesh state.

`StaticMeshAsset.construction` remains optional legacy/planning metadata for compatibility and future AI
experiments. It is **not displayed by the normal Static Mesh editor and is not required or persisted by
normal modeling operations**.

## Normal modeling IDs

Normal modeling uses the IDs already present in the mesh:

- face: numeric index into `asset.topology.faces`
- vertex: numeric mesh vertex ID
- edge: unordered pair of vertex IDs / `meshEdgeKey(a, b)`
- Mesh Shell: topology-derived shell ID

Examples:

```ts
staticMeshAssetAPI.extrudeFace({
  assetId,
  faceId: 4,
  distance: 1,
});

staticMeshAssetAPI.insetFace({
  assetId,
  faceId: 4,
  ratio: 0.15,
});

`ratio` is scale-independent: each face vertex moves toward the arithmetic face center by that fraction.
The normal editor uses this as the default Inset, so warped/non-planar logical faces can still be inset.
The UI range is `0.005..0.99`; API validation remains the stricter open interval `0 < ratio < 1`.

staticMeshAssetAPI.splitEdge({
  assetId,
  vertexAId: 12,
  vertexBId: 18,
  t: 0.5,
});

staticMeshAssetAPI.cutFace({
  assetId,
  faceId: 4,
  vertexAId: 12,
  vertexBId: 30,
});

staticMeshAssetAPI.bevelEdge({
  assetId,
  vertexAId: 12,
  vertexBId: 18,
  width: 0.2,
});
```

Normal operations currently supported through this path are:

- `extrudeFace()`
- `insetFace()`
- `deleteFace()`
- `splitEdge()`
- `cutFace()`
- `bevelEdge()`

The UI calls these same numeric-ID overloads. It does not adopt or synthesize persistent semantic IDs before
editing.

## Transitional implementation bridge

The mature first-generation topology algorithms were originally written against Construction Point/Face
records. During this refactor, numeric normal-mesh operations reuse those algorithms through an **internal,
transient adapter**:

```text
normal LogicalMesh input
        ↓
transient semantic adapter (internal only)
        ↓
existing validated topology algorithm
        ↓
normal geometry + LogicalMesh result
        ↓
transient adapter discarded before commit
```

This is an implementation detail, not an editor/data contract. A successful normal operation must end with:

```ts
asset.construction === undefined
```

Normal human modeling also intentionally invalidates/removes pre-existing optional Construction/planning metadata instead of attempting to synchronize a second semantic topology through arbitrary manual edits. Undo restores the complete pre-edit snapshot, including that optional metadata. This prevents stale planning points/faces from silently drifting away from the mesh.

The adapter must never become a prerequisite for the UI, selection, topology query, persisted normal asset, or external normal-modeling API.

Future cleanup may move the algorithms themselves directly onto numeric logical topology. The public normal
API should not need to change when that happens.

## Stable face behavior

Where practical, operations preserve the selected logical face ID so a modeller can continue without
reselection.

- Inset: the selected face ID becomes the inner face; border faces are appended.
- Extrude: the selected face ID moves to the new top boundary; side faces are appended and the source surface
  is consumed.
- Cut: one side keeps the selected face ID and the other side gets a new face ID.

Delete compacts logical face IDs because the face is removed. Callers should use the returned result and/or
current selection after destructive compaction rather than caching unrelated numeric face IDs forever.

## Extrude direction

Face Extrude is normal-driven. The ordered logical face boundary determines the face normal and every new top
vertex is offset by:

```text
newPosition = oldPosition + faceNormal * distance
```

Positive distance follows the current face normal; negative distance moves opposite. The API itself does not
activate a gizmo. The Static Mesh editor activates Move after a UI Extrude as a modeller convenience.

## Topology queries

Read-only topology intelligence is also normal-mesh-first and contains no Construction fields:

- `getFaceInfo()` / `isQuadFace()` / `getFaceBoundary()`
- `getEdgeFaceIds()`
- `getAdjacentFacesAcrossEdge()` / `getAdjacentFaceAcrossEdge()`
- `getOppositeEdge()`
- `traceEdgeRing()` / `traceFaceStrip()`

`StaticMeshTopologyEdgeInfo` reports numeric `vertexIds` and `canonicalVertexIds`. A ring trace reports numeric
`faceIds` and edge IDs. These queries do not mutate geometry or create history.

## Mesh Shell and sibling rules

Normal modeling must preserve the existing connectivity contract:

- sharing an actual vertex means connected topology;
- explicit `LogicalMesh.siblings` may identify duplicated render vertices as one canonical logical vertex;
- equal XYZ positions alone never create a weld;
- Mesh Shells are derived from logical/canonical vertex connectivity, not from Construction metadata.

## Undo / Redo

Each normal modeling API call is one asset-history transaction unless it runs inside an explicit outer
transaction. Undo/Redo restores geometry, LogicalMesh, half-edge graph, normals, AABB, sibling state, and Mesh
Shell metadata together.

The transform gizmo is derived UI state. It is never restored as an independent history object; after history
restore it is recomputed from the still-valid component selection.

## Editor contract

The normal Static Mesh hierarchy contains only normal mesh information:

```text
Static Mesh
└─ Geometry
   ├─ Mesh Shells
   │  └─ ... shell-local Vertices / Edges / Faces
   └─ Components
      ├─ Vertices
      ├─ Edges
      └─ Faces
```

There is no Construction branch and no Adopt Topology button. Selecting a normal logical face/edge/vertex is
enough to enable supported topology operations.

## Manual fixtures

`smTest(...)` now always returns a **normal Logical Mesh fixture with no Construction metadata**, even though the
developer helper may use legacy semantic builders internally to assemble deterministic geometry quickly.

Useful fixtures:

```js
smTest()                  // 4-vertex logical quad
smTest('inset')           // already inset normal panel
smTest('box')             // closed normal box
smTest('split')           // two triangles sharing an edge
smTest('cut')             // one quad with opposite cut vertices logged
smTest('ring')            // four connected quads
smTest('bevel')           // normal valence-3 bevel edge
smTest('bevel-valence')   // normal valence-4 bevel edge
smTest('extrude-normal')  // tilted quad
```

The browser console reports numeric targets such as `primaryFaceId`, `primaryEdgeVertices`, and
`primaryCutVertices`.

## Legacy / future planning layer

The old string-ID Construction API remains available for compatibility and future AI experimentation. It should
be treated as a separate planning layer, not as normal mesh topology. `adoptTopology()` likewise remains a legacy
compatibility helper and is intentionally not exposed in the normal editor.

If an AI-specific planning workflow is revisited later, it should use a dedicated planning/query surface rather
than reintroducing Construction selection into the human Static Mesh editor.

## Relative center inset

`insetFace()` now uses a scale-independent **relative center inset** by default. It does not project the
face to a world or local plane. For each ordered boundary vertex `v`, the new inner vertex is:

```ts
inner = lerp(v, faceCenter, ratio)
```

where `faceCenter` is the arithmetic mean of the boundary vertices. API validation accepts the strict open
interval `0 < ratio < 1`; the editor exposes the safer working range `0.005..0.99`.

Because this is a uniform 3D scale about one center, it preserves the source boundary's ordering and shape
without requiring planarity. It therefore works on:

- horizontal floor/top faces;
- vertical wall faces;
- sloped roof faces;
- deliberately warped/non-planar logical faces;
- convex or concave ordered polygons;
- boundaries containing collinear vertices introduced by `splitEdge()`.

The older constant-width planar math remains in `engine/mesh-editing/MeshPlanarGeometry.ts` as an internal
helper for a future explicit **Even Inset** mode. It is no longer the default human-modeling operation.

For manual testing use:

```js
smTest('inset-orient')
```

The fixture contains three normal Logical Mesh faces: horizontal, vertical with one collinear boundary
vertex, and a deliberately warped/sloped face. All three should accept the same relative Inset ratio.

## Viewport Display menu

The Static Mesh viewport owns a centered **Display** eye widget. The shared top toolbar uses a three-column layout so left/center/right controls cannot occupy the same horizontal slot. The popover is rendered through a viewport-independent portal, clamps to the browser bounds, and flips above the trigger when there is not enough room below. It is presentation-only and does not mutate
mesh topology or create asset history. Current controls are:

- shading mode;
- grid;
- wireframe;
- Face-mode selection fill;
- face normals;
- vertex normals;
- normal display size.

Face normals are derived from ordered logical polygon boundaries, not render-triangle diagonals. Vertex normals
use the mesh's stored normal buffer. Normal lines are debug overlays only and do not participate in picking.

## Batch selection modeling: multi-face Inset and multi-edge Bevel

The normal modeller now treats the current component selection as the batch boundary for two operations:

- `insetFaces({ assetId, faceIds, ratio })` applies the same center-relative ratio to every selected logical face as one atomic history action. Faces are inset **individually**; adjacent selected faces do not get merged into one region boundary.
- `bevelEdges({ assetId, edges, width })` resolves the complete original edge selection before topology mutation and bevels every selected **vertex-disjoint** manifold edge as one atomic history action. This covers Edge Rings and arbitrary disjoint edge selections.

The batch bevel intentionally rejects selected edges that share an endpoint. Blender-style connected-chain/closed-loop bevel needs a joint corner/miter solver so the shared vertex is solved once for the complete selected edge network. Repeatedly calling the single-edge bevel at a shared corner would double-apply the setback and is therefore prohibited rather than guessed.

Both batch operations return aggregate result ids suitable for restoring editor selection after the mutation, and neither persists the transient Construction adapter used internally by the normal LogicalMesh path.
