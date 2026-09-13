import { assetManager } from '@/engine/AssetManager';
import { COMPONENT_MASKS } from '@/engine/constants';
import { AABBUtils, Vec3Utils, type AABB } from '@/engine/math';
import type { IEngine, MeshComponentMode, SkeletalMeshAsset, StaticMeshAsset } from '@/types';
import {
  createFocusTargetFromBounds,
  createFocusTargetFromPoints,
  type FocusTarget,
  type FocusPoint,
} from './viewportFocus';

type MeshAsset = StaticMeshAsset | SkeletalMeshAsset;

const meshAssetForEntity = (engine: IEngine, entityId: string): MeshAsset | null => {
  const idx = engine.ecs?.idToIndex?.get(entityId);
  if (idx === undefined) return null;
  const meshIntId = engine.ecs.store.meshType[idx];
  const uuid = assetManager.meshIntToUuid.get(meshIntId);
  const asset = uuid ? assetManager.getAsset(uuid) : null;
  return asset && (asset.type === 'MESH' || asset.type === 'SKELETAL_MESH') ? asset as MeshAsset : null;
};

const getMeshReferenceRadius = (asset: MeshAsset, worldMatrix?: Float32Array | null) => {
  const aabb = asset.geometry.aabb;
  if (!aabb) return 0.08;
  const resolved = AABBUtils.create();
  if (worldMatrix) AABBUtils.transform(resolved, aabb, worldMatrix);
  else AABBUtils.copy(resolved, aabb);
  const size = AABBUtils.size(resolved, { x: 0, y: 0, z: 0 });
  return Math.max(0.02, Math.max(size.x, size.y, size.z) * 0.025);
};

/** Resolve whole-mesh or component-level focus from a mesh asset. */
export const resolveMeshFocusTarget = (
  asset: MeshAsset,
  vertexIds?: Iterable<number> | null,
  worldMatrix?: Float32Array | null,
): FocusTarget | null => {
  const minWorldRadius = getMeshReferenceRadius(asset, worldMatrix);
  if (vertexIds) {
    const vertices = asset.geometry.vertices;
    const points: FocusPoint[] = [];
    for (const vertexId of vertexIds) {
      const offset = vertexId * 3;
      if (offset < 0 || offset + 2 >= vertices.length) continue;
      const local = { x: vertices[offset], y: vertices[offset + 1], z: vertices[offset + 2] };
      points.push(worldMatrix
        ? Vec3Utils.transformMat4(local, worldMatrix, { x: 0, y: 0, z: 0 })
        : local);
    }
    if (points.length > 0) {
      return createFocusTargetFromPoints(points, { minWorldRadius, padding: 1.2 });
    }
  }

  const localBounds = asset.geometry.aabb;
  if (!localBounds) return null;
  const bounds = AABBUtils.create();
  if (worldMatrix) AABBUtils.transform(bounds, localBounds, worldMatrix);
  else AABBUtils.copy(bounds, localBounds);
  return createFocusTargetFromBounds(bounds, { minWorldRadius, padding: 1.12 });
};

/**
 * Scene adapter: component mode resolves selected mesh components first;
 * otherwise actual transformed mesh AABBs (plus point bounds for helpers) are
 * unioned across the object selection.
 */
export const resolveSceneSelectionFocusTarget = (
  engine: IEngine,
  selectedIds: readonly string[],
  componentMode: MeshComponentMode,
): FocusTarget | null => {
  if (selectedIds.length === 0) return null;

  if (componentMode !== 'OBJECT') {
    const selectedIndices: Set<number> | undefined = engine.selectionSystem?.selectedIndices;
    const firstIndex = selectedIndices?.values().next().value as number | undefined;
    const componentEntityId = firstIndex !== undefined ? engine.ecs.store.ids[firstIndex] : selectedIds[0];
    if (componentEntityId) {
      const asset = meshAssetForEntity(engine, componentEntityId);
      const world = engine.sceneGraph?.getWorldMatrix(componentEntityId) as Float32Array | null;
      const vertices: Set<number> | undefined = engine.selectionSystem?.getSelectionAsVertices?.();
      if (asset && vertices && vertices.size > 0) {
        const componentTarget = resolveMeshFocusTarget(asset, vertices, world);
        if (componentTarget) return componentTarget;
      }
    }
  }

  const combined = AABBUtils.create();
  let valid = false;
  for (const entityId of selectedIds) {
    const idx = engine.ecs?.idToIndex?.get(entityId);
    if (idx === undefined) continue;
    const world = engine.sceneGraph?.getWorldMatrix(entityId) as Float32Array | null;
    if (!world) continue;

    const mask = engine.ecs.store.componentMask[idx];
    if (mask & COMPONENT_MASKS.MESH) {
      const asset = meshAssetForEntity(engine, entityId);
      if (asset?.geometry.aabb) {
        const worldBounds = AABBUtils.create();
        AABBUtils.transform(worldBounds, asset.geometry.aabb, world);
        if (!valid) AABBUtils.copy(combined, worldBounds);
        else AABBUtils.union(combined, combined, worldBounds);
        valid = true;
        continue;
      }
    }

    // Lights, cameras, pivots, bones, and other non-mesh scene items still get
    // a useful focus volume centered on their real world transform.
    const pointBounds: AABB = {
      min: { x: world[12] - 0.25, y: world[13] - 0.25, z: world[14] - 0.25 },
      max: { x: world[12] + 0.25, y: world[13] + 0.25, z: world[14] + 0.25 },
    };
    if (!valid) AABBUtils.copy(combined, pointBounds);
    else AABBUtils.union(combined, combined, pointBounds);
    valid = true;
  }

  return valid ? createFocusTargetFromBounds(combined, { minWorldRadius: 0.08, padding: 1.15 }) : null;
};
