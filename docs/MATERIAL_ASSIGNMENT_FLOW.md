# Mesh Material Assignment Flow

This document defines how mesh materials are selected, inherited, previewed, and rendered across the Scene viewport and mesh asset editors.

## 1. Material precedence

Every mesh uses this order:

```text
Scene entity material override
        |
        | empty
        v
Mesh asset materialId
        |
        | empty
        v
Built-in Standard Lambert
```

`StaticMeshAsset.materialId` / `SkeletalMeshAsset.materialId` stores the asset-default Material asset UUID. It is optional. An empty slot is not the project `Standard` PBR material; it means the built-in neutral **Standard Lambert** fallback.

A Scene entity may override the mesh asset default through its Mesh Renderer `materialId`. Clearing the entity slot returns it to asset inheritance.

## 2. Shared inspector control

Material assignment UI must reuse:

```text
editor/components/inspector/MaterialSlotField.tsx
```

It is used by:

- `MeshAssetInspector` for the mesh asset default material.
- Scene `MeshModule` inspector for per-entity material override.
- Other material-slot consumers may reuse it when the value is a Material asset UUID.

Do not rebuild Material `<Select>` lists independently in each inspector. `MaterialSlotField` listens for Material asset creation/update and refreshes its options.

## 3. Built-in Standard Lambert

The no-material fallback is intentionally simple and predictable:

```text
albedo
  + hemisphere ambient
  + Lambert directional diffuse
```

The GLSL source lives in:

```text
engine/renderers/MeshSurfaceContract.ts
  LAMBERT_SURFACE_GLSL
```

The Scene fallback program and the asset preview fallback both consume this shared implementation. This restores the neutral modeling/editor look while keeping custom project materials opt-in.

The project `Standard` Material asset remains a generated Standard/PBR material. Selecting it explicitly switches the mesh from built-in Lambert to the graph material.

## 4. Asset editor material preview

`StaticMeshEditor` renders two paths:

```text
materialId empty
    -> AssetViewport3D shared meshProgram
    -> Standard Lambert

materialId assigned
    -> MaterialPreviewRenderer
    -> compileShader(material graph)
    -> program compiled in the asset viewport WebGL context
    -> direct-to-canvas display transfer
```

WebGL programs cannot be shared between Scene and asset canvases because they belong to different WebGL contexts. Therefore the graph is shared, but each viewport compiles its own program.

The reusable compiler/texture bridge is:

```text
engine/renderers/MaterialPreviewRenderer.ts
```

It provides:

- project Material graph compilation for an asset viewport,
- the graph vertex-offset path,
- UV and vertex-color varyings,
- preview texture-array binding,
- neutral preview light uniforms,
- direct-to-display color conversion,
- one color target for the default framebuffer.

## 5. Scene material resolution

`MeshRenderSystem.prepareBuckets()` resolves the effective material before batching:

```text
entity materialIndex > 0
    -> entity override
else mesh asset has materialId
    -> asset default Material integer ID
else
    -> material ID 0 / Standard Lambert fallback
```

This means changing a mesh asset's material is visible in Scene instances that have not explicitly overridden their material.

## 6. Color-space rule

Generated project materials normally render linear color into the Scene FBO. Scene display conversion happens during composition.

Asset previews draw directly to their canvas, so `compileShader(..., { directToDisplay: true, singleTarget: true })` applies the same display transfer inside the preview fragment shader.

Never add a second ad-hoc gamma conversion in `StaticMeshEditor`.

## 7. Texture rule

Both Scene and asset material preview texture arrays initialize unused layers to white. This guarantees that:

- Standard Lambert remains visible before textures load,
- a missing/unassigned texture does not turn the entire mesh black,
- uploaded Texture assets replace their own array layers when available.

## 8. Developer checklist

When changing mesh material behavior, verify:

1. Mesh asset with empty material slot renders Standard Lambert in the asset editor.
2. Scene instance with no material override and no asset material renders the same Lambert fallback.
3. Assign `Standard` (PBR) in the mesh asset inspector; asset preview switches immediately.
4. A Scene instance with no override inherits that asset material.
5. Assign another material in the Scene inspector; only that entity overrides the asset default.
6. Clear the Scene override; it returns to the asset material.
7. Edit the assigned Material graph; Scene recompiles it and the asset preview recompiles on the next frame.
8. Material textures appear in the asset preview when their Texture assets are loaded.
9. Normals/Unlit modes still use the shared render-mode IDs.
10. No viewport creates its own material dropdown or its own Lambert equations.

## 9. Key files

```text
types.ts
    StaticMeshAsset.materialId

editor/components/inspector/MaterialSlotField.tsx
    shared inspector selector

editor/components/asset-editor/MeshAssetInspector.tsx
    mesh asset default slot

engine/modules/CoreModules.tsx
    Scene entity override slot

engine/renderers/MeshSurfaceContract.ts
    Lambert fallback + Standard PBR + display contract

engine/renderers/MaterialPreviewRenderer.ts
    asset-viewport project Material compiler/binder

engine/ShaderCompiler.ts
    Scene/preview compile options

engine/systems/MeshRenderSystem.ts
    Scene material inheritance and fallback

editor/components/StaticMeshEditor.tsx
    chooses Lambert fallback or assigned Material preview
```
