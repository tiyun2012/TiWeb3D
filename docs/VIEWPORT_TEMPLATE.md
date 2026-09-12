# Reusable Viewport Template

## Why this exists

Ti3D has multiple viewport hosts with different rendering lifecycles. The main `SceneView` is backed by the primary engine renderer, while asset editors use `AssetViewport3D` and their own WebGL lifecycle. Those hosts should not duplicate the DOM shell, toolbar placement, HUD styling, or orbit-camera math.

The reusable viewport architecture is therefore split into three layers:

1. **`ViewportTemplate`** (`editor/components/viewport/ViewportTemplate.tsx`) — engine-agnostic canvas and overlay layout.
2. **`viewportCamera`** (`editor/viewports/viewportCamera.ts`) — pure shared orbit/pan/zoom camera math.
3. **Viewport hosts** — `SceneView` and `AssetViewport3D`, which keep ownership of renderer lifecycle, picking, gizmos, and domain-specific interactions.

This separation lets a viewport reuse the common visual/input primitives without forcing unrelated rendering engines into one component.

## `ViewportTemplate` slots

`ViewportTemplate` renders the canvas and exposes stable composition slots:

- `toolbarLeft` — primary viewport controls.
- `toolbarRight` — stats and secondary controls.
- `hudBottomLeft` / `hudBottomRight` — passive status/readout areas.
- `viewportChildren` — canvas-local visuals such as selection rectangles.
- `overlayChildren` — menus, tooltips, brush readouts, or portals.
- `containerProps` — host-specific pointer, wheel, context-menu, drag/drop events.
- `canvasProps` — host-specific canvas attributes.

The template deliberately does **not** initialize WebGL, run a render loop, own selection state, or know about the engine singleton.

## Shared chrome primitives

Use these helpers instead of rebuilding the same Tailwind class groups:

- `ViewportToolbarGroup` — translucent bordered toolbar group.
- `ViewportIconButton` — accessible viewport button with a required `label`, automatically mapped to both `title` and `aria-label`.
- `ViewportHud` — standardized compact viewport status panel.

## Shared camera math

`editor/viewports/viewportCamera.ts` owns reusable camera operations:

- `getCameraEye`
- `orbitCamera`
- `panCamera`
- `dragZoomCamera`
- `wheelZoomCamera`
- `cloneCamera`

Viewport hosts can configure sensitivity and minimum radius without duplicating vector math. `SceneView` retains its scene-oriented limits, while `AssetViewport3D` retains its closer asset-preview limits.

## Current adoption

- `SceneView` uses `ViewportTemplate` for its canvas shell, grid/view-mode toolbar placement, selection rectangle, HUD, and overlays.
- `AssetViewport3D` uses `ViewportTemplate` for the reusable asset viewport shell, transform toolbar, stats, auto-rotate control, HUD, and editor-specific overlay slots.
- `StaticMeshEditor` and `SkeletonEditor` continue to inherit from `AssetViewport3D`, so they receive the template automatically.

## Adding a new viewport

For a new renderer-backed viewport:

```tsx
<ViewportTemplate
  containerRef={containerRef}
  canvasRef={canvasRef}
  containerProps={{ onMouseDown, onWheel }}
  toolbarLeft={<MyViewportTools />}
  hudBottomRight={<ViewportHud>Ready</ViewportHud>}
  overlayChildren={<MyOverlay />}
/>
```

For a new **3D asset editor**, do not use the template directly. Inherit from `AssetViewport3D` and inject only asset-specific rendering and controls through its existing lifecycle/slot props.

## Rules

- Do not put renderer initialization or `requestAnimationFrame` loops into `ViewportTemplate`.
- Do not copy toolbar/HUD shell classes into new viewport hosts when one of the shared chrome primitives fits.
- Do not duplicate orbit/pan/zoom vector math; use `viewportCamera` utilities.
- Keep domain interactions such as scene picking, component selection, skeleton hit testing, and asset mutation in the owning viewport/editor.
- All new 3D asset editors still inherit from `AssetViewport3D`.

## Full asset editor frame

`ViewportTemplate` is only the low-level canvas/chrome shell. Full asset editors now add one higher composition layer: `editor/components/asset-editor/AssetEditorTemplate.tsx`.

The full stack is:

`AssetEditorTemplate` (Hierarchy / Viewport / Inspector) -> `AssetViewport3D` (renderer host and filtered asset toolbar) -> `ViewportTemplate` (canvas/chrome placement).

See `/docs/ASSET_EDITOR_TEMPLATE.md` for asset-type capability filtering and skeletal-mesh workspace routing.
