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

When Extrude, Bevel, Weld, Connect, Inset, or other topology tools become real operations, their dock buttons should call those APIs. Do not create a second implementation just because the Pie Menu also exposes the action.


## Live asset geometry propagation

Static Mesh geometry is a shared asset, so Scene instances should visually follow direct asset edits. Live gizmo deformation emits `MESH_GEOMETRY_PREVIEW_UPDATED`, which refreshes only Scene mesh position/normal GPU buffers. On mouse-up the editor emits one normal `ASSET_UPDATED` transaction boundary.

This distinction prevents two common failures:

- Scene's CPU-driven component cage showing the new geometry while the solid GPU mesh still shows the old geometry.
- emitting the full asset-update pipeline on every mouse move.

The Scene `MeshRenderSystem` reuses existing VBO/NBO objects for preview updates; do not allocate replacement GPU buffers per drag event.
