import { assetManager } from '@/engine/AssetManager';
import { ComponentType, StaticMeshAsset } from '@/types';

export type StaticMeshEditHost = 'STATIC_MESH_EDITOR' | 'SCENE_VIEW' | 'SKELETAL_MESH_EDITOR';
export type StaticMeshEditScope = 'ASSET' | 'INSTANCE';

/**
 * Context-neutral description of editable static-mesh geometry.
 * Tools operate on this target instead of branching on Scene vs asset editor.
 */
export interface StaticMeshEditTarget {
  assetId: string;
  entityId?: string;
  host: StaticMeshEditHost;
  editScope: StaticMeshEditScope;
}

export function resolveAssetStaticMeshEditTarget(asset: StaticMeshAsset): StaticMeshEditTarget | null {
  if (asset.type !== 'MESH') return null;
  return {
    assetId: asset.id,
    host: 'STATIC_MESH_EDITOR',
    editScope: 'ASSET',
  };
}

/**
 * Scene reuse is deliberately limited to a single selected entity that resolves
 * to a true Static Mesh asset. Skeletal meshes do not silently opt into source
 * geometry editing; a future skeletal-mesh adapter must expose that capability
 * explicitly (for example through an "Edit Source Mesh" mode).
 */
export function resolveSceneStaticMeshEditTarget(engine: any, selectedIds: string[]): StaticMeshEditTarget | null {
  if (selectedIds.length !== 1) return null;
  const entityId = selectedIds[0];
  if (!engine.ecs?.hasComponent?.(entityId, ComponentType.MESH)) return null;

  const index = engine.ecs?.getEntityIndex?.(entityId) ?? engine.ecs?.idToIndex?.get(entityId);
  if (index == null) return null;
  const meshIntId = engine.ecs?.store?.meshType?.[index];
  const assetId = assetManager.getMeshUUID(meshIntId);
  if (!assetId) return null;
  const asset = assetManager.getAsset(assetId);
  if (!asset || asset.type !== 'MESH') return null;

  return {
    assetId,
    entityId,
    host: 'SCENE_VIEW',
    editScope: 'ASSET',
  };
}
