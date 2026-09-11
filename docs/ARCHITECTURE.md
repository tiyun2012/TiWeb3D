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

