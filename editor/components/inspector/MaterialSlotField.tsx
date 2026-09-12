import React, { useEffect, useMemo, useState } from 'react';
import { assetManager } from '@/engine/AssetManager';
import { Select } from '@/editor/components/ui/Select';
import { eventBus } from '@/engine/EventBus';

export interface MaterialSlotFieldProps {
  value?: string | null;
  onChange: (materialId: string) => void;
  label?: string;
  defaultLabel?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Shared material-slot selector used by Scene mesh components and mesh asset
 * inspectors. An empty value means the built-in/asset fallback material.
 */
export const MaterialSlotField: React.FC<MaterialSlotFieldProps> = ({
  value,
  onChange,
  label = 'Material',
  defaultLabel = 'Standard Lambert',
  disabled = false,
  className = '',
}) => {
  const [assetRevision, setAssetRevision] = useState(0);
  useEffect(() => {
    const refresh = (payload: any) => {
      if (!payload?.type || payload.type === 'MATERIAL') setAssetRevision(v => v + 1);
    };
    const offCreated = eventBus.on('ASSET_CREATED', refresh);
    const offUpdated = eventBus.on('ASSET_UPDATED', refresh);
    return () => { offCreated(); offUpdated(); };
  }, []);

  const options = useMemo(() => {
    const materials = assetManager.getAssetsByType('MATERIAL');
    return [
      { label: defaultLabel, value: '' },
      ...materials.map(material => ({ label: material.name, value: material.id })),
    ];
  }, [defaultLabel, assetRevision]);

  return (
    <div className={`flex items-center gap-2 py-1 ${className}`}>
      <span className="w-24 shrink-0 text-text-secondary text-[10px]">{label}</span>
      <div className="flex-1 min-w-0">
        <Select
          icon="Palette"
          value={value || ''}
          options={options}
          onChange={next => onChange(String(next))}
          disabled={disabled}
        />
      </div>
    </div>
  );
};
