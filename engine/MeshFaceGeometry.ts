/**
 * Logical-face triangle extraction used by filled component highlights.
 *
 * Face identity comes from logical topology via triangleToFaceIndex. When a
 * mapping is unavailable, triangle ids are treated as face ids as a safe
 * triangle-soup fallback, matching the rest of the mesh editing stack.
 */

export type MeshFaceElementIndexArray = Uint16Array | Uint32Array;

export interface MeshFaceTriangleIndexData {
  indices: MeshFaceElementIndexArray;
  useUint32: boolean;
  triangleCount: number;
}

export type MeshFaceRgba = { r: number; g: number; b: number; a: number };

/** Soft fills complement the stronger boundary-edge selection colors. */
export const MESH_FACE_COLORS = {
  selected: { r: 1.0, g: 0.78, b: 0.08, a: 0.2 } satisfies MeshFaceRgba,
  hovered: { r: 1.0, g: 0.58, b: 0.08, a: 0.12 } satisfies MeshFaceRgba,
} as const;

export function buildMeshFaceTriangleIndices(
  sourceIndices: ArrayLike<number>,
  triangleToFaceIndex: ArrayLike<number> | undefined,
  faceIds: Iterable<number>,
  preferUint32: boolean = false,
): MeshFaceTriangleIndexData {
  const selected = new Set<number>();
  for (const faceId of faceIds) {
    if (Number.isInteger(faceId) && faceId >= 0) selected.add(faceId);
  }

  const values: number[] = [];
  const triangleCount = Math.floor(sourceIndices.length / 3);
  const hasLogicalMapping = !!triangleToFaceIndex && triangleToFaceIndex.length === triangleCount;
  let maxIndex = 0;

  for (let triangleId = 0; triangleId < triangleCount; triangleId += 1) {
    const faceId = hasLogicalMapping ? triangleToFaceIndex![triangleId] : triangleId;
    if (!selected.has(faceId)) continue;

    const base = triangleId * 3;
    const a = sourceIndices[base];
    const b = sourceIndices[base + 1];
    const c = sourceIndices[base + 2];
    if (![a, b, c].every(Number.isFinite)) continue;
    values.push(a, b, c);
    maxIndex = Math.max(maxIndex, a, b, c);
  }

  const useUint32 = preferUint32 || maxIndex > 65535;
  return {
    indices: useUint32 ? new Uint32Array(values) : new Uint16Array(values),
    useUint32,
    triangleCount: values.length / 3,
  };
}
