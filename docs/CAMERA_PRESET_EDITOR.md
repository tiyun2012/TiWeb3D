# Camera Preset Editor

## Purpose

A Camera Preset is reusable camera configuration, not a live Scene transform. Double-clicking a `CAMERA_PRESET` asset opens a dedicated two-panel editor:

```text
+--------------------------------------+----------------------+
|              Viewport                |      Inspector       |
|                                      |                      |
| Through / Inspect camera preview     | CameraSettings       |
| reusable viewport controls           | AutoInspector        |
|                                      |                      |
+--------------------------------------+----------------------+
```

There is intentionally no hierarchy panel.

## Reused systems

- Outer layout: `AssetEditorTemplate`
- Viewport: `AssetViewport3D`
- Inspector schema: `CameraSettings` through `AutoInspector`
- Asset mutations: `assetManager.updateAsset`
- Double-click routing: `AssetEditorRegistry`

Do not create a Camera-Preset-specific copy of camera setting controls.

## Preview modes

Preview mode is editor state only and is not serialized into the Camera Preset.

### Through Camera

This is the default mode. It binds the Camera Preset's lens/configuration to the same navigable viewport-camera behavior used by the other 3D editors:

- `Alt+LMB` orbit;
- `Alt+MMB` pan;
- `Alt+RMB` drag zoom;
- mouse wheel zoom;
- `F` resets the preview pose.

The lens still comes from the Camera Preset:

- Perspective/Orthographic projection;
- FOV or Orthographic Size;
- near/far clipping.

The preview pose is editor-only. A Camera Preset deliberately has no Scene transform, so orbit/pan/zoom never serialize position or rotation into the preset asset. Switching to Inspect mode and back preserves the Through Camera preview pose for the current editor session.

Orthographic camera navigation uses a transient viewport scale multiplier because dollying an orthographic camera does not change apparent size. `orthoScale = 1` means the authored `orthoSize` is shown exactly; zooming changes only the editor preview scale.

Through mode never draws Camera/frustum/lens-reference geometry back into its own image. Grid and navigation remain viewport-profile features.

### Inspect Camera

This mode uses its own regular orbit/pan/zoom editor-camera pose and renders the preset frustum externally through `CameraPreviewGeometry`. Through and Inspect keep separate transient poses, so mode switching does not destroy navigation state.

Use Inspect Camera to understand frustum shape and clipping configuration spatially.

## Relationship to Scene Camera

A Scene Camera may use the preset as a live base configuration:

```text
Camera Component
  Source = Preset
  Preset = Cinematic35mm
```

Editing `Cinematic35mm` updates the resolved settings of cameras that reference it. The preset is not copied into the Camera component on assignment.

Scene transforms remain on the entity Transform component.

See `CAMERA_RESOLUTION_FLOW.md` for Local/Preset and Manual/Runtime/Cinematic layering.


## Viewport camera rule

A viewport camera is conceptually two independent inputs:

```text
Viewport camera
  pose  -> eye / target / navigation state
  lens  -> perspective/orthographic + FOV/ortho size + near/far
```

`AssetViewport3D` owns/reuses the navigation behavior. A host supplies the lens with `projectionSettings` and may control the pose with `camera` / `onCameraChange`. Do not implement a separate camera-navigation path for Camera Presets or future camera-bound viewports.

For a Camera Preset editor, the lens is persistent asset data while the pose is transient editor state. Scene `View Through Camera` uses that same controller but binds pose changes to the Camera entity's Transform while the lens comes from `Engine.getResolvedCamera(...)`. See `CAMERA_VIEWPORT_BINDING.md`.


## Viewport Profile

Camera Presets may bind an editor-only `VIEWPORT_PROFILE` through `asset.editor.viewportProfileId`. The profile owns navigation and overlays; it never becomes runtime Camera data. See [`VIEWPORT_PROFILE_AND_CAMERA_BINDING.md`](./VIEWPORT_PROFILE_AND_CAMERA_BINDING.md).
