import { Vec3Utils } from '@/engine/math';

export type CameraState = {
  theta: number;
  phi: number;
  radius: number;
  target: { x: number; y: number; z: number };
  /**
   * Optional legacy/custom up axis. Most editor cameras are Y-up. Bound Scene
   * Cameras use `roll` so orbit can transport authored roll without keeping a
   * stale world-space up vector while the forward direction changes.
   */
  up?: { x: number; y: number; z: number };
  /** Signed roll (radians) around the current forward axis. */
  roll?: number;
  /**
   * Editor-only orthographic navigation multiplier.
   *
   * Orthographic cameras do not visually zoom when dollying along their forward
   * axis, so viewports keep a transient screen-scale multiplier alongside the
   * orbit pose. A value of 1 means the authored orthoSize is shown exactly.
   */
  orthoScale?: number;
};

export type CameraDragMode = 'ORBIT' | 'PAN' | 'ZOOM';

export interface OrbitDragOptions {
  sensitivity?: number;
  minPhi?: number;
  maxPhi?: number;
}

export interface ZoomOptions {
  sensitivity?: number;
  minRadius?: number;
}

export interface OrthographicZoomOptions {
  sensitivity?: number;
  minScale?: number;
  maxScale?: number;
}

const EPSILON = 1e-8;
const WORLD_UP = { x: 0, y: 1, z: 0 };

const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  a.x * b.x + a.y * b.y + a.z * b.z;

const normalizeOr = (
  value: { x: number; y: number; z: number },
  fallback: { x: number; y: number; z: number },
) => {
  const length = Math.hypot(value.x, value.y, value.z);
  if (length <= EPSILON) return { ...fallback };
  return { x: value.x / length, y: value.y / length, z: value.z / length };
};

const rotateAroundAxis = (
  value: { x: number; y: number; z: number },
  axisValue: { x: number; y: number; z: number },
  angle: number,
) => {
  const axis = normalizeOr(axisValue, { x: 0, y: 0, z: -1 });
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const axisDot = dot(axis, value);
  const cross = Vec3Utils.cross(axis, value, { x: 0, y: 0, z: 0 });
  return {
    x: value.x * cosine + cross.x * sine + axis.x * axisDot * (1 - cosine),
    y: value.y * cosine + cross.y * sine + axis.y * axisDot * (1 - cosine),
    z: value.z * cosine + cross.z * sine + axis.z * axisDot * (1 - cosine),
  };
};

const getCanonicalFrame = (
  forwardValue: { x: number; y: number; z: number },
  fallbackRight?: { x: number; y: number; z: number },
) => {
  const forward = normalizeOr(forwardValue, { x: 0, y: 0, z: -1 });
  let right = Vec3Utils.cross(forward, WORLD_UP, { x: 0, y: 0, z: 0 });
  if (Math.hypot(right.x, right.y, right.z) <= EPSILON) {
    right = fallbackRight
      ? { ...fallbackRight }
      : Vec3Utils.cross(forward, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 });
  }
  right = normalizeOr(right, { x: 1, y: 0, z: 0 });
  const up = normalizeOr(
    Vec3Utils.cross(right, forward, { x: 0, y: 0, z: 0 }),
    WORLD_UP,
  );
  return { forward, right, up };
};

export const cloneCamera = (camera: CameraState): CameraState => ({
  ...camera,
  target: { ...camera.target },
  up: camera.up ? { ...camera.up } : undefined,
  roll: camera.roll ?? 0,
  orthoScale: camera.orthoScale ?? 1,
});

export const getCameraEye = (camera: CameraState) => ({
  x: camera.target.x + camera.radius * Math.sin(camera.phi) * Math.cos(camera.theta),
  y: camera.target.y + camera.radius * Math.cos(camera.phi),
  z: camera.target.z + camera.radius * Math.sin(camera.phi) * Math.sin(camera.theta),
});

export const getCameraForward = (camera: CameraState) => {
  const eye = getCameraEye(camera);
  return normalizeOr({
    x: camera.target.x - eye.x,
    y: camera.target.y - eye.y,
    z: camera.target.z - eye.z,
  }, { x: 0, y: 0, z: -1 });
};

/**
 * Returns the live up vector for the current camera direction.
 *
 * A stored world-space `up` becomes stale as an orbit changes the forward vector
 * and is the main source of bound-camera corkscrew/flip behavior. Roll is instead
 * transported around the live forward axis from a stable Y-up editor frame.
 */
export const getCameraUp = (camera: CameraState) => {
  const forward = getCameraForward(camera);
  if (camera.roll === undefined && camera.up) {
    const projected = {
      x: camera.up.x - forward.x * dot(camera.up, forward),
      y: camera.up.y - forward.y * dot(camera.up, forward),
      z: camera.up.z - forward.z * dot(camera.up, forward),
    };
    return normalizeOr(projected, WORLD_UP);
  }
  const canonical = getCanonicalFrame(forward);
  return normalizeOr(
    rotateAroundAxis(canonical.up, forward, camera.roll ?? 0),
    canonical.up,
  );
};

export const getCameraRight = (camera: CameraState) => {
  const forward = getCameraForward(camera);
  const up = getCameraUp(camera);
  return normalizeOr(
    Vec3Utils.cross(forward, up, { x: 0, y: 0, z: 0 }),
    { x: 1, y: 0, z: 0 },
  );
};

/** Converts a world pose into the shared orbit-style viewport representation. */
export const cameraStateFromWorldPose = (
  position: { x: number; y: number; z: number },
  forwardValue: { x: number; y: number; z: number },
  upValue: { x: number; y: number; z: number },
  focalDistance = 5,
  fallbackRight?: { x: number; y: number; z: number },
): CameraState => {
  const forward = normalizeOr(forwardValue, { x: 0, y: 0, z: -1 });
  const radius = Math.max(0.05, focalDistance);
  const target = {
    x: position.x + forward.x * radius,
    y: position.y + forward.y * radius,
    z: position.z + forward.z * radius,
  };
  const offset = {
    x: position.x - target.x,
    y: position.y - target.y,
    z: position.z - target.z,
  };
  const theta = Math.atan2(offset.z, offset.x);
  const phi = Math.acos(Math.max(-1, Math.min(1, offset.y / radius)));

  const actualUpProjected = normalizeOr({
    x: upValue.x - forward.x * dot(upValue, forward),
    y: upValue.y - forward.y * dot(upValue, forward),
    z: upValue.z - forward.z * dot(upValue, forward),
  }, WORLD_UP);
  const canonical = getCanonicalFrame(forward, fallbackRight);
  const upCross = Vec3Utils.cross(canonical.up, actualUpProjected, { x: 0, y: 0, z: 0 });
  const roll = Math.atan2(dot(upCross, forward), dot(canonical.up, actualUpProjected));

  return { theta, phi, radius, target, roll, orthoScale: 1 };
};

export const orbitCamera = (
  start: CameraState,
  dx: number,
  dy: number,
  options: OrbitDragOptions = {},
): CameraState => {
  const sensitivity = options.sensitivity ?? 0.01;
  const minPhi = options.minPhi ?? 0.05;
  const maxPhi = options.maxPhi ?? Math.PI - minPhi;

  return {
    ...start,
    theta: start.theta + dx * sensitivity,
    phi: Math.max(minPhi, Math.min(maxPhi, start.phi - dy * sensitivity)),
    target: { ...start.target },
  };
};

export const panCamera = (
  start: CameraState,
  dx: number,
  dy: number,
  sensitivity = 0.001,
): CameraState => {
  const panSpeed = start.radius * sensitivity;
  const right = getCameraRight(start);
  const cameraUp = getCameraUp(start);
  const moveX = Vec3Utils.scale(right, -dx * panSpeed, { x: 0, y: 0, z: 0 });
  const moveY = Vec3Utils.scale(cameraUp, dy * panSpeed, { x: 0, y: 0, z: 0 });
  const offset = Vec3Utils.add(moveX, moveY, { x: 0, y: 0, z: 0 });

  return {
    ...start,
    target: Vec3Utils.add(start.target, offset, { x: 0, y: 0, z: 0 }),
  };
};

export const dragZoomCamera = (
  start: CameraState,
  dx: number,
  dy: number,
  options: ZoomOptions = {},
): CameraState => ({
  ...start,
  radius: Math.max(
    options.minRadius ?? 0.2,
    start.radius - (dx - dy) * (options.sensitivity ?? 0.05),
  ),
  target: { ...start.target },
});

export const wheelZoomCamera = (
  camera: CameraState,
  deltaY: number,
  options: ZoomOptions = {},
): CameraState => ({
  ...camera,
  radius: Math.max(
    options.minRadius ?? 0.2,
    camera.radius + deltaY * (options.sensitivity ?? 0.005),
  ),
  target: { ...camera.target },
});

const clampOrthographicScale = (scale: number, options: OrthographicZoomOptions) =>
  Math.max(options.minScale ?? 0.02, Math.min(options.maxScale ?? 100, scale));

/**
 * Orthographic equivalent of viewport dolly zoom. The camera pose can still be
 * orbited/panned, but zoom changes screen scale because moving an orthographic
 * camera forward/backward does not change apparent object size.
 */
export const dragOrthographicZoomCamera = (
  start: CameraState,
  dx: number,
  dy: number,
  options: OrthographicZoomOptions = {},
): CameraState => ({
  ...start,
  orthoScale: clampOrthographicScale(
    (start.orthoScale ?? 1) * Math.exp(-(dx - dy) * (options.sensitivity ?? 0.01)),
    options,
  ),
  target: { ...start.target },
});

export const wheelOrthographicZoomCamera = (
  camera: CameraState,
  deltaY: number,
  options: OrthographicZoomOptions = {},
): CameraState => ({
  ...camera,
  orthoScale: clampOrthographicScale(
    (camera.orthoScale ?? 1) * Math.exp(deltaY * (options.sensitivity ?? 0.001)),
    options,
  ),
  target: { ...camera.target },
});
