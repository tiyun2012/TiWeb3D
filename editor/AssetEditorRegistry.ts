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

type RegistryListener = () => void;

class AssetEditorRegistryService {
  private definitions = new Map<AssetType, AssetEditorDefinition>();
  private listeners = new Set<RegistryListener>();

  register<TAsset extends Asset>(definition: AssetEditorDefinition<TAsset>) {
    this.definitions.set(definition.type, definition as AssetEditorDefinition);
    this.notify();
    return definition;
  }

  unregister(type: AssetType) {
    const deleted = this.definitions.delete(type);
    if (deleted) this.notify();
    return deleted;
  }

  get<TAsset extends Asset = Asset>(type: AssetType): AssetEditorDefinition<TAsset> | undefined {
    return this.definitions.get(type) as AssetEditorDefinition<TAsset> | undefined;
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
