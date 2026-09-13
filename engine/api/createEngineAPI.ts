
import type { EngineAPI } from './EngineAPI';
import { eventBus } from '@/engine/EventBus';
import { engineInstance } from '@/engine/engine';
import type { CameraSettings, ComponentType, SimulationMode, MeshComponentMode, ToolType } from '@/types';
import { Mat4Utils, Vec3Utils } from '@/engine/math';

export function createEngineAPI(engine: any = engineInstance): EngineAPI {
  return {
    commands: {
      selection: {
        setSelected(ids: string[]) {
          if (engine.setSelected) {
            engine.setSelected(ids);
          } else if (engine.selectionSystem) {
            // Selection does not own transforms. SelectionSystem publishes its own
            // notification by default, so avoid a redundant scene sync/notification.
            engine.selectionSystem.setSelected(ids);
          }
        },
        clear() {
          if (engine.setSelected) {
            engine.setSelected([]);
          } else if (engine.selectionSystem) {
            engine.selectionSystem.setSelected([]);
          }
        },
      },
      simulation: {
        setMode(mode: SimulationMode) {
          engine.simulationMode = mode;
          engine.notifyUI();
        },
      },
      mesh: {
        setComponentMode(mode: MeshComponentMode) {
          engine.meshComponentMode = mode;
          engine.notifyUI();
        },
      },
      meshEditing: {
        configureSoftSelection(settings) {
          if (settings.enabled !== undefined) engine.softSelectionEnabled = settings.enabled;
          if (settings.radius !== undefined) engine.softSelectionRadius = Math.max(0.0001, settings.radius);
          if (settings.mode !== undefined) engine.softSelectionMode = settings.mode;
          if (settings.falloff !== undefined) engine.softSelectionFalloff = settings.falloff;
          if (settings.heatmapVisible !== undefined) engine.softSelectionHeatmapVisible = settings.heatmapVisible;
          engine.recalculateSoftSelection?.();
          engine.notifyUI?.();
        },
        recalculateSoftSelection() {
          engine.recalculateSoftSelection?.();
          engine.notifyUI?.();
        },
      },
      transform: {
        setPosition(id: string, x: number, y: number, z: number) {
          const idx = engine.ecs?.getEntityIndex ? engine.ecs.getEntityIndex(id) : engine.ecs?.idToIndex?.get(id);
          if (idx !== undefined && engine.ecs?.store) {
            engine.ecs.store.setPosition(idx, x, y, z);
            engine.sceneGraph.setDirty(id);
            engine.syncTransforms(true);
          }
        },
        setRotation(id: string, x: number, y: number, z: number) {
          const idx = engine.ecs?.getEntityIndex ? engine.ecs.getEntityIndex(id) : engine.ecs?.idToIndex?.get(id);
          if (idx !== undefined && engine.ecs?.store) {
            engine.ecs.store.setRotation(idx, x, y, z);
            engine.sceneGraph.setDirty(id);
            engine.syncTransforms(true);
          }
        },
        setScale(id: string, x: number, y: number, z: number) {
          const idx = engine.ecs?.getEntityIndex ? engine.ecs.getEntityIndex(id) : engine.ecs?.idToIndex?.get(id);
          if (idx !== undefined && engine.ecs?.store) {
            engine.ecs.store.setScale(idx, x, y, z);
            engine.sceneGraph.setDirty(id);
            engine.syncTransforms(true);
          }
        },
        move(id: string, delta: { x: number; y: number; z: number }) {
          const idx = engine.ecs?.getEntityIndex ? engine.ecs.getEntityIndex(id) : engine.ecs?.idToIndex?.get(id);
          if (idx !== undefined && engine.ecs?.store) {
            const curX = engine.ecs.store.posX[idx];
            const curY = engine.ecs.store.posY[idx];
            const curZ = engine.ecs.store.posZ[idx];
            engine.ecs.store.setPosition(idx, curX + delta.x, curY + delta.y, curZ + delta.z);
            engine.sceneGraph.setDirty(id);
            engine.syncTransforms(true);
          }
        },
        setWorldPosition(id: string, pos: { x: number; y: number; z: number }) {
          const parentId = engine.sceneGraph.getParentId(id);
          const parentMat = Mat4Utils.create();
          if (parentId) {
            const pm = engine.sceneGraph.getWorldMatrix(parentId);
            if (pm) Mat4Utils.copy(parentMat, pm);
          }
          const invParent = Mat4Utils.create();
          Mat4Utils.invert(parentMat, invParent);
          const localPos = Vec3Utils.create();
          Vec3Utils.transformMat4(pos, invParent, localPos);
          const idx = engine.ecs?.getEntityIndex ? engine.ecs.getEntityIndex(id) : engine.ecs?.idToIndex?.get(id);
          if (idx !== undefined && engine.ecs?.store) {
            engine.ecs.store.setPosition(idx, localPos.x, localPos.y, localPos.z);
            engine.sceneGraph.setDirty(id);
            engine.syncTransforms(true);
          }
        },
      },
      gizmo: {
        setTool(tool: ToolType) {
          engine.gizmoSystem?.setTool(tool);
          engine.notifyUI();
        },
      },
      camera: {
        setRuntimeOverride(id: string, override: Partial<CameraSettings> | null) {
          engine.setCameraRuntimeOverride?.(id, override);
        },
        setCinematicOverride(id: string, override: Partial<CameraSettings> | null) {
          engine.setCameraCinematicOverride?.(id, override);
        },
        clearDriverOverrides(id: string) {
          engine.clearCameraDriverOverrides?.(id);
        },
      },
      components: {
        add(id: string, type: ComponentType) {
          engine.ecs?.addComponent(id, type);
          engine.notifyUI?.();
        },
        remove(id: string, type: ComponentType) {
          const removed = engine.ecs?.removeComponent(id, type) ?? false;
          if (removed) engine.notifyUI?.();
          return removed;
        },
      },
    },

    subscribe(event: string, cb: (payload: any) => void) {
      eventBus.on(event, cb);
      return () => eventBus.off(event, cb);
    },

    getSelectedIds() {
      const indices = engine.selectionSystem?.selectedIndices;
      if (!indices) return [];
      const ids: string[] = [];
      indices.forEach((idx: number) => {
          const id = engine.ecs.store.ids[idx];
          if (id) ids.push(id);
      });
      return ids;
    },

    getPosition(id: string) {
      const idx = engine.ecs?.getEntityIndex ? engine.ecs.getEntityIndex(id) : engine.ecs?.idToIndex?.get(id);
      if (idx === undefined || !engine.ecs?.store) return null;
      return {
        x: engine.ecs.store.posX[idx],
        y: engine.ecs.store.posY[idx],
        z: engine.ecs.store.posZ[idx],
      };
    },

    getWorldPosition(id: string) {
      return engine.sceneGraph.getWorldPosition(id);
    },

    getTool(): ToolType {
      return (engine.gizmoSystem as any)?.tool || 'SELECT';
    },

    getResolvedCamera(id: string) {
      return engine.getResolvedCamera?.(id) ?? null;
    },

    hasComponentCapability(id: string, capability: string) {
      return engine.ecs?.hasCapability?.(id, capability) ?? false;
    },
  };
}
