import type { MeshComponentMode } from '@/types';
import { resolveSceneStaticMeshEditTarget } from '@/engine/mesh-editing/StaticMeshEditTarget';

export type SelectionContext =
  | 'SCENE'
  | 'STATIC_MESH_EDITOR'
  | 'SKELETAL_MESH_EDITOR'
  | 'UV_EDITOR';

export type SelectionOperation = 'REPLACE' | 'ADD' | 'SUBTRACT' | 'TOGGLE';

export type SelectionTarget =
  | { kind: 'OBJECTS' }
  | { kind: 'MESH_COMPONENTS'; entityId: string };

export interface SelectionPolicy {
  context: SelectionContext;
  domain: MeshComponentMode;
  target: SelectionTarget | null;
  supportsMarquee: boolean;
  reason?: string;
}

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}

export type MarqueeSelectionResult =
  | {
      kind: 'OBJECTS';
      hitIds: string[];
      selectedIds: string[];
    }
  | {
      kind: 'MESH_COMPONENTS';
      hitCount: number;
    }
  | {
      kind: 'UNAVAILABLE';
      reason?: string;
    };

/**
 * Resolve Static Mesh Editor selection ownership before any click/marquee query.
 * The preview engine is an isolated scene, so OBJECT targets that preview scene
 * while component domains target the editor's single mesh preview entity.
 */
export function resolveStaticMeshEditorSelectionPolicy(
  mode: MeshComponentMode,
  previewEntityId: string | null | undefined,
): SelectionPolicy {
  if (mode === 'OBJECT') {
    return {
      context: 'STATIC_MESH_EDITOR',
      domain: 'OBJECT',
      target: { kind: 'OBJECTS' },
      supportsMarquee: true,
    };
  }

  if (!previewEntityId) {
    return {
      context: 'STATIC_MESH_EDITOR',
      domain: mode,
      target: null,
      supportsMarquee: false,
      reason: 'Static Mesh component selection requires an active preview entity.',
    };
  }

  return {
    context: 'STATIC_MESH_EDITOR',
    domain: mode,
    target: { kind: 'MESH_COMPONENTS', entityId: previewEntityId },
    supportsMarquee: true,
  };
}

/**
 * Scene component editing is valid only when the current object selection resolves
 * to exactly one editable Static Mesh target. OBJECT mode always targets Scene entities.
 */
export function resolveSceneSelectionPolicy(
  engine: any,
  selectedIds: string[],
  mode: MeshComponentMode,
): SelectionPolicy {
  if (mode === 'OBJECT') {
    return {
      context: 'SCENE',
      domain: 'OBJECT',
      target: { kind: 'OBJECTS' },
      supportsMarquee: true,
    };
  }

  const target = resolveSceneStaticMeshEditTarget(engine, selectedIds);
  if (!target?.entityId) {
    return {
      context: 'SCENE',
      domain: mode,
      target: null,
      supportsMarquee: false,
      reason: 'Scene component selection requires exactly one editable Static Mesh entity.',
    };
  }

  return {
    context: 'SCENE',
    domain: mode,
    target: { kind: 'MESH_COMPONENTS', entityId: target.entityId },
    supportsMarquee: true,
  };
}


export function selectionPoliciesMatch(a: SelectionPolicy, b: SelectionPolicy): boolean {
  if (a.context !== b.context || a.domain !== b.domain || a.supportsMarquee !== b.supportsMarquee) return false;
  if (a.target?.kind !== b.target?.kind) return false;
  if (!a.target || !b.target) return a.target === b.target;
  if (a.target.kind === 'MESH_COMPONENTS' && b.target.kind === 'MESH_COMPONENTS') {
    return a.target.entityId === b.target.entityId;
  }
  return true;
}

/** Existing editor convention: Shift toggles marquee hits, otherwise replace. */
export function resolveMarqueeOperation(modifiers: { shiftKey?: boolean }): SelectionOperation {
  return modifiers.shiftKey ? 'TOGGLE' : 'REPLACE';
}

export function applyObjectSelectionOperation(
  currentIds: readonly string[],
  hitIds: readonly string[],
  operation: SelectionOperation,
): string[] {
  if (operation === 'REPLACE') return Array.from(new Set(hitIds));

  const next = new Set(currentIds);
  for (const id of hitIds) {
    if (operation === 'ADD') next.add(id);
    else if (operation === 'SUBTRACT') next.delete(id);
    else if (next.has(id)) next.delete(id);
    else next.add(id);
  }
  return Array.from(next);
}

/**
 * Context-neutral marquee execution. Context/mode/target are already resolved by
 * the viewport policy, so this layer only dispatches to the appropriate low-level
 * selection query. Object selection is returned to the host because Scene/asset
 * editors own their React/editor selection state; component selection is mutated
 * by SelectionSystem and shares its normal soft-selection invalidation path.
 */
export function executeMarqueeSelection(
  engine: any,
  policy: SelectionPolicy,
  rect: SelectionRect,
  operation: SelectionOperation,
  currentObjectIds: readonly string[] = [],
): MarqueeSelectionResult {
  if (!policy.supportsMarquee || !policy.target) {
    return { kind: 'UNAVAILABLE', reason: policy.reason };
  }

  if (policy.domain === 'OBJECT') {
    if (policy.target.kind !== 'OBJECTS') {
      return { kind: 'UNAVAILABLE', reason: 'OBJECT domain requires an object selection target.' };
    }
    const hitIds = engine.selectionSystem?.selectEntitiesInRect?.(
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      rect.viewportWidth,
      rect.viewportHeight,
    ) ?? [];
    return {
      kind: 'OBJECTS',
      hitIds,
      selectedIds: applyObjectSelectionOperation(currentObjectIds, hitIds, operation),
    };
  }

  if (policy.target.kind !== 'MESH_COMPONENTS') {
    return { kind: 'UNAVAILABLE', reason: 'Mesh component domain requires a mesh component target.' };
  }

  const hitCount = engine.selectionSystem?.selectMeshComponentsInRect?.(
    policy.target.entityId,
    policy.domain,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    rect.viewportWidth,
    rect.viewportHeight,
    operation,
  ) ?? 0;
  return { kind: 'MESH_COMPONENTS', hitCount };
}
