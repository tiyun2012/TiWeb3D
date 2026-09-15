# Static Mesh Asset Workflow

`MESH` is the canonical Static Mesh asset type. It is both importable and creatable.
A newly created Static Mesh starts with empty geometry/topology and can be populated later.

## Stable API

UI code should use `staticMeshAssetAPI` from `engine/api/StaticMeshAssetAPI.ts` rather than
mutating geometry or editor reference metadata directly. Composition inputs are resolved from the
asset registry, not from Content Browser selection state.

```ts
staticMeshAssetAPI.create({ name: 'New Static Mesh', path: '/Content' });

const sources = staticMeshAssetAPI.listCompositionSources(targetAssetId);

const plan = staticMeshAssetAPI.planAppendMesh({
  targetAssetId,
  sourceAssetId: meshA,
});

const result = staticMeshAssetAPI.appendMesh({
  targetAssetId,
  sourceAssetId: meshA,
});

staticMeshAssetAPI.addReferenceMesh(targetAssetId, guideMesh);
staticMeshAssetAPI.removeReferenceMesh(targetAssetId, guideMesh);
```

Batch append/reference APIs remain available for scripts and agents:

```ts
staticMeshAssetAPI.appendMeshes({ targetAssetId, sourceAssetIds: [meshA, meshB] });
staticMeshAssetAPI.addReferenceMeshes({ targetAssetId, sourceAssetIds: [guideA, guideB] });
```

## Append ID allocation

Static Mesh component IDs are currently dense array indices. Append never renumbers components
that already exist in the target. Each source receives new ranges beginning after the current
target ranges.

For a target with 128 vertices, 200 triangles and 90 logical faces, appending a source starts at:

```text
vertexIdOffset   = 128
triangleIdOffset = 200
faceIdOffset     = 90
```

Therefore source vertex `0` becomes target vertex `128`, source vertex `1` becomes `129`, and so on.
Every source index, logical face vertex id, sibling id and triangle-to-face reference is remapped by
the matching offset before topology is rebuilt. Edge IDs are derived from their remapped vertex IDs,
so they do not need a separate persistent allocator.

`planAppendMesh()` exposes these ranges before mutation; `appendMesh()` / `appendMeshes()` return the
committed allocations so tests, agents, undo systems and future UI can reason about exactly which
component IDs were created.

## Append vs Reference

### Append Mesh

Append is destructive asset composition. Source mesh vertex/index/attribute data is copied into
the target asset. Logical faces and triangle-to-face mappings are offset and rebuilt, and the
combined half-edge topology is regenerated. The source assets are never modified.

Append does not weld different source meshes together, even when their vertices occupy the same
position. Existing sibling groups within each source mesh are preserved with the appropriate
vertex offset.

### Reference Mesh

Reference is non-destructive and editor-only. Reference asset ids live in:

```ts
asset.editor.referenceMeshIds
```

Runtime systems must not depend on this metadata. The Static Mesh Editor draws reference meshes through
the normal shaded mesh surface path with a cool neutral reference material. They follow the viewport's
current Lit / Normals / Unlit render mode, remain non-selectable, and are not included in exported target
geometry. References intentionally do not draw a topology cage by default.

## Static Mesh Editor Flow

1. Create -> Static Mesh creates an empty `type: 'MESH'` asset.
2. Open it in the Static Mesh Editor.
3. **Sculpt Tools -> Mesh Assembly** exposes the available Static Mesh assets through a compact asset
   selector. Choose a source and click **Append Mesh**; Content Browser selection is irrelevant.
4. **Inspector -> Reference Meshes** uses the same compact asset selector. Choose a source and click
   **Add Reference** to attach a non-destructive shaded guide.

This keeps the UI replaceable: future search, drag/drop, transforms, context menus, automation, or
agent workflows should call the same stable asset API.

## Shell detection and composition metadata

A Static Mesh shell is a **topological surface island**, not merely an append record and not a count copied
from importer metadata. `resolveStaticMeshShells()` detects shells from the mesh's logical polygon topology.
Faces belong to the same shell when they are connected through a logical polygon edge. Persistent
`LogicalMesh.siblings` weld UV / hard-normal split render vertices for topology purposes, so the built-in
24-render-vertex cube still resolves as **one shell**, not six face islands. Point contact alone is not enough
to merge two shells.

Direct component deformation may move only one side of an existing render-vertex sibling group. When that
happens, keeping the old weld would make the saved topology disagree with the visible mesh. At the edit
transaction boundary (`endVertexDrag`), Static Mesh runs a **split-only sibling reconciliation**: an existing
sibling group is partitioned when its members no longer coincide, `vertexToFaces`/connectivity are refreshed,
and shell metadata is rematerialized. No new weld is ever inferred from position, so moving two unrelated
shells into contact does not merge them.

`StaticMeshAsset.shells` remains lightweight naming/provenance metadata. It never overrides actual topology.
Older range-only metadata is accepted, while new composition writes also persist `faceIdsExact` so a shell can
be matched safely even when imported face IDs are not contiguous.

```ts
interface StaticMeshShell {
  id: string;
  name: string;
  // compatibility / allocation bounds, not authoritative membership
  vertexIds: { start: number; endExclusive: number };
  triangleIds: { start: number; endExclusive: number };
  faceIds: { start: number; endExclusive: number };
  // exact logical-face membership hint for non-contiguous shells
  faceIdsExact?: number[];
  sourceAssetId?: string;
}
```

The resolver first detects connected components from `LogicalMesh.faces` plus persistent sibling groups, then
uses saved shell metadata only to recover stable names, IDs, and append provenance. If metadata says "one shell"
but the topology contains three disconnected surface islands, the hierarchy shows three shells. If stale metadata
splits one truly connected surface into several records, the hierarchy still shows one detected shell.

Generated primitives and newly imported Static Mesh assets immediately materialize this detected result back into
`asset.shells`, including exact logical-face membership. This keeps raw asset metadata, hierarchy counts, and
composition-source summaries aligned from the first open rather than waiting for the first append operation.

Append follows the same rule. Source shells are resolved from source topology, offset with the appended face/vertex/
triangle allocation, and then the final target topology is detected again before shell metadata is saved. This makes
composition robust against stale source metadata and preserves sources that already contain multiple disconnected
parts.

For importers, the important contract is therefore **populate logical topology correctly** rather than trying to
guess a shell count separately. OBJ/FBX import must preserve `LogicalMesh.faces`, `triangleToFaceIndex`, and persistent
`siblings` for intentional seam/hard-edge welding. The shell resolver then derives the correct hierarchy. Import code
should not weld unrelated FBX objects together merely because their current positions happen to coincide; object/node
boundaries must be preserved when sibling groups are constructed. Later edit finalization may only split those imported
weld groups if their members are actually edited apart; it never creates cross-node welds from proximity.

### Hierarchy contract

The Static Mesh hierarchy exposes both topology-detected shell scopes and asset-wide component modes:

```text
Static Mesh
└─ Geometry                      [shell count]
   ├─ Shells
   │  ├─ Shell 0 · BaseMesh
   │  │  ├─ Vertices             [shell-local count]
   │  │  ├─ Edges                [shell-local count]
   │  │  └─ Faces                [shell-local count]
   │  └─ Shell 1 · AppendedMesh
   └─ Components
      ├─ Vertices                [global]
      ├─ Edges                   [global]
      └─ Faces                   [global]
```

A shell row itself is organizational: selecting it keeps `MeshComponentMode` at `OBJECT` and shows shell
metadata in the Inspector. Its `Vertices`, `Edges`, and `Faces` children are executable selection scopes.
Clicking one performs two linked operations through the normal editor APIs:

1. switch the viewport to the matching `VERTEX`, `EDGE`, or `FACE` component mode;
2. replace the current mesh sub-selection with every matching component ID owned by that shell.

Shells still do not duplicate topology. `getStaticMeshShellComponentSelection()` derives the resolved vertex,
edge, and face IDs from the asset's existing geometry/topology, and the editor sends them through
`engine.api.commands.selection.setMeshComponents(...)`. This means gizmo, soft selection, overlays, Focus,
and later editing commands see exactly the same selection representation as viewport picking.

The global `Components` branch does not select all components; it only enters the requested asset-wide mode.
Choosing a global component row, using the component toolbar/pie menu, or manually changing the selection in
the viewport clears the shell-wide scope. This prevents a highlighted `Shell > Faces` row from remaining after
the user has reduced that selection to only a few faces.

Triangles remain visible as a shell count in the Inspector, but are not a hierarchy action because the editor
currently has no Triangle component mode.

### React invalidation for composed assets

`AssetManager.updateAsset()` mutates the registered asset object in place with `Object.assign()`. React therefore
cannot use the asset object identity alone as a memo invalidation signal. `StaticMeshEditor` owns an
`assetRevision` tick driven by mesh asset events and passes it into `StaticMeshToolDock`, `MeshAssetHierarchy`,
and `MeshAssetInspector`. Any memo that derives geometry counts, shell lists, shell-local counts, or selected-shell
metadata must include that revision (or an equivalent changed field reference). This is what makes the hierarchy
advance from 0 -> 1 -> 2 shells after successive append operations even though the asset object reference itself
does not change.
