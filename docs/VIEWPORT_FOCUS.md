# Viewport Focus Architecture

## Goal

Focus is an explicit viewport navigation command. Selection changes never move a camera by themselves.

The shared flow is:

```text
F / Pie Focus / future agent command
        -> context FocusTarget resolver
        -> FocusTarget { bounds, pivot?, padding?, minWorldRadius? }
        -> frameCameraOnFocusTarget(...)
        -> viewport camera state
        -> optional Scene Camera binding commit
```

This separates three responsibilities:

1. **Selection systems** own what is selected.
2. **Focus target resolvers** translate the active editor context into world/local bounds.
3. **Viewport navigation** owns how a camera frames those bounds.

## Shared API

`editor/viewports/viewportFocus.ts` contains the domain-neutral contract:

- `FocusTarget`
- `ViewportFocusProvider`
- `createFocusTargetFromBounds(...)`
- `createFocusTargetFromPoints(...)`
- `frameCameraOnFocusTarget(...)`

The framing function preserves the current view direction and roll. Perspective fitting uses the live camera basis, viewport aspect ratio, and FOV. Orthographic fitting changes the editor-only `orthoScale` instead of dollying the camera.

`AssetViewport3D` accepts an optional `focusProvider` and exposes an imperative API:

```ts
interface AssetViewport3DHandle {
  focus(): void;
  focusTarget(target: FocusTarget): void;
}
```

This makes UI buttons, Pie Menu actions, tests, scripts, and future agent-facing editor APIs able to invoke the same navigation path rather than reproducing camera math.

## Context Adapters

`editor/viewports/focusTargetResolvers.ts` contains domain adapters.

### Scene View

`resolveSceneSelectionFocusTarget(...)` behaves as follows:

- Object mode: union actual transformed mesh AABBs for all selected mesh entities.
- Non-mesh entities: use a small world-space focus volume around their real world transform.
- Vertex/Edge/Face mode: if a mesh component selection exists, convert it through `SelectionSystem.getSelectionAsVertices()` and frame only those selected vertex positions.
- No selection: Scene View keeps its existing world-overview fallback.

The old Scene focus approximation (`world position +/- transform scale`) must not be reintroduced because it ignores mesh bounds, pivots, rotations, and asset dimensions.

### Static Mesh Editor

`StaticMeshEditor` provides a `ViewportFocusProvider` to `AssetViewport3D`:

- Object mode -> whole mesh AABB.
- Vertex mode -> selected vertices.
- Edge mode -> endpoints from selected edges.
- Face mode -> vertices from selected faces.
- Component mode with nothing selected -> whole mesh AABB.

The provider reads the live local preview engine at command time. `AssetViewport3D` does not know mesh topology or component-selection semantics.

## Camera Binding Rule

When Scene View is looking through a Scene Camera, Focus updates the shared viewport camera state and then commits through `writeSceneCameraViewportState(...)`, the same binding path used by navigation. Focus code must not write Transform component fields directly.

Selection notifications must never reconstruct or move the bound camera unless its actual transform changed. See `SCENE_CAMERA_NAVIGATION_STABILITY.md`.

## Extension Pattern

Future editors should implement a small provider rather than adding focus logic to `AssetViewport3D`:

```ts
const focusProvider: ViewportFocusProvider = {
  getFocusTarget: () => resolveMyEditorSelection(),
  getDefaultFocusTarget: () => resolveWholeAsset(),
};
```

Examples:

- Skeleton Editor: selected joint/bone bounds, then whole skeleton fallback.
- Animation Editor: selected animated controls/keyed subjects.
- Camera preview: selected preview subject.
- Material preview: preview primitive bounds.

Do not add asset-type branches to `AssetViewport3D` for these cases.
