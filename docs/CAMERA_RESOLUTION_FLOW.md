# Camera Resolution Flow

## Why this exists

A Camera Preset, a Scene Camera, a runtime gameplay camera, and a cinematic camera are related but they are not the same owner of data.

The renderer should consume one resolved camera state. It should not care whether a value came from a reusable preset, a locally-authored Scene Camera, gameplay code, or the timeline.

## Ownership model

```text
CameraPreset asset
      |
      | base configuration when Source = Preset
      v
Scene Camera component
      |
      | Source: Local | Preset
      | Control: Manual | Runtime | Cinematic
      v
CameraResolver
      |
      +-- Runtime override layer   (gameplay/script)
      +-- Cinematic override layer (timeline/sequencer)
      v
ResolvedCameraState
      |
      +--> renderer
      +--> post-process profile resolution
```

The Camera Preset never owns a Scene transform. Position and rotation remain on the Scene entity Transform component.

## Two independent enums

`CameraConfigSource` answers where the serialized base settings come from:

```ts
'LOCAL' | 'PRESET'
```

`CameraControlMode` answers which transient driver may override that base:

```ts
'MANUAL' | 'RUNTIME' | 'CINEMATIC'
```

Do not merge these into one enum. `Preset + Runtime` and `Preset + Cinematic` are both valid combinations.

## Resolution rules

### Local + Manual

```text
Camera component values
        -> resolved camera
```

### Preset + Manual

```text
CameraPreset.data
        -> resolved camera
```

The component stores only the preset reference and source selection. Editing the Camera Preset updates all cameras that use it without copying values into every Camera component.

If a referenced preset is missing, the resolver falls back to the component's local values and reports `baseSource = LOCAL_FALLBACK`.

### Runtime

Gameplay/script code writes a transient override through:

```ts
engineAPI.commands.camera.setRuntimeOverride(cameraId, {
  fov: 72,
});
```

The override is applied only while the Camera component has:

```text
Control Mode = Runtime
```

The override is not serialized and never mutates the Camera Preset.

### Cinematic

Timeline/sequencer code writes a transient override through:

```ts
engineAPI.commands.camera.setCinematicOverride(cameraId, {
  fov: keyedFov,
});
```

The override is applied only while:

```text
Control Mode = Cinematic
```

This is the intended integration point for future keyframe evaluation.

### Manual

`Manual` ignores both runtime and cinematic transient maps. This makes it safe to return from gameplay/cinematic control without destroying authored values.

## Inspector behavior

The Scene Camera Inspector exposes:

```text
Configuration
  Source        Local | Camera Preset
  Camera Preset <asset slot>       (Preset only)
  Control Mode  Manual | Runtime | Cinematic
```

When `Source = Preset`, base Camera Settings fields are read-only because the preset asset is authoritative. Double-click/open the Camera Preset to edit those values.

When switching from `Preset` to `Local`, the current preset values are copied once into the component so the camera does not visually jump when detaching from the preset.

Selecting a preset does **not** copy its values into the component. It establishes a live reusable base relationship.

## Animatable inspector metadata

Camera fields can declare:

```ts
animatable: true
animationMode: 'continuous' | 'discrete'
```

This metadata belongs to the Inspector schema so a future timeline/keyframe UI can discover animatable fields without hardcoding Camera-specific property lists.

Examples:

- FOV / Ortho Size / Near / Far: continuous.
- Projection / Clear Mode / Post Process enabled: discrete.

The schema metadata does not itself create keyframes; a sequencer should evaluate tracks and call the Cinematic override API.

## Camera Preset editor preview modes

The Camera Preset editor has two editor-only preview modes. Neither is stored in the asset.

### Through Camera

Uses the actual preset lens with the shared viewport navigation controller:

- Perspective FOV.
- Orthographic size.
- Near/far clipping.
- Orbit / pan / drag zoom / wheel zoom / reset.

The navigation pose is transient editor state and is not written into the Camera Preset. Equal-size reference frames at multiple depths make perspective vs orthographic behavior visible. Orthographic zoom uses an editor-only scale multiplier because transform dolly does not change orthographic apparent size.

A Camera Preset has no Scene transform, so this mode previews the **lens/configuration through a temporary viewport camera pose**, not an authored world position.

### Inspect Camera

Uses the normal orbit editor camera and displays the Camera Preset frustum externally.

Use this mode to inspect frustum shape and configuration spatially.

## Post-process resolution

Post-process resolution consumes `ResolvedCameraState.settings`, not the raw Camera component. Therefore a Camera Preset's post-process profile and future cinematic/runtime camera overrides participate in the same camera resolution contract.

Existing precedence remains:

```text
Viewport PP override
      -> resolved Camera profile
      -> Scene profile
      -> none
```

## Asset visibility is independent of editability

`AssetTypeRegistry.contentVisibility` controls whether an asset type appears in Content Browser:

```ts
'PUBLIC' | 'INTERNAL' | 'GENERATED'
```

This is intentionally separate from:

- `creatable` — appears in Create menu.
- `placeable` — can be dragged/instantiated in Scene.
- `AssetEditorRegistry` registration — double-click has an editor.

Do not hide an asset merely because it is read-only, and do not create hidden assets to represent runtime camera state. Runtime/cinematic driver state is transient system state, not project content.

## Extension checklist

When adding a new camera driver:

1. Keep the Camera Preset immutable from the driver.
2. Add a transient override layer or adapter in/around `CameraResolver`.
3. Do not write evaluated animation values back into ECS serialized fields every frame.
4. Renderer and post-process consumers should request the resolved camera.
5. Clear transient driver state when an entity is deleted or a Scene is loaded.


## Scene viewport binding

The Scene viewport can bind to a live Camera entity without creating a second navigation implementation. `SceneCameraViewportBinding` reads/writes the entity Transform while `Engine.getResolvedCamera(...)` supplies the lens. Orbit/pan/zoom therefore behave like the normal editor camera and leaving View Through restores the previous editor camera.

See `CAMERA_VIEWPORT_BINDING.md` for the pose/lens ownership contract and orthographic navigation rule.
