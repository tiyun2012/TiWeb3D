import React from 'react';
import type { Asset } from '@/types';
import { assetEditorRegistry } from './AssetEditorRegistry';
import { NodeGraph } from './components/NodeGraph';
import { StaticMeshEditor } from './components/StaticMeshEditor';
import { SkeletalMeshEditor } from './components/SkeletalMeshEditor';
import { SkeletonEditor } from './components/SkeletonEditor';
import { CameraPresetEditor } from './components/CameraPresetEditor';
import { ViewportProfileEditor } from './components/ViewportProfileEditor';

let registered = false;

const centeredWindow = (width: number, height: number) => ({
  width,
  height,
  initialPosition: {
    x: Math.max(40, (window.innerWidth - width) / 2),
    y: Math.max(40, (window.innerHeight - height) / 2),
  },
});

const getFullAssetEditorLayout = () => {
  const width = Math.max(820, Math.min(1180, window.innerWidth - 80));
  const height = Math.max(620, Math.min(760, window.innerHeight - 80));
  return centeredWindow(width, height);
};

const getCameraEditorLayout = () => {
  const width = Math.max(760, Math.min(1040, window.innerWidth - 120));
  const height = Math.max(560, Math.min(720, window.innerHeight - 100));
  return centeredWindow(width, height);
};

const graphEditor = (asset: Asset, icon: string) => ({
  id: `editor_${asset.id}`,
  title: asset.name,
  icon,
  content: <NodeGraph assetId={asset.id} />,
  ...centeredWindow(800, 600),
});

/**
 * Registers built-in Content Browser double-click editors.
 *
 * This is intentionally separate from AssetTypeRegistry: asset creation and
 * editor opening have different dependencies/lifecycles. Optional modules may
 * register either capability independently.
 */
export const registerBuiltInAssetEditors = () => {
  if (registered) return;
  registered = true;

  assetEditorRegistry.register({
    type: 'MATERIAL',
    createWindow: asset => graphEditor(asset, 'Palette'),
  });

  assetEditorRegistry.register({
    type: 'SCRIPT',
    createWindow: asset => graphEditor(asset, 'Code'),
  });

  assetEditorRegistry.register({
    type: 'RIG',
    createWindow: asset => graphEditor(asset, 'Cpu'),
  });

  assetEditorRegistry.register({
    type: 'MESH',
    createWindow: asset => ({
      id: `editor_${asset.id}`,
      title: asset.name,
      icon: 'Box',
      content: <StaticMeshEditor assetId={asset.id} />,
      ...getFullAssetEditorLayout(),
    }),
  });

  assetEditorRegistry.register({
    type: 'SKELETAL_MESH',
    createWindow: asset => ({
      id: `editor_${asset.id}`,
      title: asset.name,
      icon: 'Bone',
      content: <SkeletalMeshEditor assetId={asset.id} />,
      ...getFullAssetEditorLayout(),
    }),
  });

  assetEditorRegistry.register({
    type: 'SKELETON',
    createWindow: asset => ({
      id: `editor_${asset.id}`,
      title: asset.name,
      icon: 'Bone',
      content: <SkeletonEditor assetId={asset.id} />,
      ...getFullAssetEditorLayout(),
    }),
  });


  assetEditorRegistry.register({
    type: 'VIEWPORT_PROFILE',
    createWindow: asset => ({
      id: `editor_${asset.id}`,
      title: asset.name,
      icon: 'Monitor',
      content: <ViewportProfileEditor assetId={asset.id} />,
      ...centeredWindow(520, 600),
    }),
  });

  assetEditorRegistry.register({
    type: 'CAMERA_PRESET',
    createWindow: asset => ({
      id: `editor_${asset.id}`,
      title: asset.name,
      icon: 'Camera',
      content: <CameraPresetEditor assetId={asset.id} />,
      ...getCameraEditorLayout(),
    }),
  });
};
