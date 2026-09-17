# Asset Viewports & Reusable 3D Editor Architecture

## Overview
In the Ti3D Editor, assets such as meshes, skeletons, animations, and materials need specialized 3D preview and editing environments. Rather than duplicating WebGL contexts, camera math, HiDPI canvas handling, ground grids, toolbar buttons, and gizmo integration across every editor, all 3D asset editors inherit from the unified **`AssetViewport3D`** (`editor/components/AssetViewport3D.tsx`).

Both **`StaticMeshEditor`** and **`SkeletonEditor`** inherit from this base component, guaranteeing consistent controls, keybindings, and visual language across the engine.

---

## Core Capabilities Provided by `AssetViewport3D`

1. **HiDPI-Aware WebGL2 Viewport:**
   - Powered by `useViewportSize` with DPR capping and layout change observation.
   - Automatically matches pixel resolution to device pixel ratios with depth testing and clear passes.

2. **Standardized Navigation & Camera Model:**
   - **Alt + LMB Drag:** Smooth spherical orbit (`theta`, `phi`) with pole-clamping.
   - **Alt + MMB Drag:** Local camera-space panning (calculates forward, right, and camera up vectors).
   - **Alt + RMB Drag / Scroll Wheel:** Distance zooming (`radius`) with minimum bounds to prevent clipping.
   - **F Key / Focus:** Resolves a contextual `FocusTarget` through an optional `ViewportFocusProvider` and frames it with shared perspective/orthographic math. Editors not yet migrated retain the legacy whole-asset `fitCamera` fallback.
   - **Auto-Rotate:** Interactive turntable rotation toggle for asset inspection.

3. **Ground Grid & Coordinates:**
   - World-space ground grid rendered dynamically with primary coordinate axes.
   - Toggleable via the `G` shortcut key or the toolbar grid button.

4. **Gizmo & ECS Integration:**
   - Mounts `GizmoRenderer` on the WebGL2 context and hooks into `AssetViewportEngine` or the asset's `GizmoSystem`.
   - Supports Select (`Q`), Move (`W`), Rotate (`E`), and Scale (`R`) transforms directly in asset space.

5. **Unified Toolbar & HUD:**
   - Base transform tools (`Q`, `W`, `E`, `R`), Grid toggle, and Reset View.
   - `toolbarExtra`: Extensible slot for domain-specific controls (e.g., Shading Mode `Lit`/`Flat`/`Normals`, Wireframe toggle, Bone display mode).
   - `headerExtra` & `stats`: Verts/Tris metrics, Bone counts, and selection badges.
   - `overlayChildren`: Portals for context menus and Pie Menus.

---


### Contextual Focus API

`AssetViewport3D` is domain-neutral. Asset editors may provide `focusProvider: ViewportFocusProvider`; the viewport never branches on vertices, edges, faces, bones, or asset-specific selection types. Static Mesh Editor is the reference implementation: component modes convert selection through `SelectionSystem.getSelectionAsVertices()` and frame only those points, while object/no-component selection frames the complete mesh.

The component also exposes `AssetViewport3DHandle.focus()` and `focusTarget(target)`, allowing Pie Menu actions, tests, scripts, and future agent-facing editor APIs to invoke the same navigation path without synthesizing key events. See [`VIEWPORT_FOCUS.md`](./VIEWPORT_FOCUS.md).

## Component Interface (`AssetViewport3DProps`)

```typescript
export interface AssetViewport3DProps {
  // Core Tool State
  tool: ToolType;
  setTool: (tool: ToolType) => void;

  // Camera & Bounds
  camera?: CameraState;
  onCameraChange?: (camera: CameraState) => void;
  defaultCamera?: CameraState;
  fitCamera?: { radius: number; target: { x: number; y: number; z: number } } | null;
  focusProvider?: ViewportFocusProvider;

  // Grid & Display
  showGrid?: boolean;
  onToggleGrid?: () => void;
  stats?: Array<{ label: string; value: string | number; color?: string }>;
  selectionBadge?: { text: string; active: boolean };

  // Extensibility Slots
  toolbarExtra?: React.ReactNode;
  headerExtra?: React.ReactNode;
  shortcutsLegend?: string;
  overlayChildren?: React.ReactNode;

  // Engine & Gizmos
  engine?: AssetViewportEngine | null;
  gizmoSystem?: GizmoSystem | null;

  // WebGL Lifecycle Callbacks
  onInitGl?: (gl: WebGL2RenderingContext) => void;
  onCleanupGl?: (gl: WebGL2RenderingContext) => void;
  onRender?: (args: AssetViewportRenderArgs) => void;

  // Interaction Events
  onMouseDown?: (e: React.MouseEvent, coords: { x: number; y: number; width: number; height: number }) => void;
  onMouseMove?: (e: MouseEvent, coords: { x: number; y: number; width: number; height: number }) => void;
  onMouseUp?: (e: MouseEvent, coords: { x: number; y: number; width: number; height: number }) => void;
  onWheel?: (e: React.WheelEvent) => void;
  onContextMenu?: (e: React.MouseEvent, coords: { x: number; y: number; clientX: number; clientY: number }) => void;
  onResetView?: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}
```

---

## Pattern: How to Implement a New Asset Editor

When building a new 3D asset editor (e.g., Material Preview, Animation Clip Player):

1. **Do NOT write a new canvas loop or camera handler.**
2. Set up local state/engine (e.g. `AssetViewportEngine`).
3. Allocate asset-specific WebGL resources in `onInitGl` and release them in `onCleanupGl`.
4. Draw custom elements inside `onRender(args)`:
   - Use `args.vp` (view-projection matrix) and `args.gl`.
   - Take advantage of `args.meshProgram` or `args.lineProgram`, or compile custom shaders if needed.
5. Provide domain-specific tools via `toolbarExtra` and context menus via `overlayChildren`.

---

## Implemented Reference Editors

- **`StaticMeshEditor.tsx`**: Composes through `AssetEditorTemplate` and inherits `AssetViewport3D` to render 3D geometry, wireframe overlays, vertex/edge/face component picking, PieMenu, and shading mode cycles. It provides `MeshAssetHierarchy` and `MeshAssetInspector` to complete the shared Hierarchy / Viewport / Inspector frame.
- **`SkeletalMeshEditor.tsx`**: Entry point for skeletal mesh assets. It switches between the reused Geometry (`StaticMeshEditor`) and Skeleton (`SkeletonEditor`) workspaces instead of duplicating either implementation.
- **`SkeletonEditor.tsx`**: Composes through `AssetEditorTemplate` and inherits `AssetViewport3D` to render hierarchical bone octahedrons, wireframe sphere joints, bone selection, and skeleton hierarchy synchronization, with an integrated Inspector sidebar powered by `JointInspector`, `SkeletonAssetInspector`, and `SkeletonDisplayOptions`. Scene entities spawned from skeleton assets maintain exact 1:1 transform parity with the editor via `bone.bindPose` initialization and `syncSkeletonEntities`.

---

## Reusable Skeleton Visualization & Inspector Architecture

To guarantee visual consistency between global scene tools (such as `SkeletonTool.ts`) and asset-specific editors (`SkeletonEditor.tsx`), the visualization options and inspector controls are modularized into shared components:

1. **`SkeletonDisplayOptions.tsx` (`editor/components/inspector/SkeletonDisplayOptions.tsx`)**:
   - Reusable UI component encapsulating display toggles: `enabled`, `drawJoints`, `drawBones`, `drawAxes`, `jointRadius`, and `rootScale`.
   - Decoupled from state management: accepts `options` and `onChange` props, allowing it to seamlessly bind to `EditorContext.skeletonViz` (global space) or component-local state.
   - Used across `InspectorPanel.tsx`, `ToolOptionsPanel.tsx`, and `SkeletonEditor.tsx`.

2. **`JointInspector.tsx` (`editor/components/inspector/JointInspector.tsx`)**:
   - Inspector component for individual selected joints.
   - Provides accessible joint renaming, parent hierarchy selection with cycle-prevention logic, local position/rotation/scale editing with `DraggableNumber`, focus joint, add child, and delete joint actions.

3. **`SkeletonAssetInspector.tsx` (`editor/components/inspector/SkeletonAssetInspector.tsx`)**:
   - Overview component for skeleton and skeletal mesh assets displaying bone counts, linked meshes, quick root joint creation, and an embedded `SkeletonDisplayOptions` card.

4. **Consistent 3D Drawing Pipeline (Sphere-Only Joints)**:
   - All skeleton joints across global viewport (`SkeletonTool.ts`), asset editors (`SkeletonEditor.tsx`), and animation playback (`AnimationSystem.ts`) are uniformly visualized as wireframe spheres (never diamonds or dot sprites).
   - Shared pure geometry algorithms (`generateWireSphereLines`, `generateBoneOctahedronLines`, `generateAxisLines`) and high-level drawing routines (`drawWireSphere`, `drawAxis`, `drawBoneOctahedron`) are centralized in `engine/renderers/DebugRenderer.ts`, preventing duplicate math implementations and guaranteeing optical and scale parity across the entire application.
   - Bone octahedrons, wireframe joint spheres, and 3D RGB orientation axes scale harmoniously with `jointRadius` and `rootScale`.

5. **Unified Joint & Bone Selection & Optical Highlighting**:
   - A bone extending from joint $J_1$ (parent) to joint $J_2$ (child) belongs to $J_1$. Clicking or raycasting the bone segment in the viewport (both in Scene View via `SelectionSystem.ts` and Skeleton Editor via `SkeletonEditor.tsx`) directly selects $J_1$.
   - When joint $J_1$ is selected, both its joint sphere and its outgoing bone octahedron(s) are illuminated in the matching golden amber highlight (`#fbbf24` / `rgba(0.98, 0.65, 0.12, 1.0)`). They act visually and behaviorally as a single unified object.
   - Hierarchy tree item selection in `HierarchyTreeItem.tsx` and `HierarchyPanel.tsx` is bound to `onPointerDown` (debounced against subsequent `onClick`) and `onDragStart`, eliminating missed clicks caused by HTML5 drag thresholds and ensuring instantaneous selection response.
   - Synchronous selection dispatching via `handleSelectBone` and `engine.setSelected` executes `syncTransforms(false)` and `notifyUI()` immediately, eliminating reactive lag between the hierarchy, viewport gizmo, and inspector.

6. **Zero-Latency Depth-Aware Joint & Bone Hit-Testing**:
   - `SkeletonEditor` employs synchronous, zero-latency screen hit testing via `findBoneAtScreen` triggered directly within `handleMouseMove` and `handleMouseDown`, rather than waiting for next-frame render loops or relying on stale refs.
   - **Hierarchical Hit Priority**: Direct hits on joint spheres (22px radius) take strict precedence over bone connection segment tests (14px radius). Bone tests are only evaluated when no joint sphere is under the cursor.
   - **Depth Sorting**: When multiple joints or bones project into overlapping 2D regions, items are depth-sorted by camera view depth ($p_w$). The candidate closest to the camera is selected, eliminating mis-selections of rear occluded joints.
   - **Visual Hover Feedback**: Hovered joints and bone octahedrons are rendered in high-contrast vibrant cyan (`rgba(0.22, 0.78, 0.98, 1.0)`), accompanied by a cursor tooltip label, providing unambiguous visual confirmation before clicking. Selected elements illuminate in warm golden amber (`rgba(0.98, 0.65, 0.12, 1.0)`).
   - **Gizmo Deconfliction**: In `SELECT` tool mode (Q), `GizmoSystem.renderInSelectTool` is disabled to prevent gizmos from intercepting bone and joint clicks. In transform tool modes (`MOVE`, `ROTATE`, `SCALE`), gizmo axis hit radii are tightly calibrated so clicking joints outside active axes seamlessly shifts selection.

---

## Asset Persistence & Mutation Contracts

All asset edits performed inside viewports (e.g., bone transformations, joint renaming, topology adjustments, or metadata edits) synchronize back to the central `AssetManagerService` via:
```typescript
assetManager.updateAsset(assetId, partial);
```
`updateAsset` merges updates onto the live asset instance and emits `eventBus.emit('ASSET_UPDATED', { id, type })` so all open editor panels, project browsers, and 3D viewports remain seamlessly in sync.

---

## Gizmo Interaction & Transform API Synchronization

1. **State-Driven Engine Binding**:
   - `AssetViewport3D` must receive `engine` and `gizmoSystem` through React state (`useState`), ensuring the component receives valid instances as soon as `useEffect` finishes initialization in child editors (`SkeletonEditor`, `StaticMeshEditor`).
   - `AssetViewport3D` dynamically updates `engine.setRenderer` whenever `engine` changes, attaching the active `GizmoRenderer` facade to the viewport engine.

2. **Live Inspector Feedback During Gizmo Drag**:
   - Gizmo translations (`GizmoSystem.handleDrag` -> `setWorldPosition` -> `syncTransforms`) trigger `engine.notifyUI()`.
   - In `SkeletonEditor`, `onNotifyUI` calculates updated bone bind poses, updates the asset, and increments a reactive revision counter (`transformRevision`).
   - `JointInspector` consumes this revision, continuously updating its decomposed local coordinates (Position X, Y, Z, Rotation, Scale) in real-time as the user drags gizmo handles.

3. **Unified Transform Engine API (`EngineAPI`)**:
   - `EngineAPI.commands.transform`: Provides decoupled commands for `setPosition`, `setRotation`, `setScale`, `move`, and `setWorldPosition`.
   - `EngineAPI.commands.gizmo`: Provides `setTool` for switching between `SELECT`, `MOVE`, `ROTATE`, and `SCALE`.
   - `EngineAPI.getPosition`, `getWorldPosition`, and `getTool`: Provide standardized read-only queries for UI inspectors and gizmos.
   - **Target-Engine Scoping**: `createEngineAPI(targetEngine)` binds to any `IEngine` instance (both the primary `engineInstance` and local `AssetViewportEngine`), providing unified commands and reactive notification across all editors.
   - **Built-in Gizmo Event Interception**: `AssetViewport3D` evaluates `gizmoSystem.update(..., isDown, isUp)` directly in its mouse lifecycle. When the mouse hovers or drags a gizmo axis, the gizmo consumes the interaction without falling through or causing unwanted deselection.
   - **SoA Dirty Flag Preservation**: Proxy setters (`transformProxy.position`, `rotation`, `scale`) explicitly set `store.transformDirty[index] = 1` and `sceneGraph.setDirty(id)`, ensuring matrix calculations and ECS sync loops update without objects becoming locked or frozen.


---

## Viewport Template Layer

`AssetViewport3D` is itself built on the engine-agnostic `ViewportTemplate` (`editor/components/viewport/ViewportTemplate.tsx`). This keeps canvas/chrome composition consistent with the main `SceneView` while preserving separate renderer lifecycles.

Use `ViewportTemplate` directly only for a new viewport host with its own renderer lifecycle. New 3D asset editors must continue to use `AssetViewport3D` and its lifecycle/slot props. Shared orbit, pan, and zoom math is provided by `editor/viewports/viewportCamera.ts`.

See `/docs/VIEWPORT_TEMPLATE.md` for the reusable shell API and design rules.


## Full Asset Editor Composition

Full 3D asset editor windows use `AssetEditorTemplate` above `AssetViewport3D`. Asset-specific toolbar commands are `AssetViewportToolbarAction` descriptors and are filtered against `assetViewportCapabilities.ts`; keyboard and context/pie triggers must check the same capability. See `/docs/ASSET_EDITOR_TEMPLATE.md`.

---

## Asset Editor Lifetime Follows Asset Lifetime

Asset-editor windows are bound to the UUID of the asset they edit through `AssetEditorWindowConfig.assetId`.
`WindowManager` listens for `ASSET_DELETED` and removes every window bound to that UUID instead of leaving the React editor mounted against a missing asset.

This is required for both normal Content Browser deletion and repeatable developer fixtures such as `smTest(...)`: creating a new `TEST_StaticMesh_*` fixture deletes the previous fixture first, so any open editor for the old fixture must close automatically. A deleted asset must never leave a stale window displaying `Mesh asset could not be loaded.`

Utility windows that are not asset editors omit `assetId` and are unaffected by asset deletion.
