import { assetManager } from '@/engine/AssetManager';
import { normalizeViewportProfileSettings } from '@/engine/viewport/ViewportProfileSettings';
import type { Asset, CameraComponentData, CameraPresetAsset, ViewportProfileAsset, ViewportProfileSettings } from '@/types';
import { ComponentType } from '@/types';
import type { Engine } from '@/engine/engine';

export const resolveViewportProfile = (profileId?: string | null): ViewportProfileSettings => {
  if (!profileId) return normalizeViewportProfileSettings();
  const asset = assetManager.getAsset(profileId);
  if (!asset || asset.type !== 'VIEWPORT_PROFILE') return normalizeViewportProfileSettings();
  return normalizeViewportProfileSettings((asset as ViewportProfileAsset).data);
};

export const getAssetViewportProfileId = (asset?: Asset | null) => asset?.editor?.viewportProfileId || undefined;

/**
 * Scene Camera viewport behavior is editor metadata, not Camera runtime state.
 * Preset-backed cameras inherit the preset's editor viewport profile; local cameras
 * use the editor default profile.
 */
export const resolveSceneCameraViewportProfile = (
  engine: Engine,
  cameraEntityId: string,
): ViewportProfileSettings => {
  const proxy = engine.ecs.createProxy(cameraEntityId, engine.sceneGraph);
  const camera = proxy?.components?.[ComponentType.CAMERA] as CameraComponentData | undefined;
  if (camera?.configSource === 'PRESET' && camera.presetId) {
    const preset = assetManager.getAsset(camera.presetId);
    if (preset?.type === 'CAMERA_PRESET') {
      return resolveViewportProfile(getAssetViewportProfileId(preset as CameraPresetAsset));
    }
  }
  return resolveViewportProfile();
};
