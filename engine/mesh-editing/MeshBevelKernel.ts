import type { StaticMeshConstructionData, Vector3 } from '@/types';
import { computePlanarFaceNormal } from './MeshPlanarGeometry';

const EPSILON = 1e-8;
const PARALLEL_EPSILON = 1e-8;
const OVERLAP_LIMIT = 0.98;
const BLENDER_EPSILON_ANGLE = Math.PI / 90; // 2 degrees.
const BLENDER_SMALL_ANGLE = Math.PI / 18; // 10 degrees.

/**
 * Signals topology that the joint planner intentionally does not own yet.
 * Callers may fall back to the legacy single-edge path only when the selected
 * edges are vertex-disjoint; connected selections must never be decomposed.
 */
export class BevelKernelUnsupportedTopologyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BevelKernelUnsupportedTopologyError';
  }
}


/** Width-dependent geometric collision. The public planner may reduce the
 * requested width and retry when Clamp Overlap is enabled. */
class BevelKernelCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BevelKernelCollisionError';
  }
}

const edgeKey = (a: string, b: string): string => a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
const cornerKey = (faceId: string, vertexId: string): string => `${faceId}\u0000${vertexId}`;

const add3 = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub3 = (a: Vector3, b: Vector3): Vector3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale3 = (v: Vector3, scale: number): Vector3 => ({ x: v.x * scale, y: v.y * scale, z: v.z * scale });
const dot3 = (a: Vector3, b: Vector3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross3 = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length3 = (v: Vector3): number => Math.hypot(v.x, v.y, v.z);
const normalize3 = (v: Vector3, label: string): Vector3 => {
  const length = length3(v);
  if (!Number.isFinite(length) || length <= EPSILON) throw new Error(`${label} is degenerate.`);
  return scale3(v, 1 / length);
};
const midpoint3 = (a: Vector3, b: Vector3): Vector3 => scale3(add3(a, b), 0.5);
const lerp3 = (a: Vector3, b: Vector3, t: number): Vector3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

const negate3 = (v: Vector3): Vector3 => ({ x: -v.x, y: -v.y, z: -v.z });

type ProfileSample = { x: number; y: number };

/**
 * Blender maps the user-facing Profile value onto a superellipse exponent.
 * 0.25 is the straight chamfer (r=1), 0.5 is circular (r=2), and values above
 * 0.5 progressively square the profile outward. Keep the same mapping so the
 * API can grow toward Blender-compatible profile controls without changing the
 * meaning of values introduced with the first segmented-bevel milestone.
 */
const profileSuperellipseExponent = (profile: number): number => {
  if (profile >= 0.999999) return 1e4;
  if (profile <= 0.000001) return 1e-4;
  const exponent = -Math.log(2) / Math.log(Math.sqrt(profile));
  if (!Number.isFinite(exponent)) return 2;
  return Math.max(1e-4, Math.min(1e4, exponent));
};

const buildEvenProfileSamples = (segments: number, profile: number): ProfileSample[] => {
  if (segments <= 1) return [{ x: 0, y: 1 }, { x: 1, y: 0 }];
  const exponent = profileSuperellipseExponent(profile);
  const power = 2 / exponent;
  const denseCount = Math.max(96, Math.min(4096, segments * 48));
  const dense: ProfileSample[] = [];
  const cumulative: number[] = [0];

  for (let index = 0; index <= denseCount; index += 1) {
    const theta = (Math.PI * 0.5 * index) / denseCount;
    const sin = Math.max(0, Math.sin(theta));
    const cos = Math.max(0, Math.cos(theta));
    const sample = {
      x: index === 0 ? 0 : index === denseCount ? 1 : Math.pow(sin, power),
      y: index === 0 ? 1 : index === denseCount ? 0 : Math.pow(cos, power),
    };
    dense.push(sample);
    if (index > 0) {
      const previous = dense[index - 1];
      cumulative.push(cumulative[index - 1] + Math.hypot(sample.x - previous.x, sample.y - previous.y));
    }
  }

  const total = cumulative[cumulative.length - 1];
  if (!Number.isFinite(total) || total <= EPSILON) {
    return Array.from({ length: segments + 1 }, (_, index) => ({
      x: index / segments,
      y: 1 - index / segments,
    }));
  }

  const result: ProfileSample[] = [{ x: 0, y: 1 }];
  let denseIndex = 1;
  for (let segment = 1; segment < segments; segment += 1) {
    const target = total * segment / segments;
    while (denseIndex < cumulative.length - 1 && cumulative[denseIndex] < target) denseIndex += 1;
    const before = denseIndex - 1;
    const span = cumulative[denseIndex] - cumulative[before];
    const t = span <= EPSILON ? 0 : (target - cumulative[before]) / span;
    result.push({
      x: dense[before].x + (dense[denseIndex].x - dense[before].x) * t,
      y: dense[before].y + (dense[denseIndex].y - dense[before].y) * t,
    });
  }
  result.push({ x: 1, y: 0 });
  return result;
};

/** Closest point on the first infinite line to the second infinite line. */
const closestPointBetweenLines = (
  linePoint: Vector3,
  lineDirection: Vector3,
  otherPoint: Vector3,
  otherDirection: Vector3,
): Vector3 | null => {
  const a = dot3(lineDirection, lineDirection);
  const b = dot3(lineDirection, otherDirection);
  const c = dot3(otherDirection, otherDirection);
  if (a <= EPSILON || c <= EPSILON) return null;
  const delta = sub3(linePoint, otherPoint);
  const d = dot3(lineDirection, delta);
  const e = dot3(otherDirection, delta);
  const denominator = a * c - b * b;
  if (Math.abs(denominator) <= 1e-10 * Math.max(1, a * c)) return null;
  const t = (b * e - c * d) / denominator;
  return add3(linePoint, scale3(lineDirection, t));
};

/**
 * Map Blender's normalized first-quadrant profile sample into the sheared
 * parallelogram defined by start -> middle -> end. This is the affine form of
 * Blender's make_unit_square_map(): (0,1)=start, (1,1)=middle, (1,0)=end.
 */
const mapProfileSample = (
  start: Vector3,
  middle: Vector3,
  end: Vector3,
  sample: ProfileSample,
): Vector3 => {
  const origin = sub3(add3(start, end), middle);
  const xAxis = sub3(end, origin);
  const yAxis = sub3(start, origin);
  return add3(origin, add3(scale3(xAxis, sample.x), scale3(yAxis, sample.y)));
};

/**
 * Blender's offset_meet() deliberately prefers the plane formed by the two
 * incident boundary edges at a corner when a logical face is non-planar. The
 * whole-face normal is retained only to choose which side of that local plane
 * is the face's normal side. This avoids the skew/intersection error produced
 * by projecting every corner of a warped n-gon through one Newell plane.
 */
const buildLocalCornerFrame = (
  vertex: Vector3,
  previous: Vector3,
  next: Vector3,
  faceNormal: Vector3,
): { normal: Vector3; reflex: boolean } => {
  const incoming = normalize3(sub3(vertex, previous), 'Bevel incoming face edge');
  const outgoing = normalize3(sub3(next, vertex), 'Bevel outgoing face edge');
  const rawNormal = cross3(incoming, outgoing);
  const rawLength = length3(rawNormal);
  const alignment = Math.max(-1, Math.min(1, dot3(incoming, outgoing)));

  // A straight/near-straight split corner does not define a stable local plane.
  // Blender's offset_meet() uses the face normal for small angles (10 degrees)
  // because a cross-product normal becomes visually unstable long before the
  // vectors are numerically parallel.
  if (!Number.isFinite(rawLength)
    || rawLength <= 1e-7
    || alignment >= Math.cos(BLENDER_SMALL_ANGLE)) {
    return { normal: faceNormal, reflex: false };
  }

  const rawUnit = scale3(rawNormal, 1 / rawLength);
  const orientation = dot3(rawUnit, faceNormal);
  return {
    normal: orientation < 0 ? negate3(rawUnit) : rawUnit,
    reflex: orientation < -1e-8,
  };
};

export interface BevelKernelSelectedEdge {
  pointAId: string;
  pointBId: string;
}

export interface BevelKernelPoint {
  key: string;
  position: Vector3;
  sourcePointId: string;
}

export interface BevelKernelEdgePlan {
  edgeKey: string;
  pointAId: string;
  pointBId: string;
  forwardFaceId: string;
  reverseFaceId: string;
  /** Bevel quad in winding order: A-forward, A-reverse, B-reverse, B-forward. */
  bevelPointKeys: [string, string, string, string];
  /**
   * Profile rows at the two original edge endpoints, each ordered from the
   * forward incident face to the reverse incident face. Length is seg + 1.
   * Segments=1 therefore preserves the original two-point chamfer contract.
   */
  profilePointKeys: [string[], string[]];
  /** Long rails in the two original incident faces. */
  railPointKeys: [[string, string], [string, string]];
  endpointCornerKeys: [string[], string[]];
}

export interface BevelKernelCornerPlan {
  sourcePointId: string;
  selectedEdgeKeys: string[];
  boundaryPointKeys: string[];
}

export interface BevelKernelPlan {
  points: BevelKernelPoint[];
  replacements: Map<string, string[]>;
  edges: BevelKernelEdgePlan[];
  corners: BevelKernelCornerPlan[];
  requestedWidth: number;
  effectiveWidth: number;
  clamped: boolean;
  /** Number of polygon strips across every beveled edge profile. */
  segments: number;
  /** Blender-style superellipse shape parameter. 0.5 is circular. */
  profile: number;
}

interface FaceCorner {
  faceId: string;
  vertexId: string;
  prevId: string;
  nextId: string;
  /** Newell/original face orientation; used only to orient the local wedge normal. */
  faceNormal: Vector3;
  /**
   * Plane normal of the two boundary edges at this corner. Blender's bevel uses
   * the local cross-product plane for non-planar faces instead of forcing every
   * corner onto one averaged face plane.
   */
  normal: Vector3;
  /** True when the ordered face corner sweeps through an interior angle > 180 degrees. */
  reflex: boolean;
}

interface FaceSector {
  faceId: string;
  neighborAId: string;
  neighborBId: string;
}

interface VertexStar {
  vertexId: string;
  neighbors: string[];
  sectors: FaceSector[];
  /**
   * True when the incident face fan closes all the way around the vertex.
   * False means there is exactly one boundary gap, so `sectors` is a path
   * between the two boundary edges instead of a cycle.
   */
  closed: boolean;
}

interface GeneratedPointInternal extends BevelKernelPoint {
  edgeInset?: { edgeKey: string; endpointId: string; distance: number };
}

interface SolveResult {
  plan: BevelKernelPlan;
  overlapScale: number;
}

const findPoint = (construction: StaticMeshConstructionData, pointId: string): Vector3 => {
  const point = construction.points.find(candidate => candidate.id === pointId);
  if (!point) throw new Error(`Bevel could not resolve mesh vertex '${pointId}'.`);
  return point.position;
};

const lineIntersectionInPlane = (
  p1: Vector3,
  d1: Vector3,
  p2: Vector3,
  d2: Vector3,
  normal: Vector3,
): Vector3 | null => {
  const denominator = dot3(cross3(d1, d2), normal);
  if (Math.abs(denominator) <= PARALLEL_EPSILON) return null;
  const t = dot3(cross3(sub3(p2, p1), d2), normal) / denominator;
  return add3(p1, scale3(d1, t));
};


type Vec2 = { x: number; y: number };
const sub2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
const cross2 = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

const projectDominant = (position: Vector3, normal: Vector3): Vec2 => {
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);
  if (ax >= ay && ax >= az) return { x: position.y, y: position.z };
  if (ay >= ax && ay >= az) return { x: position.x, y: position.z };
  return { x: position.x, y: position.y };
};

const polygonSignedArea2 = (points: readonly Vec2[]): number => {
  let area2 = 0;
  for (let index = 0; index < points.length; index += 1) {
    area2 += cross2(points[index], points[(index + 1) % points.length]);
  }
  return area2;
};

const orient2 = (a: Vec2, b: Vec2, c: Vec2): number => cross2(sub2(b, a), sub2(c, a));
const onSegment2 = (a: Vec2, b: Vec2, p: Vec2, epsilon: number): boolean => (
  Math.abs(orient2(a, b, p)) <= epsilon
  && p.x >= Math.min(a.x, b.x) - epsilon
  && p.x <= Math.max(a.x, b.x) + epsilon
  && p.y >= Math.min(a.y, b.y) - epsilon
  && p.y <= Math.max(a.y, b.y) + epsilon
);

const segmentsIntersect2 = (a: Vec2, b: Vec2, c: Vec2, d: Vec2, epsilon: number): boolean => {
  const o1 = orient2(a, b, c);
  const o2 = orient2(a, b, d);
  const o3 = orient2(c, d, a);
  const o4 = orient2(c, d, b);
  if (((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon))
    && ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon))) return true;
  return (Math.abs(o1) <= epsilon && onSegment2(a, b, c, epsilon))
    || (Math.abs(o2) <= epsilon && onSegment2(a, b, d, epsilon))
    || (Math.abs(o3) <= epsilon && onSegment2(c, d, a, epsilon))
    || (Math.abs(o4) <= epsilon && onSegment2(c, d, b, epsilon));
};

const polygonIsSimple2 = (points: readonly Vec2[], epsilon: number): boolean => {
  if (points.length < 3) return false;
  for (let i = 0; i < points.length; i += 1) {
    const i2 = (i + 1) % points.length;
    for (let j = i + 1; j < points.length; j += 1) {
      const j2 = (j + 1) % points.length;
      if (i === j || i2 === j || j2 === i) continue;
      if (i === 0 && j2 === 0) continue;
      if (segmentsIntersect2(points[i], points[i2], points[j], points[j2], epsilon)) return false;
    }
  }
  return true;
};

/**
 * Check reconstructed logical face boundaries before mutation. Blender's clamp
 * pass limits the bevel before topology is emitted; doing the same here avoids
 * committing a bow-tie / collapsed n-gon and then discovering the problem in
 * the render triangulator. Existing non-simple projections are ignored so this
 * validator never rejects unrelated pre-existing modeling damage.
 */
const validateReconstructedFaces = (
  construction: StaticMeshConstructionData,
  replacements: Map<string, string[]>,
  generatedByKey: Map<string, GeneratedPointInternal>,
): void => {
  for (const face of construction.faces) {
    const original3 = face.pointIds.map(pointId => findPoint(construction, pointId));
    const faceNormal = computePlanarFaceNormal(original3);
    const original2 = original3.map(position => projectDominant(position, faceNormal));
    const scale = original2.reduce((value, point) => Math.max(value, Math.abs(point.x), Math.abs(point.y)), 1);
    const epsilon = Math.max(1e-9, scale * 1e-9);
    const originalArea = polygonSignedArea2(original2);
    if (Math.abs(originalArea) <= epsilon || !polygonIsSimple2(original2, epsilon)) continue;

    let changed = false;
    const planned3: Vector3[] = [];
    for (const pointId of face.pointIds) {
      const keys = replacements.get(cornerKey(face.id, pointId));
      if (!keys) {
        planned3.push(findPoint(construction, pointId));
        continue;
      }
      changed = true;
      for (const key of keys) {
        const generated = generatedByKey.get(key);
        if (!generated) throw new Error(`Bevel face validation lost planned point '${key}'.`);
        planned3.push(generated.position);
      }
    }
    if (!changed) continue;

    // Reject coincident consecutive vertices before semantic ids are allocated.
    for (let index = 0; index < planned3.length; index += 1) {
      if (length3(sub3(planned3[index], planned3[(index + 1) % planned3.length])) <= 1e-8) {
        throw new BevelKernelCollisionError(`Bevel would collapse logical face '${face.id}'.`);
      }
    }

    const planned2 = planned3.map(position => projectDominant(position, faceNormal));
    const plannedArea = polygonSignedArea2(planned2);
    if (Math.abs(plannedArea) <= epsilon || plannedArea * originalArea <= 0) {
      throw new BevelKernelCollisionError(`Bevel would invert logical face '${face.id}'.`);
    }
    if (!polygonIsSimple2(planned2, epsilon)) {
      throw new BevelKernelCollisionError(`Bevel would self-intersect logical face '${face.id}'.`);
    }
  }
};

const faceOffsetLine = (
  construction: StaticMeshConstructionData,
  corner: FaceCorner,
  neighborId: string,
  width: number,
): { point: Vector3; direction: Vector3 } => {
  const vertex = findPoint(construction, corner.vertexId);
  let direction: Vector3;
  if (neighborId === corner.prevId) {
    direction = normalize3(sub3(vertex, findPoint(construction, corner.prevId)), 'Bevel face edge');
  }
  else if (neighborId === corner.nextId) {
    direction = normalize3(sub3(findPoint(construction, corner.nextId), vertex), 'Bevel face edge');
  }
  else {
    throw new Error('Bevel corner/face incidence is inconsistent.');
  }
  const inward = normalize3(cross3(corner.normal, direction), 'Bevel face inward direction');
  return { point: add3(vertex, scale3(inward, width)), direction };
};

/**
 * Blender's special edgecount==2 terminal branch uses `offset_in_plane()` with
 * the actual incident BMFace normal.  That is intentionally different from
 * the general offset-meet path above, where a local edge-cross plane is more
 * stable for warped n-gons.  Keeping this distinction matters when the two
 * faces around the selected edge are non-coplanar: the two terminal profile
 * sides must separate in their respective face planes instead of collapsing
 * onto the same artificial leg point.
 */
const terminalOffsetInFacePlane = (
  construction: StaticMeshConstructionData,
  corner: FaceCorner,
  selectedNeighborId: string,
  width: number,
): Vector3 => {
  const vertex = findPoint(construction, corner.vertexId);
  const neighbor = findPoint(construction, selectedNeighborId);
  const edgeRay = normalize3(sub3(neighbor, vertex), 'Bevel terminal selected edge');
  const faceNormal = normalize3(corner.faceNormal, 'Bevel terminal face normal');
  let inward: Vector3;
  if (corner.nextId === selectedNeighborId) {
    // Face boundary leaves the corner along the selected edge; interior is to
    // its left for the stored face winding.
    inward = normalize3(cross3(faceNormal, edgeRay), 'Bevel terminal face offset');
  }
  else if (corner.prevId === selectedNeighborId) {
    // Looking from the corner toward the previous vertex reverses the boundary
    // direction, so the interior is on the opposite side.
    inward = normalize3(cross3(edgeRay, faceNormal), 'Bevel terminal face offset');
  }
  else {
    throw new Error('Bevel terminal face/selected-edge incidence is inconsistent.');
  }
  return add3(vertex, scale3(inward, width));
};

const intersectSelectedPair = (
  construction: StaticMeshConstructionData,
  corner: FaceCorner,
  width: number,
): Vector3 => {
  const previous = faceOffsetLine(construction, corner, corner.prevId, width);
  const next = faceOffsetLine(construction, corner, corner.nextId, width);
  const intersection = lineIntersectionInPlane(previous.point, previous.direction, next.point, next.direction, corner.normal);
  if (intersection) return intersection;

  // Collinear Split-Edge continuation: both offset lines coincide. Keep the
  // boundary at the original split station but shifted by the common offset.
  const alignment = dot3(previous.direction, next.direction);
  if (alignment > 1 - 1e-6) return midpoint3(previous.point, next.point);
  throw new Error('Bevel selected edges form a backtracking or degenerate face corner.');
};

interface EdgeMeetCandidate {
  position: Vector3;
  distance: number;
  /** Unclamped distance along the original edge; used by overlap limiting. */
  rawDistance: number;
  /** Whether this is a geometrically usable meet rather than a clamp/fallback. */
  validMeet: boolean;
  /**
   * Most terminal meets lie on the unselected incident edge. Blender has an
   * important exception for a straight/near-straight face corner: the offset
   * line is parallel to the zero-offset neighbor, so the terminal boundary
   * point stays perpendicular to the selected edge instead of collapsing back
   * to the source vertex.
   */
  onUnselectedEdge: boolean;
}

const intersectSelectedWithUnselected = (
  construction: StaticMeshConstructionData,
  corner: FaceCorner,
  selectedNeighborId: string,
  unselectedNeighborId: string,
  width: number,
): EdgeMeetCandidate => {
  const vertex = findPoint(construction, corner.vertexId);
  const selected = faceOffsetLine(construction, corner, selectedNeighborId, width);
  const unselected = faceOffsetLine(construction, corner, unselectedNeighborId, 0);
  const neighbor = findPoint(construction, unselectedNeighborId);
  const edgeVector = sub3(neighbor, vertex);
  const edgeLength = length3(edgeVector);
  const ray = normalize3(edgeVector, 'Bevel neighboring edge');
  const alignment = Math.max(-1, Math.min(1, dot3(selected.direction, unselected.direction)));
  const angle = Math.acos(alignment);

  // Blender offset_meet() has a deliberate near-parallel branch at 2 degrees.
  // The mathematical intersection would run arbitrarily far down the zero-
  // offset neighboring edge as the corner approaches a straight continuation.
  // Instead, terminate the profile approximately perpendicular to the common
  // direction. This is especially common after Split Edge / repeated Bevel,
  // where a logical n-gon contains a nearly-collinear boundary vertex.
  if (angle < BLENDER_EPSILON_ANGLE) {
    const offsetVector = sub3(selected.point, vertex);
    const offsetLength = length3(offsetVector);
    const inward = offsetLength > EPSILON
      ? scale3(offsetVector, 1 / offsetLength)
      : normalize3(cross3(corner.normal, selected.direction), 'Bevel straight-terminal inward direction');
    const correctedDistance = width / Math.max(Math.cos(angle * 0.5), 1e-6);
    return {
      position: add3(vertex, scale3(inward, correctedDistance)),
      distance: 0,
      rawDistance: 0,
      validMeet: true,
      onUnselectedEdge: false,
    };
  }

  const intersection = lineIntersectionInPlane(selected.point, selected.direction, vertex, ray, corner.normal);
  if (!intersection) {
    if (alignment > 1 - 1e-6) {
      // Defensive fallback for numerical parallelism below the line solver's
      // denominator threshold. The normal 2-degree branch above owns this case.
      return {
        position: selected.point,
        distance: 0,
        rawDistance: 0,
        validMeet: true,
        onUnselectedEdge: false,
      };
    }

    if (alignment < -1 + 1e-6) {
      // Anti-parallel face edges describe Blender's zero-area/backtracking
      // special case. Keep a finite terminal by sliding along the real
      // neighbor segment rather than returning the source vertex.
      const distance = Math.min(width, edgeLength);
      return {
        position: add3(vertex, scale3(ray, distance)),
        distance,
        rawDistance: width,
        validMeet: distance < edgeLength - EPSILON,
        onUnselectedEdge: true,
      };
    }

    // Numerical parallelism that is neither cleanly aligned nor opposed is not
    // a reliable line meet. Use the source as a clamp fallback and allow face
    // validation / width limiting to decide whether the network is usable.
    return { position: vertex, distance: 0, rawDistance: 0, validMeet: false, onUnselectedEdge: true };
  }
  const rawDistance = dot3(sub3(intersection, vertex), ray);
  if (!Number.isFinite(rawDistance)) throw new Error('Bevel terminal corner intersection is invalid.');

  // Blender's offset_meet() treats the unselected edge as a zero-offset edge.
  // When the mathematical offset intersection falls outside that *segment*, it
  // clamps to the nearer endpoint instead of rejecting the corner. This is
  // required for obtuse/reflex/non-planar terminal configurations and also
  // prevents a generated point from wandering beyond a short neighboring edge.
  if (rawDistance <= EPSILON) {
    return { position: vertex, distance: 0, rawDistance, validMeet: false, onUnselectedEdge: true };
  }
  if (rawDistance >= edgeLength - EPSILON) {
    return { position: neighbor, distance: edgeLength, rawDistance, validMeet: false, onUnselectedEdge: true };
  }
  return { position: intersection, distance: rawDistance, rawDistance, validMeet: true, onUnselectedEdge: true };
};

const buildTopologyIndex = (construction: StaticMeshConstructionData) => {
  const cornersByVertex = new Map<string, FaceCorner[]>();
  const cornersByFaceVertex = new Map<string, FaceCorner>();
  const edgeFaces = new Map<string, Array<{ faceId: string; fromId: string; toId: string }>>();

  for (const face of construction.faces) {
    if (face.pointIds.length < 3) throw new Error(`Bevel found degenerate logical face '${face.id}'.`);
    const positions = face.pointIds.map(pointId => findPoint(construction, pointId));
    const faceNormal = computePlanarFaceNormal(positions);
    for (let index = 0; index < face.pointIds.length; index += 1) {
      const vertexId = face.pointIds[index];
      const prevId = face.pointIds[(index - 1 + face.pointIds.length) % face.pointIds.length];
      const nextId = face.pointIds[(index + 1) % face.pointIds.length];
      const vertex = positions[index];
      const previous = positions[(index - 1 + positions.length) % positions.length];
      const next = positions[(index + 1) % positions.length];
      const local = buildLocalCornerFrame(vertex, previous, next, faceNormal);
      const corner: FaceCorner = {
        faceId: face.id,
        vertexId,
        prevId,
        nextId,
        faceNormal,
        normal: local.normal,
        reflex: local.reflex,
      };
      const entries = cornersByVertex.get(vertexId) ?? [];
      entries.push(corner);
      cornersByVertex.set(vertexId, entries);
      cornersByFaceVertex.set(cornerKey(face.id, vertexId), corner);

      const fromId = vertexId;
      const toId = nextId;
      const key = edgeKey(fromId, toId);
      const incidents = edgeFaces.get(key) ?? [];
      incidents.push({ faceId: face.id, fromId, toId });
      edgeFaces.set(key, incidents);
    }
  }

  return { cornersByVertex, cornersByFaceVertex, edgeFaces };
};

/**
 * Build the ordered one-ring used by the bevel planner.
 *
 * Blender does not require the touched vertex itself to be manifold-closed.
 * A selected edge still needs two incident faces, but one of its endpoints can
 * sit on a face-chain with one boundary gap (for example next to a recess or
 * an already-cut opening).  `bevel_vert_construct()` explicitly prefers a
 * one-face boundary edge as the start of that chain.
 *
 * Support the same common case here: either one closed ring or one open path.
 * Branching/non-manifold fans and multiple disconnected gaps remain rejected.
 */
const buildVertexStar = (vertexId: string, corners: FaceCorner[]): VertexStar => {
  type Link = { to: string; faceId: string };
  const adjacency = new Map<string, Link[]>();
  const add = (from: string, to: string, faceId: string) => {
    const links = adjacency.get(from) ?? [];
    links.push({ to, faceId });
    adjacency.set(from, links);
  };

  for (const corner of corners) {
    if (corner.prevId === corner.nextId || corner.prevId === vertexId || corner.nextId === vertexId) {
      throw new Error('Bevel vertex fan is degenerate.');
    }
    add(corner.prevId, corner.nextId, corner.faceId);
    add(corner.nextId, corner.prevId, corner.faceId);
  }

  const neighbors = Array.from(adjacency.keys());
  if (neighbors.length < 2) throw new Error('Bevel vertex has too few incident edges.');
  const degreeOne = neighbors.filter(neighborId => (adjacency.get(neighborId)?.length ?? 0) === 1);
  const invalidDegree = neighbors.some(neighborId => {
    const degree = adjacency.get(neighborId)?.length ?? 0;
    return degree < 1 || degree > 2;
  });
  if (invalidDegree || (degreeOne.length !== 0 && degreeOne.length !== 2)) {
    throw new BevelKernelUnsupportedTopologyError(
      'Joint bevel requires one closed face ring or one continuous open face fan at every touched vertex.',
    );
  }

  const closed = degreeOne.length === 0;
  // For an open fan, begin at a boundary edge so traversal never has to wrap
  // across the missing-face gap. This mirrors Blender choosing a one-face edge
  // as `first_bme` when ordering the edge halves.
  const startNeighbor = closed ? neighbors[0] : degreeOne[0];
  const orderedNeighbors: string[] = [startNeighbor];
  const sectors: FaceSector[] = [];
  let previous: string | null = null;
  let current = startNeighbor;
  const usedFaces = new Set<string>();

  while (true) {
    const links = adjacency.get(current)!;
    const nextLink = links.find(link => link.to !== previous && !usedFaces.has(link.faceId))
      ?? links.find(link => !usedFaces.has(link.faceId));
    if (!nextLink) break;
    usedFaces.add(nextLink.faceId);
    sectors.push({ faceId: nextLink.faceId, neighborAId: current, neighborBId: nextLink.to });
    previous = current;
    current = nextLink.to;
    if (closed && current === orderedNeighbors[0]) break;
    orderedNeighbors.push(current);
    if (orderedNeighbors.length > neighbors.length) throw new Error('Bevel vertex fan traversal did not terminate.');
  }

  const traversalComplete = closed
    ? current === orderedNeighbors[0]
    : degreeOne.includes(current);
  if (!traversalComplete || usedFaces.size !== corners.length || orderedNeighbors.length !== neighbors.length) {
    throw new Error('Bevel vertex fan is disconnected or non-manifold.');
  }
  if (closed && sectors.length !== orderedNeighbors.length) {
    throw new Error('Bevel closed vertex fan has inconsistent face sectors.');
  }
  if (!closed && sectors.length !== orderedNeighbors.length - 1) {
    throw new Error('Bevel open vertex fan has inconsistent face sectors.');
  }
  return { vertexId, neighbors: orderedNeighbors, sectors, closed };
};

const solveAtWidth = (
  construction: StaticMeshConstructionData,
  selectedEdges: readonly BevelKernelSelectedEdge[],
  requestedWidth: number,
  width: number,
  segments: number,
  profile: number,
): SolveResult => {
  const { cornersByVertex, cornersByFaceVertex, edgeFaces } = buildTopologyIndex(construction);
  const selectedKeys = new Set(selectedEdges.map(selected => edgeKey(selected.pointAId, selected.pointBId)));
  const touchedVertices = new Set(selectedEdges.flatMap(edge => [edge.pointAId, edge.pointBId]));

  for (const selected of selectedEdges) {
    const incidents = edgeFaces.get(edgeKey(selected.pointAId, selected.pointBId)) ?? [];
    if (incidents.length !== 2) throw new Error('Bevel requires every selected edge to have exactly two incident logical faces.');
    const forward = incidents.filter(item => item.fromId === selected.pointAId && item.toId === selected.pointBId);
    const reverse = incidents.filter(item => item.fromId === selected.pointBId && item.toId === selected.pointAId);
    if (forward.length !== 1 || reverse.length !== 1) {
      throw new Error('Bevel requires consistently wound manifold faces with opposite selected-edge directions.');
    }
  }

  const generatedByKey = new Map<string, GeneratedPointInternal>();
  const replacements = new Map<string, string[]>();
  const corners: BevelKernelCornerPlan[] = [];
  const canonicalKeyByKey = new Map<string, string>();
  // Rail endpoint per original face corner. Usually this is also the sole
  // replacement point for that corner, but Blender's edgecount==2 terminal
  // case replaces the source corner with TWO points (leg + profile side) while
  // the bevel strip must attach only to the profile-side point. Keep the rail
  // role explicit instead of inferring it from replacement-array length.
  const railPointKeyByFaceVertex = new Map<string, string>();
  const pointKeyForUnselected = (vertexId: string, neighborId: string) => `u:${vertexId}:${neighborId}`;
  const pointKeyForSelectedPair = (vertexId: string, faceId: string) => `f:${vertexId}:${faceId}`;
  const pointKeyForTerminalSide = (vertexId: string, faceId: string) => `t:${vertexId}:${faceId}`;
  const canonicalKey = (key: string): string => {
    let current = key;
    const visited = new Set<string>();
    while (canonicalKeyByKey.has(current) && !visited.has(current)) {
      visited.add(current);
      const next = canonicalKeyByKey.get(current)!;
      if (next === current) break;
      current = next;
    }
    return current;
  };

  for (const vertexId of touchedVertices) {
    const vertexCorners = cornersByVertex.get(vertexId) ?? [];
    const star = buildVertexStar(vertexId, vertexCorners);
    const vertexPosition = findPoint(construction, vertexId);
    const selectedNeighborSet = new Set(star.neighbors.filter(neighborId => selectedKeys.has(edgeKey(vertexId, neighborId))));
    if (selectedNeighborSet.size === 0) throw new Error('Bevel lost a selected edge at a touched vertex.');
    // Blender can order a touched vertex as one continuous face chain with a
    // single boundary gap. The common and well-defined edge-bevel case there
    // is a terminal selected edge (selcount==1). Multi-selected open fans need
    // the full gap-aware miter/VMesh rules, so keep those explicit rather than
    // silently closing geometry across a missing sector.
    if (!star.closed && selectedNeighborSet.size !== 1) {
      throw new BevelKernelUnsupportedTopologyError(
        'Joint bevel currently supports one selected edge at an open endpoint fan; multi-edge open-fan miters require the general VMesh path.',
      );
    }
    // Blender solves selcount==1 independently per BevVert. The edgecount==2
    // subcase is NOT a reason to fall back for the whole selected edge: it has
    // three boundary roles at this endpoint -- one profile-side point in each
    // incident face plus an artificial point slid along the lone unselected
    // edge. Keeping this inside the joint planner is essential when the other
    // endpoint has a different/high-valence fan.
    const twoEdgeTerminal = star.neighbors.length === 2 && selectedNeighborSet.size === 1;
    const terminalSelectedNeighborId = twoEdgeTerminal ? Array.from(selectedNeighborSet)[0] : null;
    const terminalUnselectedNeighborId = twoEdgeTerminal
      ? star.neighbors.find(neighborId => !selectedNeighborSet.has(neighborId)) ?? null
      : null;

    if (twoEdgeTerminal) {
      if (!terminalSelectedNeighborId || !terminalUnselectedNeighborId) {
        throw new Error('Bevel could not resolve the two-edge terminal fan.');
      }

      const legRay = normalize3(
        sub3(findPoint(construction, terminalUnselectedNeighborId), vertexPosition),
        'Bevel two-edge terminal leg',
      );
      const legKey = pointKeyForUnselected(vertexId, terminalUnselectedNeighborId);
      generatedByKey.set(legKey, {
        key: legKey,
        sourcePointId: vertexId,
        position: add3(vertexPosition, scale3(legRay, width)),
        edgeInset: {
          edgeKey: edgeKey(vertexId, terminalUnselectedNeighborId),
          endpointId: vertexId,
          distance: width,
        },
      });

      for (const faceCorner of vertexCorners) {
        const selectedIsPrev = faceCorner.prevId === terminalSelectedNeighborId;
        const selectedIsNext = faceCorner.nextId === terminalSelectedNeighborId;
        const unselectedIsPrev = faceCorner.prevId === terminalUnselectedNeighborId;
        const unselectedIsNext = faceCorner.nextId === terminalUnselectedNeighborId;
        if (!(selectedIsPrev || selectedIsNext) || !(unselectedIsPrev || unselectedIsNext)) {
          throw new Error('Bevel two-edge terminal face incidence is inconsistent.');
        }
        const sideKey = pointKeyForTerminalSide(vertexId, faceCorner.faceId);
        generatedByKey.set(sideKey, {
          key: sideKey,
          sourcePointId: vertexId,
          // Blender build_boundary_terminal_edge() uses offset_in_plane() for
          // these two profile sides rather than intersecting them back onto the
          // lone zero-offset edge.
          position: terminalOffsetInFacePlane(construction, faceCorner, terminalSelectedNeighborId, width),
        });
      }
    }
    else {
      // First solve one shared on-edge point for every unselected incident edge.
      for (let index = 0; index < star.neighbors.length; index += 1) {
      const neighborId = star.neighbors[index];
      if (selectedNeighborSet.has(neighborId)) continue;
      const candidates: EdgeMeetCandidate[] = [];
      const previousSector = index > 0
        ? star.sectors[index - 1]
        : (star.closed ? star.sectors[star.sectors.length - 1] : null);
      const nextSector = index < star.sectors.length
        ? star.sectors[index]
        : (star.closed ? star.sectors[index % star.sectors.length] : null);
      const previousNeighbor = index > 0
        ? star.neighbors[index - 1]
        : (star.closed ? star.neighbors[star.neighbors.length - 1] : null);
      const nextNeighbor = index + 1 < star.neighbors.length
        ? star.neighbors[index + 1]
        : (star.closed ? star.neighbors[0] : null);

      if (previousNeighbor && previousSector && selectedNeighborSet.has(previousNeighbor)) {
        const faceCorner = cornersByFaceVertex.get(cornerKey(previousSector.faceId, vertexId));
        if (!faceCorner) throw new Error('Bevel could not resolve a previous face corner.');
        candidates.push(intersectSelectedWithUnselected(construction, faceCorner, previousNeighbor, neighborId, width));
      }
      if (nextNeighbor && nextSector && selectedNeighborSet.has(nextNeighbor)) {
        const faceCorner = cornersByFaceVertex.get(cornerKey(nextSector.faceId, vertexId));
        if (!faceCorner) throw new Error('Bevel could not resolve a next face corner.');
        candidates.push(intersectSelectedWithUnselected(construction, faceCorner, nextNeighbor, neighborId, width));
      }

      const ray = normalize3(sub3(findPoint(construction, neighborId), vertexPosition), 'Bevel neighboring edge');
      let distance = width;
      let usageDistance = width;
      let position = add3(vertexPosition, scale3(ray, distance));
      if (candidates.length === 1) {
        // A clamped zero-offset meet is still Blender's chosen boundary point.
        // Keep its exact coordinate, not merely its scalar projection. This is
        // essential for the straight-terminal branch where the correct bound
        // point intentionally lies off the unselected edge.
        const candidate = candidates[0];
        distance = candidate.distance;
        position = candidate.position;
        usageDistance = candidate.onUnselectedEdge ? Math.max(0, candidate.rawDistance) : 0;
      }
      else if (candidates.length >= 2) {
        const validCandidates = candidates.filter(candidate => candidate.validMeet);
        if (validCandidates.length === 1) {
          // Blender's offset_on_edge_between keeps the one usable side when the
          // opposite side sees a reflex/invalid meet.
          const candidate = validCandidates[0];
          distance = candidate.distance;
          position = candidate.position;
          usageDistance = candidate.onUnselectedEdge ? Math.max(0, candidate.rawDistance) : 0;
        }
        else if (validCandidates.length >= 2) {
          const onEdgeCandidates = validCandidates.filter(candidate => candidate.onUnselectedEdge);
          if (onEdgeCandidates.length === validCandidates.length) {
            distance = validCandidates.reduce((sum, candidate) => sum + candidate.distance, 0) / validCandidates.length;
            position = add3(vertexPosition, scale3(ray, distance));
            usageDistance = validCandidates.reduce((sum, candidate) => sum + Math.max(0, candidate.rawDistance), 0) / validCandidates.length;
          }
          else {
            // Rare straight/parallel mixed case. Preserve the actual solved 3D
            // positions instead of projecting them back onto a rail where one
            // candidate is not supposed to lie.
            position = scale3(validCandidates.reduce((sum, candidate) => add3(sum, candidate.position), { x: 0, y: 0, z: 0 }), 1 / validCandidates.length);
            distance = Math.max(0, dot3(sub3(position, vertexPosition), ray));
            usageDistance = onEdgeCandidates.length === 0
              ? 0
              : onEdgeCandidates.reduce((sum, candidate) => sum + Math.max(0, candidate.rawDistance), 0) / onEdgeCandidates.length;
          }
        }
        else {
          // Neither side can meet the rail cleanly. Slide by the bevel amount;
          // the network overlap pass below will clamp against the opposite end.
          distance = width;
          usageDistance = width;
          position = add3(vertexPosition, scale3(ray, distance));
        }
      }
      const key = pointKeyForUnselected(vertexId, neighborId);
      generatedByKey.set(key, {
        key,
        sourcePointId: vertexId,
        position,
        edgeInset: { edgeKey: edgeKey(vertexId, neighborId), endpointId: vertexId, distance: usageDistance },
      });
    }

    // Faces between two selected edges need their own offset-line intersection.
      for (const sector of star.sectors) {
        const aSelected = selectedNeighborSet.has(sector.neighborAId);
        const bSelected = selectedNeighborSet.has(sector.neighborBId);
        if (!aSelected || !bSelected) continue;
        const faceCorner = cornersByFaceVertex.get(cornerKey(sector.faceId, vertexId));
        if (!faceCorner) throw new Error('Bevel could not resolve a selected-pair face corner.');
        const key = pointKeyForSelectedPair(vertexId, sector.faceId);
        generatedByKey.set(key, {
          key,
          sourcePointId: vertexId,
          position: intersectSelectedPair(construction, faceCorner, width),
        });
      }
    }

    // Several different boundary roles can collapse to the same geometric
    // point at difficult corners. Blender's VMesh stores equivalent entries as
    // the same BMVert rather than leaving coincident duplicates. Canonicalize
    // only points generated from this one original vertex, which is topology-
    // safe and avoids accidentally welding coincident but separate mesh shells.
    const localKeys = Array.from(generatedByKey.entries())
      .filter(([, point]) => point.sourcePointId === vertexId)
      .map(([key]) => key);
    const incidentLengths = star.neighbors.map(neighborId => length3(sub3(findPoint(construction, neighborId), vertexPosition)));
    const localScale = incidentLengths.length > 0 ? Math.max(EPSILON, Math.min(...incidentLengths)) : Math.max(width, 1);
    const weldTolerance = Math.max(1e-9, Math.min(Math.max(width, EPSILON) * 1e-5, localScale * 1e-7));
    for (let index = 0; index < localKeys.length; index += 1) {
      const key = localKeys[index];
      if (canonicalKeyByKey.has(key)) continue;
      canonicalKeyByKey.set(key, key);
      const point = generatedByKey.get(key)!;
      for (let otherIndex = index + 1; otherIndex < localKeys.length; otherIndex += 1) {
        const otherKey = localKeys[otherIndex];
        if (canonicalKeyByKey.has(otherKey)) continue;
        const other = generatedByKey.get(otherKey)!;
        if (length3(sub3(point.position, other.position)) <= weldTolerance) {
          canonicalKeyByKey.set(otherKey, key);
        }
      }
    }

    // Reconstruct the original one-ring face corners. This is the topology step
    // that replaces the old source vertex exactly once for the whole selection.
    if (twoEdgeTerminal) {
      const selectedNeighborId = terminalSelectedNeighborId!;
      const unselectedNeighborId = terminalUnselectedNeighborId!;
      const legKey = canonicalKey(pointKeyForUnselected(vertexId, unselectedNeighborId));
      const terminalBoundary: string[] = [];

      for (const faceCorner of vertexCorners) {
        const sideKey = canonicalKey(pointKeyForTerminalSide(vertexId, faceCorner.faceId));
        const selectedIsPrev = faceCorner.prevId === selectedNeighborId;
        const selectedIsNext = faceCorner.nextId === selectedNeighborId;
        const unselectedIsPrev = faceCorner.prevId === unselectedNeighborId;
        const unselectedIsNext = faceCorner.nextId === unselectedNeighborId;
        if (!(selectedIsPrev || selectedIsNext) || !(unselectedIsPrev || unselectedIsNext)) {
          throw new Error('Bevel two-edge terminal reconstruction is inconsistent.');
        }

        // Preserve the original face-boundary order: incoming unselected leg ->
        // profile side -> selected edge, or the reverse ordering on the other face.
        const keys = unselectedIsPrev && selectedIsNext
          ? [legKey, sideKey]
          : [sideKey, legKey];
        // The artificial leg point and one profile side can legitimately weld
        // at a right-angle/planar terminal. Blender then has two boundary roles
        // backed by one BMVert. Mirror the topology that will actually be
        // materialized instead of feeding duplicate canonical keys into face
        // validation (which would incorrectly look like a zero-length edge).
        const compactKeys = keys.filter((key, index) => index === 0 || key !== keys[index - 1]);
        replacements.set(cornerKey(faceCorner.faceId, vertexId), compactKeys);
        railPointKeyByFaceVertex.set(cornerKey(faceCorner.faceId, vertexId), sideKey);
        terminalBoundary.push(sideKey);
      }

      // build_boundary_terminal_edge() forms a triangle from the two profile
      // sides and the artificial leg point. Orientation is normalized later by
      // applyJointBevelPlan() against already-rebuilt neighboring faces.
      const boundary = terminalBoundary.length >= 2
        ? [terminalBoundary[0], legKey, terminalBoundary[1]]
        : [...terminalBoundary, legKey];
      const uniqueBoundary = boundary.filter((key, index) => boundary.indexOf(key) === index);
      corners.push({
        sourcePointId: vertexId,
        selectedEdgeKeys: [edgeKey(vertexId, selectedNeighborId)],
        boundaryPointKeys: uniqueBoundary,
      });
    }
    else {
      for (const faceCorner of vertexCorners) {
        const prevSelected = selectedKeys.has(edgeKey(vertexId, faceCorner.prevId));
        const nextSelected = selectedKeys.has(edgeKey(vertexId, faceCorner.nextId));
        let keys: string[];
        let railKey: string | null = null;
        if (prevSelected && nextSelected) {
          railKey = pointKeyForSelectedPair(vertexId, faceCorner.faceId);
          keys = [railKey];
        }
        else if (prevSelected) {
          railKey = pointKeyForUnselected(vertexId, faceCorner.nextId);
          keys = [railKey];
        }
        else if (nextSelected) {
          railKey = pointKeyForUnselected(vertexId, faceCorner.prevId);
          keys = [railKey];
        }
        else {
          keys = [
            pointKeyForUnselected(vertexId, faceCorner.prevId),
            pointKeyForUnselected(vertexId, faceCorner.nextId),
          ];
        }
        if (keys.some(key => !generatedByKey.has(key))) {
          throw new Error('Bevel failed to construct a complete corner boundary.');
        }
        const resolvedKeys = keys.map(canonicalKey);
        replacements.set(cornerKey(faceCorner.faceId, vertexId), resolvedKeys);
        if (railKey) {
          railPointKeyByFaceVertex.set(cornerKey(faceCorner.faceId, vertexId), canonicalKey(railKey));
        }
      }

      // Build the cyclic VMesh boundary analogue. Consecutive duplicates are welds
      // (Blender's M_NONE two-boundary-vertex case for two selected edges).
      const boundary: string[] = [];
      const pushBoundary = (key: string) => {
        const resolved = canonicalKey(key);
        if (boundary[boundary.length - 1] !== resolved) boundary.push(resolved);
      };
      for (const sector of star.sectors) {
        const aSelected = selectedNeighborSet.has(sector.neighborAId);
        const bSelected = selectedNeighborSet.has(sector.neighborBId);
        if (aSelected && bSelected) {
          pushBoundary(pointKeyForSelectedPair(vertexId, sector.faceId));
        }
        else if (aSelected) {
          pushBoundary(pointKeyForUnselected(vertexId, sector.neighborBId));
        }
        else if (bSelected) {
          pushBoundary(pointKeyForUnselected(vertexId, sector.neighborAId));
        }
        else {
          pushBoundary(pointKeyForUnselected(vertexId, sector.neighborAId));
          pushBoundary(pointKeyForUnselected(vertexId, sector.neighborBId));
        }
      }
      if (boundary.length > 1 && boundary[0] === boundary[boundary.length - 1]) boundary.pop();
      const uniqueBoundary = boundary.filter((key, index) => boundary.indexOf(key) === index);
      corners.push({
        sourcePointId: vertexId,
        selectedEdgeKeys: star.neighbors.filter(neighborId => selectedNeighborSet.has(neighborId)).map(neighborId => edgeKey(vertexId, neighborId)),
        boundaryPointKeys: uniqueBoundary,
      });
    }
  }

  const edgePlans: BevelKernelEdgePlan[] = selectedEdges.map(selected => {
    const key = edgeKey(selected.pointAId, selected.pointBId);
    const incidents = edgeFaces.get(key)!;
    const forward = incidents.find(item => item.fromId === selected.pointAId && item.toId === selected.pointBId)!;
    const reverse = incidents.find(item => item.fromId === selected.pointBId && item.toId === selected.pointAId)!;
    const aForward = railPointKeyByFaceVertex.get(cornerKey(forward.faceId, selected.pointAId));
    const aReverse = railPointKeyByFaceVertex.get(cornerKey(reverse.faceId, selected.pointAId));
    const bForward = railPointKeyByFaceVertex.get(cornerKey(forward.faceId, selected.pointBId));
    const bReverse = railPointKeyByFaceVertex.get(cornerKey(reverse.faceId, selected.pointBId));
    if (!aForward || !aReverse || !bForward || !bReverse) {
      throw new Error('Bevel selected edge did not resolve one rail endpoint per incident face.');
    }
    return {
      edgeKey: key,
      pointAId: selected.pointAId,
      pointBId: selected.pointBId,
      forwardFaceId: forward.faceId,
      reverseFaceId: reverse.faceId,
      bevelPointKeys: [aForward, aReverse, bReverse, bForward],
      profilePointKeys: [[aForward, aReverse], [bForward, bReverse]],
      railPointKeys: [[aForward, bForward], [aReverse, bReverse]],
      endpointCornerKeys: [
        corners.find(corner => corner.sourcePointId === selected.pointAId)?.boundaryPointKeys ?? [],
        corners.find(corner => corner.sourcePointId === selected.pointBId)?.boundaryPointKeys ?? [],
      ],
    };
  });

  if (segments > 1) {
    const normalizedProfile = buildEvenProfileSamples(segments, profile);

    const insertProfileArc = (boundary: string[], profileKeys: string[]): string[] => {
      if (profileKeys.length <= 2) return boundary;
      const start = profileKeys[0];
      const end = profileKeys[profileKeys.length - 1];
      if (start === end) {
        throw new BevelKernelUnsupportedTopologyError(
          'Multi-segment bevel does not yet support a fully collapsed endpoint profile.',
        );
      }
      const interior = profileKeys.slice(1, -1);
      const expanded: string[] = [];
      let inserted = false;
      for (let index = 0; index < boundary.length; index += 1) {
        const current = boundary[index];
        const next = boundary[(index + 1) % boundary.length];
        expanded.push(current);
        if (!inserted && current === start && next === end) {
          expanded.push(...interior);
          inserted = true;
        }
        else if (!inserted && current === end && next === start) {
          expanded.push(...[...interior].reverse());
          inserted = true;
        }
      }
      if (!inserted) {
        throw new BevelKernelUnsupportedTopologyError(
          'Multi-segment bevel requires each selected-edge profile to be a boundary arc of its endpoint VMesh.',
        );
      }
      return expanded;
    };

    const insertProfileArcIntoReplacement = (replacement: string[], profileKeys: string[]): string[] | null => {
      if (profileKeys.length <= 2) return replacement;
      const start = profileKeys[0];
      const end = profileKeys[profileKeys.length - 1];
      const interior = profileKeys.slice(1, -1);
      for (let index = 0; index < replacement.length - 1; index += 1) {
        if (replacement[index] === start && replacement[index + 1] === end) {
          return [...replacement.slice(0, index + 1), ...interior, ...replacement.slice(index + 1)];
        }
        if (replacement[index] === end && replacement[index + 1] === start) {
          return [...replacement.slice(0, index + 1), ...[...interior].reverse(), ...replacement.slice(index + 1)];
        }
      }
      return null;
    };

    const attachProfileArcAtEndpoint = (endpointId: string, profileKeys: string[]) => {
      // Blender's M_NONE corner case (typically one selected edge in a 3-edge
      // manifold fan) has no separate vertex patch: the opposite reconstructed
      // original face owns the profile arc directly. Expand that face-corner
      // replacement first so every endpoint profile segment gets a paired edge.
      const endpointCorners = cornersByVertex.get(endpointId) ?? [];
      for (const endpointCorner of endpointCorners) {
        const replacementKey = cornerKey(endpointCorner.faceId, endpointId);
        const replacement = replacements.get(replacementKey);
        if (!replacement) continue;
        const expandedReplacement = insertProfileArcIntoReplacement(replacement, profileKeys);
        if (expandedReplacement && expandedReplacement !== replacement) {
          replacements.set(replacementKey, expandedReplacement);
          return;
        }
      }

      // Otherwise the endpoint VMesh/cap owns the arc. This is the common path
      // for terminal triangles and connected selected-edge corners.
      const corner = corners.find(candidate => candidate.sourcePointId === endpointId);
      if (!corner) {
        throw new BevelKernelUnsupportedTopologyError(
          'Multi-segment bevel could not find an endpoint face or VMesh boundary to own its profile arc.',
        );
      }
      corner.boundaryPointKeys = insertProfileArc(corner.boundaryPointKeys, profileKeys);
    };

    for (const edgePlan of edgePlans) {
      const edgeStart = findPoint(construction, edgePlan.pointAId);
      const edgeEnd = findPoint(construction, edgePlan.pointBId);
      const edgeDirection = normalize3(sub3(edgeEnd, edgeStart), 'Bevel profile edge');

      const buildEndpointProfile = (
        endpointId: string,
        startKey: string,
        endKey: string,
        endpointIndex: 0 | 1,
      ): string[] => {
        const resolvedStart = canonicalKey(startKey);
        const resolvedEnd = canonicalKey(endKey);
        if (resolvedStart === resolvedEnd) {
          throw new BevelKernelUnsupportedTopologyError(
            'Multi-segment bevel does not yet support a welded zero-span endpoint profile.',
          );
        }
        const startPoint = generatedByKey.get(resolvedStart);
        const endPoint = generatedByKey.get(resolvedEnd);
        if (!startPoint || !endPoint) throw new Error('Bevel lost an endpoint profile boundary point.');
        if (length3(sub3(endPoint.position, startPoint.position)) <= EPSILON) {
          throw new BevelKernelUnsupportedTopologyError(
            'Multi-segment bevel does not yet support a geometrically collapsed endpoint profile.',
          );
        }

        const chordDirection = sub3(endPoint.position, startPoint.position);
        const middle = closestPointBetweenLines(edgeStart, edgeDirection, startPoint.position, chordDirection)
          ?? midpoint3(startPoint.position, endPoint.position);
        const keys = [resolvedStart];
        for (let segment = 1; segment < segments; segment += 1) {
          const sample = normalizedProfile[segment];
          const key = `p:${edgePlan.edgeKey}:${endpointIndex}:${segment}`;
          generatedByKey.set(key, {
            key,
            sourcePointId: endpointId,
            position: mapProfileSample(startPoint.position, middle, endPoint.position, sample),
          });
          keys.push(key);
        }
        keys.push(resolvedEnd);
        return keys;
      };

      const aProfile = buildEndpointProfile(
        edgePlan.pointAId,
        edgePlan.bevelPointKeys[0],
        edgePlan.bevelPointKeys[1],
        0,
      );
      const bProfile = buildEndpointProfile(
        edgePlan.pointBId,
        edgePlan.bevelPointKeys[3],
        edgePlan.bevelPointKeys[2],
        1,
      );
      edgePlan.profilePointKeys = [aProfile, bProfile];
      attachProfileArcAtEndpoint(edgePlan.pointAId, aProfile);
      attachProfileArcAtEndpoint(edgePlan.pointBId, bProfile);
    }
  }

  // Track longitudinal usage on selected edges too. Bound points are lateral to
  // the edge but may advance along it, and opposite endpoint patches must not cross.
  for (const edgePlan of edgePlans) {
    for (const endpointId of [edgePlan.pointAId, edgePlan.pointBId]) {
      const otherId = endpointId === edgePlan.pointAId ? edgePlan.pointBId : edgePlan.pointAId;
      const origin = findPoint(construction, endpointId);
      const ray = normalize3(sub3(findPoint(construction, otherId), origin), 'Bevel selected edge');
      const endpointKeys = endpointId === edgePlan.pointAId
        ? edgePlan.profilePointKeys[0]
        : edgePlan.profilePointKeys[1];
      let maxDistance = 0;
      for (const key of endpointKeys) {
        const point = generatedByKey.get(key);
        if (!point) throw new Error('Bevel lost a selected-edge boundary point.');
        const distance = dot3(sub3(point.position, origin), ray);
        // A valid bevel boundary may project *behind* the original endpoint when
        // the neighboring face edges flare outward. Blender allows this: the
        // bound vertex still lies on the incident face/edge wedge, and only the
        // portion that advances toward the opposite endpoint consumes selected-
        // edge length for overlap limiting. Treating every negative projection
        // as an inversion incorrectly rejects perfectly valid obtuse/reflex
        // endpoint configurations (for example a narrow edge on a flared box).
        maxDistance = Math.max(maxDistance, Math.max(0, distance));
      }
      const syntheticKey = `selectedInset:${edgePlan.edgeKey}:${endpointId}`;
      generatedByKey.set(syntheticKey, {
        key: syntheticKey,
        sourcePointId: endpointId,
        position: origin,
        edgeInset: { edgeKey: edgePlan.edgeKey, endpointId, distance: maxDistance },
      });
    }
  }

  const insetsByEdge = new Map<string, Map<string, number>>();
  for (const point of generatedByKey.values()) {
    if (!point.edgeInset) continue;
    const endpointMap = insetsByEdge.get(point.edgeInset.edgeKey) ?? new Map<string, number>();
    endpointMap.set(point.edgeInset.endpointId, Math.max(endpointMap.get(point.edgeInset.endpointId) ?? 0, point.edgeInset.distance));
    insetsByEdge.set(point.edgeInset.edgeKey, endpointMap);
  }

  let overlapScale = 1;
  for (const [key, endpointMap] of insetsByEdge) {
    const [aId, bId] = key.split('\u0000');
    const edgeLength = length3(sub3(findPoint(construction, bId), findPoint(construction, aId)));
    const used = Array.from(endpointMap.values()).reduce((sum, value) => sum + value, 0);
    if (used > edgeLength * OVERLAP_LIMIT && used > EPSILON) {
      overlapScale = Math.min(overlapScale, (edgeLength * OVERLAP_LIMIT) / used);
    }
  }

  validateReconstructedFaces(construction, replacements, generatedByKey);

  const visiblePoints = Array.from(generatedByKey.entries())
    .filter(([key, point]) => !point.key.startsWith('selectedInset:') && canonicalKey(key) === key)
    .map(([, point]) => point);
  return {
    plan: {
      points: visiblePoints.map(({ key, position, sourcePointId }) => ({ key, position, sourcePointId })),
      replacements,
      edges: edgePlans,
      corners,
      requestedWidth,
      effectiveWidth: width,
      clamped: width < requestedWidth - EPSILON,
      segments,
      profile,
    },
    overlapScale,
  };
};

/**
 * Blender-inspired joint bevel planner for segmented edge bevels.
 *
 * The important architectural property is that all selected edges are analyzed
 * before topology is mutated. Every touched vertex gets one cyclic local star,
 * one shared boundary, and at most one corner patch. This prevents the doubled
 * setback produced by repeatedly beveling connected edges one at a time.
 *
 * Current scope intentionally keeps the reliable boundary solver as the source
 * of truth, then samples Blender-style superellipse profiles between each pair
 * of edge-strip boundary rails:
 * - manifold selected edges (two incident faces),
 * - closed one-rings plus one-gap open terminal face fans (`selcount == 1`),
 * - Segments=1 remains the exact sharp-chamfer compatibility path,
 * - Segments>1 emits profile strips and expands endpoint VMesh boundaries,
 * - global overlap clamping.
 *
 * The current multi-segment corner fill is deliberately a boundary n-gon, not
 * Blender's final M_ADJ/Grid Fill interior. General miter/VMesh subdivision,
 * multi-selected open-fan miters, multiple face-chain gaps and UV interpolation
 * should extend this plan rather than reintroduce per-edge mutation.
 */
export const buildJointBevelPlan = (
  construction: StaticMeshConstructionData,
  selectedEdges: readonly BevelKernelSelectedEdge[],
  width: number,
  clampOverlap = true,
  segments = 1,
  profile = 0.5,
): BevelKernelPlan => {
  if (!Number.isFinite(width) || width <= EPSILON) throw new Error('Bevel width must be a finite positive number.');
  if (selectedEdges.length === 0) throw new Error('Bevel requires at least one selected edge.');
  if (!Number.isFinite(segments) || Math.floor(segments) !== segments || segments < 1 || segments > 64) {
    throw new Error('Bevel segments must be an integer from 1 to 64.');
  }
  if (!Number.isFinite(profile) || profile < 0 || profile > 1) {
    throw new Error('Bevel profile must be between 0 and 1.');
  }

  const uniqueEdges = new Map<string, BevelKernelSelectedEdge>();
  for (const edge of selectedEdges) {
    if (edge.pointAId === edge.pointBId) throw new Error('Bevel requires two different mesh vertices per edge.');
    uniqueEdges.set(edgeKey(edge.pointAId, edge.pointBId), edge);
  }
  const normalized = Array.from(uniqueEdges.values());

  const solveOrNull = (candidateWidth: number): SolveResult | null => {
    try {
      return solveAtWidth(construction, normalized, width, candidateWidth, segments, profile);
    }
    catch (error) {
      if (error instanceof BevelKernelCollisionError) return null;
      throw error;
    }
  };

  const findLargestValidWidth = (highWidth: number): SolveResult | null => {
    let low = 0;
    let high = highWidth;
    let best: SolveResult | null = null;
    for (let iteration = 0; iteration < 36; iteration += 1) {
      const candidate = (low + high) * 0.5;
      if (candidate <= EPSILON) break;
      const attempt = solveOrNull(candidate);
      if (attempt) {
        best = attempt;
        low = candidate;
      }
      else high = candidate;
    }
    return best;
  };

  let solved = solveOrNull(width);
  if (!solved) {
    if (!clampOverlap) throw new Error('Bevel width causes overlapping corner geometry or self-intersecting face geometry.');

    // Geometry on irregular/reflex n-gons is not always captured by a single
    // adjacent-edge length ratio. Find the largest valid width monotonically,
    // just as Blender performs a pre-build collision limiting pass.
    const best = findLargestValidWidth(width);
    if (!best || best.plan.effectiveWidth <= EPSILON) {
      throw new Error('Bevel has no remaining geometric room after overlap clamping.');
    }
    solved = best;
  }

  // Offset limiting is coupled: reducing one width can reveal a different
  // constraining neighboring edge. Iterate until the solved network no longer
  // asks for a reduction instead of applying only one ratio and returning a
  // still-overlapping plan.
  for (let iteration = 0; solved.overlapScale < 1 - 1e-8 && iteration < 16; iteration += 1) {
    if (!clampOverlap) throw new Error('Bevel width causes overlapping corner geometry.');
    const effectiveWidth = solved.plan.effectiveWidth * solved.overlapScale;
    if (!Number.isFinite(effectiveWidth) || effectiveWidth <= EPSILON) {
      throw new Error('Bevel has no remaining geometric room after overlap clamping.');
    }
    const reduced = solveOrNull(effectiveWidth);
    if (!reduced) {
      // A ratio clamp can reveal a different face collision on a highly
      // irregular n-gon. Fall back to the same bounded search below it.
      const best = findLargestValidWidth(effectiveWidth);
      if (!best) throw new Error('Bevel has no remaining geometric room after overlap clamping.');
      solved = best;
    }
    else solved = reduced;
  }
  if (solved.overlapScale < 1 - 1e-8) {
    throw new Error('Bevel overlap limiting did not converge to a stable boundary.');
  }
  return solved.plan;
};
