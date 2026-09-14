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

## Shell composition metadata

Static Mesh composition now tracks authored parts through `StaticMeshAsset.shells`.
A shell is metadata over existing dense component IDs; it does **not** copy geometry or topology.
Each shell stores vertex, triangle, and logical-face ID ranges plus optional append provenance.

```ts
interface StaticMeshShell {
  id: string;
  name: string;
  vertexIds: { start: number; endExclusive: number };
  triangleIds: { start: number; endExclusive: number };
  faceIds: { start: number; endExclusive: number };
  sourceAssetId?: string;
}
```

Empty Static Mesh assets start with no shells. Imported/generated Static Mesh assets start with one
base shell. `appendMesh()` preserves source shell boundaries and offsets their component ranges by the
same allocation used for appended geometry. A source with one shell therefore contributes one new
shell; a source that is already composed from several shells keeps those authored parts separate.

Older assets that predate shell metadata remain valid. `resolveStaticMeshShells()` exposes their
existing geometry as one virtual legacy shell, and the next append materializes that shell metadata.

### Hierarchy contract

The Static Mesh hierarchy separates organization from edit mode:

```text
Static Mesh
└─ Geometry                      [shell count]
   ├─ Shells
   │  ├─ Shell 0 · BaseMesh
   │  │  ├─ Vertices               [shell-local count]
   │  │  ├─ Edges                  [shell-local count]
   │  │  ├─ Faces                  [shell-local count]
   │  │  └─ Triangles              [shell-local count]
   │  └─ Shell 1 · AppendedMesh
   └─ Components
      ├─ Vertices                [global]
      ├─ Edges                   [global]
      └─ Faces                   [global]
```

Shell children are descriptive component summaries. Selecting/appending a shell expands `Geometry -> Shells`
and the selected shell automatically so its local counts are visible immediately. `Components` remains the
authoritative entry point for the current asset-wide Vertex / Edge / Face edit modes. Shell selection is intentionally **not** a new
`MeshComponentMode` yet; adding shell-scoped picking/deformation requires a separate selection-scope
contract so the hierarchy never implies filtering that the viewport does not enforce.

### React invalidation for composed assets

`AssetManager.updateAsset()` mutates the registered asset object in place with `Object.assign()`. React therefore
cannot use the asset object identity alone as a memo invalidation signal. `StaticMeshEditor` owns an
`assetRevision` tick driven by mesh asset events and passes it into `StaticMeshToolDock`, `MeshAssetHierarchy`,
and `MeshAssetInspector`. Any memo that derives geometry counts, shell lists, shell-local counts, or selected-shell
metadata must include that revision (or an equivalent changed field reference). This is what makes the hierarchy
advance from 0 -> 1 -> 2 shells after successive append operations even though the asset object reference itself
does not change.
