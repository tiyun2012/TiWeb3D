# Viewport Profile and Camera Binding

## Why this exists

A viewport and a Camera are related, but they are not the same object.

A **Camera** owns the image-producing camera state:

- projection type;
- FOV / orthographic size;
- near/far clip;
- clear settings;
- post-process reference;
- for a live Scene Camera, pose comes from the entity `Transform`.

A **Viewport** owns editor behavior around whichever camera source it is currently using:

- orbit / pan / zoom / focus gestures;
- grid visibility;
- helper visibility;
- editor gizmo visibility;
- toolbar / HUD / selection overlays.

The viewport must keep those behaviors when its camera source changes.

```text
Viewport Profile
  navigation + overlays
          |
          v
      Viewport Host
          |
          +----------------------+----------------------+
          |                      |                      |
          v                      v                      v
   Editor Camera          Camera Preset          Scene Camera
   transient pose         preset lens            resolved lens
                                                + Transform pose
```

Do not make Camera inherit from a viewport class and do not make viewport grid/helper state part of runtime `CameraSettings`.

## Viewport Profile asset

`VIEWPORT_PROFILE` is a reusable editor asset. Its data contract is `ViewportProfileSettings`:

```ts
interface ViewportProfileSettings {
  navigation: {
    orbit: boolean;
    pan: boolean;
    zoom: boolean;
    focus: boolean;
  };

  overlays: {
    grid: boolean;
    helpers: boolean;
    gizmos: boolean;
  };
}
```

It deliberately contains **no camera pose and no lens**.

A Camera Preset (or another future 3D asset) may bind a profile through editor-only asset metadata:

```ts
asset.editor?.viewportProfileId
```

Because this lives under `Asset.editor`, runtime render/camera systems must not depend on it.

If no profile is assigned, `DEFAULT_VIEWPORT_PROFILE_SETTINGS` is used.

## Camera Preset editor

The Camera Preset editor has two camera bindings.

### Through Camera

- viewport behavior comes from the resolved Viewport Profile;
- lens comes from `CameraPresetAsset.data`;
- pose is transient editor state;
- orbit/pan/zoom do **not** write Transform data because the preset is not a Scene entity;
- grid remains a viewport overlay and may stay visible;
- the Camera/frustum is **not** drawn back into its own image.

This last rule is important. Older code drew lens reference frames in Through mode, which made the viewport look as if the Camera component were visible inside its own render. Through mode must render only the preview world/overlays, never the source Camera helper.

### Inspect Camera

- a normal editor camera controls the viewport;
- the Camera Preset frustum may be rendered as a helper;
- helper visibility follows the Viewport Profile;
- this is the place to inspect the camera object externally.

```text
Through Camera                 Inspect Camera

source = preset lens           source = editor camera
helper = hidden                helper = preset frustum
navigation = profile           navigation = profile
grid = profile                 grid = profile
```

## Scene View Through Camera

A live Scene Camera is spatial:

```text
Entity
├── Transform          <- pose
└── Camera             <- lens source/control mode
```

When Scene View binds to Camera A:

1. `CameraResolver` supplies the resolved lens.
2. `SceneCameraViewportBinding` reads Camera A's world Transform into `CameraState`.
3. The regular shared viewport navigation math handles orbit/pan/zoom.
4. During a navigation gesture, the viewport keeps the live pose locally; on mouse-up / wheel-idle the final pose is committed once through `writeSceneCameraViewportState(...)`.
5. Camera A's own gizmo/helper is suppressed in that viewport.
6. Leaving Camera View restores the independent editor camera.

Therefore pan/zoom/orbit while looking through a live camera are real camera manipulations, not a second hidden editor camera. The viewport is the temporary interaction owner during the gesture; the Scene Camera Transform becomes the committed result at the gesture boundary.

```text
Alt+MMB Pan
    |
    v
shared panCamera(...)
    |
    v
CameraState (live viewport pose)
    |
    | mouse-up / wheel-idle
    v
writeSceneCameraViewportState(...)
    |
    v
Camera entity Transform
```

Perspective zoom changes the Camera Transform by dollying the camera pose. Orthographic zoom remains transient `orthoScale` because moving an orthographic Camera along forward does not change apparent scale. If a tool wants to author `orthoSize`, it must write that Camera property explicitly.

## Source-helper invariant

A camera must not render its own editor helper into the image produced by that camera.

This is an invariant, not a user preference.

For the current implementation:

- Camera Preset Through mode does not draw frustum/lens guide geometry.
- Scene Camera Through mode suppresses the bound entity in `GizmoSystem`.

Future camera icon/frustum/debug systems must consume the same bound-camera exclusion rather than drawing Camera A while Camera A is the viewport source.

Other cameras may still be shown if viewport helper display is enabled.

## Grid rule

Grid is a **viewport overlay**, not Camera data.

Do not do this:

```text
Through Camera -> hide grid
Inspect Camera -> show grid
```

Instead:

```text
Viewport Profile.overlays.grid
              |
              v
         viewport grid
```

Changing camera source must not silently disable the grid. The grid can still become physically edge-on if the live Camera looks exactly parallel to the ground plane; that is expected projection behavior, not an overlay bug.

## Navigation rule

`AssetViewport3D` accepts a per-gesture navigation policy. Hosts should resolve that from a Viewport Profile rather than create another camera controller.

```text
Viewport Profile.navigation
    orbit / pan / zoom / focus
                 |
                 v
          AssetViewport3D
                 |
                 v
        viewportCamera.ts
```

Scene View uses the same `viewportCamera.ts` math.

## Extending to other assets

Any future 3D asset may opt into the same profile binding by storing:

```ts
asset.editor = {
  ...asset.editor,
  viewportProfileId,
};
```

Then resolve it through `ViewportProfileResolver` and pass the resulting navigation/overlay policy to the existing viewport host.

Examples:

- Material preview;
- Animation preview;
- Reflection Probe editor;
- Particle editor;
- Lighting preview;
- custom plugin asset editor.

Do not copy profile fields into every asset type.

## Ownership summary

| Concern | Owner |
| --- | --- |
| Orbit / pan / zoom / focus availability | Viewport Profile |
| Grid / helper / gizmo visibility | Viewport Profile |
| Viewport DOM/toolbars/HUD | ViewportTemplate / host |
| Shared camera navigation math | `viewportCamera.ts` |
| Camera projection/FOV/clip | Camera / Camera Preset |
| Live camera position/rotation | Transform |
| Runtime/cinematic camera overrides | CameraResolver driver layers |
| Camera helper rendering | editor helper systems, excluding active source |

This separation keeps Camera reusable for runtime/cinematics while keeping editor viewport behavior reusable across all 3D editors.
