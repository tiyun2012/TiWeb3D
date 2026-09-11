import React from 'react';
import { SkeletonAsset, SkeletalMeshAsset } from '@/types';
import { SkeletonVizSettings } from '@/editor/state/EditorContext';
import { Icon } from '../Icon';
import { SkeletonDisplayOptions } from './SkeletonDisplayOptions';

export interface SkeletonAssetInspectorProps {
  asset: SkeletonAsset | SkeletalMeshAsset;
  displayOptions: SkeletonVizSettings;
  onDisplayOptionsChange: (options: SkeletonVizSettings) => void;
  associatedMeshName?: string | null;
  onAddRootJoint?: () => void;
  showMeshOverlay?: boolean;
  meshOverlayActive?: boolean;
  onToggleMeshOverlay?: () => void;
  showWireframe?: boolean;
  wireframeActive?: boolean;
  onToggleWireframe?: () => void;
  className?: string;
}

export const SkeletonAssetInspector: React.FC<SkeletonAssetInspectorProps> = ({
  asset,
  displayOptions,
  onDisplayOptionsChange,
  associatedMeshName,
  onAddRootJoint,
  showMeshOverlay = false,
  meshOverlayActive = true,
  onToggleMeshOverlay,
  showWireframe = false,
  wireframeActive = false,
  onToggleWireframe,
  className = ''
}) => {
  const bones = asset.skeleton?.bones || [];

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Asset Overview Card */}
      <div className="bg-[#1e1e20] p-3 rounded-md border border-white/10 space-y-2.5">
        <div className="flex items-center justify-between pb-1 border-b border-white/5">
          <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
            <Icon name="Bone" size={14} className="text-accent" />
            <span className="truncate max-w-[180px]">{asset.name || 'Skeleton Asset'}</span>
          </div>
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-accent/20 text-accent border border-accent/30 uppercase">
            {asset.type}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="bg-black/20 p-2 rounded border border-white/5 flex flex-col">
            <span className="text-[10px] text-text-secondary font-medium">Bones Count</span>
            <span className="text-accent font-semibold text-sm">{bones.length}</span>
          </div>
          <div className="bg-black/20 p-2 rounded border border-white/5 flex flex-col">
            <span className="text-[10px] text-text-secondary font-medium">Linked Mesh</span>
            <span className="text-text-primary font-medium text-xs truncate">
              {associatedMeshName || (asset.type === 'SKELETAL_MESH' ? 'Self' : 'None')}
            </span>
          </div>
        </div>

        {onAddRootJoint && (
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 py-1.5 px-3 bg-accent/15 hover:bg-accent/30 text-accent border border-accent/40 rounded text-xs transition-colors"
            onClick={onAddRootJoint}
            title="Add a new root joint to the skeleton"
            aria-label="Add root joint"
          >
            <Icon name="Plus" size={13} />
            <span>Add Root Joint</span>
          </button>
        )}
      </div>

      {/* Embedded Reusable Skeleton Display Options */}
      <SkeletonDisplayOptions
        options={displayOptions}
        onChange={onDisplayOptionsChange}
        showMeshOverlay={showMeshOverlay}
        meshOverlayActive={meshOverlayActive}
        onToggleMeshOverlay={onToggleMeshOverlay}
        showWireframe={showWireframe}
        wireframeActive={wireframeActive}
        onToggleWireframe={onToggleWireframe}
      />
    </div>
  );
};
