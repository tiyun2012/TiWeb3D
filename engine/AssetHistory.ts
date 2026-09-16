import { assetManager } from './AssetManager';
import { eventBus } from './EventBus';
import type { Asset } from '@/types';

export interface AssetHistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  inTransaction: boolean;
}

interface AssetHistoryEntry {
  label: string;
  snapshot: Asset;
}

interface AssetHistoryStacks {
  undo: AssetHistoryEntry[];
  redo: AssetHistoryEntry[];
}

interface AssetHistoryTransaction {
  label: string;
  before: Asset;
  depth: number;
  dirty: boolean;
}

/**
 * Clone asset data without JSON serialization so typed arrays, Maps, Sets and
 * ArrayBuffers survive exactly. Assets are data-only records, so preserving
 * object prototypes is unnecessary; preserving their container/value types is.
 */
function cloneHistoryValue<T>(value: T): T {
  if (value == null || typeof value !== 'object') return value;

  if (value instanceof ArrayBuffer) return value.slice(0) as T;
  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      return new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)) as T;
    }
    return (value as unknown as { slice(): T }).slice();
  }
  if (value instanceof Map) {
    return new Map(
      Array.from(value.entries(), ([key, entryValue]) => [cloneHistoryValue(key), cloneHistoryValue(entryValue)]),
    ) as T;
  }
  if (value instanceof Set) {
    return new Set(Array.from(value.values(), entry => cloneHistoryValue(entry))) as T;
  }
  if (Array.isArray(value)) return value.map(cloneHistoryValue) as T;

  const result: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value as Record<string, unknown>)) {
    result[key] = cloneHistoryValue(entryValue);
  }
  return result as T;
}

export function cloneAssetHistorySnapshot<T extends Asset>(asset: T): T {
  return cloneHistoryValue(asset);
}

/**
 * Per-asset snapshot history used by authoring tools. History is deliberately
 * separate from the scene ECS HistorySystem: an asset edit may change geometry,
 * topology, Construction data and shell metadata without changing scene ECS.
 */
class AssetHistoryService {
  maxHistory = 50;

  private histories = new Map<string, AssetHistoryStacks>();
  private transactions = new Map<string, AssetHistoryTransaction>();

  private stacks(assetId: string): AssetHistoryStacks {
    let stacks = this.histories.get(assetId);
    if (!stacks) {
      stacks = { undo: [], redo: [] };
      this.histories.set(assetId, stacks);
    }
    return stacks;
  }

  private snapshot(assetId: string): Asset {
    const asset = assetManager.getAsset(assetId);
    if (!asset) throw new Error(`Asset '${assetId}' was not found.`);
    return cloneAssetHistorySnapshot(asset);
  }

  private emitChanged(assetId: string): void {
    eventBus.emit('ASSET_HISTORY_CHANGED', { id: assetId, ...this.getState(assetId) });
  }

  private pushUndo(assetId: string, entry: AssetHistoryEntry): void {
    const stacks = this.stacks(assetId);
    stacks.undo.push(entry);
    if (stacks.undo.length > this.maxHistory) stacks.undo.shift();
    stacks.redo = [];
    this.emitChanged(assetId);
  }

  /**
   * Run one atomic asset mutation. Outside a manual transaction it becomes one
   * undo step. Inside a transaction it only marks the outer transaction dirty.
   * On error, the pre-mutation snapshot is restored so callers never keep a
   * partially mutated asset.
   */
  execute<T>(assetId: string, label: string, mutation: () => T): T {
    const transaction = this.transactions.get(assetId);
    if (transaction) {
      try {
        const result = mutation();
        transaction.dirty = true;
        return result;
      } catch (error) {
        assetManager.restoreAssetSnapshot(assetId, transaction.before);
        this.transactions.delete(assetId);
        this.emitChanged(assetId);
        throw error;
      }
    }

    const before = this.snapshot(assetId);
    try {
      const result = mutation();
      this.pushUndo(assetId, { label, snapshot: before });
      return result;
    } catch (error) {
      // Most mesh operations stage data before committing, but restoring here
      // keeps the history contract atomic even if a future operation mutates in place.
      assetManager.restoreAssetSnapshot(assetId, before);
      throw error;
    }
  }

  begin(assetId: string, label = 'Asset Edit'): void {
    const active = this.transactions.get(assetId);
    if (active) {
      active.depth += 1;
      return;
    }
    this.transactions.set(assetId, {
      label,
      before: this.snapshot(assetId),
      depth: 1,
      dirty: false,
    });
    this.emitChanged(assetId);
  }

  markDirty(assetId: string): boolean {
    const transaction = this.transactions.get(assetId);
    if (!transaction) return false;
    transaction.dirty = true;
    return true;
  }

  commit(assetId: string): boolean {
    const transaction = this.transactions.get(assetId);
    if (!transaction) return false;
    transaction.depth -= 1;
    if (transaction.depth > 0) return false;

    this.transactions.delete(assetId);
    if (transaction.dirty) {
      this.pushUndo(assetId, { label: transaction.label, snapshot: transaction.before });
      return true;
    }
    this.emitChanged(assetId);
    return false;
  }

  cancel(assetId: string): boolean {
    const transaction = this.transactions.get(assetId);
    if (!transaction) return false;
    this.transactions.delete(assetId);
    assetManager.restoreAssetSnapshot(assetId, transaction.before);
    this.emitChanged(assetId);
    return true;
  }

  transaction<T>(assetId: string, label: string, mutation: () => T): T {
    this.begin(assetId, label);
    try {
      const result = mutation();
      this.commit(assetId);
      return result;
    } catch (error) {
      if (this.transactions.has(assetId)) this.cancel(assetId);
      throw error;
    }
  }

  undo(assetId: string): boolean {
    if (this.transactions.has(assetId)) return false;
    const asset = assetManager.getAsset(assetId);
    if (!asset) return false;
    const stacks = this.stacks(assetId);
    const previous = stacks.undo.pop();
    if (!previous) return false;

    stacks.redo.push({ label: previous.label, snapshot: cloneAssetHistorySnapshot(asset) });
    if (stacks.redo.length > this.maxHistory) stacks.redo.shift();
    assetManager.restoreAssetSnapshot(assetId, previous.snapshot);
    this.emitChanged(assetId);
    return true;
  }

  redo(assetId: string): boolean {
    if (this.transactions.has(assetId)) return false;
    const asset = assetManager.getAsset(assetId);
    if (!asset) return false;
    const stacks = this.stacks(assetId);
    const next = stacks.redo.pop();
    if (!next) return false;

    stacks.undo.push({ label: next.label, snapshot: cloneAssetHistorySnapshot(asset) });
    if (stacks.undo.length > this.maxHistory) stacks.undo.shift();
    assetManager.restoreAssetSnapshot(assetId, next.snapshot);
    this.emitChanged(assetId);
    return true;
  }

  clear(assetId?: string): void {
    if (assetId) {
      this.histories.delete(assetId);
      this.transactions.delete(assetId);
      this.emitChanged(assetId);
      return;
    }
    const ids = new Set([...this.histories.keys(), ...this.transactions.keys()]);
    this.histories.clear();
    this.transactions.clear();
    ids.forEach(id => this.emitChanged(id));
  }

  getState(assetId: string): AssetHistoryState {
    const stacks = this.histories.get(assetId);
    return {
      canUndo: Boolean(stacks?.undo.length),
      canRedo: Boolean(stacks?.redo.length),
      undoLabel: stacks && stacks.undo.length > 0 ? stacks.undo[stacks.undo.length - 1].label : undefined,
      redoLabel: stacks && stacks.redo.length > 0 ? stacks.redo[stacks.redo.length - 1].label : undefined,
      inTransaction: this.transactions.has(assetId),
    };
  }
}

export const assetHistory = new AssetHistoryService();
