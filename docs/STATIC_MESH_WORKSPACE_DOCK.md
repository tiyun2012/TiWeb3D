# Static Mesh Workspace Dock

## Purpose

`StaticMeshEditor` owns a dedicated left workspace dock that combines the asset hierarchy with Static Mesh editing controls. The dock exists to keep modeling/sculpt controls next to the mesh they operate on while allowing the viewport to reclaim horizontal space when needed.

The dock is implemented by:

- `editor/components/mesh-editing/StaticMeshToolDock.tsx`
- `editor/components/asset-editor/MeshAssetHierarchy.tsx`
- `editor/components/StaticMeshEditor.tsx`

The dock is a UI projection only. It does **not** own a second copy of selection or soft-selection state.

## Layout

Expanded:

```text
Static Mesh left dock
├─ Mesh Workspace header
├─ Hierarchy section
│  └─ MeshAssetHierarchy
└─ Sculpt Tools section
   ├─ Soft Selection master toggle
   ├─ Fixed Soft Transform
   ├─ Live Falloff Transform
   ├─ Slide Sculpt
   ├─ radius / distance / heatmap controls
   └─ context-sensitive Loop Select
```

The dock can collapse to a narrow left rail. This is distinct from the asset-editor header's existing Hierarchy visibility toggle: the header toggle can hide the left area completely, while the dock collapse keeps a small expansion affordance visible.

## State ownership

`StaticMeshToolDock` is a projection of the **Static Mesh Editor's edit session state**. Static Mesh Editor owns viewport-local values for:

- active tool,
- component mode,
- soft-selection enabled/radius/mode/falloff,
- heatmap visibility.

Do not mirror those transient values into Scene's `EditorContext`. Sharing command IDs and deformation code is not permission to share active viewport state. Otherwise entering Vertex mode in the asset editor makes Scene draw a component cage/heatmap and allows unrelated gizmo systems to react.

`StaticMeshEditor` synchronizes its local settings into its local `AssetViewportEngine` through `meshEditing.configureSoftSelection(...)`. Scene uses the same API against the main Engine with its own state.

The dock itself still must not own a second copy of these values: it receives them from its host and invokes catalogue commands/settings callbacks.

## Component mode rule

Soft deformation is available only in Vertex, Edge, or Face mode. The dock leaves the tools visible in Object mode so the user can discover them, but disables activation until a component mode is selected.

Selecting one of the deformation behaviors:

1. enables Soft Selection,
2. selects the requested deformation policy,
3. activates the Move gizmo.

The geometry algorithm remains in `engine/mesh-editing/`; the dock only changes tool state.

## Loop selection

Loop selection is **not** reimplemented by the dock. The canonical algorithm remains:

```text
StaticMeshToolDock / PieMenu
        ↓
StaticMeshEditor.handleSelectLoop()
        ↓
AssetViewportEngine.selectionSystem.selectLoop(mode)
        ↓
SelectionSystem + MeshTopologyUtils
```

Seed requirements are intentionally the same as `SelectionSystem`:

- Edge loop: at least one selected edge.
- Vertex loop: at least two connected selected vertices.
- Face loop: at least two adjacent selected faces.

The Static Mesh Pie Menu must route `loop_vert`, `loop_edge`, and `loop_face` to the **local asset preview engine**, never to the global Scene engine.

Changing a component selection through loop expansion invalidates any retained mesh-deformation transaction before soft-selection weights are recalculated. This prevents a Live Falloff operation from retaining a baseline that belongs to the previous component selection.

## Extending the dock

Future Static Mesh tools should be registered/exposed through mesh-editing APIs first, then surfaced in this dock. Do not put geometry mutation algorithms into React click handlers.

Examples:

```text
UI command
  ↓
Static Mesh editing API / tool session
  ↓
geometry transaction
```

Working Extrude, Inset, Delete Face, Split Edge, Cut Face, and Bevel buttons call the shared normal `StaticMeshAssetAPI` numeric-ID modeling surface. Geometry mutation never lives in React click handlers. When Weld, Connect, or other topology tools become real operations, their dock buttons must call the same engine API used by scripts/tests.


## Live asset geometry propagation

Static Mesh geometry is a shared asset, so Scene instances should visually follow direct asset edits. Live gizmo deformation emits `MESH_GEOMETRY_PREVIEW_UPDATED`, which refreshes only Scene mesh position/normal GPU buffers. On mouse-up the editor emits one normal `ASSET_UPDATED` transaction boundary.

This distinction prevents two common failures:

- Scene's CPU-driven component cage showing the new geometry while the solid GPU mesh still shows the old geometry.
- emitting the full asset-update pipeline on every mouse move.

The Scene `MeshRenderSystem` reuses existing VBO/NBO objects for preview updates; do not allocate replacement GPU buffers per drag event.


## Working normal topology controls

The Topology subsection is mode-aware and works directly on the selected `LogicalMesh` components. Face mode exposes Extrude Distance and relative Inset Ratio (`0.005..0.99`) for exactly one selected logical face. Edge mode exposes Split Position (`0 < t < 1`, default `0.5`) and Bevel Width for exactly one selected logical edge. Vertex mode enables Cut Face when exactly two selected non-adjacent vertices lie on one logical face.

No **Adopt Topology** step is required. Imported, appended, generated, and `smTest(...)` normal meshes use the same numeric face/vertex/edge API. The editor hierarchy does not expose Construction Points/Faces/Loops. See `docs/STATIC_MESH_NORMAL_MODELING_API.md`.

## Quad Ring / Strip selection

Selection Actions now include two topology-query-driven tools in Edge mode:

- **Edge Ring** selects opposite edges across connected logical quads.
- **Quad Strip** uses the same traversal but selects the crossed logical faces and changes to Face mode.

Both actions use `staticMeshAssetAPI.traceEdgeRing()/traceFaceStrip()` rather than a UI-local geometry
algorithm, so browser scripts, future AI planning, and the editor agree on quad/opposite-edge semantics.
These queries work directly on logical/imported topology and return only normal numeric vertex/face identity. They do not mutate the asset.

Use `smTest('ring')` for a clean four-quad manual fixture. Select its center vertical edge; Edge Ring should
select five vertical edges, while Quad Strip should select all four quads.


## Single-edge Bevel

Bevel UI is available for one selected normal manifold edge. Width is world-space distance measured along the local endpoint one-ring edges. The common valence-3 box edge remains supported, and higher-valence interior manifold endpoints are resolved through their unique face fan with endpoint cap faces generated when needed. Ambiguous/open/branched/non-manifold high-valence topology rejects atomically. Use `smTest('bevel')` for the simple case and `smTest('bevel-valence')` for valence-4 endpoints.

### Batch Topology actions

Face-mode **Inset** accepts one or more selected logical faces. The current ratio is applied independently to every selected face in one Undo step, and all generated inner faces remain selected.

Edge-mode **Bevel** accepts one or more selected logical edges. Edge Ring/disjoint selections are processed as one operation and the generated long bevel edges become the new selection. For now, selected edges that share a vertex are rejected with an inline validation message; connected-chain/loop bevel requires the future joint-corner solver.
