# Asset Editor Registry

## Purpose

Content Browser double-click behavior must not be a hardcoded asset-type switch inside `ProjectPanel.tsx`.
Creation and editing are separate capabilities:

- `AssetTypeRegistry` owns creation/presentation metadata.
- `AssetEditorRegistry` owns which editor window opens for an asset type.

This lets an optional editor module register an editor without changing the Content Browser.

## Runtime flow

```text
Content Browser asset double-click
        |
        v
assetEditorRegistry.get(asset.type)
        |
        +--> editor registered
        |       |
        |       v
        |   createWindow(asset)
        |       |
        |       v
        |   WindowManager.registerWindow/openWindow
        |
        +--> no editor registered
                |
                +--> asset-specific non-editor behavior may run
                     (for example Scene loading)
```

## Built-in registration

`editor/BuiltInAssetEditors.tsx` registers the built-in editors during bootstrap:

- Material -> NodeGraph
- Script -> NodeGraph
- Rig -> NodeGraph
- Static Mesh -> StaticMeshEditor
- Skeletal Mesh -> SkeletalMeshEditor
- Skeleton -> SkeletonEditor
- Camera Preset -> CameraPresetEditor

`index.tsx` calls `registerBuiltInAssetEditors()` before React mounts.

## Registering a new editor

```tsx
assetEditorRegistry.register({
  type: 'MY_ASSET',
  createWindow: asset => ({
    id: `editor_${asset.id}`,
    title: asset.name,
    icon: 'Puzzle',
    content: <MyAssetEditor assetId={asset.id} />,
    width: 900,
    height: 650,
    initialPosition: { x: 120, y: 80 },
  }),
});
```

No change to `ProjectPanel.tsx` is required.

## Why this is separate from AssetTypeRegistry

Asset creation can exist without an editor, and an editor may be supplied by an optional module. Keeping the registries separate avoids forcing React/window-manager dependencies into the engine-facing asset type registry.

Examples:

- Texture may be imported and displayed without a dedicated editor.
- Scene uses double-click to load rather than opening an asset editor window.
- Camera Preset is creatable and also has a dedicated editor.

## Rules

1. Do not reintroduce a large `if (asset.type === ...)` editor-opening chain in `ProjectPanel`.
2. Asset editors should register during editor bootstrap or module activation.
3. 3D asset editors must still reuse `AssetViewport3D` for viewport lifecycle/navigation.
4. Registration defines only editor-window opening; creation remains in `AssetTypeRegistry`.
