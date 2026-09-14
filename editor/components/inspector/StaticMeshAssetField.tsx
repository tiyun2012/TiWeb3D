import React, { useMemo } from 'react';

import type { StaticMeshCompositionSource } from '@/engine/api/StaticMeshAssetAPI';

import { Select } from '../ui/Select';

export interface StaticMeshAssetFieldProps {
  sources: StaticMeshCompositionSource[];
  value?: string | null;
  onChange: (assetId: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Shared Static Mesh asset selector for composition/reference workflows.
 * The source list comes from StaticMeshAssetAPI rather than Content Browser
 * selection so editor UIs remain replaceable without changing behavior.
 */
export const StaticMeshAssetField: React.FC<StaticMeshAssetFieldProps> = ({
  sources,
  value,
  onChange,
  label = 'Mesh',
  placeholder = 'Select Static Mesh...',
  disabled = false,
  className = '',
}) => {
  const options = useMemo(
    () => sources.map(source => ({
      label: source.path ? `${source.name} — ${source.path}` : source.name,
      value: source.id,
    })),
    [sources],
  );

  return (
    <div className={`flex items-center gap-2 py-1 ${className}`}>
      <span className="w-16 shrink-0 text-text-secondary text-[10px]">{label}</span>
      <div className="flex-1 min-w-0">
        <Select
          icon="Box"
          value={value || ''}
          options={options}
          onChange={next => onChange(String(next))}
          placeholder={placeholder}
          disabled={disabled || options.length === 0}
        />
      </div>
    </div>
  );
};
