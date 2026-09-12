# Camera, Post Process, and Inspector Registry

## Purpose

TiWeb3D now treats inspector UI as registered metadata instead of requiring every component or asset to hand-write a React inspector. Camera is the reference implementation; Light has also been migrated to prove the same mechanism works for other component types.

## Ownership model

```text
Scene Entity
├── Transform
└── Camera Component
    ├── optional Camera Preset source
    ├── projection / FOV / clipping
    ├── clear / render layers
    └── optional Post Process Profile override

Scene Asset
└── default Post Process Profile

Post Process Profile Asset
└── ordered effects
    ├── PRE_GLOBAL
    ├── GLOBAL
    ├── POST_GLOBAL
    └── OVERLAY
```

A mesh does not own a full post-process profile. Mesh/material state describes surface appearance; object masks can later be consumed by masked post-process effects.

## Post-process resolution

The API in `engine/postprocess/PostProcessProfile.ts` resolves profiles in this order:

```text
Viewport override
    ↓
Camera profile
    ↓
Scene profile
    ↓
None
```

`camera.postProcessEnabled = false` explicitly disables post-process inheritance for that camera.

`Engine.getResolvedPostProcessProfile(cameraEntityId?, viewportProfileId?)` exposes the resolved profile to future render-pipeline stages.

## Inspector registry

Core pieces:

- `editor/inspector/InspectorSchema.ts` — schema contracts.
- `editor/inspector/InspectorRegistry.ts` — schema registration/lookup.
- `editor/components/inspector/AutoInspector.tsx` — renders common field types.
- `engine/modules/CoreInspectorSchemas.ts` — built-in Camera, Scene Rendering, and Light registrations.

Supported automatic fields currently include number, string, boolean, enum, color, vector3, asset reference, and read-only values. Fields can define visibility, enabled state, min/max/step, validation/normalization, asset-type filtering, and animatable metadata (`animatable`, `animationMode`) for future timeline/keyframe discovery.

## Camera schema reuse

`CameraSettings` is registered once. A `CAMERA_PRESET` asset uses that schema directly. The Scene Camera component uses `CameraComponent`, which composes the same settings with a Camera Preset field.

```text
CameraSettings schema
├── Camera Preset Inspector
└── CameraComponent schema
    ├── Camera Preset slot
    └── same CameraSettings sections
```

A Scene Camera now separates `Source = Local | Preset` from `Control Mode = Manual | Runtime | Cinematic`. When Source is Preset, the preset remains a live reusable base and Camera setting fields are read-only in the Scene Inspector; edit the preset asset itself. Switching from Preset to Local copies the current preset values once so detaching does not visually jump. See `CAMERA_RESOLUTION_FLOW.md`.

## Post Process Profile inspector

`PostProcessProfileInspector` is intentionally custom because an ordered effect stack is more complex than scalar fields. It supports:

- profile enabled state;
- add/remove effects;
- effect enabled state;
- effect type;
- stage;
- numeric order;
- target mask for Outline/Glow.

Within a stage, lower `order` values execute first. Cross-stage ordering is fixed by `PRE_GLOBAL → GLOBAL → POST_GLOBAL → OVERLAY`.

## Adding a new auto-inspected component

1. Add/confirm its runtime data contract.
2. Register an `InspectorSchema` in a module-owned registration file.
3. Use `AutoInspector` from the component's `EngineModule.InspectorComponent`.
4. Keep complex editors as custom inspectors rather than forcing every workflow into field metadata.
5. Route writes through existing undo/commit callbacks rather than mutating unrelated systems from the schema.

Example:

```ts
inspectorRegistry.register({
  id: 'Example',
  title: 'Example',
  sections: [{
    id: 'main',
    label: 'Main',
    fields: [
      { path: 'enabled', type: 'boolean', label: 'Enabled' },
      { path: 'strength', type: 'number', label: 'Strength', min: 0, step: 0.1 },
    ],
  }],
});
```

Then render it with `AutoInspector schemaId="Example"`.

## Current boundary

This change establishes the data model, assets, inspectors, resolution API, Scene placement, serialization fields, and reusable registration path. It does **not yet replace** `WebGLRenderer.ppConfig` with a full multi-pass profile executor. The renderer should consume `getResolvedPostProcessProfile()` when the staged post-process executor is implemented, rather than inventing another Camera/Scene configuration path.
