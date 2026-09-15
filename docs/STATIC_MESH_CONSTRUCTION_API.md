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
- moving a semantic point updates all bound mesh vertices,
- extrusion returns stable generated handles and creates a closed wall volume,
- referenced points cannot be silently deleted,
- two equal four-point loops bridge into four logical quads.

The test uses a small Node TypeScript loader so this focused API behavior can run independently of the
browser renderer. In a normal project install it uses the local `typescript` devDependency.

## Next modeling operations

Keep future modeling commands at this semantic layer where practical. Good next additions are transaction/
rollback support for multi-operation AI plans, point-gizmo transforms, face/loop deletion with safe topology
rebuild, inset, bevel, cut/split, unequal-loop bridging, and robust concave n-gon triangulation.
