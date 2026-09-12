# Asset Editor Template & Capability Filtering

## Goal

Every full 3D asset editor now uses the same four-part structure:

1. **Hierarchy** on the left.
2. **Viewport** in the center.
3. **Inspector** on the right.
4. **Toolbar/actions** owned by `AssetViewport3D`, filtered by asset type.

The structural shell is `editor/components/asset-editor/AssetEditorTemplate.tsx`. It does not initialize WebGL and does not know how an asset is rendered. Its job is editor composition, panel visibility, asset identity, and consistent sizing.

`AssetViewport3D` remains the renderer host and still owns the canvas lifecycle, orbit/pan/zoom, grid, focus, gizmos, stats HUD, and input forwarding.

## Capability registry

`editor/components/asset-editor/assetViewportCapabilities.ts` is the single allow-list for asset viewport actions. Toolbar controls and hotkeys must use the same action ids so a hidden action cannot still fire from the keyboard.

Current action families include:

- `tool.*` — Select / Move / Rotate / Scale.
- `view.*` — Grid / Focus / Auto Rotate.
- `mesh.*` — Object / Vertex / Edge / Face modes, shading, wireframe.
- `skeleton.*` — Joint editing and mesh-overlay display controls.
- `panel.*` — Hierarchy and Inspector availability.

Asset-specific toolbar controls are passed to `AssetViewport3D` as `AssetViewportToolbarAction` descriptors. The viewport filters the descriptors before rendering them. Prefer descriptors over arbitrary `toolbarExtra` JSX for normal editor commands.

## Static mesh editor

`StaticMeshEditor` now composes through `AssetEditorTemplate` and provides:

- `MeshAssetHierarchy` — Asset > Geometry > Vertices / Edges / Faces.
- `MeshAssetInspector` — asset identity, geometry counts, bounds, active component mode, selection count, shading and wireframe state.
- Mesh component hierarchy rows directly switch the viewport component mode.
- Object / Vertex / Edge / Face, shading, and wireframe toolbar actions are descriptors filtered by the capability registry.

## Skeletal mesh editor

`SkeletalMeshEditor` is the entry point for `SKELETAL_MESH` assets. It exposes two valid workspaces without duplicating viewport code:

- **Geometry** — reuses `StaticMeshEditor` for topology/component editing.
- **Skeleton** — reuses `SkeletonEditor` for joints, hierarchy, gizmos, and skeleton display.

The workspace switch is injected through the shared asset editor header. Each workspace keeps the same Hierarchy / Viewport / Inspector frame.

## Skeleton editor

`SkeletonEditor` now also composes through `AssetEditorTemplate`. Its existing `SkeletonHierarchy`, `JointInspector`, `SkeletonAssetInspector`, and `SkeletonDisplayOptions` remain domain-specific slots. Mesh-overlay toolbar actions are passed as filtered descriptors.

## Layout behavior

Full asset-editor windows open larger than before because a persistent hierarchy and inspector need horizontal room. Both side panels can be collapsed from the shared editor header. The viewport toolbar can wrap, and passive mesh/bone statistics live in the lower-left HUD instead of competing with active tools at the top.

## Rules for new asset editors

- Full 3D asset editors use `AssetEditorTemplate` for editor structure.
- Their center viewport uses `AssetViewport3D`.
- Add action ids to `assetViewportCapabilities.ts` before exposing a new command.
- Pass asset-specific toolbar controls as `AssetViewportToolbarAction` descriptors.
- Keyboard shortcuts must check the same capability id as the visible control.
- Hierarchy selections may change an editor mode only when the corresponding capability is allowed.
- Do not duplicate the three-column shell, viewport toolbar groups, or renderer lifecycle.

## Two-panel asset editors

`AssetEditorTemplate` also supports asset types that intentionally have no hierarchy. `CAMERA_PRESET` sets `hasHierarchy=false` and `hasInspector=true`, producing a Viewport + Inspector layout while still reusing the same editor chrome and `AssetViewport3D`. Do not create a second layout shell for this case.
