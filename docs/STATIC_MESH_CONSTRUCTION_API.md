# Static Mesh Construction API

## Purpose

Static Mesh construction data is an authored planning layer above render topology. It is intended for
AI agents, scripts, and editor tools that need stable semantic handles while they build geometry.

A **Construction Point is not a mesh vertex**. Creating a point records a position and optional semantic
metadata, but it does not allocate a vertex, triangle, edge, or logical face. Topology is materialized only
when a modeling operation such as `createFaceFromPoints()`, `extrudeFace()`, or `bridgeLoops()` needs it.

```text
AI / Script Plan
      |
      v
Construction Points / Faces / Loops   <-- stable semantic handles
      |
      v
StaticMeshAssetAPI modeling operations
      |
      v
MeshGeometry + LogicalMesh             <-- implementation topology
```

This prevents an AI plan from depending on fragile numeric vertex/face indices that may change after
future topology operations.

## Persisted data

`StaticMeshAsset.construction` stores three semantic collections:

```ts
interface StaticMeshConstructionData {
  points: StaticMeshConstructionPoint[];
  faces: StaticMeshConstructionFace[];
  loops: StaticMeshConstructionLoop[];
}
```

A point has a stable string ID, position, optional role/group/tags/data, and an optional set of compiled
vertex bindings:

```ts
interface StaticMeshConstructionPoint {
  id: string;
  position: Vector3;
  name?: string;
  role?: 'ANCHOR' | 'CORNER' | 'CENTER' | 'OPENING' | 'GUIDE' | 'CUSTOM';
  groupId?: string;
  tags?: string[];
  data?: Record<string, string | number | boolean | null>;
  vertexIds?: number[];
}
```

`vertexIds` is a backend binding, not the point identity. It is intentionally one-to-many: a semantic
corner may eventually compile to multiple render vertices because of UV seams, hard normals, material
boundaries, or other topology splits.

## Public API

Construction operations live on the existing `staticMeshAssetAPI` so mutations continue through
`AssetManager.updateAsset()` and the normal asset update events.

### Add planning points

```ts
staticMeshAssetAPI.addPoints({
  assetId,
  points: [
    { id: 'house.A', position: { x: 0, y: 0, z: 0 }, role: 'CORNER' },
    { id: 'house.B', position: { x: 8, y: 0, z: 0 }, role: 'CORNER' },
    { id: 'house.C', position: { x: 8, y: 0, z: 6 }, role: 'CORNER' },
    { id: 'house.D', position: { x: 0, y: 0, z: 6 }, role: 'CORNER' },
  ],
});
```

At this point `geometry.vertices.length` is still `0` for an otherwise empty mesh.

Single-point and query/update operations are also available:

```ts
staticMeshAssetAPI.addPoint(...);
staticMeshAssetAPI.getPoint(assetId, pointId);
staticMeshAssetAPI.listPoints(assetId);
staticMeshAssetAPI.movePoint({ assetId, pointId, position });
staticMeshAssetAPI.removePoint({ assetId, pointId });
```

`movePoint()` updates every valid compiled mesh vertex bound to that semantic point. `removePoint()`
refuses to remove a point while a Construction Face or Construction Loop still references it.

### Create a face from 3+ points

```ts
const floor = staticMeshAssetAPI.createFaceFromPoints({
  assetId,
  id: 'face:ground-floor',
  name: 'Ground Floor',
  pointIds: ['house.A', 'house.D', 'house.C', 'house.B'],
});
```

The returned `floor.id` is the semantic handle that AI/scripts should retain. The numeric `faceId`,
`vertexIds`, and `triangleIds` in the result describe the current compiled topology and should not be
used as long-lived planning identity.

The first implementation supports ordered, planar, non-self-intersecting convex polygons. It fan-
triangulates the polygon while preserving one logical face in `LogicalMesh.faces`.

### Face-core sharing invariant

`LogicalMesh.faces` is the authoritative logical surface topology. Construction Points are semantic
inputs to those faces; they are not independent topology islands. When two Construction Faces reference
the same Construction Point ID, compilation reuses that point's existing mesh vertex binding. Therefore:

- faces sharing one Construction Point share one actual/canonical mesh vertex,
- adjacent faces sharing an authored edge reuse the same two mesh vertex IDs,
- the half-edge graph pairs that shared edge when the two face windings traverse it in opposite directions,
- separate Construction Point IDs at the same XYZ position remain separate vertices unless an explicit
  sibling/weld relationship says otherwise.

Do not introduce a separate "sibling face" identity table for ordinary adjacency. Face adjacency is derived
from the shared vertex/edge topology. `LogicalMesh.siblings` is reserved for duplicated render vertices that
represent one explicitly authored logical vertex (for example a UV/hard-normal seam).

### Inset a face

`insetFace()` keeps face identity stable. The selected Construction Face is not deleted/replaced with an
unrelated handle; instead, its boundary becomes the new inner boundary and a ring of border faces is
created around it.

```ts
const inset = staticMeshAssetAPI.insetFace({
  assetId,
  faceId: floor.id,
  id: 'inset:floor-panel',
  amount: 0.25,
});
```

The first implementation uses a **constant world-space distance measured in the face plane** and follows
the same ordered planar-convex polygon contract as `createFaceFromPoints()`.

```ts
{
  id: 'inset:floor-panel',
  sourceFaceId: 'face:ground-floor',
  innerFaceId: 'face:ground-floor', // stable: same semantic face
  innerLoopId: 'inset:floor-panel.innerLoop',
  innerPointIds: [...],
  borderFaceIds: [...],
}
```

The stable-face rule is deliberate. AI/scripts can chain operations without rediscovering topology:

```ts
const inset = staticMeshAssetAPI.insetFace({
  assetId,
  faceId: wall.id,
  amount: 0.15,
});

const recess = staticMeshAssetAPI.extrudeFace({
  assetId,
  faceId: inset.innerFaceId, // same id as wall.id
  distance: -0.2,
});
```

Internally the logical face ID is also preserved. Its old boundary remains available to the newly-created
border ring, while the inner face gets newly-authored Construction Points. The border ring shares the
correct vertices and opposite half-edge winding with the inner face and neighboring border faces.

`insetFace()` rejects non-positive distances, non-planar/concave input, degenerate neighboring edges, and
an inset amount large enough to collapse or cross the source polygon. It does not silently produce invalid
topology.

### Delete a face / create an opening

`deleteFace()` removes one authored Construction Face by its **semantic face id**. It deliberately keeps
its Construction Points and Construction Loops, which makes it useful as a small architectural opening
primitive after an inset.

```ts
const inset = staticMeshAssetAPI.insetFace({
  assetId,
  faceId: wall.id,
  amount: 0.15,
});

staticMeshAssetAPI.deleteFace({
  assetId,
  faceId: inset.innerFaceId,
});
```

This produces an inset border ring with the inner surface removed. The operation removes the deleted
face's triangles, compacts `LogicalMesh.faces`, remaps every surviving Construction Face `faceId`, rebuilds
`triangleToFaceIndex`, vertex-to-face adjacency, half-edges, normals, AABB and Mesh Shell metadata, and
records one asset-history step. Numeric logical face ids are therefore still dense after deletion.

The first delete primitive does **not** garbage-collect unused Construction Points or Loops. Those are
semantic planning handles and may be intentionally reused by later AI/modeling operations. Explicit point
removal remains guarded by face/loop references.

### Split an authored edge

`splitEdge()` inserts one new Construction Point between two **semantic endpoint Point IDs**. The AI-facing
contract intentionally does not accept raw mesh vertex IDs. Every incident Construction Face that contains
that authored boundary edge is updated to reuse the same new point, and any Construction Loop containing the
same segment is updated as well. Face semantic IDs and logical `faceId` mappings remain stable.

```ts
const split = staticMeshAssetAPI.splitEdge({
  assetId,
  pointAId: 'wall.A',
  pointBId: 'wall.B',
  t: 0.5,
});
```

The first implementation requires `0 < t < 1`, defaults to `0.5`, and supports manifold authored edges with
at most two incident Construction Faces. For a shared edge, both adjacent faces receive the same semantic Point
and therefore the same compiled mesh vertex; the two replacement half-edges on each side remain pairable. Because
a split point is collinear with the original edge, Construction-face triangulation preserves the historical fan when
possible but rotates/falls back to convex ear clipping when needed so the compiled render triangles are not degenerate.
`getConstructionEdgePointIds(assetId, vertexAId, vertexBId)` exists only as an editor adapter so an Edge-mode
selection can map current numeric topology back to stable Construction Point endpoints. AI/scripts should keep
semantic Point IDs instead.

The result returns the generated point/vertex plus the two replacement edge keys for transient editor selection:

```ts
{
  id: 'split-1',
  sourcePointIds: ['wall.A', 'wall.B'],
  pointId: 'split-1.point',
  vertexId: 12,
  updatedFaceIds: ['face:wall-left', 'face:wall-right'],
  updatedLoopIds: ['loop:wall'],
  edgeIds: ['3-12', '7-12'],
  t: 0.5,
}
```

`splitEdge()` is one asset-history step. Undo restores the original edge, face boundaries, loops, render triangles,
half-edge graph, and Mesh Shell metadata together.

### Create a loop

```ts
const opening = staticMeshAssetAPI.createLoop({
  assetId,
  id: 'loop:opening',
  pointIds: ['opening.A', 'opening.B', 'opening.C', 'opening.D'],
  closed: true,
});
```

A Construction Loop is a semantic ordered point handle and does not allocate geometry by itself.
Closed loops require at least three points; open loops require at least two.

### Extrude a semantic face

```ts
const walls = staticMeshAssetAPI.extrudeFace({
  assetId,
  faceId: floor.id,
  id: 'extrude:walls',
  distance: 3,
});
```

When `direction` is omitted, the operation derives it from the ordered source face normal. The result
returns semantic handles for the newly generated topology:

```ts
{
  id: 'extrude:walls',
  sourceFaceId: 'face:ground-floor',
  topFaceId: 'extrude:walls.top',
  topLoopId: 'extrude:walls.topLoop',
  topPointIds: [...],
  sideFaceIds: [...],
}
```

AI code should feed these returned IDs into later operations instead of discovering numeric topology IDs.

### Bridge two loops

```ts
const bridge = staticMeshAssetAPI.bridgeLoops({
  assetId,
  loopAId: lowerLoop.id,
  loopBId: upperLoop.id,
  id: 'bridge:walls',
});
```

The current bridge implementation requires equal point counts and matching open/closed state. It creates
one logical quad per corresponding segment and returns their semantic Construction Face IDs.

## Topology rebuild contract

Any construction operation that changes compiled geometry rebuilds the same derived data used by the
existing Static Mesh editor:

- typed triangle index buffer,
- `LogicalMesh.faces` and triangle-to-face mapping,
- half-edge graph,
- vertex-to-face mapping,
- generated normals,
- AABB,
- topology-derived Mesh Shell metadata.

Construction code must not maintain a second topology graph. It compiles into the existing mesh topology
and lets the shared topology/shell systems remain authoritative.

## Editor behavior

Static Mesh hierarchy now has a separate Construction branch:

```text
Static Mesh
├─ Geometry
│  └─ ... existing Mesh Shell / Components hierarchy
└─ Construction
   ├─ Points [count]
   │  ├─ point A
   │  └─ point B
   ├─ Faces  [count]
   └─ Loops  [count]
```

Construction Points render from their own viewport VBO so they are visually and behaviorally separate
from mesh Vertex mode. They are visible even before any geometry exists. In `Construction > Points`, LMB
selects a point, `Shift+LMB` toggles point selection, and plain LMB on empty space clears it. Focusing a
selected Construction Point set frames those semantic positions. Selecting a Mesh Shell, mesh component,
or whole object releases the Construction Point selection domain.

Construction Point selection currently does **not** use the mesh component gizmo. Point movement is
already available through `staticMeshAssetAPI.movePoint()`; a dedicated semantic-point gizmo adapter can
be added without pretending these points are mesh vertices.

### Topology tools in the Static Mesh dock

The `Mesh Workspace > Sculpt Tools > Topology` section now routes its first working face actions through
the same Construction API used by browser-console scripts and AI:

- **Extrude** calls `staticMeshAssetAPI.extrudeFace()` using the editable Extrude Distance.
- **Inset** calls `staticMeshAssetAPI.insetFace()` using the editable Inset Amount.
- **Delete Face** calls `staticMeshAssetAPI.deleteFace()` and leaves an opening.
- **Split Edge** calls `staticMeshAssetAPI.splitEdge()` using the editable Split Position and updates every incident authored face/loop.
- **Cut Face** calls `staticMeshAssetAPI.cutFace()` between two selected non-adjacent Construction-backed vertices on one authored face.

Face actions intentionally require **Face mode + exactly one selected logical face that maps to an authored Construction Face**. Split Edge requires **Edge mode + exactly one selected edge whose current mesh vertices resolve back to an authored Construction Point pair**. Cut Face requires **Vertex mode + exactly two non-adjacent selected vertices that resolve to Construction Points on exactly one common authored face**. Imported/appended topology without Construction identity remains disabled rather than receiving guessed planning identity. After Extrude, the generated top face becomes the
active face selection; after Inset, the stable inner/source face remains selected; after Delete Face, face
selection is cleared because the selected surface no longer exists.

The dock dispatches through `EditorCommandRegistry` (`staticMesh.extrude`, `staticMesh.inset`,
`staticMesh.deleteFace`, `staticMesh.splitEdge`, `staticMesh.cutFace`) and the editor's `topologyCommand` service. React UI must not implement separate
topology mutation logic.

## Automated test

Run the focused construction step without starting the UI:

```bash
npm run test:mesh-construction
```

The test verifies:

- adding points alone allocates no mesh vertices,
- four points create one logical quad / two triangles,
- adjacent faces that reuse Construction Points share the same actual mesh vertices and pair their oppositely wound half-edge,
- moving a semantic point updates all bound mesh vertices,
- inset preserves the selected semantic/logical face id, creates a shared border ring, rejects collapse, and can feed the same face directly into extrusion,
- delete-face removes only the selected authored surface, compacts logical/triangle mappings, preserves semantic points/loops, stays one shell for an inset ring, and supports undo/redo,
- split-edge inserts one shared semantic point into both incident faces/loops, preserves shell/half-edge connectivity, and supports undo/redo,
- cut-face splits one authored polygon between two existing non-adjacent semantic boundary points, preserves the source face handle, creates one paired shared diagonal, and supports undo/redo,
- the editor command catalogue resolves working Inset/Delete Face/Split Edge/Cut Face dispatch through the shared topology command service,
- extrusion returns stable generated handles and creates a closed wall volume,
- referenced points cannot be silently deleted,
- two equal four-point loops bridge into four logical quads.

The test uses a small Node TypeScript loader so this focused API behavior can run independently of the
browser renderer. In a normal project install it uses the local `typescript` devDependency.

## Cut Face contract

`cutFace()` is intentionally small: it connects two **existing non-adjacent boundary Construction Points** on one authored face. The original semantic face id and logical face id survive as one side of the cut; the other side receives a new semantic face handle. Both sides reuse the same endpoint mesh vertices, so the new diagonal is a normal paired logical edge and the Mesh Shell remains connected.

The first version does not invent arbitrary interior points or project a freehand knife line. To cut from positions in the middle of existing edges, compose the primitives:

```text
splitEdge(edge A, tA)
splitEdge(edge B, tB)
cutFace(face, newPointA, newPointB)
```

This keeps AI plans deterministic and makes each topology change independently testable/undoable. Adjacent endpoints, points not on the selected face, triangles, or otherwise degenerate cuts are rejected before commit. The current face-order contract remains the same planar ordered convex Construction polygon contract used by the other first-generation primitives.

## Next modeling operations

Keep future modeling commands at this semantic layer where practical. Asset transactions/rollback are now
available. Good next additions are point-gizmo transforms, loop deletion, cut-face, bevel, unequal-loop bridging, and robust concave n-gon triangulation.

## Asset undo/redo and AI transactions

Static Mesh construction mutations are recorded by the asset-level `AssetHistory` service. This history is separate from the Scene ECS `HistorySystem`: a modeling operation can change Construction Points/Faces/Loops, mesh geometry, logical topology, half-edge data and Mesh Shell metadata without changing any scene entity.

Every public construction mutation (`addPoint(s)`, `movePoint`, `removePoint`, `createFaceFromPoints`, `createLoop`, `insetFace`, `deleteFace`, `splitEdge`, `cutFace`, `extrudeFace`, `bridgeLoops`) creates one atomic undo step. Static Mesh append/reference mutations use the same history boundary. Snapshots preserve typed arrays and Maps rather than JSON-serializing them.

The API exposes:

```ts
staticMeshAssetAPI.undo(assetId);
staticMeshAssetAPI.redo(assetId);
staticMeshAssetAPI.getHistoryState(assetId);

staticMeshAssetAPI.beginTransaction(assetId, 'Build Window');
// any number of construction primitives
staticMeshAssetAPI.commitTransaction(assetId);
// or cancelTransaction(assetId)
```

An AI should group one semantic intent into a transaction. For example, creating points, creating a face, insetting it and extruding it can become one `Build Window` undo step rather than four unrelated user undos. If an operation inside a transaction throws, the asset is restored to the transaction's starting snapshot.

The Static Mesh editor maps `Ctrl/Cmd+Z` to asset undo, `Ctrl/Cmd+Shift+Z` and `Ctrl/Cmd+Y` to redo, and exposes Undo/Redo toolbar buttons. Plain `Z` remains the wireframe shortcut. Component gizmo drags capture one asset-history transaction from drag start through mouse-up.

### Gizmo/history synchronization contract

The gizmo is transient UI, not a second source of history. Mesh/component state is authoritative and the gizmo pivot is derived from the current selection every render.

- A completed component drag is one asset-history entry.
- A drag with no effective movement creates no history entry.
- `Esc` during a component drag cancels the unfinished transaction and restores the drag-start asset state.
- `Ctrl/Cmd+Z` during an unfinished drag cancels that drag first. A later Undo addresses the previous committed history entry.
- Undo/Redo preserves still-valid Vertex/Edge/Face selection ids and prunes only ids that no longer exist in the restored topology.
- Construction Point and Mesh Shell selection are likewise preserved when their semantic ids still exist.
- After Undo/Redo, soft-selection weights are recomputed against restored geometry and gizmo hover/active-handle state is reset. The next gizmo render therefore follows the restored selected components automatically.
- Cancelling a gizmo drag inside a broader API transaction must not cancel the outer transaction; only the live drag deformation is restored.

Do not add separate "gizmo position" snapshots to `AssetHistory`. That would allow mesh state and gizmo state to diverge.

## Repeatable browser-console fixtures

Manual modeling checks should not require rebuilding throwaway assets after every app restart. Application bootstrap installs a small `smTest` browser-console command backed by `engine/dev/StaticMeshTestFixtures.ts`.

```js
smTest()            // fresh four-point panel / one Construction Face
smTest('inset')     // panel with a 0.5 inset, center face still present
smTest('opening')   // inset ring with the center face deleted
smTest('box')       // simple extruded panel
smTest('split')     // two authored triangles sharing one edge; Edge mode Split Edge test
smTest('cut')       // one authored quad; Vertex mode select opposite corners + Cut Face
smTest.clear()      // delete only TEST_StaticMesh_* fixtures
smTest.help()       // print the available fixture commands
```

Each creation first deletes earlier assets whose names start with `TEST_StaticMesh_`, so repeated checks do not accumulate stale runtime fixtures. User-authored assets and automated `/Tests` assets are untouched. The created asset appears under Content > Meshes and the command returns its `assetId`, semantic point/face/loop ids, `primaryFaceId` when one is available, `primaryEdgePointIds` for the split-ready fixture, and `primaryCutPointIds` for the cut-ready fixture.

Fixture construction history is cleared before the command returns. The generated shape is therefore a clean baseline: the first manual Inset/Extrude/Delete/Split/Gizmo operation is also the first Ctrl+Z step. Keep fixture generation separate from the production modeling API; fixtures call `StaticMeshAssetAPI` rather than duplicating topology mutation logic.
