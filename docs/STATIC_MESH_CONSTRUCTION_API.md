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
- extrusion returns stable generated handles and creates a closed wall volume,
- referenced points cannot be silently deleted,
- two equal four-point loops bridge into four logical quads.

The test uses a small Node TypeScript loader so this focused API behavior can run independently of the
browser renderer. In a normal project install it uses the local `typescript` devDependency.

## Next modeling operations

Keep future modeling commands at this semantic layer where practical. Asset transactions/rollback are now
available. Good next additions are point-gizmo transforms, face/loop deletion with safe topology rebuild,
bevel, cut/split, unequal-loop bridging, and robust concave n-gon triangulation.

## Asset undo/redo and AI transactions

Static Mesh construction mutations are recorded by the asset-level `AssetHistory` service. This history is separate from the Scene ECS `HistorySystem`: a modeling operation can change Construction Points/Faces/Loops, mesh geometry, logical topology, half-edge data and Mesh Shell metadata without changing any scene entity.

Every public construction mutation (`addPoint(s)`, `movePoint`, `removePoint`, `createFaceFromPoints`, `createLoop`, `insetFace`, `extrudeFace`, `bridgeLoops`) creates one atomic undo step. Static Mesh append/reference mutations use the same history boundary. Snapshots preserve typed arrays and Maps rather than JSON-serializing them.

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
