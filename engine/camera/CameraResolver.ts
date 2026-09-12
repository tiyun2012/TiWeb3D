import type {
  CameraComponentData,
  CameraSettings,
  CameraPresetAsset,
  ResolvedCameraState,
} from '@/types';
import { assetManager } from '@/engine/AssetManager';
import {
  cameraSettingsFromComponent,
  cloneCameraSettings,
} from './CameraSettings';

export type CameraOverride = Partial<CameraSettings>;

const mergeSettings = (base: CameraSettings, override?: CameraOverride | null): CameraSettings => ({
  ...base,
  ...(override ?? {}),
});

/**
 * Resolves serialized camera configuration plus transient driver layers.
 *
 * Serialized ownership:
 * - LOCAL: Camera component fields are authoritative.
 * - PRESET: CameraPresetAsset.data is authoritative; missing preset falls back to local fields.
 *
 * Transient ownership:
 * - MANUAL: no transient override.
 * - RUNTIME: gameplay/script override layer.
 * - CINEMATIC: timeline/sequencer override layer.
 *
 * Transient layers never mutate the CameraPreset asset or serialized component values.
 */
export class CameraResolver {
  private runtimeOverrides = new Map<string, CameraOverride>();
  private cinematicOverrides = new Map<string, CameraOverride>();

  resolve(entityId: string, camera: CameraComponentData): ResolvedCameraState {
    const configSource = camera.configSource ?? (camera.presetId ? 'PRESET' : 'LOCAL');
    const controlMode = camera.controlMode ?? 'MANUAL';
    const presetId = camera.presetId ?? '';

    let settings: CameraSettings;
    let baseSource: ResolvedCameraState['baseSource'];

    if (configSource === 'PRESET' && presetId) {
      const asset = assetManager.getAsset(presetId);
      if (asset?.type === 'CAMERA_PRESET') {
        settings = cloneCameraSettings((asset as CameraPresetAsset).data);
        baseSource = 'PRESET';
      } else {
        settings = cameraSettingsFromComponent(camera);
        baseSource = 'LOCAL_FALLBACK';
      }
    } else {
      settings = cameraSettingsFromComponent(camera);
      baseSource = configSource === 'PRESET' ? 'LOCAL_FALLBACK' : 'LOCAL';
    }

    let overrideSource: ResolvedCameraState['overrideSource'] = 'NONE';
    if (controlMode === 'RUNTIME') {
      const runtime = this.runtimeOverrides.get(entityId);
      if (runtime) {
        settings = mergeSettings(settings, runtime);
        overrideSource = 'RUNTIME';
      }
    } else if (controlMode === 'CINEMATIC') {
      const cinematic = this.cinematicOverrides.get(entityId);
      if (cinematic) {
        settings = mergeSettings(settings, cinematic);
        overrideSource = 'CINEMATIC';
      }
    }

    return {
      settings,
      configSource,
      controlMode,
      baseSource,
      overrideSource,
      presetId,
    };
  }

  setRuntimeOverride(entityId: string, override: CameraOverride | null) {
    this.setOverride(this.runtimeOverrides, entityId, override);
  }

  setCinematicOverride(entityId: string, override: CameraOverride | null) {
    this.setOverride(this.cinematicOverrides, entityId, override);
  }

  clearEntity(entityId: string) {
    this.runtimeOverrides.delete(entityId);
    this.cinematicOverrides.delete(entityId);
  }

  clearAll() {
    this.runtimeOverrides.clear();
    this.cinematicOverrides.clear();
  }

  private setOverride(
    target: Map<string, CameraOverride>,
    entityId: string,
    override: CameraOverride | null,
  ) {
    if (!override || Object.keys(override).length === 0) {
      target.delete(entityId);
      return;
    }
    target.set(entityId, { ...override });
  }
}
