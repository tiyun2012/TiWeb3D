
import type { EngineContext } from './EngineContext';
import { eventBus } from '@/engine/EventBus';
import { assetManager } from "@/engine/AssetManager";
import { engineInstance } from "@/engine/engine";

/**
 * Bridge context used by new feature modules.
 * Keeps legacy engineInstance intact while you migrate features incrementally.
 */
export function createEngineContext(): EngineContext {
  return {
    engine: engineInstance,
    assets: assetManager,
    events: eventBus,
    commands: {},
  };
}
