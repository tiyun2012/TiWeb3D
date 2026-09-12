# Asset Type Registry

## Purpose

The Content Browser must not maintain a second hardcoded list of asset types.
An asset type owns its own creation metadata and factory registration; the Content Browser only reads the registry.

This keeps three things synchronized:

1. the asset type known by TypeScript / `AssetManager`,
2. the factory used to create the asset,
3. the Create menu entry shown by the Content Browser.

## Runtime flow

```text
Asset module / built-in registration
        |
        v
AssetTypeRegistry.register(...)
        |
        +--> presentation metadata
        |      label / icon / color / category
        |
        +--> defaultName
        |
        +--> create(context) factory
        |
        v
Content Browser subscription
        |
        v
Right-click Create menu refreshes automatically
        |
        v
assetTypeRegistry.create(type, { path })
        |
        v
AssetManager-specific factory
        |
        v
ASSET_CREATED
```

## Camera asset creation

A reusable camera is represented by the `CAMERA_PRESET` asset type. A live camera in a Scene remains a Camera ECS component/entity.

The specialized factory still exists:

```ts
assetManager.createCameraPreset('Gameplay Camera', '/Content/Cameras');
```

The generic editor-facing creation API is now:

```ts
assetTypeRegistry.create('CAMERA_PRESET', {
  path: '/Content/Cameras',
  name: 'Gameplay Camera',
});
```

If `name` is omitted, the registry uses the type's registered `defaultName`.

## Registering a new asset type

When adding a new compile-time asset type, first add it to the `AssetType` union and implement its storage/factory as usual. Then register its Content Browser contract from the owning module or from `BuiltInAssetTypes.ts`:

```ts
assetTypeRegistry.register({
  type: 'MY_ASSET',
  label: 'My Asset',
  icon: 'Puzzle',
  colorClass: 'text-cyan-400',
  creatable: true,
  createCategory: 'Other',
  createOrder: 20,
  defaultName: 'New My Asset',
  create: ({ name, path }) => myAssetService.create(name, path),
});
```

No change to `ProjectPanel.tsx` is required. The Create menu reads `assetTypeRegistry.getCreatable()` and subscribes to registry changes.

If a type is import-only, register its presentation metadata without `creatable` or `create`:

```ts
assetTypeRegistry.register({
  type: 'TEXTURE',
  label: 'Texture',
  icon: 'Image',
  colorClass: 'text-cyan-300',
});
```

The Content Browser can then use the same metadata for icons/colors without exposing an invalid Create action.

## Categories

Built-in Create entries are grouped by registry metadata:

- Project
- Rendering
- Animation
- Logic
- Physics
- Other

`createOrder` controls ordering inside a category. Asset modules should not depend on the visual position of another type.

## Dynamic registration

`AssetTypeRegistry` supports `subscribe()` and `unregister()`. This is important for optional editor modules/plugins:

```ts
const dispose = assetTypeRegistry.subscribe(() => {
  // registry metadata changed
});

assetTypeRegistry.register(...);

// optional module unload
assetTypeRegistry.unregister('MY_ASSET');
dispose();
```

The Content Browser already subscribes, so a newly registered creatable asset appears without a reload.

## Responsibilities that are intentionally separate

The registry currently owns **asset creation and Content Browser presentation metadata**. It does not automatically invent behavior for:

- double-click editor windows (owned by `AssetEditorRegistry`),
- drag/drop scene placement,
- custom asset inspectors,
- serialization rules,
- importers.

Those capabilities have different runtime dependencies and should be registered explicitly when generalized. Do not add type switches back into the Create menu to solve them.

## Rules

1. Never add another hardcoded `if (type === ...) create...` chain to `ProjectPanel`.
2. A creatable type must register a factory and a default name.
3. Import-only types should still register icon/label metadata when shown in the Content Browser.
4. Core registrations run during application bootstrap, before React mounts.
5. Optional modules may register later; UI consumers must subscribe instead of assuming a frozen registry.

## Related editor capability registry

Double-click editor opening is registered separately through `editor/AssetEditorRegistry.ts`. See `docs/ASSET_EDITOR_REGISTRY.md`. This separation is intentional: an asset can be creatable without having a dedicated editor, and optional editor modules can register UI behavior without adding React dependencies to the engine-facing asset type registry.
