# Camera Viewport Binding

> See also [`VIEWPORT_PROFILE_AND_CAMERA_BINDING.md`](./VIEWPORT_PROFILE_AND_CAMERA_BINDING.md) for the reusable Viewport Profile asset and source-helper rules.

## Goal

A viewport should not invent a second camera-control model just because it is looking through a Camera entity or Camera Preset. The shared viewport camera controller owns orbit/pan/zoom behavior; the host decides where the camera **pose** and **lens** come from.

```text
Viewport camera
  pose  -> eye / target / up / navigation state
  lens  -> perspective/orthographic + FOV/ortho size + near/far
```

## Shared navigation

`editor/viewports/viewportCamera.ts` is the canonical navigation math for:

- orbit;
- pan;
- perspective dolly/zoom;
- orthographic screen-scale zoom;
- camera eye calculation.

Do not create Camera-specific mouse math in `CameraPresetEditor` or `SceneView`.

## Camera Preset editor

A `CAMERA_PRESET` owns lens/render settings but no Scene Transform.

### Through Camera

- lens: `CameraPresetAsset.data`;
- pose: transient editor `CameraState`;
- controls: the normal shared orbit/pan/zoom controller;
- persistence: lens changes save to the asset, preview pose never does.

### Inspect Camera

- lens: normal editor perspective lens;
- pose: a separate transient editor `CameraState`;
- content: the Camera Preset frustum is rendered as geometry only in Inspect mode; Through mode never draws the source Camera helper.

Through and Inspect preserve independent editor poses while the editor stays open.

## Scene View Through Camera

A live Scene Camera is different because it owns a Transform through ECS composition:

```text
Scene Camera entity
  Transform       -> pose
  CameraComponent -> source/control configuration
       |
       v
  CameraResolver  -> resolved lens
```

`SceneView` exposes **View Through Selected Camera** when the selected entity has the Camera component.

While bound:

- projection/FOV/ortho size/near/far come from `Engine.getResolvedCamera(cameraId)`;
- eye/orientation come from the Camera entity Transform;
- Alt+LMB orbit, Alt+MMB pan, Alt+RMB zoom, wheel zoom, and Focus use the same shared viewport controller;
- pose changes are written back to the Camera entity Transform through `SceneCameraViewportBinding`;
- leaving View Through restores the previous editor camera.

`SceneCameraViewportBinding` converts between SceneGraph world Transform and the orbit-style `CameraState`, including parent-space conversion when writing a parented camera.

## Roll / up axis

`CameraState.up` is optional. Normal editor cameras default to world +Y. A bound Scene Camera reads its world +Y axis into `CameraState.up`, so an authored camera roll is preserved when first entering View Through and while panning. Orbit remains the familiar editor orbit behavior.

## Orthographic zoom

Moving an orthographic camera closer/farther does not change apparent size. Therefore shared viewport navigation uses:

```ts
CameraState.orthoScale
```

for editor navigation. `1` means the authored `orthoSize` is shown exactly.

- Camera Preset editor: `orthoScale` is preview-only and never serialized.
- Scene View Through Camera: Transform orbit/pan still writes to the Camera entity; orthographic zoom remains a viewport navigation scale and does not overwrite preset/local `orthoSize`.

If a future tool wants to **author** ortho size from a zoom gesture, it should explicitly write a Camera setting/override through the Camera API rather than overloading viewport navigation state.

## Source-of-truth rules

1. Reuse `viewportCamera.ts` for all normal viewport navigation.
2. Camera Preset never receives a Transform from preview navigation.
3. Scene Camera pose belongs to Transform; lens belongs to resolved Camera settings.
4. Do not copy resolved preset settings into Camera components just to drive a viewport.
5. Leaving a bound Scene Camera restores the independent editor camera.
6. Do not serialize `CameraState.target`, `radius`, or `orthoScale` into Camera Preset assets.


## Viewport overlays

Grid and editor overlays are viewport-profile features, not Camera features. Switching to Through Camera must not automatically disable them. The active/bound Camera helper itself is always suppressed from its own view.


## Navigation stability and Transform ownership

Scene Camera binding must follow the interaction ownership and roll-transport rules in [`SCENE_CAMERA_NAVIGATION_STABILITY.md`](./SCENE_CAMERA_NAVIGATION_STABILITY.md). In particular, never perform a whole-scene SceneGraph update on every camera mouse-move and never round-trip Transform notifications back into CameraState while the viewport is actively driving the same Camera. Camera Preset editors expose an editor-only **Transform [Preview]** component so their spatial behavior is visible without incorrectly serializing a Scene Transform into the reusable preset.
