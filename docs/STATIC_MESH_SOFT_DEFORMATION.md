# Static Mesh Soft Deformation

Soft deformation is owned by Static Mesh editing and shared by both the Static Mesh asset viewport and Scene component editing. Scene does not implement a second deformation algorithm; it only supplies a Static Mesh entity as the target.

## Shared flow

`component selection -> soft-selection solver -> MeshDeformationSession -> gizmo deformation -> geometry/GPU update`

The pure weight solver lives in `engine/mesh-editing/SoftSelection.ts`. Surface/connected traversal uses the shared cached connectivity API in `engine/mesh-editing/MeshConnectivity.ts`. The transactional deformation state lives in `engine/mesh-editing/MeshDeformationSession.ts`.

Only assets with `type === 'MESH'` are accepted by the new deformation session. Skeletal Mesh editing is intentionally excluded until it has its own explicit deformation policy.


## Influence settings

Distance and connectivity are separate axes and are shared by Scene and Static Mesh Editor:

- **Volume** — Euclidean distance from the current component-selection center.
- **Surface** — face-aware surface-distance approximation. Authored edges stay authoritative for topology, while virtual face-center links are used only by the influence metric so quads/ngons do not expand in edge-only cross patterns.
- **Hybrid** — blends the resulting Volume and Surface weights. `surfaceBlend = 0` is Volume, `1` is Surface.
- **Connectivity / None** — no topology mask.
- **Connectivity / Same Island** — reject vertices outside the connected logical component.
- **Connectivity / Flood Within Radius** — flood logical neighbors only while each next vertex remains inside the Euclidean radius. This is the cheap connected-volume behavior intended for future skinning/deformer/sculpt brushes.

The solver order is:

`distance weights -> optional Volume/Surface blend -> connectivity mask -> deformation strategy`

This keeps Fixed / Live Falloff / Slide independent from how influence is calculated.

## Behaviors

### FIXED — Fixed Soft Transform

The component selection owns a stable influence-reference geometry. Gizmo movement does not change that reference, so repeated transforms cannot make the weights drift. Geometry for each drag is reconstructed as:

`position = operationBaseline + totalGizmoDelta * fixedWeight`

Explicit influence edits such as radius, distance metric, hybrid blend, or connectivity **do** recompute `fixedWeight`, but they are solved against the stable reference geometry rather than the already-deformed mesh. Existing deformation is not retroactively rewritten; the updated heatmap/weights are used by the next gizmo movement.

### LIVE_FALLOFF — Live Falloff Transform

The operation keeps an immutable baseline plus total gizmo delta. Radius/falloff changes recompute weights against the baseline and immediately recompose:

`position = operationBaseline + totalGizmoDelta * currentWeight`

The operation remains adjustable after mouse-up while component selection is unchanged. Changing component selection or component mode commits/invalidates the retained operation.

### SLIDE — Slide Sculpt

Slide intentionally keeps a per-vertex accumulated displacement buffer. On every gizmo update it computes influence from the current deformed mesh, then applies only the incremental gizmo movement:

`accumulatedOffset += incrementalGizmoDelta * currentWeight`

`position = operationBaseline + accumulatedOffset`

Vertices that move outside the current influence radius receive zero additional movement. If they later re-enter the radius, they can be affected again. Radius changes do not retroactively rewrite already accumulated Slide history.

Surface distance is supported through the cached logical-mesh connectivity graph plus metric-only face-center links. SLIDE + SURFACE/HYBRID is still more expensive than Volume because surface distances are re-evaluated during movement, but adjacency/weld discovery is no longer rebuilt on each solve.

## API

`EngineAPI.commands.meshEditing.configureSoftSelection(...)` is the stable configuration surface for UI, scripts, tests, and future agents. Asset viewports already use this API instead of directly writing local engine fields. Example:

```ts
engine.api.commands.meshEditing.configureSoftSelection({
  distanceMetric: 'HYBRID',
  surfaceBlend: 0.65,
  connectivity: 'FLOOD_WITHIN_RADIUS',
  radius: 1.5,
});

const current = engine.api.getSoftSelectionSettings();
```

`falloff` remains accepted as a legacy alias for `distanceMetric`, but new agent/script callers should prefer `distanceMetric`.

## Test matrix

1. Select one or more vertices, edges, or faces on a Static Mesh.
2. Enable Soft Selection and choose a radius.
3. FIXED: move the gizmo and release. The heatmap/weights must remain unchanged from geometry movement alone. Change radius: the heatmap/weights must update from the stable selection reference while existing deformation stays unchanged. Start another drag to use the new weights.
4. LIVE_FALLOFF: move the gizmo, release, change radius without changing selection. Existing deformation must expand/contract from the original operation baseline without drift.
5. SLIDE: drag far enough that low-weight vertices fall behind/outside the moving influence region. Those vertices must stop receiving additional movement rather than being pulled indefinitely.
6. Change component selection or Vertex/Edge/Face mode. Any retained LIVE operation must no longer respond to subsequent radius changes.
7. Repeat in Scene with a Static Mesh entity selected. Behavior should match Static Mesh Editor. Skeletal Mesh targets should not enter the new deformation session.

## Static Mesh workspace UI and state scope

Static Mesh Editor exposes the deformation policies through the collapsible left workspace dock documented in [`STATIC_MESH_WORKSPACE_DOCK.md`](./STATIC_MESH_WORKSPACE_DOCK.md).

The deformation **implementation** and command IDs are shared with Scene, but transient edit state is viewport/context scoped. Static Mesh Editor owns its current tool, component mode, soft-selection settings, and heatmap visibility; Scene owns its own corresponding state. Reusing the command catalogue must never force Scene into Vertex/Edge/Face mode merely because the asset editor entered that mode.

Both contexts still configure the same `meshEditing.configureSoftSelection(...)` API on their own engine host. This is implementation reuse without cross-viewport UI-state coupling.

The Static Mesh asset viewport uploads the session's existing soft-selection weight buffer as vertex attribute 14 for heatmap display. The renderer observes weights; it does not calculate a second set of weights.

## Component-edit interaction ownership

While Vertex/Edge/Face mode is active, the Static Mesh viewport treats the preview entity as a fixed edit target. Component clicks must never fall through to object picking: `SelectionSystem.setSelected()` deliberately clears component sub-selection, which also clears the soft-selection weights and removes the component gizmo. A component-pick miss therefore preserves the current component selection rather than silently switching selection domains. RMB/Pie Menu opening must preserve component selection too.

Gizmo drags capture their entity and component/object mode at mouse-down and keep that ownership until mouse-up. Pointer-move samples do not re-resolve mutable selection state, so UI notifications, hover changes, or other transient state cannot cancel `activeAxis` mid-gesture. `AssetViewportEngine.updateVertexDrag()` also avoids React UI invalidation per pointer sample; rendering reads geometry and soft-selection revisions directly, with normal UI/asset finalization at the gesture boundary.

### Drag cancellation and Undo/Redo

Static Mesh component deformation uses the asset transaction as the drag-start snapshot. The gizmo itself is never recorded in history.

`Esc` cancels an active drag and restores the transaction-start mesh without creating an Undo entry. `Ctrl/Cmd+Z` while a drag is still active performs that cancellation first rather than consuming the previous committed history step. Once a drag has been committed, Undo/Redo restores the mesh snapshot, keeps any still-valid component selection, recomputes soft-selection state, and lets `GizmoSystem` derive its pivot from the restored selected vertices.

No-op drags are not committed. If the final total gizmo delta returns to zero, `AssetViewportEngine` closes its transaction without marking it dirty.

If a component drag begins while a broader asset transaction is already open, the viewport does not own that outer transaction. Commit marks the outer transaction dirty without closing it; cancel restores only the drag's geometry baseline rather than rolling back the caller's whole transaction.
