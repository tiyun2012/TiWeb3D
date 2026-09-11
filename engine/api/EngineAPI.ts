import type { SimulationMode, MeshComponentMode, ToolType } from '@/types';

export type EngineAPI = {
  // Commands: stable surface that UI should call
  commands: {
    selection: {
      setSelected(ids: string[]): void;
      clear(): void;
    };
    simulation: {
      setMode(mode: SimulationMode): void;
    };
    mesh: {
      setComponentMode(mode: MeshComponentMode): void;
    };
    transform: {
      setPosition(id: string, x: number, y: number, z: number): void;
      setRotation(id: string, x: number, y: number, z: number): void;
      setScale(id: string, x: number, y: number, z: number): void;
      move(id: string, delta: { x: number; y: number; z: number }): void;
      setWorldPosition(id: string, pos: { x: number; y: number; z: number }): void;
    };
    gizmo: {
      setTool(tool: ToolType): void;
    };
  };

  // Events: subscribe to engine/editor events
  subscribe(event: string, cb: (payload: any) => void): () => void;

  // Queries: read-only accessors for UI
  getSelectedIds(): string[];
  getPosition(id: string): { x: number; y: number; z: number } | null;
  getWorldPosition(id: string): { x: number; y: number; z: number } | null;
  getTool(): ToolType;
};
