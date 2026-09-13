/**
 * Canonical polygon-edge extraction used by every mesh viewport/overlay.
 *
 * The logical topology (polygon faces) wins when available so triangulation
 * diagonals are not rendered as authored polygon edges. Triangle indices are
 * only used as a fallback for assets without logical topology.
 */

export type MeshElementIndexArray = Uint16Array | Uint32Array;

export interface MeshEdgeIndexData {
  indices: MeshElementIndexArray;
  useUint32: boolean;
  edgeCount: number;
}

export type MeshEdgeRgb = { r: number; g: number; b: number };
export type MeshEdgeRgba = MeshEdgeRgb & { a: number };

/** Shared visual defaults. User-configurable object-selection color may override these. */
export const MESH_EDGE_COLORS = {
  wireframe: { r: 0.62, g: 0.68, b: 0.76, a: 0.58 } satisfies MeshEdgeRgba,
  dim: { r: 0.3, g: 0.3, b: 0.35 } satisfies MeshEdgeRgb,
  selected: { r: 1.0, g: 1.0, b: 0.0 } satisfies MeshEdgeRgb,
  hovered: { r: 1.0, g: 0.78, b: 0.15 } satisfies MeshEdgeRgb,
} as const;

export function meshEdgeKey(a: number, b: number): string {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return `${lo}-${hi}`;
}


export function meshEdgePairFromKey(key: string): [number, number] | null {
  const separator = key.indexOf('-');
  if (separator <= 0 || separator >= key.length - 1) return null;
  const a = Number(key.slice(0, separator));
  const b = Number(key.slice(separator + 1));
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) return null;
  return a < b ? [a, b] : [b, a];
}

export function buildMeshEdgeIndicesFromKeys(
  keys: Iterable<string>,
  preferUint32: boolean = false,
): MeshEdgeIndexData {
  const values: number[] = [];
  const seen = new Set<string>();
  let maxIndex = 0;

  for (const key of keys) {
    const pair = meshEdgePairFromKey(key);
    if (!pair) continue;
    const canonical = meshEdgeKey(pair[0], pair[1]);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    values.push(pair[0], pair[1]);
    maxIndex = Math.max(maxIndex, pair[0], pair[1]);
  }

  const useUint32 = preferUint32 || maxIndex > 65535;
  return {
    indices: useUint32 ? new Uint32Array(values) : new Uint16Array(values),
    useUint32,
    edgeCount: values.length / 2,
  };
}

/** Collects all authored boundary edges that belong to the provided logical face ids. */
export function collectFaceEdgeKeys(
  faces: readonly (readonly number[])[] | undefined,
  faceIds: Iterable<number>,
): Set<string> {
  const keys = new Set<string>();
  if (!faces) return keys;

  for (const faceId of faceIds) {
    const face = faces[faceId];
    if (!face || face.length < 2) continue;
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      if (a === b) continue;
      keys.add(meshEdgeKey(a, b));
    }
  }
  return keys;
}

/**
 * Visits each undirected polygon edge exactly once.
 * Degenerate edges are skipped.
 */
export function forEachUniqueMeshEdge(
  indices: ArrayLike<number>,
  faces: readonly (readonly number[])[] | undefined,
  visit: (a: number, b: number, key: string) => void,
): void {
  const seen = new Set<string>();

  const emit = (a: number, b: number) => {
    if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return;
    const key = meshEdgeKey(a, b);
    if (seen.has(key)) return;
    seen.add(key);
    visit(Math.min(a, b), Math.max(a, b), key);
  };

  if (faces && faces.length > 0) {
    for (const face of faces) {
      if (!face || face.length < 2) continue;
      for (let i = 0; i < face.length; i++) {
        emit(face[i], face[(i + 1) % face.length]);
      }
    }
    return;
  }

  // Fallback: triangle soup. This necessarily includes triangulation diagonals
  // because no authored polygon topology is available.
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    emit(a, b);
    emit(b, c);
    emit(c, a);
  }
}

export function buildMeshEdgeIndices(
  indices: MeshElementIndexArray,
  faces?: readonly (readonly number[])[],
): MeshEdgeIndexData {
  const values: number[] = [];
  let maxIndex = 0;

  forEachUniqueMeshEdge(indices, faces, (a, b) => {
    values.push(a, b);
    if (a > maxIndex) maxIndex = a;
    if (b > maxIndex) maxIndex = b;
  });

  const useUint32 = indices instanceof Uint32Array || maxIndex > 65535;
  return {
    indices: useUint32 ? new Uint32Array(values) : new Uint16Array(values),
    useUint32,
    edgeCount: values.length / 2,
  };
}
