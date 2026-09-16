# Code Health & Validation

This document records the repository-level validation rules and the runtime contracts tightened during the September 2026 code-health pass.

## Validation commands

Run these from the project root:

- `npm run audit` — dependency-free source audit. It checks strict TypeScript configuration, the `drafts/` exclusion, local import resolution, Vite import-map safety, and required `AssetViewport3D` reuse. Accessibility convention violations are reported as warnings with file/line locations.
- `npm run typecheck` — strict TypeScript validation with `tsc --noEmit`.
- `npm run build` — production Vite build.
- `npm run check` — runs the audit, typecheck, and production build in sequence.

`drafts/` contains experimental code and is intentionally excluded from project typechecking.

## Shared type contracts

### Graph connections

The canonical graph connection representation is:

- `fromNode`
- `fromPin`
- `toNode`
- `toPin`

Legacy `source` / `target` fields are optional compatibility fields only. New code must use the canonical four-field representation.

### Animation tracks

Imported/runtime animation tracks always expose `name`, `type`, `times`, and `values`. Optional editor metadata such as `target`, `path`, and `keyframes` must not be used as a substitute for the runtime typed-array data.

`AnimationEvaluator` is the single source of truth for sampling a track between keyframes. Systems must delegate sampling to it rather than duplicating interval-selection or interpolation logic. This prevents disagreement at exact keys, after the last key, and for one-keyframe tracks.

### Timeline state

`playbackSpeed` and `isLooping` are required timeline state fields. Runtime code may consume them directly rather than repeatedly defaulting missing values.

## Asset/runtime safety contracts

- `AssetManager.getMeshUUID(intId)` is the supported reverse lookup from runtime integer mesh IDs to asset UUIDs.
- Asset-created events must report the actual asset type that was created. Skeletal mesh creation emits `SKELETAL_MESH`, not `SKELETON`.
- Asset viewport drag paths must guard failed mesh UUID lookups before starting, updating, or ending vertex edits.
- `AssetViewportEngine` implements the `IEngine.isPlaying` contract so it can be consumed by shared viewport/gizmo systems without unsafe casting.
- Gizmo rendering captures validated program/VAO/offset references before entering draw closures so nullability cannot reappear across callback boundaries.

## Accessibility release gate

The project convention requires every interactive `button`, `input`, `select`, and range control to provide both `title` and `aria-label` attributes. `npm run audit` reports violations so they remain visible even before a dedicated UI linter is installed. These warnings should be resolved before release.

## Dependency installation note

The audit intentionally has no npm-package dependency. This means architecture and source-layout checks can still run in restricted/offline environments. Typechecking and the Vite production build still require a complete `npm ci` / dependency installation.

## Viewport template refactor

The main viewport shell is now centralized in `editor/components/viewport/ViewportTemplate.tsx`. Both `SceneView` and `AssetViewport3D` compose through this template rather than maintaining separate canvas wrappers, absolute toolbar positions, and HUD containers.

Camera navigation math was also extracted to `editor/viewports/viewportCamera.ts`. The shared helpers preserve host-specific camera limits while removing duplicate orbit/pan/zoom vector calculations.

The repository audit now verifies that `ViewportTemplate` and `viewportCamera` exist and that both primary viewport hosts reuse them.

## Runtime selection and local Tailwind build

`SelectionSystem` exposes entity selection through `selectedIndices`, `selectedEntities`, and `isSelected(id)`. UI code must not read the stale/nonexistent `selectedEntityIds` property. The repository audit rejects that identifier so this class of runtime-only crash is caught even when dependencies are unavailable.

Tailwind is compiled locally through `tailwind.config.cjs` and `postcss.config.cjs`; `index.css` owns the Tailwind directives. Do not reintroduce `https://cdn.tailwindcss.com` in `index.html`. The CDN runtime is development-oriented and produces a production warning; the audit now rejects it.

## Bone visual data and TypeScript 6 path mapping

`BoneData.visual.color` uses the project `Vector3` contract (`{ x, y, z }`). Joint creation code in both skeleton editor surfaces types new bone literals as `BoneData`, which catches shape drift immediately instead of failing later at `bones.push(...)`.

`tsconfig.json` intentionally does not set `baseUrl`. TypeScript 6 deprecates that option, and this repository does not need it: `paths` maps `@/*` explicitly to `./*`, while Vite provides the matching runtime alias. The dependency-free audit rejects `baseUrl` if it is reintroduced.

## Strict editor API contracts

The September 2026 strict-typecheck cleanup also codifies several editor/runtime boundaries that had drifted:

- `SoAEntitySystem` does not expose `setName`. Joint editor renames resolve the entity index and update the ECS name storage through the supported store/proxy contract.
- `SceneGraph` does not expose `detach`. Reparenting uses `sceneGraph.attach(childId, parentId)` and passes `null` to make an entity a root.
- `EngineModule.name` and `EngineModule.icon` are optional metadata. Inspector cards must provide stable fallbacks (`module.id` and a valid default icon) rather than assuming both values exist.
- `UIConfiguration.vertexSize` is optional in the persisted configuration contract. UI controls must use the editor default (`1.0`) when it is absent.
- `AssetViewportEngine.entityId` is nullable until its preview entity exists. Render and picking paths must guard it before calling scene-graph or selection APIs.
- The current `TransformSpace` runtime contract supports only `World` and `Local`. Tool option UIs must not advertise placeholder spaces such as Gimbal, Parent, VirtualPivot, Normal, or Average until the engine implements them.
- Lucide icon names stay strongly typed. Use valid exported names such as `Wrench`; do not weaken `Icon` typing to accept invented names such as `Tool`.
- `AssetManager.getAsset()` returns the generic `Asset` interface. Mesh-only editor restore/reconciliation paths must narrow to a typed `StaticMeshAsset` local after validating `asset.type === 'MESH'` before passing the value to topology helpers or iterating typed Construction data.

`npm run audit` rejects the stale `ecs.setName`, `sceneGraph.detach`, invalid `Tool` icon, and unsupported transform-space options so these mismatches are caught before the dependency-backed typecheck.

## Skeleton viewport update-loop prevention

Skeleton gizmo dragging must not broadcast `ASSET_UPDATED` for every pointer-move sample. Live transforms are written into the asset viewport's working skeleton and reflected through `transformRevision`; the global asset event is committed once on mouse-up. This prevents the main engine from repeatedly resynchronizing skeleton entities and notifying every React subscriber during one drag.

`DraggableNumber` also derives its unfocused display directly from its numeric prop. Local text state is initialized only when editing starts, rather than synchronized from props through a passive effect. This avoids passive-effect `setState` churn while transforms stream through inspectors.

## Skeleton edit transaction guard

Skeleton editing is now an explicit draft/confirm transaction. `SkeletonEditor` keeps unconfirmed `BoneData[]` changes private, filters the viewport to Select-only outside edit mode, and persists only from the Confirm action. See `docs/SKELETON_EDIT_MODE.md`. The dependency-free project audit checks for the draft/Confirm/Cancel contract and the transform-tool lock.
