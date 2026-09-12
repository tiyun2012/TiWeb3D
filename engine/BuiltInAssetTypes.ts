import { assetManager } from './AssetManager';
import { assetTypeRegistry } from './AssetTypeRegistry';

let registered = false;

/**
 * Registers built-in asset metadata and creation factories.
 *
 * Content Browser consumes this registry dynamically, so adding a new creatable
 * asset should only require registering it here (or from the owning module/plugin)
 * rather than editing ProjectPanel.
 */
export function registerBuiltInAssetTypes() {
  if (registered) return;
  registered = true;

  assetTypeRegistry.register({
    type: 'FOLDER',
    label: 'Folder',
    icon: 'FolderPlus',
    colorClass: 'text-yellow-500',
    creatable: true,
    createCategory: 'Project',
    createOrder: 0,
    defaultName: 'New Folder',
    create: ({ name, path }) => assetManager.createFolder(name, path),
  });

  assetTypeRegistry.register({
    type: 'SCENE',
    label: 'Scene',
    icon: 'Clapperboard',
    creatable: true,
    createCategory: 'Project',
    createOrder: 10,
    defaultName: 'New Scene',
    create: ({ name, path }) => assetManager.createScene(name, '{}', path),
  });

  assetTypeRegistry.register({
    type: 'MATERIAL',
    label: 'Material',
    icon: 'Palette',
    colorClass: 'text-emerald-400',
    creatable: true,
    createCategory: 'Rendering',
    createOrder: 0,
    defaultName: 'New Material',
    create: ({ name, path }) => assetManager.createMaterial(name, undefined, path),
  });

  assetTypeRegistry.register({
    type: 'VIEWPORT_PROFILE',
    label: 'Viewport Profile',
    icon: 'Monitor',
    colorClass: 'text-indigo-300',
    description: 'Reusable editor viewport navigation and overlay behavior.',
    contentVisibility: 'PUBLIC',
    creatable: true,
    createCategory: 'Rendering',
    createOrder: 5,
    defaultName: 'New Viewport Profile',
    create: ({ name, path }) => assetManager.createViewportProfile(name, path),
  });

  assetTypeRegistry.register({
    type: 'CAMERA_PRESET',
    label: 'Camera Preset',
    icon: 'Camera',
    colorClass: 'text-sky-400',
    description: 'Reusable Camera settings that can be placed in a Scene.',
    contentVisibility: 'PUBLIC',
    creatable: true,
    createCategory: 'Rendering',
    createOrder: 10,
    defaultName: 'New Camera Preset',
    placeable: true,
    create: ({ name, path }) => assetManager.createCameraPreset(name, path),
  });

  assetTypeRegistry.register({
    type: 'POST_PROCESS_PROFILE',
    label: 'Post Process Profile',
    icon: 'Sparkles',
    colorClass: 'text-fuchsia-400',
    contentVisibility: 'PUBLIC',
    creatable: true,
    createCategory: 'Rendering',
    createOrder: 20,
    defaultName: 'New Post Process',
    create: ({ name, path }) => assetManager.createPostProcessProfile(name, path),
  });

  assetTypeRegistry.register({
    type: 'SKELETON',
    label: 'Skeleton',
    icon: 'Bone',
    colorClass: 'text-orange-300',
    creatable: true,
    createCategory: 'Animation',
    createOrder: 0,
    defaultName: 'New Skeleton',
    placeable: true,
    create: ({ name, path }) => assetManager.createSkeleton(name, path),
  });

  assetTypeRegistry.register({
    type: 'RIG',
    label: 'Rig',
    icon: 'GitBranch',
    creatable: true,
    createCategory: 'Animation',
    createOrder: 10,
    defaultName: 'New Rig',
    create: ({ name, path }) => assetManager.createRig(name, undefined, path),
  });

  assetTypeRegistry.register({
    type: 'SCRIPT',
    label: 'Script',
    icon: 'FileCode',
    creatable: true,
    createCategory: 'Logic',
    createOrder: 0,
    defaultName: 'New Script',
    create: ({ name, path }) => assetManager.createScript(name, path),
  });

  assetTypeRegistry.register({
    type: 'PHYSICS_MATERIAL',
    label: 'Physics Material',
    icon: 'Gauge',
    creatable: true,
    createCategory: 'Physics',
    createOrder: 0,
    defaultName: 'New Physics Mat',
    create: ({ name, path }) => assetManager.createPhysicsMaterial(name, undefined, path),
  });

  // Imported/generated types still register presentation metadata even though
  // Content Browser does not expose them in Create.
  assetTypeRegistry.register({
    type: 'MESH',
    label: 'Static Mesh',
    icon: 'Box',
    colorClass: 'text-blue-400',
    placeable: true,
  });

  assetTypeRegistry.register({
    type: 'SKELETAL_MESH',
    label: 'Skeletal Mesh',
    icon: 'PersonStanding',
    colorClass: 'text-purple-400',
    placeable: true,
  });

  assetTypeRegistry.register({
    type: 'TEXTURE',
    label: 'Texture',
    icon: 'Image',
    colorClass: 'text-cyan-300',
  });
}
