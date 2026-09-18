# Static Mesh Construction API

> **Legacy / planning compatibility layer.** The normal human Static Mesh editor no longer depends on or displays Construction Points/Faces/Loops. `MeshGeometry + LogicalMesh` are authoritative for normal modeling; use the numeric-ID API documented in `STATIC_MESH_NORMAL_MODELING_API.md`. This document remains for legacy semantic tests and future AI-planning experiments.

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
  ratio: 0.25,
});
```

The default implementation uses a **relative center inset**. Each ordered boundary point moves toward the
arithmetic face center by `ratio`, where `0` means the original boundary and values approaching `1` move
the inner boundary toward the center. The editor exposes `0.005..0.99`. Because this is a uniform 3D
scale about the face center, the face does **not** need to be planar and the result is independent of model
scale. The older constant-width planar helper remains internal for a future explicit **Even Inset** mode.

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
  ratio: 0.15,
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

`insetFace()` rejects ratios outside the open `0..1` interval and faces with fewer than three boundary
points. It no longer requires a planar polygon: the inner boundary is a uniform 3D scale of the ordered
source boundary about its arithmetic center, so warped/sloped/manual-edit faces remain editable.

### Delete a face / create an opening

`deleteFace()` removes one authored Construction Face by its **semantic face id**. It deliberately keeps
its Construction Points and Construction Loops, which makes it useful as a small architectural opening
primitive after an inset.

```ts
const inset = staticMeshAssetAPI.insetFace({
  assetId,
  faceId: wall.id,
  ratio: 0.15,
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

Face Extrude always derives its direction from the ordered source face normal. Positive distance follows that normal and negative distance goes exactly opposite. There is no arbitrary direction override in this primitive; a future sweep/translate operation should handle non-normal motion. Face Extrude follows modeller semantics: the source surface is **consumed/moved** to the new offset boundary and side faces are created around the old boundary. It does **not** leave a duplicate cap at the original source location. The stable semantic/logical source face handle is preserved on the moved top surface, so `topFaceId === sourceFaceId`:

```ts
{
  id: 'extrude:walls',
  sourceFaceId: 'face:ground-floor',
  topFaceId: 'face:ground-floor', // same stable face, now on the new top boundary
  topLoopId: 'extrude:walls.topLoop',
  topPointIds: [...],
  sideFaceIds: [...],
}
```

This means extruding an isolated plane produces an open extrusion at the original boundary, which is the expected polygon-modelling behavior. Extruding a face that is already part of a manifold surface keeps the surrounding old-boundary faces and inserts side walls between them and the moved face. If a script specifically wants a closed prism from an isolated plane, it should create the bottom cap explicitly with `createFaceFromPoints()` rather than relying on Extrude to duplicate the source surface.

AI code should feed the returned semantic IDs into later operations instead of discovering numeric topology IDs. The API itself is editor-tool neutral; it never activates a transform gizmo.

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

## Normal editor status

The normal Static Mesh editor no longer displays or selects Construction Points/Faces/Loops. It has no Construction hierarchy branch and no Adopt Topology button. Human modeling uses numeric `LogicalMesh` face/vertex/edge identity directly through the normal API documented in `STATIC_MESH_NORMAL_MODELING_API.md`.

This legacy semantic API remains callable from scripts/tests for compatibility. A future AI-specific planning editor may expose it again, but it must remain separate from the human modeller.

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
- bevel-edge replaces one manifold edge with a four-point chamfer, propagates new points into endpoint faces/loops, compacts orphan render vertices, keeps one shell, and supports undo/redo,
- cut-face splits one authored polygon between two existing non-adjacent semantic boundary points, preserves the source face handle, creates one paired shared diagonal, and supports undo/redo,
- the editor command catalogue resolves working Inset/Delete Face/Split Edge/Bevel/Cut Face dispatch through the shared topology command service,
- extrusion returns stable generated handles and creates a closed, consistently wound wall volume whose cap/side half-edges pair,
- referenced points cannot be silently deleted,
- two equal four-point loops bridge into four logical quads.

The test uses a small Node TypeScript loader so this focused API behavior can run independently of the
browser renderer. In a normal project install it uses the local `typescript` devDependency.

## Bevel Edge contract

`bevelEdge()` is intentionally a single-edge primitive. It accepts stable Construction Point endpoint ids and a positive world-space `width`. Width is the distance traveled from each selected-edge endpoint along every local one-ring edge that participates in the bevel corner, which keeps the result deterministic and independent of render-triangle ids.

The selected edge must still have exactly two incident authored faces with opposite shared-edge winding and non-coplanar normals. Endpoint valence is no longer capped at three. For an interior manifold endpoint, the API resolves the unique face fan between the two selected incident faces, creates one semantic offset point on each edge in that fan, rewrites all affected faces/loops, and creates a small endpoint cap polygon when three or more offsets are required. The common valence-3 case remains the two-offset special case and therefore needs no extra cap. Open/branched/disconnected/non-manifold high-valence fans reject atomically rather than guessing. A Construction Loop that directly owns the selected edge is still rejected because choosing which bevel rail should replace that loop is ambiguous.

After the rewrite, source endpoint Construction Points remain as semantic planning/history handles but orphan render vertices are compacted away. The result returns the two long bevel rails, the main bevel face, and any generated endpoint cap face ids so UI/AI can continue without rediscovering raw topology. Invalid widths and unsupported topology create no Undo entry.

Face Extrude is normal-driven: it computes the current ordered Construction Face normal before mutation and offsets every generated top point by `normal * distance`. It never falls back to a world/ground axis. Positive distance follows the face normal; negative distance goes opposite. The source surface is consumed/moved to the new boundary, so an isolated plane remains open at its old position unless a caller explicitly creates a cap.

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
available. Good next additions are point-gizmo transforms, loop deletion, multi-edge/segment bevel, unequal-loop bridging, and robust concave n-gon triangulation.

## Asset undo/redo and AI transactions

Static Mesh construction mutations are recorded by the asset-level `AssetHistory` service. This history is separate from the Scene ECS `HistorySystem`: a modeling operation can change Construction Points/Faces/Loops, mesh geometry, logical topology, half-edge data and Mesh Shell metadata without changing any scene entity.

Every public construction mutation (`addPoint(s)`, `movePoint`, `removePoint`, `createFaceFromPoints`, `createLoop`, `insetFace`, `deleteFace`, `splitEdge`, `bevelEdge`, `cutFace`, `extrudeFace`, `bridgeLoops`) creates one atomic undo step. Static Mesh append/reference mutations use the same history boundary. Snapshots preserve typed arrays and Maps rather than JSON-serializing them.

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
- Mesh Shell selection is preserved when its topology-derived ids still exist.
- After Undo/Redo, soft-selection weights are recomputed against restored geometry and gizmo hover/active-handle state is reset. The next gizmo render therefore follows the restored selected components automatically.
- Cancelling a gizmo drag inside a broader API transaction must not cancel the outer transaction; only the live drag deformation is restored.

Do not add separate "gizmo position" snapshots to `AssetHistory`. That would allow mesh state and gizmo state to diverge.

## Repeatable browser-console fixtures

`smTest(...)` is now intentionally a **normal-mesh** manual test surface. Every fixture strips temporary semantic scaffolding before it returns, so `asset.construction === undefined` and the editor exercises the same numeric LogicalMesh path as imported meshes.

```js
smTest()
smTest('inset')
smTest('opening')
smTest('box')
smTest('normal')
smTest('split')
smTest('cut')
smTest('ring')
smTest('bevel')
smTest('bevel-valence')
smTest('extrude-normal')
```

The console reports numeric `primaryFaceId`, `primaryEdgeVertices`, and `primaryCutVertices` where useful. Fixture setup is removed from AssetHistory before return, so the first human edit is the first Undo step.

## Legacy Adopt Topology compatibility

`adoptTopology()` remains available only for legacy semantic/planning compatibility. It is metadata-only and preserves geometry/logical topology, but the normal editor does not call or expose it because normal editing no longer needs adoption.

## Read-only topology query layer

The normal modeling/query layer works directly on existing logical meshes. `StaticMeshAssetAPI` exposes read-only quad topology queries: face classification, face boundary edges, edge
incident/adjacent faces, opposite-edge lookup, edge-ring tracing, and face-strip tracing.

This is intentionally separate from mutation. An AI can first inspect:

```text
selected edge
  -> incident faces
  -> is the face a logical quad?
  -> opposite edge
  -> continue across adjacent quad
  -> edge ring + crossed face strip
```

and only then compose existing editing primitives such as `splitEdge()` and `cutFace()`. This keeps higher
level operations like a wall band/window row deterministic without introducing a large special-purpose
"cut ring" command prematurely.

## Searchable construction-test report

The standard construction regression command now writes the complete terminal transcript to a stable
searchable text file while still streaming the same output to the terminal:

```powershell
npm run test:mesh-construction
```

Latest report:

```text
reports/static-mesh-construction-test.txt
```

For manual debugging in VS Code, use:

```powershell
npm run test:mesh-construction:open
```

This runs the same test, overwrites the latest report, then tries to reopen that report in the current
VS Code window (`code -r`). On Windows it also checks the common per-user and Program Files VS Code
locations when the `code` shell launcher is not on `PATH`. If VS Code cannot be located, the command
still writes the report and prints its full path.

The direct loader command remains available as `npm run test:mesh-construction:raw` for debugging the
report runner itself. Generated `reports/*.txt` files are intentionally ignored by git so local test
runs do not add repository noise.
