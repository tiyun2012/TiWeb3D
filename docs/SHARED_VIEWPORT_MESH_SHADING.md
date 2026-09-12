# Shared Viewport Mesh Shading

This document defines the mesh-surface rendering contract shared by the main Scene viewport and 3D asset viewports.

The goal is **rendering parity without coupling asset editors to the main scene engine**. Scene View and asset editors may use different cameras, transforms, and light inputs, but they must not implement different BRDFs, gamma rules, render-mode numbering, or WebGL context assumptions.

---

## 1. Why this exists

Historically the two viewport families used different surface pipelines:

```text
Scene View
  material graph / Standard PBR
  actual scene light
  off-screen linear render target
  post-process composite
  gamma/display transfer

Static Mesh / Skeleton asset viewport
  fixed gray Lambert + hemi light
  hard-coded preview light
  direct canvas output
  no shared display transfer
```

That meant a mesh could look substantially different in the editor even when Scene post-processing was disabled. The difference was not primarily post-processing: the surface shader, environment response, render modes, output transfer, clear color, and canvas antialias settings were different.

The shared contract removes those duplicated rules.

---

## 2. Canonical implementation

The source of truth is:

```text
engine/renderers/MeshSurfaceContract.ts
```

It owns:

- `MESH_SURFACE_RENDER_MODE`
  - `LIT = 0`
  - `NORMALS = 1`
  - `UNLIT = 2`
- `STANDARD_SURFACE_GLSL`
  - GGX distribution
  - geometry term
  - Fresnel
  - the shared fake IBL/environment term
  - `shadeStandardSurface(...)`
- `DISPLAY_TRANSFER_GLSL`
  - shared linear-light -> display transfer
- `DEFAULT_MESH_SURFACE_MATERIAL`
  - albedo `0.8, 0.8, 0.8`
  - metallic `0`
  - smoothness `0.5`
- `DEFAULT_MESH_PREVIEW_LIGHT`
- shared Scene/asset WebGL context attributes
- linear Scene background and display-space direct-preview background
- `ASSET_MESH_SURFACE_VS` / `ASSET_MESH_SURFACE_FS`
- `applyMeshSurfaceUniforms(...)`

Do not create a second copy of the PBR equations in a viewport component.

---

## 3. Scene render flow

```text
Mesh / Material Graph
        |
        v
ShaderCompiler
        |
        | uses STANDARD_SURFACE_GLSL
        v
MeshRenderSystem
        |
        | LINEAR color
        v
Scene FBO
        |
        v
WebGLRenderer composite
        |
        | optional PP/effects
        | DISPLAY_TRANSFER_GLSL
        v
Canvas / display
```

Generated project `StandardMaterial` graphs use the shared `shadeStandardSurface(...)` PBR helper. The unassigned Scene/asset fallback intentionally uses the shared `shadeLambertSurface(...)` helper so modeling viewports retain a neutral Lambert default.

### Post-process disabled

`Post Process = Off` now means:

```text
shared mesh surface
    -> no per-object PP effects
    -> no vignette
    -> no chromatic aberration
    -> no tone map
    -> display transfer only
```

The display transfer remains required because Scene meshes are rendered into a linear off-screen target before compositing.

Per-object effects are part of the post-process stage and therefore follow the same global enable toggle. This is important when comparing Scene output against an asset preview.

---

## 4. Asset viewport render flow

Asset viewports still inherit from `AssetViewport3D` and own their domain-specific mesh buffers. The default path is shared Standard Lambert; assigning a project Material compiles the same material graph in the asset viewport's own WebGL context.

```text
Mesh asset geometry
        |
        +-- materialId empty --> shared Standard Lambert
        |
        +-- materialId set ----> MaterialPreviewRenderer
                                  -> ShaderCompiler graph
                                  -> direct display transfer
        |
        v
Canvas / display
```

The asset shader intentionally performs display transfer itself because it renders directly to the default framebuffer.

### Important color-space distinction

The Scene FBO clear color is **linear**:

```text
VIEWPORT_BACKGROUND_LINEAR_COLOR
```

The asset canvas clear color is the display-transferred equivalent:

```text
VIEWPORT_BACKGROUND_DISPLAY_COLOR
```

Using the same numeric `0.1` clear value in both paths is *not* visually equivalent because the Scene value passes through gamma conversion while a direct canvas clear does not.

Asset viewport line/point rendering uses the same display transfer for the same reason. This keeps topology cages, vertex points, skeleton lines, and grid colors closer to their Scene equivalents.

---

## 5. Shared surface versus shared environment

The shader is shared. The environment can still intentionally differ.

### Shared

- BRDF / Standard surface math
- fake IBL response
- render mode IDs
- default Standard material values
- linear/display color contract
- WebGL context antialias policy
- default fallback light values
- background color contract

### Host-specific

- camera
- model/world transform
- actual Scene light when one exists
- entity color/tint
- assigned Scene material
- texture/material graph data
- skinning / animation pose
- optional Scene post-process

A mesh asset may own an optional `materialId`. Scene entities with an empty material override inherit that asset material. If both are empty, the shared Standard Lambert fallback is used. The mesh asset inspector and Scene inspector reuse `MaterialSlotField`; asset graph preview is compiled through `MaterialPreviewRenderer`. See `MATERIAL_ASSIGNMENT_FLOW.md`.

---

## 6. Render mode contract

Scene and asset viewports must agree on the first three mesh surface modes:

| ID | Mode | Meaning |
|---:|---|---|
| 0 | Lit | Standard Lambert fallback, or assigned Material graph lighting |
| 1 | Normals | Encoded normal visualization |
| 2 | Unlit | Base albedo without lighting |

The IDs come from `MESH_SURFACE_RENDER_MODE`.

`engine/constants.ts -> VIEW_MODES` references those constants. Asset editors filter the Scene list to the modes supported by the preview surface.

Never reintroduce an asset-only mapping such as `1 = Flat, 2 = Normals`.

---

## 7. WebGL context parity

Scene rendering uses non-multisampled off-screen FBOs. If asset canvases alone request MSAA, silhouettes appear smoother in the editor even when the surface shader is identical.

Both viewport families therefore reuse:

```text
VIEWPORT_WEBGL_CONTEXT_ATTRIBUTES
```

Current contract:

```text
alpha: false
antialias: false
powerPreference: high-performance
```

If multisampling is added later, implement it in the shared Scene render-target pipeline and asset path together rather than enabling it in only one canvas.

---

## 8. Key files and responsibilities

```text
engine/renderers/MeshSurfaceContract.ts
    BRDF, display transfer, render modes, preview defaults, asset shader

engine/ShaderCompiler.ts
    generated material shaders reuse STANDARD_SURFACE_GLSL

engine/systems/MeshRenderSystem.ts
    Scene fallback mesh shader reuses STANDARD_SURFACE_GLSL

engine/renderers/WebGLRenderer.ts
    Scene linear targets + shared display transfer + PP toggle semantics

editor/components/AssetViewport3D.tsx
    shared context/background contract and direct line display transfer

editor/components/StaticMeshEditor.tsx
    shared Standard preview surface + shared render-mode IDs

editor/components/SkeletonEditor.tsx
    associated mesh preview uses same surface shader contract
```

---

## 9. Debugging visual differences

### Mesh brighter/darker in one viewport

Check, in this order:

1. Is the Scene object using the Standard/default material or a custom material?
2. Is entity tint/color white in Scene?
3. Is the Scene directional light different from the preview light?
4. Is post-processing actually disabled?
5. Is the object using an effect index?
6. Is one path missing/duplicating display transfer?
7. Is the Scene object skinned/animated while the asset preview shows source geometry?

Do **not** immediately tune asset-editor constants.

### Normals mode looks different

Verify both hosts use `MESH_SURFACE_RENDER_MODE.NORMALS` and that neither has a local numeric mode mapping.

### Background differs even though both use `0.1`

That is a color-space bug. Scene FBO colors are linear; direct canvas clear values are already display values. Use the two background constants from `MeshSurfaceContract.ts`.

### Post Process Off still changes an object

Check `WebGLRenderer` composite logic. Per-object `processCustomEffects(...)` must remain inside the `u_enabled > 0.5` branch.

### Asset editor looks smoother around silhouettes

Check that both contexts use `VIEWPORT_WEBGL_CONTEXT_ATTRIBUTES`. Do not enable canvas antialiasing only in asset viewports.

---

## 10. Extension rules

When adding a new 3D asset preview:

1. Inherit from `AssetViewport3D`.
2. Use `ASSET_MESH_SURFACE_VS/FS` for a Standard mesh surface instead of defining another Lit shader.
3. Bind material/light/camera through `applyMeshSurfaceUniforms(...)`.
4. Use `MESH_SURFACE_RENDER_MODE` IDs.
5. If rendering directly to the canvas, perform the shared display transfer exactly once.
6. If rendering into a linear FBO that later composites, do **not** gamma-convert the surface shader.
7. Reuse `VIEWPORT_WEBGL_CONTEXT_ATTRIBUTES`.
8. Keep environment choices (preview light/material input) explicit and separate from surface math.

---

## 11. Regression checklist

- [ ] Scene Standard material and Static Mesh Editor use `shadeStandardSurface(...)` from the same source.
- [ ] Scene fallback mesh shader uses the same Standard surface helper.
- [ ] Scene Lit / Normals / Unlit are IDs 0 / 1 / 2.
- [ ] Asset Lit / Normals / Unlit are IDs 0 / 1 / 2.
- [ ] Asset mesh preview uses default Standard values `0.8 / 0 / 0.5` unless explicitly overridden.
- [ ] Scene composite applies display transfer once.
- [ ] Direct asset mesh shader applies display transfer once.
- [ ] Direct asset line/point shader applies display transfer once.
- [ ] Scene linear FBO clear and asset direct clear appear visually equivalent.
- [ ] Post Process Off bypasses object effects, vignette, aberration, and tone mapping.
- [ ] Scene and asset canvases do not silently use different MSAA policies.
- [ ] Custom Scene material/light differences are treated as environment/input differences, not fixed by duplicating shader code.
