import { Vec3Utils } from '@/engine/math';

export type CameraState = {
  theta: number;
  phi: number;
  radius: number;
  target: { x: number; y: number; z: number };
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

export const cloneCamera = (camera: CameraState): CameraState => ({
  ...camera,
  target: { ...camera.target },
});

export const getCameraEye = (camera: CameraState) => ({
  x: camera.target.x + camera.radius * Math.sin(camera.phi) * Math.cos(camera.theta),
  y: camera.target.y + camera.radius * Math.cos(camera.phi),
  z: camera.target.z + camera.radius * Math.sin(camera.phi) * Math.sin(camera.theta),
});

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
  const eyeOffset = {
    x: start.radius * Math.sin(start.phi) * Math.cos(start.theta),
    y: start.radius * Math.cos(start.phi),
    z: start.radius * Math.sin(start.phi) * Math.sin(start.theta),
  };
  const forward = Vec3Utils.normalize(
    Vec3Utils.scale(eyeOffset, -1, { x: 0, y: 0, z: 0 }),
    { x: 0, y: 0, z: 0 },
  );
  const right = Vec3Utils.normalize(
    Vec3Utils.cross(forward, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }),
    { x: 0, y: 0, z: 0 },
  );
  const cameraUp = Vec3Utils.normalize(
    Vec3Utils.cross(right, forward, { x: 0, y: 0, z: 0 }),
    { x: 0, y: 0, z: 0 },
  );
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
