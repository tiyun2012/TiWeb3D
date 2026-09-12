# ti3D Editor Refactor Template

This refactor is designed to make it easy to add new features with minimum impact on existing ones.

## High-level layers

- **app/**
  - App shell & bootstrapping.
- **editor/**
  - React UI: panels, layouts, editor state.
- **engine/**
  - Runtime engine/services (rendering, ECS, tools, physics...).
  - `engine/api/` = stable UI-facing API (commands/events/queries).
  - `engine/core/` = lightweight module pattern for new features.
- **features/**
  - Feature modules that can be plugged in without touching unrelated code.
- **drafts/**
  - WIP/experimental code excluded from TS typechecking.

## How to add a new feature

1. Create `features/<featureName>/` with:
   - events: `feature.events.ts` (strings only)
   - commands: `feature.commands.ts` (write-only operations)
   - types: `feature.types.ts`
   - module: `FeatureModule.ts` that registers commands/events into `EngineContext`.
2. Keep UI usage behind `engine/api/EngineAPI` (or a feature-specific API) so UI does not import engine singletons.

## Important decoupling rule

UI should not import engine singletons directly (e.g. `engineInstance`) for new code.
Use:
- `engine/api/createEngineAPI.ts`
- `engine/api/EngineProvider.tsx` + `useEngineAPI()`

Existing code still works and can be migrated incrementally.

## Asset Viewport & 3D Editors Architecture (`AssetViewport3D`)

All asset-level 3D inspection and editing tools (e.g. Static Mesh Editor, Skeleton Editor, Animation Preview, Material Preview) **MUST inherit from the unified `AssetViewport3D` component** (`editor/components/AssetViewport3D.tsx`).

### Design Principles:
1. **Inheritance & Consistency Over Duplication:**
   - Never re-implement camera orbit/pan/zoom math, ground grid VAO, gizmo loops, HiDPI canvas resizing, or base toolbar buttons.
   - All asset editors configure `AssetViewport3D` via lifecycle callbacks:
     - `onInitGl(gl)`: Allocate domain-specific buffers, VAOs, textures.
     - `onCleanupGl(gl)`: Release domain-specific GPU buffers.
     - `onRender(args)`: Render specialized geometry (e.g. shaded meshes, bone diamonds, joint lines).
     - `onMouseDown` / `onMouseMove` / `onMouseUp`: Pass interaction to domain systems or gizmos.
     - `toolbarExtra`: Inject editor-specific tool controls (e.g. shading mode, wireframe toggle, bone size sliders).
     - `overlayChildren`: Render floating HTML overlays (e.g. Pie menus, custom HUDs).

2. **Always Update Documentation & Respect Consistency:**
   - Any architectural pattern or reusable component created must be documented in `/docs/`.
   - New editor features must inherit from and extend existing primitives to maintain consistent UI/UX across all Ti3D editor panels.

3. **Viewport Hosting & Safe Lookup Contracts:**
   - **Workspace Shell:** Uses lightweight, performant viewport containers without reliance on incompatible third-party docking runtimes or unmanaged CDN importmaps.
   - **SceneGraph Hierarchy API:** Entity parent-child relations use `sceneGraph.getParentId(id)` and `sceneGraph.getChildren(id)` rather than assumed map properties.
   - **Null-Guarded Map Lookups:** All high-frequency ECS store and index lookups (`ecs.idToIndex.get`, `store.names`, `perObjectModes`) enforce optional chaining and guard against uninitialized state.

4. **Shared Hierarchy Tree & Inline Renaming Architecture:**
   - **Unified Template (`HierarchyTreeItem`):** All tree row elements representing structured object types (Scene entities, Skeleton bones, Asset items) use `HierarchyTreeItem.tsx`.
   - **Reusable Renaming Hook (`useInlineRename`):** Manages inline renaming state, keyboard event isolation (preventing hotkey collision during text editing), and standardized commit lifecycles. See `/docs/HIERARCHY_TREE_API.md` for full contract details.


## Reusable Viewport Shell (`ViewportTemplate`)

Viewport layout/chrome is now separated from renderer lifecycle. `editor/components/viewport/ViewportTemplate.tsx` is the engine-agnostic canvas shell used by both `SceneView` and `AssetViewport3D`. It owns only placement/composition for the canvas, toolbars, HUDs, and overlays. Renderer setup, render loops, picking, gizmos, and asset/scene behavior stay in the owning viewport host.

Shared orbit/pan/zoom math lives in `editor/viewports/viewportCamera.ts`. New viewport hosts must reuse these camera helpers rather than copy spherical-camera/vector math. New **asset** editors still inherit from `AssetViewport3D`; they should not bypass it and use `ViewportTemplate` directly.

See `/docs/VIEWPORT_TEMPLATE.md` for the component contract and extension pattern.

## Reusable Full Asset Editor Frame (`AssetEditorTemplate`)

Full 3D asset editor windows must compose through `editor/components/asset-editor/AssetEditorTemplate.tsx` so Hierarchy, Viewport, Inspector, asset identity, and panel visibility are structurally consistent. The center renderer remains `AssetViewport3D`.

Asset action availability is centralized in `editor/components/asset-editor/assetViewportCapabilities.ts`. Both visible toolbar descriptors and keyboard triggers must use that allow-list. Do not hide an invalid toolbar command while leaving its hotkey active.

`SKELETAL_MESH` assets route through `SkeletalMeshEditor`, which switches between the existing geometry (`StaticMeshEditor`) and skeleton (`SkeletonEditor`) workspaces instead of forcing one editor to reimplement the other domain.

See `/docs/ASSET_EDITOR_TEMPLATE.md`.

## Stable skeleton bone visuals

Skeleton bone geometry is shared through `engine/renderers/DebugRenderer.ts` and follows a parent-anchored contract: the live child controls only the tip/length, while bone cross-section size comes from the parent's structural joint radius and roll comes from the parent's local frame plus a stable rest direction. `SkeletonEditor` and `SkeletonTool` cache local visual rest directions so live bind-pose updates do not twist the bone base during child translation. See [`SKELETON_BONE_VISUALS.md`](./SKELETON_BONE_VISUALS.md).

## Shared mesh polygon-edge rendering

Mesh edge identity, authored polygon-edge extraction, typed line-index buffers, and common edge colors are centralized in `engine/MeshEdgeGeometry.ts`. Asset viewports render those indices through `editor/viewports/MeshEdgeOverlay.ts`; Vertex component points reuse `editor/viewports/MeshVertexOverlay.ts`; the Scene viewport uses the same unique-edge iterator with `DebugRenderer`. Component overlays depth-test against the mesh but do not write depth, so dim topology passes cannot suppress selected edge/vertex highlights at the same surface depth. See [`MESH_EDGE_RENDERING.md`](./MESH_EDGE_RENDERING.md). For the end-to-end component-mode render flow, depth ordering, Scene-vs-asset backend split, and CSS-pixel/DPR sizing rules, see [`MESH_COMPONENT_RENDERING_FLOW.md`](./MESH_COMPONENT_RENDERING_FLOW.md).

## Shared mesh surface shading across viewports

Scene meshes and 3D asset previews share their surface/render-output contract through `engine/renderers/MeshSurfaceContract.ts`. Generated Standard materials (`ShaderCompiler`), the Scene fallback mesh shader (`MeshRenderSystem`), and direct asset-preview mesh shaders all reuse the same Standard BRDF. Scene off-screen targets stay linear and convert to display space in `WebGLRenderer`; direct asset previews apply that same display transfer in their surface/line shaders. Lit/Normals/Unlit mode IDs and WebGL context/background rules are also shared. Environment inputs such as actual Scene light, custom Scene material, entity tint, and skinning remain host-specific. See [`SHARED_VIEWPORT_MESH_SHADING.md`](./SHARED_VIEWPORT_MESH_SHADING.md).

## Shared mesh material assignment

Mesh assets may define an optional default `materialId`. Scene mesh components may override it; an empty Scene slot inherits the asset default, and an empty asset slot uses the built-in shared **Standard Lambert** fallback. Material selection UI is centralized in `editor/components/inspector/MaterialSlotField.tsx`, while asset-viewport graph materials compile through `engine/renderers/MaterialPreviewRenderer.ts` because WebGL programs cannot cross contexts. See [`MATERIAL_ASSIGNMENT_FLOW.md`](./MATERIAL_ASSIGNMENT_FLOW.md).

## Camera / Inspector Registry

Camera, Scene post-process references, and reusable auto-inspector registration are documented in `docs/CAMERA_INSPECTOR_REGISTRY.md`. New simple component inspectors should prefer `InspectorRegistry` + `AutoInspector`; specialized graph/hierarchy/timeline editors may remain custom.

## Asset Type Registry / Content Browser creation

Content Browser asset creation is registry-driven. Built-in asset definitions are registered at application bootstrap in `engine/BuiltInAssetTypes.ts`; `editor/components/ProjectPanel.tsx` reads `engine/AssetTypeRegistry.ts` rather than maintaining a parallel type/factory list. New creatable asset types must register their label, icon, category, default name, and factory with `assetTypeRegistry`. See `docs/ASSET_TYPE_REGISTRY.md`.


## Asset Editor Registry / double-click routing

Content Browser editor opening is registered through `editor/AssetEditorRegistry.ts`; built-ins are installed by `editor/BuiltInAssetEditors.tsx`. `ProjectPanel.tsx` must query the registry instead of hardcoding editor components by asset type. See `docs/ASSET_EDITOR_REGISTRY.md`.

Camera Preset uses this path and opens a two-panel `CameraPresetEditor` (Viewport + Inspector) that reuses `AssetViewport3D` and the `CameraSettings` AutoInspector schema. See `docs/CAMERA_PRESET_EDITOR.md`.

- Camera configuration/runtime layering is documented in `docs/CAMERA_RESOLUTION_FLOW.md`; renderer-facing code should consume resolved camera state rather than mutating presets or serialized camera fields during runtime/cinematic control.

## Component composition & Inspector inheritance

Scene-object "inheritance" is capability-based ECS composition, not class inheritance. Runtime component dependencies/default structural components are registered in `engine/components/ComponentDefinitionRegistry.ts`; for example Camera, Light, Mesh, Physics, and Particle System require Transform, so adding one automatically guarantees the spatial base exists. Reusable editable-data contracts use `InspectorSchema.extends`, so adding fields to a base schema such as `CameraSettings` automatically flows into derived schemas such as `CameraComponent`. See [`COMPONENT_COMPOSITION_AND_INSPECTOR_INHERITANCE.md`](./COMPONENT_COMPOSITION_AND_INSPECTOR_INHERITANCE.md).

## Viewport Profile + Camera Binding

Viewport behavior and Camera state are deliberately separate. `VIEWPORT_PROFILE` assets store editor-only navigation/overlay policy (orbit/pan/zoom/focus, grid/helpers/gizmos). A Camera Preset may reference one through `asset.editor.viewportProfileId`; runtime Camera resolution ignores that editor metadata. Scene View Through Camera keeps the viewport profile while binding pose changes to the live Camera entity Transform, and the bound Camera helper/gizmo is suppressed from its own image. Through Camera in the Camera Preset editor never renders frustum/lens-reference geometry; Inspect Camera is the external frustum view. See [`VIEWPORT_PROFILE_AND_CAMERA_BINDING.md`](./VIEWPORT_PROFILE_AND_CAMERA_BINDING.md).

Scene Camera View Through navigation uses explicit interaction ownership: the viewport drives the live Camera Transform during orbit/pan/zoom, external Transform edits resync only outside the active gesture, and Camera roll is transported around the live forward axis rather than stored as a stale world-space up vector. Camera Presets expose an editor-only Transform [Preview] component but do not serialize a Scene Transform. See [`SCENE_CAMERA_NAVIGATION_STABILITY.md`](./SCENE_CAMERA_NAVIGATION_STABILITY.md).
