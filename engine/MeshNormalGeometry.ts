import { computePlanarFaceNormal } from '@/engine/mesh-editing/MeshPlanarGeometry';
import type { Vector3 } from '@/types';

const readPosition = (vertices: ArrayLike<number>, vertexId: number): Vector3 => ({
  x: vertices[vertexId * 3] ?? 0,
  y: vertices[vertexId * 3 + 1] ?? 0,
  z: vertices[vertexId * 3 + 2] ?? 0,
});

/** Build GL_LINES vertices showing each stored mesh vertex normal. */
export const buildVertexNormalLines = (
  vertices: ArrayLike<number>,
  normals: ArrayLike<number>,
  size: number,
): Float32Array => {
  if (!Number.isFinite(size) || size <= 0) return new Float32Array();
  const vertexCount = Math.min(Math.floor(vertices.length / 3), Math.floor(normals.length / 3));
  const out = new Float32Array(vertexCount * 6);
  let cursor = 0;
  for (let vertexId = 0; vertexId < vertexCount; vertexId += 1) {
    const offset = vertexId * 3;
    const x = vertices[offset] ?? 0;
    const y = vertices[offset + 1] ?? 0;
    const z = vertices[offset + 2] ?? 0;
    const nx = normals[offset] ?? 0;
    const ny = normals[offset + 1] ?? 0;
    const nz = normals[offset + 2] ?? 0;
    const length = Math.hypot(nx, ny, nz);
    const scale = length > 1e-8 ? size / length : 0;
    out[cursor++] = x; out[cursor++] = y; out[cursor++] = z;
    out[cursor++] = x + nx * scale; out[cursor++] = y + ny * scale; out[cursor++] = z + nz * scale;
  }
  return out;
};

/** Build one center->normal GL_LINES segment per logical polygon face. */
export const buildFaceNormalLines = (
  vertices: ArrayLike<number>,
  faces: readonly (readonly number[])[] | undefined,
  size: number,
): Float32Array => {
  if (!faces?.length || !Number.isFinite(size) || size <= 0) return new Float32Array();
  const lines: number[] = [];
  for (const face of faces) {
    if (face.length < 3) continue;
    const positions = face.map(vertexId => readPosition(vertices, vertexId));
    let normal: Vector3;
    try {
      normal = computePlanarFaceNormal(positions);
    } catch {
      continue;
    }
    const center = positions.reduce(
      (sum, position) => ({ x: sum.x + position.x, y: sum.y + position.y, z: sum.z + position.z }),
      { x: 0, y: 0, z: 0 },
    );
    center.x /= positions.length;
    center.y /= positions.length;
    center.z /= positions.length;
    lines.push(
      center.x, center.y, center.z,
      center.x + normal.x * size,
      center.y + normal.y * size,
      center.z + normal.z * size,
    );
  }
  return new Float32Array(lines);
};
