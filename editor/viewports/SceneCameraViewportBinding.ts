import * as THREE from 'three';
import type { Engine } from '@/engine/engine';
import { ComponentType } from '@/types';
import { cameraStateFromWorldPose, getCameraEye, getCameraUp, type CameraState } from './viewportCamera';

const EPSILON = 1e-6;
const WORLD_UP = { x: 0, y: 1, z: 0 };

const normalizeOr = (
  value: { x: number; y: number; z: number },
  fallback: { x: number; y: number; z: number },
) => {
  const length = Math.hypot(value.x, value.y, value.z);
  if (length <= EPSILON) return { ...fallback };
  return { x: value.x / length, y: value.y / length, z: value.z / length };
};

/**
 * Converts a live Scene Camera Transform into the same orbit-style pose used by
 * all editor viewports. The focal distance is viewport state; it is not stored on
 * the Camera component or Transform.
 */
export const readSceneCameraViewportState = (
  engine: Engine,
  entityId: string,
  focalDistance = 5,
): CameraState | null => {
  if (!engine.ecs.hasComponent(entityId, ComponentType.CAMERA)) return null;
  // getWorldMatrix updates only this entity's parent chain when dirty. Avoid a
  // whole-scene update here: this function is used by interactive camera binding.
  const world = engine.sceneGraph.getWorldMatrix(entityId);
  if (!world) return null;

  const eye = { x: world[12], y: world[13], z: world[14] };
  const backward = normalizeOr({ x: world[8], y: world[9], z: world[10] }, { x: 0, y: 0, z: 1 });
  const forward = { x: -backward.x, y: -backward.y, z: -backward.z };
  const up = normalizeOr({ x: world[4], y: world[5], z: world[6] }, WORLD_UP);
  const right = normalizeOr({ x: world[0], y: world[1], z: world[2] }, { x: 1, y: 0, z: 0 });

  return cameraStateFromWorldPose(eye, forward, up, focalDistance, right);
};

/**
 * Writes an editor viewport pose back to a Scene Camera's Transform.
 *
 * The camera looks down local -Z. Position/rotation are converted back into the
 * entity's local parent space, so parented cameras keep using the shared SceneGraph.
 * Scale is deliberately untouched because camera view transforms do not own scale.
 */
export const writeSceneCameraViewportState = (
  engine: Engine,
  entityId: string,
  camera: CameraState,
): boolean => {
  const entity = engine.ecs.createProxy(entityId, engine.sceneGraph);
  const transform = entity?.components?.[ComponentType.TRANSFORM] as any;
  if (!transform || !engine.ecs.hasComponent(entityId, ComponentType.CAMERA)) return false;

  const eye = getCameraEye(camera);
  const target = camera.target;
  const up = getCameraUp(camera);

  const eyeVec = new THREE.Vector3(eye.x, eye.y, eye.z);
  const targetVec = new THREE.Vector3(target.x, target.y, target.z);
  const upVec = new THREE.Vector3(up.x, up.y, up.z);
  if (eyeVec.distanceToSquared(targetVec) <= EPSILON * EPSILON) return false;

  // THREE.Matrix4.lookAt produces the camera/object orientation whose +Z points
  // backward, therefore local -Z points at the viewport target.
  const worldRotation = new THREE.Matrix4().lookAt(eyeVec, targetVec, upVec);
  const worldQuaternion = new THREE.Quaternion().setFromRotationMatrix(worldRotation).normalize();

  const parentId = engine.sceneGraph.getParentId(entityId);
  let localPosition = eyeVec.clone();
  let localQuaternion = worldQuaternion.clone();

  if (parentId) {
    const parentWorldArray = engine.sceneGraph.getWorldMatrix(parentId);
    if (parentWorldArray) {
      const parentWorld = new THREE.Matrix4().fromArray(parentWorldArray);
      const inverseParent = parentWorld.clone().invert();
      localPosition = eyeVec.clone().applyMatrix4(inverseParent);

      const parentPosition = new THREE.Vector3();
      const parentQuaternion = new THREE.Quaternion();
      const parentScale = new THREE.Vector3();
      parentWorld.decompose(parentPosition, parentQuaternion, parentScale);
      localQuaternion = parentQuaternion.clone().invert().multiply(worldQuaternion).normalize();
    }
  }

  const order = (transform.rotationOrder || 'XYZ') as THREE.EulerOrder;
  const localEuler = new THREE.Euler().setFromQuaternion(localQuaternion, order);

  transform.position = { x: localPosition.x, y: localPosition.y, z: localPosition.z };
  transform.rotation = { x: localEuler.x, y: localEuler.y, z: localEuler.z };
  // Mark only this branch dirty. The render/update loop resolves world matrices;
  // doing a full SceneGraph.update() on every mousemove causes bound-camera lag.
  engine.sceneGraph.setDirty(entityId);
  return true;
};

export const cameraStatesApproximatelyEqual = (
  a: CameraState,
  b: CameraState,
  epsilon = 1e-4,
) => {
  const sameNumber = (x: number, y: number) => Math.abs(x - y) <= epsilon;
  const sameVec = (
    x: { x: number; y: number; z: number } | undefined,
    y: { x: number; y: number; z: number } | undefined,
  ) => {
    if (!x && !y) return true;
    if (!x || !y) return false;
    return sameNumber(x.x, y.x) && sameNumber(x.y, y.y) && sameNumber(x.z, y.z);
  };

  return sameNumber(a.theta, b.theta) &&
    sameNumber(a.phi, b.phi) &&
    sameNumber(a.radius, b.radius) &&
    sameNumber(a.orthoScale ?? 1, b.orthoScale ?? 1) &&
    sameNumber(a.roll ?? 0, b.roll ?? 0) &&
    sameVec(a.target, b.target) &&
    sameVec(a.up, b.up);
};
