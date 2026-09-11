import { eventBus } from "@/engine/EventBus";
import { assetManager } from "@/engine/AssetManager";
import { engineInstance } from "@/engine/engine";

export type EngineContext = {
  engine: typeof engineInstance;
  assets: typeof assetManager;
  events: typeof eventBus;
  /** Feature command registry (populated by modules). */
  commands: Record<string, any>;
};

export function createEngineContext(): EngineContext {
  return {
    engine: engineInstance,
    assets: assetManager,
    events: eventBus,
    commands: {},
  };
}
