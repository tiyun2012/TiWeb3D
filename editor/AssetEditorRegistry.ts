import type { ReactNode } from 'react';
import type { Asset, AssetType } from '@/types';

export interface AssetEditorWindowConfig {
  id: string;
  title: string;
  icon: string;
  content: ReactNode;
  width?: number;
  height?: number | string;
  initialPosition?: { x: number; y: number };
}

export interface AssetEditorDefinition<TAsset extends Asset = Asset> {
  type: TAsset['type'];
  createWindow: (asset: TAsset) => AssetEditorWindowConfig;
}

/**
 * Registry storage deliberately erases the concrete asset subtype.
 *
 * The public register() API remains generic/strongly typed. A checked wrapper
 * restores the subtype before invoking each editor factory, which avoids
 * treating `(CameraPresetAsset) => ...` as `(Asset) => ...` (an invalid
 * function-parameter variance conversion under strict TypeScript).
 */
interface StoredAssetEditorDefinition {
  type: AssetType;
  createWindow: (asset: Asset) => AssetEditorWindowConfig;
}

type RegistryListener = () => void;

const matchesDefinition = <TAsset extends Asset>(
  asset: Asset,
  definition: AssetEditorDefinition<TAsset>,
): asset is TAsset => asset.type === definition.type;

class AssetEditorRegistryService {
  private definitions = new Map<AssetType, StoredAssetEditorDefinition>();
  private listeners = new Set<RegistryListener>();

  register<TAsset extends Asset>(definition: AssetEditorDefinition<TAsset>) {
    const stored: StoredAssetEditorDefinition = {
      type: definition.type,
      createWindow: asset => {
        if (!matchesDefinition(asset, definition)) {
          throw new Error(
            `Asset editor for ${definition.type} cannot open asset ${asset.id} of type ${asset.type}`,
          );
        }
        return definition.createWindow(asset);
      },
    };

    this.definitions.set(definition.type, stored);
    this.notify();
    return definition;
  }

  unregister(type: AssetType) {
    const deleted = this.definitions.delete(type);
    if (deleted) this.notify();
    return deleted;
  }

  get(type: AssetType): StoredAssetEditorDefinition | undefined {
    return this.definitions.get(type);
  }

  has(type: AssetType) {
    return this.definitions.has(type);
  }

  subscribe(listener: RegistryListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

/**
 * Editor-side registry for Content Browser double-click behavior.
 *
 * Asset creation stays in AssetTypeRegistry. Opening/editing is deliberately
 * separate because editor components have React/window-manager dependencies.
 */
export const assetEditorRegistry = new AssetEditorRegistryService();
