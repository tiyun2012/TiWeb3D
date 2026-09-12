import type { Asset, AssetType } from '@/types';

export type AssetCreateCategory =
  | 'Project'
  | 'Rendering'
  | 'Animation'
  | 'Logic'
  | 'Physics'
  | 'Other';

export interface AssetCreateContext {
  path: string;
  name?: string;
}

export interface AssetTypeDefinition<TAsset extends Asset = Asset> {
  type: TAsset['type'];
  label: string;
  icon: string;
  colorClass?: string;
  description?: string;

  /** Whether Content Browser exposes this type in its Create menu. */
  creatable?: boolean;
  createCategory?: AssetCreateCategory;
  createOrder?: number;
  defaultName?: string;

  /** Asset types that can be instantiated in the Scene may advertise that here. */
  placeable?: boolean;

  /** Factory used by Content Browser and other editor code. */
  create?: (context: Required<Pick<AssetCreateContext, 'path'>> & { name: string }) => TAsset;
}

type RegistryListener = () => void;

const CATEGORY_ORDER: Record<AssetCreateCategory, number> = {
  Project: 0,
  Rendering: 10,
  Animation: 20,
  Logic: 30,
  Physics: 40,
  Other: 100,
};

class AssetTypeRegistryService {
  private definitions = new Map<AssetType, AssetTypeDefinition>();
  private listeners = new Set<RegistryListener>();

  register<TAsset extends Asset>(definition: AssetTypeDefinition<TAsset>) {
    this.definitions.set(definition.type, definition as AssetTypeDefinition);
    this.notify();
    return definition;
  }

  unregister(type: AssetType) {
    const deleted = this.definitions.delete(type);
    if (deleted) this.notify();
    return deleted;
  }

  get<TAsset extends Asset = Asset>(type: AssetType): AssetTypeDefinition<TAsset> | undefined {
    return this.definitions.get(type) as AssetTypeDefinition<TAsset> | undefined;
  }

  getAll() {
    return Array.from(this.definitions.values());
  }

  getCreatable() {
    return this.getAll()
      .filter((definition) => definition.creatable && definition.create)
      .sort((a, b) => {
        const categoryA = CATEGORY_ORDER[a.createCategory ?? 'Other'];
        const categoryB = CATEGORY_ORDER[b.createCategory ?? 'Other'];
        if (categoryA !== categoryB) return categoryA - categoryB;
        const orderA = a.createOrder ?? 100;
        const orderB = b.createOrder ?? 100;
        if (orderA !== orderB) return orderA - orderB;
        return a.label.localeCompare(b.label);
      });
  }

  create(type: AssetType, context: AssetCreateContext): Asset {
    const definition = this.definitions.get(type);
    if (!definition?.creatable || !definition.create) {
      throw new Error(`Asset type ${type} is not registered as creatable.`);
    }

    const name = context.name?.trim() || definition.defaultName || `New ${definition.label}`;
    return definition.create({ path: context.path, name });
  }

  subscribe(listener: RegistryListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

export const assetTypeRegistry = new AssetTypeRegistryService();
