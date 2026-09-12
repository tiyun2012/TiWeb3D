import type { CameraComponentData, CameraSettings } from '@/types';

export const createDefaultCameraSettings = (): CameraSettings => ({
  projection: 'PERSPECTIVE',
  fov: 60,
  orthoSize: 10,
  near: 0.1,
  far: 1000,
  clearMode: 'SKY',
  clearColor: '#20252d',
  renderLayerMask: 0xffffffff,
  postProcessEnabled: true,
  postProcessProfileId: '',
});

export const createDefaultCameraComponentData = (): CameraComponentData => ({
  ...createDefaultCameraSettings(),
  configSource: 'LOCAL',
  controlMode: 'MANUAL',
  presetId: '',
});

export const cloneCameraSettings = (settings: CameraSettings): CameraSettings => ({
  projection: settings.projection,
  fov: settings.fov,
  orthoSize: settings.orthoSize,
  near: settings.near,
  far: settings.far,
  clearMode: settings.clearMode,
  clearColor: settings.clearColor,
  renderLayerMask: settings.renderLayerMask,
  postProcessEnabled: settings.postProcessEnabled,
  postProcessProfileId: settings.postProcessProfileId ?? '',
});

/**
 * Extract only serializable camera settings from a Camera component/proxy.
 * Runtime/cinematic driver state intentionally lives outside this object.
 */
export const cameraSettingsFromComponent = (camera: CameraComponentData): CameraSettings =>
  cloneCameraSettings(camera);
