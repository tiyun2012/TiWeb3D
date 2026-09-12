import React, { useEffect, useState } from 'react';
import { assetManager } from '@/engine/AssetManager';
import { eventBus } from '@/engine/EventBus';
import { AutoInspector } from './inspector/AutoInspector';
import { Icon } from './Icon';
import type { ViewportProfileAsset, ViewportProfileSettings } from '@/types';

const getViewportProfile = (assetId: string) => {
  const asset = assetManager.getAsset(assetId);
  return asset?.type === 'VIEWPORT_PROFILE' ? asset as ViewportProfileAsset : null;
};

const setNestedValue = <T extends Record<string, any>>(source: T, path: string, value: unknown): T => {
  const keys = path.split('.');
  const root: Record<string, any> = { ...source };
  let cursor = root;
  let sourceCursor: any = source;

  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    const existing = sourceCursor?.[key];
    cursor[key] = existing && typeof existing === 'object' ? { ...existing } : {};
    cursor = cursor[key];
    sourceCursor = existing;
  }

  cursor[keys[keys.length - 1]] = value;
  return root as T;
};

export interface ViewportProfileEditorProps {
  assetId: string;
}

/** Settings-only editor. Viewport Profiles describe editor behavior, not scene content. */
export const ViewportProfileEditor: React.FC<ViewportProfileEditorProps> = ({ assetId }) => {
  const [, setRevision] = useState(0);
  const asset = getViewportProfile(assetId);

  useEffect(() => eventBus.on('ASSET_UPDATED', payload => {
    if (payload?.id === assetId) setRevision(value => value + 1);
  }), [assetId]);

  if (!asset) {
    return <div className="w-full h-full flex items-center justify-center bg-[#151515] text-xs text-red-300">Viewport Profile asset not found.</div>;
  }

  const update = (path: string, value: unknown) => {
    const current = getViewportProfile(assetId);
    if (!current) return;
    assetManager.updateAsset(assetId, {
      data: setNestedValue<ViewportProfileSettings>(current.data, path, value),
    });
  };

  return (
    <div className="w-full h-full bg-[#181818] flex flex-col">
      <div className="h-10 px-3 border-b border-white/10 flex items-center gap-2 shrink-0">
        <Icon name="Monitor" size={14} className="text-indigo-300" />
        <div className="min-w-0">
          <div className="text-[10px] font-semibold text-white truncate">{asset.name}</div>
          <div className="text-[9px] text-text-secondary truncate">Editor viewport behavior • no camera pose or lens</div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 max-w-xl w-full mx-auto">
        <AutoInspector
          schemaId="ViewportProfileSettings"
          value={asset.data}
          scope="asset"
          onChange={update}
        />
      </div>
    </div>
  );
};
