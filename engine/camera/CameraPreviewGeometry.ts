import type { CameraSettings } from '@/types';

const DEFAULT_ASPECT = 16 / 9;

const pushSegment = (
  out: number[],
  a: readonly [number, number, number],
  b: readonly [number, number, number],
) => {
  out.push(a[0], a[1], a[2], b[0], b[1], b[2]);
};

const addRectangle = (
  out: number[],
  centerZ: number,
  halfWidth: number,
  halfHeight: number,
) => {
  const corners: Array<[number, number, number]> = [
    [-halfWidth, -halfHeight, centerZ],
    [halfWidth, -halfHeight, centerZ],
    [halfWidth, halfHeight, centerZ],
    [-halfWidth, halfHeight, centerZ],
  ];
  for (let i = 0; i < 4; i += 1) {
    pushSegment(out, corners[i], corners[(i + 1) % 4]);
  }
  return corners;
};

/**
 * Builds a canonical camera/frustum wire preview facing local -Z.
 *
 * The editor intentionally normalizes clip-plane depth so a default far plane
 * such as 1000 does not make the preview unusable. Projection shape is exact
 * for the representative preview depth; authored near/far values are shown in
 * the HUD/Inspector and remain the source of truth for runtime rendering.
 */
export function buildCameraPreviewLines(
  settings: CameraSettings,
  aspect = DEFAULT_ASPECT,
): Float32Array {
  const out: number[] = [];
  const origin: [number, number, number] = [0, 0, 0];
  const nearDepth = 0.55;
  const farDepth = 2.6;

  let nearHalfHeight: number;
  let farHalfHeight: number;
  if (settings.projection === 'ORTHOGRAPHIC') {
    const normalizedSize = Math.max(0.35, Math.min(2.2, settings.orthoSize * 0.12));
    nearHalfHeight = normalizedSize;
    farHalfHeight = normalizedSize;
  } else {
    const safeFov = Math.max(1, Math.min(179, settings.fov));
    const tanHalf = Math.tan((safeFov * Math.PI) / 360);
    nearHalfHeight = tanHalf * nearDepth;
    farHalfHeight = tanHalf * farDepth;
  }

  const nearHalfWidth = nearHalfHeight * aspect;
  const farHalfWidth = farHalfHeight * aspect;
  const nearCorners = addRectangle(out, -nearDepth, nearHalfWidth, nearHalfHeight);
  const farCorners = addRectangle(out, -farDepth, farHalfWidth, farHalfHeight);

  for (let i = 0; i < 4; i += 1) {
    pushSegment(out, nearCorners[i], farCorners[i]);
  }

  // Camera body / forward indicator. No transform is stored by Camera Preset;
  // this canonical origin represents the reusable projection settings only.
  pushSegment(out, origin, [0, 0, -nearDepth]);
  pushSegment(out, [-0.18, -0.12, 0.12], [0.18, -0.12, 0.12]);
  pushSegment(out, [0.18, -0.12, 0.12], [0.18, 0.12, 0.12]);
  pushSegment(out, [0.18, 0.12, 0.12], [-0.18, 0.12, 0.12]);
  pushSegment(out, [-0.18, 0.12, 0.12], [-0.18, -0.12, 0.12]);

  return new Float32Array(out);
}
