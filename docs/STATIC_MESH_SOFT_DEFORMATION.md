# Static Mesh Soft Deformation

Soft deformation is owned by Static Mesh editing and shared by both the Static Mesh asset viewport and Scene component editing. Scene does not implement a second deformation algorithm; it only supplies a Static Mesh entity as the target.

## Shared flow

`component selection -> soft-selection solver -> MeshDeformationSession -> gizmo deformation -> geometry/GPU update`

The pure weight solver lives in `engine/mesh-editing/SoftSelection.ts`. The transactional deformation state lives in `engine/mesh-editing/MeshDeformationSession.ts`.

Only assets with `type === 'MESH'` are accepted by the new deformation session. Skeletal Mesh editing is intentionally excluded until it has its own explicit deformation policy.

## Behaviors

### FIXED — Fixed Soft Transform

Weights are captured when the gizmo drag begins. Geometry is reconstructed as:

`position = operationBaseline + totalGizmoDelta * capturedWeight`

Changing radius after/during the operation does not rewrite that operation. The preview weights may update to show what the next drag will use.

### LIVE_FALLOFF — Live Falloff Transform

The operation keeps an immutable baseline plus total gizmo delta. Radius/falloff changes recompute weights against the baseline and immediately recompose:

`position = operationBaseline + totalGizmoDelta * currentWeight`

The operation remains adjustable after mouse-up while component selection is unchanged. Changing component selection or component mode commits/invalidates the retained operation.

### SLIDE — Slide Sculpt

Slide intentionally keeps a per-vertex accumulated displacement buffer. On every gizmo update it computes influence from the current deformed mesh, then applies only the incremental gizmo movement:

`accumulatedOffset += incrementalGizmoDelta * currentWeight`

`position = operationBaseline + accumulatedOffset`

Vertices that move outside the current influence radius receive zero additional movement. If they later re-enter the radius, they can be affected again. Radius changes do not retroactively rewrite already accumulated Slide history.

Surface/geodesic distance is supported, but SLIDE + SURFACE is deliberately more expensive because weights are re-evaluated during movement. Optimize/cached adjacency only after behavior is validated.

## API

`EngineAPI.commands.meshEditing.configureSoftSelection(...)` is the stable configuration surface for UI, scripts, tests, and future agents. Asset viewports already use this API instead of directly writing local engine fields.

## Test matrix

1. Select one or more vertices, edges, or faces on a Static Mesh.
2. Enable Soft Selection and choose a radius.
3. FIXED: move the gizmo, release, change radius. Existing deformation must stay unchanged. Start another drag to use the new radius.
4. LIVE_FALLOFF: move the gizmo, release, change radius without changing selection. Existing deformation must expand/contract from the original operation baseline without drift.
5. SLIDE: drag far enough that low-weight vertices fall behind/outside the moving influence region. Those vertices must stop receiving additional movement rather than being pulled indefinitely.
6. Change component selection or Vertex/Edge/Face mode. Any retained LIVE operation must no longer respond to subsequent radius changes.
7. Repeat in Scene with a Static Mesh entity selected. Behavior should match Static Mesh Editor. Skeletal Mesh targets should not enter the new deformation session.
