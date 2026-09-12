import { CameraSettings, PostProcessEffectConfig, PostProcessProfileAsset, PostProcessStage } from '@/types';
import { assetManager } from '@/engine/AssetManager';

export const POST_PROCESS_STAGE_ORDER: Record<PostProcessStage, number> = {
  PRE_GLOBAL: 0,
  GLOBAL: 1,
  POST_GLOBAL: 2,
  OVERLAY: 3,
};

export const sortPostProcessEffects = (effects: PostProcessEffectConfig[]): PostProcessEffectConfig[] =>
  [...effects].sort((a, b) => {
    const stageDelta = POST_PROCESS_STAGE_ORDER[a.stage] - POST_PROCESS_STAGE_ORDER[b.stage];
    return stageDelta !== 0 ? stageDelta : a.order - b.order;
  });

export interface ResolvePostProcessProfileOptions {
  viewportProfileId?: string | null;
  camera?: Pick<CameraSettings, 'postProcessEnabled' | 'postProcessProfileId'> | null;
  sceneProfileId?: string | null;
}

/**
 * Resolution order: viewport override -> camera profile -> scene profile -> none.
 * An explicit camera postProcessEnabled=false stops inheritance for that camera.
 */
export const resolvePostProcessProfile = (
  options: ResolvePostProcessProfileOptions,
): PostProcessProfileAsset | null => {
  const id = options.viewportProfileId
    || (options.camera?.postProcessEnabled === false ? '' : options.camera?.postProcessProfileId)
    || (options.camera?.postProcessEnabled === false ? '' : options.sceneProfileId)
    || '';
  if (!id) return null;
  const asset = assetManager.getAsset(id);
  return asset?.type === 'POST_PROCESS_PROFILE' ? asset as PostProcessProfileAsset : null;
};
