import React, { useState } from 'react';
import { Icon } from './Icon';
import { StaticMeshEditor } from './StaticMeshEditor';
import { SkeletonEditor } from './SkeletonEditor';

export interface SkeletalMeshEditorProps {
  assetId: string;
}

type SkeletalMeshWorkspace = 'GEOMETRY' | 'SKELETON';

const WorkspaceSwitch: React.FC<{
  active: SkeletalMeshWorkspace;
  onChange: (workspace: SkeletalMeshWorkspace) => void;
}> = ({ active, onChange }) => (
  <div className="flex items-center gap-0.5 bg-black/25 rounded p-0.5 border border-white/5">
    <button
      type="button"
      title="Edit skeletal mesh geometry"
      aria-label="Edit skeletal mesh geometry"
      onClick={() => onChange('GEOMETRY')}
      className={`h-5 px-2 rounded flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide transition-colors ${
        active === 'GEOMETRY' ? 'bg-accent text-white' : 'text-text-secondary hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon name="Boxes" size={10} /> Geometry
    </button>
    <button
      type="button"
      title="Edit skeletal mesh skeleton"
      aria-label="Edit skeletal mesh skeleton"
      onClick={() => onChange('SKELETON')}
      className={`h-5 px-2 rounded flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide transition-colors ${
        active === 'SKELETON' ? 'bg-accent text-white' : 'text-text-secondary hover:text-white hover:bg-white/5'
      }`}
    >
      <Icon name="Bone" size={10} /> Skeleton
    </button>
  </div>
);

/**
 * Skeletal mesh assets expose two valid editing domains without duplicating
 * viewport infrastructure: mesh topology/geometry and the embedded skeleton.
 */
export const SkeletalMeshEditor: React.FC<SkeletalMeshEditorProps> = ({ assetId }) => {
  const [workspace, setWorkspace] = useState<SkeletalMeshWorkspace>('GEOMETRY');
  const switcher = <WorkspaceSwitch active={workspace} onChange={setWorkspace} />;

  return workspace === 'SKELETON' ? (
    <SkeletonEditor assetId={assetId} editorHeaderExtra={switcher} />
  ) : (
    <StaticMeshEditor assetId={assetId} editorHeaderExtra={switcher} />
  );
};
