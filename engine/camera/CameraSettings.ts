import { CameraSettings } from '@/types';

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

export const cloneCameraSettings = (settings: CameraSettings): CameraSettings => ({
  ...settings,
});
