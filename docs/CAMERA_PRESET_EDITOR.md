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

This is the default mode. It uses:

- a canonical fixed preview transform;
- the Camera Preset's real Perspective/Orthographic projection;
- the Camera Preset FOV or Orthographic Size;
- the Camera Preset near/far values.

Because a Camera Preset deliberately has no Scene transform, Through Camera previews the authored **lens/configuration**, not a world-space camera placement.

Reference frames at several depths make FOV and Perspective-vs-Orthographic behavior easy to compare.

### Inspect Camera

This mode uses the regular orbit/pan/zoom editor camera and renders the preset frustum externally through `CameraPreviewGeometry`.

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
