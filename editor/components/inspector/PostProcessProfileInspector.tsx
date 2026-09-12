import React from 'react';
import { PostProcessEffectConfig, PostProcessEffectType, PostProcessProfileAsset, PostProcessStage } from '@/types';
import { assetManager } from '@/engine/AssetManager';
import { Select } from '@/editor/components/ui/Select';
import { CheckboxInput, DraggableNumber } from '@/editor/components/ui/InputControls';
import { Icon } from '@/editor/components/Icon';
import { sortPostProcessEffects } from '@/engine/postprocess/PostProcessProfile';

const EFFECT_TYPES: PostProcessEffectType[] = [
  'BLOOM', 'EXPOSURE', 'TONE_MAPPING', 'COLOR_GRADING', 'VIGNETTE',
  'CHROMATIC_ABERRATION', 'OUTLINE', 'GLOW',
];
const STAGES: PostProcessStage[] = ['PRE_GLOBAL', 'GLOBAL', 'POST_GLOBAL', 'OVERLAY'];

const cloneEffect = (effect: PostProcessEffectConfig): PostProcessEffectConfig => ({
  ...effect,
  params: { ...effect.params },
});

export const PostProcessProfileInspector: React.FC<{ asset: PostProcessProfileAsset }> = ({ asset }) => {
  const [, setRevision] = React.useState(0);
  const commitData = (data: PostProcessProfileAsset['data']) => {
    assetManager.updateAsset(asset.id, { data });
    setRevision(v => v + 1);
  };

  const commitEffects = (effects: PostProcessEffectConfig[]) => {
    commitData({ ...asset.data, effects: sortPostProcessEffects(effects.map(cloneEffect)) });
  };

  const updateEffect = (id: string, patch: Partial<PostProcessEffectConfig>) => {
    commitEffects(asset.data.effects.map(effect => effect.id === id ? { ...effect, ...patch } : effect));
  };

  const addEffect = () => {
    const order = asset.data.effects.length === 0
      ? 10
      : Math.max(...asset.data.effects.map(effect => effect.order)) + 10;
    commitEffects([
      ...asset.data.effects,
      {
        id: crypto.randomUUID(),
        type: 'BLOOM',
        enabled: true,
        stage: 'PRE_GLOBAL',
        order,
        params: {},
      },
    ]);
  };

  return (
    <div className="space-y-4">
      <CheckboxInput
        label="Profile Enabled"
        checked={asset.data.enabled}
        onChange={enabled => commitData({ ...asset.data, enabled })}
      />

      <div className="space-y-2">
        <div className="flex items-center justify-between border-b border-white/5 pb-1">
          <span className="text-[10px] uppercase font-bold text-text-secondary tracking-wider">Effects</span>
          <button
            type="button"
            onClick={addEffect}
            className="flex items-center gap-1 px-2 py-1 text-[10px] rounded bg-accent/20 text-accent hover:bg-accent/30"
            title="Add post-process effect"
            aria-label="Add post-process effect"
          >
            <Icon name="Plus" size={10} /> Add
          </button>
        </div>

        {sortPostProcessEffects(asset.data.effects).map(effect => (
          <div key={effect.id} className="rounded border border-white/10 bg-black/10 p-2 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={effect.enabled}
                onChange={e => updateEffect(effect.id, { enabled: e.target.checked })}
                title="Effect enabled"
                aria-label="Effect enabled"
              />
              <div className="flex-1">
                <Select
                  value={effect.type}
                  options={EFFECT_TYPES.map(value => ({ label: value.split('_').join(' '), value }))}
                  onChange={value => updateEffect(effect.id, { type: value as PostProcessEffectType })}
                />
              </div>
              <button
                type="button"
                onClick={() => commitEffects(asset.data.effects.filter(item => item.id !== effect.id))}
                className="p-1 text-text-secondary hover:text-red-400"
                title="Remove effect"
                aria-label="Remove effect"
              >
                <Icon name="Trash2" size={12} />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-24 text-text-secondary text-[10px]">Stage</span>
              <div className="flex-1">
                <Select
                  value={effect.stage}
                  options={STAGES.map(value => ({ label: value.split('_').join(' '), value }))}
                  onChange={value => updateEffect(effect.id, { stage: value as PostProcessStage })}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-24 text-text-secondary text-[10px]">Order</span>
              <div className="flex-1">
                <DraggableNumber
                  label=""
                  value={effect.order}
                  step={1}
                  onChange={value => updateEffect(effect.id, { order: Math.floor(value) })}
                />
              </div>
            </div>

            {(effect.type === 'OUTLINE' || effect.type === 'GLOW') && (
              <div className="flex items-center gap-2">
                <span className="w-24 text-text-secondary text-[10px]">Target Mask</span>
                <input
                  type="text"
                  value={effect.targetMask || ''}
                  onChange={e => updateEffect(effect.id, { targetMask: e.target.value })}
                  placeholder="Selected / Character"
                  className="flex-1 bg-input-bg rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-accent"
                  title="Object/effect mask targeted by this pass"
                  aria-label="Target mask"
                />
              </div>
            )}
          </div>
        ))}

        {asset.data.effects.length === 0 && (
          <div className="text-[10px] text-text-secondary italic py-3 text-center">No effects. Add one to define the profile pipeline.</div>
        )}
      </div>
    </div>
  );
};
