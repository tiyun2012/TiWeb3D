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

<<<<<<< HEAD
## Shell composition metadata

Static Mesh composition now tracks authored parts through `StaticMeshAsset.shells`.
A shell is metadata over existing dense component IDs; it does **not** copy geometry or topology.
Each shell stores vertex, triangle, and logical-face ID ranges plus optional append provenance.
=======
## Mesh Shell detection and composition metadata

A **Mesh Shell** is one connected component of polygon topology. It is not an append record,
not a UV Shell, and not a group inferred from coincident XYZ positions. `resolveStaticMeshShells()`
derives Mesh Shells from `LogicalMesh.faces` plus only **explicit** logical-weld groups in
`LogicalMesh.siblings`.

Two faces are in the same Mesh Shell when they share a logical polygon edge. Render vertices may
be split for UVs or normals and still belong to one logical vertex only when the generator/importer
explicitly records that relationship in `siblings`. Equal positions alone never create a weld.
Point contact alone is also not enough to merge Mesh Shells because shell traversal requires a
shared logical edge.

The built-in Cube intentionally remains unchanged: it has 24 render vertices arranged as six
independent quads, and it provides no authored sibling/weld groups. It therefore resolves as
**6 Mesh Shells**. A future connected/welded cube primitive can be introduced separately instead
of silently changing the topology of the existing asset.

`LogicalMesh.siblings` is now an authored/imported topology contract, not a spatial coincidence
cache. OBJ import preserves this safely from OBJ position indices: if one OBJ `v` index is split
into multiple render vertices by UV/normal tuples, those render vertices become explicit siblings.
Two different OBJ `v` indices remain unrelated even if their XYZ values are identical. FBX
currently uses the connectivity preserved by the loaded index buffer; a later FBX importer upgrade
should preserve FBX control-point/node identity explicitly rather than welding by position.

Direct component deformation may move only one side of an existing explicit sibling group. At the
edit transaction boundary (`endVertexDrag`), Static Mesh performs a **split-only sibling
reconciliation**: an existing group may be partitioned when its members no longer coincide,
`vertexToFaces`/connectivity are refreshed, and Mesh Shell metadata is rematerialized. This never
creates a new weld, so moving two unrelated Mesh Shells into contact cannot merge them.

`StaticMeshAsset.shells` remains lightweight naming/provenance metadata. It never overrides actual
topology. Older range-only metadata is accepted, while new composition writes also persist
`faceIdsExact` so a Mesh Shell can be matched safely even when imported face IDs are not contiguous.
>>>>>>> 22095ed25f234a37a29434ca8482a4279c539820

```ts
interface StaticMeshShell {
  id: string;
  name: string;
<<<<<<< HEAD
  vertexIds: { start: number; endExclusive: number };
  triangleIds: { start: number; endExclusive: number };
  faceIds: { start: number; endExclusive: number };
=======
  // compatibility / allocation bounds, not authoritative membership
  vertexIds: { start: number; endExclusive: number };
  triangleIds: { start: number; endExclusive: number };
  faceIds: { start: number; endExclusive: number };
  // exact logical-face membership hint for non-contiguous Mesh Shells
  faceIdsExact?: number[];
>>>>>>> 22095ed25f234a37a29434ca8482a4279c539820
  sourceAssetId?: string;
}
```

<<<<<<< HEAD
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
=======
The resolver first detects connected components from logical faces and explicit sibling groups,
then uses saved metadata only to recover stable names, IDs, and append provenance. If metadata says
"one Mesh Shell" but topology contains three disconnected components, the hierarchy shows three.
If stale metadata splits one truly connected surface into several records, the hierarchy still
shows one detected Mesh Shell.

Generated primitives and newly imported Static Mesh assets immediately materialize the detected
result back into `asset.shells`, including exact logical-face membership. This keeps raw asset
metadata, hierarchy counts, and composition-source summaries aligned from the first open.

Append follows the same rule. Source Mesh Shells are resolved from source topology, offset with the
appended face/vertex/triangle allocation, and then the final target topology is detected again
before metadata is saved. Append never creates cross-source welds just because two vertices occupy
the same position.

For importers, the contract is **preserve source-authored topology identity** rather than guessing a
Mesh Shell count or welding by XYZ. OBJ already uses source position indices for explicit seam
siblings. Future FBX work should preserve control-point and mesh-node boundaries so hard-normal/UV
splits can remain one Mesh Shell when the FBX topology says they are connected, while separate FBX
objects remain separate even when they overlap spatially.

### Hierarchy contract

The Static Mesh hierarchy exposes both topology-detected Mesh Shell scopes and asset-wide component modes:

```text
Static Mesh
└─ Geometry                      [Mesh Shell count]
   ├─ Mesh Shells
   │  ├─ Mesh Shell 0 · BaseMesh
   │  │  ├─ Vertices             [Mesh Shell-local count]
   │  │  ├─ Edges                [Mesh Shell-local count]
   │  │  └─ Faces                [Mesh Shell-local count]
   │  └─ Mesh Shell 1 · AppendedMesh
>>>>>>> 22095ed25f234a37a29434ca8482a4279c539820
   └─ Components
      ├─ Vertices                [global]
      ├─ Edges                   [global]
      └─ Faces                   [global]
```

<<<<<<< HEAD
Shell children are descriptive component summaries. Selecting/appending a shell expands `Geometry -> Shells`
and the selected shell automatically so its local counts are visible immediately. `Components` remains the
authoritative entry point for the current asset-wide Vertex / Edge / Face edit modes. Shell selection is intentionally **not** a new
`MeshComponentMode` yet; adding shell-scoped picking/deformation requires a separate selection-scope
contract so the hierarchy never implies filtering that the viewport does not enforce.
=======
A Mesh Shell row is an **actionable transform scope**, not a fourth mesh component mode. Selecting a Mesh Shell
keeps the user-facing hierarchy/Inspector context as `SHELL`, but internally enters `VERTEX` mode and selects every
vertex owned by that Mesh Shell. The normal component gizmo therefore moves only that Mesh Shell instead of moving
the whole Static Mesh object.

`Shift+click` on another Mesh Shell toggles it into/out of the active Mesh Shell set. The transform selection is the
union of the vertices owned by all selected Mesh Shells. The child `Vertices`, `Edges`, and `Faces` rows use the same
multi-shell set and switch the component domain before selecting the matching union of IDs.

Mesh Shells still do not duplicate topology. `getStaticMeshShellComponentSelection()` and
`getStaticMeshShellsComponentSelection()` derive the resolved vertex, edge, and face IDs from the asset's existing
geometry/topology, and the editor sends them through `engine.api.commands.selection.setMeshComponents(...)`. This means
gizmo, soft selection, overlays, Focus, and later editing commands see exactly the same selection representation as
viewport picking.

The global `Components` branch is explicitly asset-wide: `All Vertices`, `All Edges`, and `All Faces` switch to the
requested component mode **and select every component of that type**. This is intentionally different from the toolbar
or pie menu, which only changes component mode and does not imply "select all".

Manual viewport picking, marquee, loop/ring, expand, or shrink releases the full Mesh Shell hierarchy scope once the
selection no longer represents it. A plain component-mode LMB click on empty viewport space also releases the Mesh Shell
scope and replaces the active component selection with an empty set, which hides the gizmo. `Shift+LMB` on empty space
keeps the current selection unchanged. Viewport `Shift+click` and hierarchy `Shift+click` both use the same operation-aware
selection API (`REPLACE | ADD | SUBTRACT | TOGGLE`) rather than mutating `SelectionSystem.subSelection` directly.

The Static Mesh editor opens with no actionable selection. Its hidden preview entity may be installed as an edit target
when component selection is needed, but that target alone must never display a gizmo. The gizmo appears only when the
whole object is explicitly selected or the **active** component domain contains selected components. In particular,
stale selections from another component mode must never make a gizmo appear at the origin.

Triangles remain visible as a Mesh Shell count in the Inspector, but are not a hierarchy action because the editor
currently has no Triangle component mode.
>>>>>>> 22095ed25f234a37a29434ca8482a4279c539820

### React invalidation for composed assets

`AssetManager.updateAsset()` mutates the registered asset object in place with `Object.assign()`. React therefore
cannot use the asset object identity alone as a memo invalidation signal. `StaticMeshEditor` owns an
`assetRevision` tick driven by mesh asset events and passes it into `StaticMeshToolDock`, `MeshAssetHierarchy`,
and `MeshAssetInspector`. Any memo that derives geometry counts, shell lists, shell-local counts, or selected-shell
metadata must include that revision (or an equivalent changed field reference). This is what makes the hierarchy
advance from 0 -> 1 -> 2 shells after successive append operations even though the asset object reference itself
does not change.
