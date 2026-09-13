import type { CameraSettings } from '@/types';
import { AABBUtils, type AABB } from '@/engine/math';
import {
  type CameraState,
  getCameraForward,
  getCameraRight,
  getCameraUp,
} from './viewportCamera';

export type FocusPoint = { x: number; y: number; z: number };

/**
 * Domain-neutral description of something a viewport can frame.
 *
 * Selection systems/editors decide WHAT these bounds represent. The viewport
 * navigation layer only decides HOW to frame them with the current camera.
 */
export interface FocusTarget {
  bounds: AABB;
  /** Orbit pivot. Defaults to the bounds center. */
  pivot?: FocusPoint;
  /** Extra breathing room around the projected bounds. */
  padding?: number;
  /** Minimum half-size used for point/edge-like selections. */
  minWorldRadius?: number;
}

/**
 * Context adapter used by asset editors. A provider may resolve component,
 * object, bone, camera-subject, or any future selection without teaching the
 * shared viewport about those domain concepts.
 */
export interface ViewportFocusProvider {
  getFocusTarget(): FocusTarget | null;
  getDefaultFocusTarget?(): FocusTarget | null;
}

export interface ViewportFrameContext {
  width: number;
  height: number;
  projectionSettings?: Pick<CameraSettings, 'projection' | 'fov' | 'orthoSize'>;
}

const EPSILON = 1e-6;

const cloneBounds = (bounds: AABB): AABB => ({
  min: { ...bounds.min },
  max: { ...bounds.max },
});

const isFinitePoint = (point: FocusPoint) =>
  Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);

export const isValidFocusBounds = (bounds: AABB) =>
  isFinitePoint(bounds.min) &&
  isFinitePoint(bounds.max) &&
  bounds.min.x <= bounds.max.x &&
  bounds.min.y <= bounds.max.y &&
  bounds.min.z <= bounds.max.z;

export const createFocusTargetFromBounds = (
  bounds: AABB,
  options: Omit<FocusTarget, 'bounds'> = {},
): FocusTarget | null => {
  if (!isValidFocusBounds(bounds)) return null;
  return { bounds: cloneBounds(bounds), ...options };
};

export const createFocusTargetFromPoints = (
  points: Iterable<FocusPoint>,
  options: Omit<FocusTarget, 'bounds'> = {},
): FocusTarget | null => {
  const bounds = AABBUtils.create();
  let count = 0;
  for (const point of points) {
    if (!isFinitePoint(point)) continue;
    AABBUtils.expandPoint(bounds, point);
    count += 1;
  }
  if (count === 0) return null;
  return createFocusTargetFromBounds(bounds, options);
};

const dot = (a: FocusPoint, b: FocusPoint) => a.x * b.x + a.y * b.y + a.z * b.z;

const getBoundsCorners = (bounds: AABB, minWorldRadius: number): FocusPoint[] => {
  const center = AABBUtils.center(bounds, { x: 0, y: 0, z: 0 });
  const halfX = Math.max((bounds.max.x - bounds.min.x) * 0.5, minWorldRadius);
  const halfY = Math.max((bounds.max.y - bounds.min.y) * 0.5, minWorldRadius);
  const halfZ = Math.max((bounds.max.z - bounds.min.z) * 0.5, minWorldRadius);
  const corners: FocusPoint[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        corners.push({
          x: center.x + sx * halfX,
          y: center.y + sy * halfY,
          z: center.z + sz * halfZ,
        });
      }
    }
  }
  return corners;
};

/**
 * Shared framing API used by Scene View and asset viewports.
 *
 * It preserves the current view direction/roll and changes only orbit target +
 * distance (or orthographic scale). Perspective fitting is evaluated in the
 * current camera basis so elongated selections frame more tightly than a
 * bounding-sphere approximation while still accounting for depth.
 */
export const frameCameraOnFocusTarget = (
  camera: CameraState,
  target: FocusTarget,
  context: ViewportFrameContext,
): CameraState => {
  if (!isValidFocusBounds(target.bounds)) return camera;

  const width = Math.max(1, context.width);
  const height = Math.max(1, context.height);
  const aspect = width / height;
  const padding = Math.max(1, target.padding ?? 1.15);
  const minWorldRadius = Math.max(EPSILON, target.minWorldRadius ?? 0.08);
  const pivot = target.pivot && isFinitePoint(target.pivot)
    ? { ...target.pivot }
    : AABBUtils.center(target.bounds, { x: 0, y: 0, z: 0 });

  const right = getCameraRight(camera);
  const up = getCameraUp(camera);
  const forward = getCameraForward(camera);
  const corners = getBoundsCorners(target.bounds, minWorldRadius);

  if (context.projectionSettings?.projection === 'ORTHOGRAPHIC') {
    let halfWidthNeeded = minWorldRadius;
    let halfHeightNeeded = minWorldRadius;
    for (const corner of corners) {
      const offset = {
        x: corner.x - pivot.x,
        y: corner.y - pivot.y,
        z: corner.z - pivot.z,
      };
      halfWidthNeeded = Math.max(halfWidthNeeded, Math.abs(dot(offset, right)));
      halfHeightNeeded = Math.max(halfHeightNeeded, Math.abs(dot(offset, up)));
    }

    const requiredHalfHeight = Math.max(halfHeightNeeded, halfWidthNeeded / aspect) * padding;
    const authoredOrthoSize = Math.max(EPSILON, context.projectionSettings.orthoSize);
    return {
      ...camera,
      target: pivot,
      orthoScale: Math.max(0.02, Math.min(100, (requiredHalfHeight * 2) / authoredOrthoSize)),
    };
  }

  const verticalFov = Math.max(1, Math.min(179, context.projectionSettings?.fov ?? 45)) * Math.PI / 180;
  const verticalHalfFov = verticalFov * 0.5;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
  const tanVertical = Math.max(EPSILON, Math.tan(verticalHalfFov));
  const tanHorizontal = Math.max(EPSILON, Math.tan(horizontalHalfFov));

  let requiredDistance = minWorldRadius / Math.min(tanVertical, tanHorizontal);
  for (const corner of corners) {
    const offset = {
      x: corner.x - pivot.x,
      y: corner.y - pivot.y,
      z: corner.z - pivot.z,
    };
    const x = Math.abs(dot(offset, right)) * padding;
    const y = Math.abs(dot(offset, up)) * padding;
    const z = dot(offset, forward);
    requiredDistance = Math.max(
      requiredDistance,
      x / tanHorizontal - z,
      y / tanVertical - z,
    );
  }

  return {
    ...camera,
    target: pivot,
    radius: Math.max(0.05, requiredDistance),
  };
};
