# Camera Preset Editor

## Purpose

A Camera Preset is reusable camera configuration, not a live Scene transform. Double-clicking a `CAMERA_PRESET` asset opens a dedicated two-panel editor:

```text
+--------------------------------------+----------------------+
|              Viewport                |      Inspector       |
|                                      |                      |
| canonical camera/frustum preview     | CameraSettings       |
| orbit / pan / zoom / grid / focus    | AutoInspector        |
|                                      |                      |
+--------------------------------------+----------------------+
```

There is intentionally no hierarchy panel.

## Reused systems

The editor does not build a new viewport implementation.

- Outer layout: `AssetEditorTemplate`
- Viewport: `AssetViewport3D`
- Inspector schema: `CameraSettings` through `AutoInspector`
- Asset mutations: `assetManager.updateAsset`
- Double-click routing: `AssetEditorRegistry`

This keeps Camera editing consistent with the rest of the editor while avoiding duplicated camera controls.

## Viewport preview

`engine/camera/CameraPreviewGeometry.ts` generates a canonical camera/frustum facing local `-Z`.

A Camera Preset has no position or rotation, so the preview origin is illustrative only. It visualizes:

- Perspective versus Orthographic projection.
- Perspective FOV.
- Orthographic size.
- The camera's forward direction and frustum shape.

Near/far values remain authoritative in the Inspector and HUD. Frustum depth is normalized in the editor preview so a common runtime far plane such as `1000` does not make the preview impossible to frame.

The preview currently uses a representative 16:9 aspect ratio because Camera Preset does not yet store an authored aspect ratio/output target.

## Inspector contract

The editor renders:

```tsx
<AutoInspector
  schemaId="CameraSettings"
  value={asset.data}
  scope="asset"
  onChange={...}
/>
```

This is the same schema used by Scene Camera components. Do not create a separate Camera Preset field list.

## Asset update flow

```text
Inspector field change
      |
      v
assetManager.updateAsset(cameraPresetId, { data })
      |
      v
ASSET_UPDATED
      |
      +--> CameraPresetEditor rerenders
      +--> Content Browser/other subscribers refresh
```

## Future camera preview modes

If a future Camera Preset viewport adds a "Look Through Camera" mode, it should remain inside `CameraPresetEditor`/`AssetViewport3D` and consume the same `CameraSettings` data. Do not create a second camera-settings model for preview rendering.
