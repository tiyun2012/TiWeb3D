import type { EngineContext } from "./EngineContext";

export interface EngineModule {
  id: string;
  init(ctx: EngineContext): void;
  dispose?(): void;
}
