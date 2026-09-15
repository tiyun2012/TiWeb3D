import type { CameraSettings, ComponentType, MeshComponentMode, ResolvedCameraState, SimulationMode, SoftSelectionConnectivity, SoftSelectionFalloff, ToolType } from '@/types';
import type { SoftSelectionMode } from '@/engine/mesh-editing/SoftSelection';

export type SoftSelectionAPIState = {
  enabled: boolean;
  radius: number;
  mode: SoftSelectionMode;
  distanceMetric: SoftSelectionFalloff;
  surfaceBlend: number;
  connectivity: SoftSelectionConnectivity;
  heatmapVisible: boolean;
};

export type EngineAPI = {
  // Commands: stable surface that UI should call
  commands: {
    selection: {
      setSelected(ids: string[]): void;
      clear(): void;
      setMeshComponents(args:
        | { mode: 'VERTEX'; ids: number[] }
        | { mode: 'EDGE'; ids: string[] }
        | { mode: 'FACE'; ids: number[] }
      ): void;
      selectMeshComponentsInRect(args: {
        entityId: string;
        mode: MeshComponentMode;
        x: number;
        y: number;
        width: number;
        height: number;
        viewportWidth: number;
        viewportHeight: number;
        operation?: 'REPLACE' | 'ADD' | 'SUBTRACT' | 'TOGGLE';
      }): number;
    };
    simulation: {
      setMode(mode: SimulationMode): void;
    };
    mesh: {
      setComponentMode(mode: MeshComponentMode): void;
    };
    meshEditing: {
      configureSoftSelection(settings: Partial<{
        enabled: boolean;
        radius: number;
        mode: SoftSelectionMode;
        /** Preferred semantic name for Volume / Surface / Hybrid. */
        distanceMetric: SoftSelectionFalloff;
        /** Legacy alias retained for existing callers. */
        falloff: SoftSelectionFalloff;
        surfaceBlend: number;
        connectivity: SoftSelectionConnectivity;
        heatmapVisible: boolean;
      }>): void;
      recalculateSoftSelection(): void;
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
    camera: {
      /** Gameplay/script driver layer; only applied when Camera Control Mode is Runtime. */
      setRuntimeOverride(id: string, override: Partial<CameraSettings> | null): void;
      /** Timeline/sequencer driver layer; only applied when Camera Control Mode is Cinematic. */
      setCinematicOverride(id: string, override: Partial<CameraSettings> | null): void;
      clearDriverOverrides(id: string): void;
    };
    components: {
      /** Adds the component plus any registered required/base components. */
      add(id: string, type: ComponentType): void;
      /** Removes only when no installed component depends on it. */
      remove(id: string, type: ComponentType): boolean;
    };
  };

  // Events: subscribe to engine/editor events
  subscribe(event: string, cb: (payload: any) => void): () => void;

  // Queries: read-only accessors for UI
  getSelectedIds(): string[];
  getPosition(id: string): { x: number; y: number; z: number } | null;
  getWorldPosition(id: string): { x: number; y: number; z: number } | null;
  getTool(): ToolType;
  getSoftSelectionSettings(): SoftSelectionAPIState;
  getResolvedCamera(id: string): ResolvedCameraState | null;
  hasComponentCapability(id: string, capability: string): boolean;
};
