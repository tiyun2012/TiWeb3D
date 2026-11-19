import type { Vector3 } from '@/types';

type Vec2 = { x: number; y: number };

const EPSILON = 1e-10;

const dot3 = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const subtract3 = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross3 = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const subtract2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const cross2 = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

const normalize3 = (vector: Vector3, label: string): Vector3 => {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (!Number.isFinite(length) || length <= 1e-8) throw new Error(`${label} is degenerate.`);
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
};

/**
 * Newell normal for an ordered planar polygon. This is orientation-independent:
 * horizontal, vertical and sloped faces use the exact same contract.
 */
export const computePlanarFaceNormal = (positions: readonly Vector3[]): Vector3 => {
  if (positions.length < 3) throw new Error('A planar face requires at least 3 positions.');
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < positions.length; i += 1) {
    const current = positions[i];
    const next = positions[(i + 1) % positions.length];
    nx += (current.y - next.y) * (current.z + next.z);
    ny += (current.z - next.z) * (current.x + next.x);
    nz += (current.x - next.x) * (current.y + next.y);
  }
  return normalize3({ x: nx, y: ny, z: nz }, 'Face normal');
};


/**
 * Relative inset for any ordered logical face, including non-planar faces.
 * Each boundary vertex moves toward the arithmetic face center by `ratio`.
 * This is a uniform 3D scale about the face center, so it preserves the
 * boundary shape/winding without requiring a projection plane.
 *
 * ratio must be strictly between 0 and 1. The editor intentionally exposes a
 * narrower 0.005..0.99 range so the new inner boundary never becomes visually
 * indistinguishable from either the source boundary or the center.
 */
export const computeRelativeInsetPositions = (
  positions: readonly Vector3[],
  ratio: number,
): Vector3[] => {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) {
    throw new Error('Inset ratio must be greater than 0 and less than 1.');
  }
  if (positions.length < 3) throw new Error('Inset requires a face with at least 3 vertices.');

  const center = positions.reduce<Vector3>(
    (sum, position) => ({
      x: sum.x + position.x,
      y: sum.y + position.y,
      z: sum.z + position.z,
    }),
    { x: 0, y: 0, z: 0 },
  );
  center.x /= positions.length;
  center.y /= positions.length;
  center.z /= positions.length;

  return positions.map(position => ({
    x: position.x + (center.x - position.x) * ratio,
    y: position.y + (center.y - position.y) * ratio,
    z: position.z + (center.z - position.z) * ratio,
  }));
};

/**
 * Constant-width inset for an ordered planar convex polygon in arbitrary 3D
 * orientation. The polygon is projected into a stable local 2D face basis,
 * inset there, and lifted back to the original plane.
 *
 * Collinear boundary vertices are allowed. They commonly appear after Split
 * Edge and should not make a valid wall/roof face impossible to inset.
 */
export const computePlanarInsetPositions = (
  positions: readonly Vector3[],
  amount: number,
): Vector3[] => {
  if (!Number.isFinite(amount) || amount <= 1e-8) {
    throw new Error('Inset amount must be a finite positive number.');
  }
  if (positions.length < 3) throw new Error('Inset requires a face with at least 3 vertices.');

  const normal = computePlanarFaceNormal(positions);
  const origin = positions[0];

  // Use the longest boundary edge for the in-plane X basis. This is more
  // numerically stable than depending on whichever vertex happens to come first.
  let u: Vector3 | null = null;
  let longestEdge = 0;
  for (let i = 0; i < positions.length; i += 1) {
    const edge = subtract3(positions[(i + 1) % positions.length], positions[i]);
    const length = Math.hypot(edge.x, edge.y, edge.z);
    if (length > longestEdge) {
      longestEdge = length;
      u = { x: edge.x / length, y: edge.y / length, z: edge.z / length };
    }
  }
  if (!u || longestEdge <= 1e-8) throw new Error('Inset face has no valid edge direction.');

  const v = normalize3(cross3(normal, u), 'Inset face basis');
  const projected: Vec2[] = positions.map(position => {
    const delta = subtract3(position, origin);
    return { x: dot3(delta, u!), y: dot3(delta, v) };
  });

  const spatialExtent = positions.reduce((max, position) => {
    const delta = subtract3(position, origin);
    return Math.max(max, Math.hypot(delta.x, delta.y, delta.z));
  }, 1);
  const planeTolerance = Math.max(1e-6, spatialExtent * 1e-6);
  for (const position of positions) {
    const planeDistance = Math.abs(dot3(subtract3(position, origin), normal));
    if (planeDistance > planeTolerance) throw new Error('Inset requires a planar logical face.');
  }

  let twiceArea = 0;
  for (let i = 0; i < projected.length; i += 1) {
    twiceArea += cross2(projected[i], projected[(i + 1) % projected.length]);
  }
  if (Math.abs(twiceArea) <= EPSILON) throw new Error('Inset face area is degenerate.');
  const orientation = twiceArea > 0 ? 1 : -1;

  // Convex faces may contain collinear split points. Negative turns are the
  // actual unsupported case; zero turns simply continue the same boundary line.
  for (let i = 0; i < projected.length; i += 1) {
    const a = projected[i];
    const b = projected[(i + 1) % projected.length];
    const c = projected[(i + 2) % projected.length];
    const turn = cross2(subtract2(b, a), subtract2(c, b)) * orientation;
    if (turn < -1e-8) throw new Error('Inset currently supports convex logical faces only.');
  }

  const offsetLines = projected.map((point, index) => {
    const next = projected[(index + 1) % projected.length];
    const edge = subtract2(next, point);
    const length = Math.hypot(edge.x, edge.y);
    if (length <= 1e-8) throw new Error('Inset face contains a zero-length edge.');
    const direction = { x: edge.x / length, y: edge.y / length };
    const inward = {
      x: -direction.y * orientation,
      y: direction.x * orientation,
    };
    return {
      point: { x: point.x + inward.x * amount, y: point.y + inward.y * amount },
      direction,
    };
  });

  const inset2d: Vec2[] = [];
  for (let i = 0; i < projected.length; i += 1) {
    const previous = offsetLines[(i - 1 + offsetLines.length) % offsetLines.length];
    const current = offsetLines[i];
    const denominator = cross2(previous.direction, current.direction);
    if (Math.abs(denominator) <= EPSILON) {
      const directionDot = previous.direction.x * current.direction.x + previous.direction.y * current.direction.y;
      if (directionDot > 1 - 1e-8) {
        // A Split Edge can leave a straight boundary vertex. Both offset lines
        // are the same line; the outgoing edge's shifted vertex is the correct
        // inset point and preserves the boundary vertex for downstream editing.
        inset2d.push({ ...current.point });
        continue;
      }
      throw new Error('Inset face contains a backtracking boundary vertex.');
    }
    const delta = subtract2(current.point, previous.point);
    const t = cross2(delta, current.direction) / denominator;
    inset2d.push({
      x: previous.point.x + previous.direction.x * t,
      y: previous.point.y + previous.direction.y * t,
    });
  }

  let insetTwiceArea = 0;
  for (let i = 0; i < inset2d.length; i += 1) {
    insetTwiceArea += cross2(inset2d[i], inset2d[(i + 1) % inset2d.length]);
  }
  if (insetTwiceArea * orientation <= EPSILON) throw new Error('Inset amount is too large for this face.');

  for (const point of inset2d) {
    for (let i = 0; i < projected.length; i += 1) {
      const a = projected[i];
      const b = projected[(i + 1) % projected.length];
      const side = cross2(subtract2(b, a), subtract2(point, a)) * orientation;
      if (side < -1e-7) throw new Error('Inset amount is too large for this face.');
    }
  }

  return inset2d.map(point => ({
    x: origin.x + u!.x * point.x + v.x * point.y,
    y: origin.y + u!.y * point.x + v.y * point.y,
    z: origin.z + u!.z * point.x + v.z * point.y,
  }));
};
