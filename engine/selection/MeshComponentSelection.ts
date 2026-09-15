/** Shared operation semantics for explicit mesh-component selection commands. */
export type MeshComponentSelectionOperation = 'REPLACE' | 'ADD' | 'SUBTRACT' | 'TOGGLE';

export function applyMeshComponentSelectionOperation<T extends number | string>(
  current: ReadonlySet<T>,
  ids: Iterable<T>,
  operation: MeshComponentSelectionOperation = 'REPLACE',
): Set<T> {
  const next = operation === 'REPLACE' ? new Set<T>() : new Set<T>(current);

  for (const id of ids) {
    if (operation === 'SUBTRACT') next.delete(id);
    else if (operation === 'TOGGLE') {
      if (next.has(id)) next.delete(id);
      else next.add(id);
    } else {
      next.add(id);
    }
  }

  return next;
}


export type MeshComponentSelectionMode = 'VERTEX' | 'EDGE' | 'FACE';

export interface MeshComponentSubSelectionView {
  vertexIds: ReadonlySet<number>;
  edgeIds: ReadonlySet<string>;
  faceIds: ReadonlySet<number>;
}

/** True only when the currently active component domain has an actionable selection. */
export function hasActiveMeshComponentSelection(
  mode: MeshComponentSelectionMode,
  selection: MeshComponentSubSelectionView,
): boolean {
  if (mode === 'VERTEX') return selection.vertexIds.size > 0;
  if (mode === 'EDGE') return selection.edgeIds.size > 0;
  return selection.faceIds.size > 0;
}
