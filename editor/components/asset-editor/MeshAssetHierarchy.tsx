import React, { useMemo, useState } from 'react';
import { MeshComponentMode, SkeletalMeshAsset, StaticMeshAsset } from '@/types';
import { HierarchyTreeItem } from '@/editor/components/HierarchyTreeItem';
import { Icon } from '@/editor/components/Icon';
import { assetViewportAllows, meshModeActionId } from './assetViewportCapabilities';

export type MeshHierarchySection =
  | 'ASSET'
  | 'GEOMETRY'
  | 'VERTICES'
  | 'EDGES'
  | 'FACES'
  | 'SKIN'
  | 'SKELETON';

export interface MeshAssetHierarchyProps {
  asset: StaticMeshAsset | SkeletalMeshAsset;
  activeSection: MeshHierarchySection;
  meshComponentMode: MeshComponentMode;
  onSectionChange: (section: MeshHierarchySection) => void;
  onMeshComponentModeChange: (mode: MeshComponentMode) => void;
}

function countUniqueEdges(asset: StaticMeshAsset | SkeletalMeshAsset): number {
  const graph = asset.topology?.graph;
  if (graph?.edgeKeyToHalfEdge instanceof Map) return graph.edgeKeyToHalfEdge.size;

  const unique = new Set<string>();
  const indices = asset.geometry.indices;
  const add = (a: number, b: number) => unique.add(`${Math.min(a, b)}_${Math.max(a, b)}`);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i];
    const b = indices[i + 1];
    const c = indices[i + 2];
    add(a, b);
    add(b, c);
    add(c, a);
  }
  return unique.size;
}

const CountBadge: React.FC<{ value: number }> = ({ value }) => (
  <span className="text-[9px] font-mono text-text-secondary bg-black/30 rounded px-1.5 py-0.5 border border-white/5">
    {value}
  </span>
);

export const MeshAssetHierarchy: React.FC<MeshAssetHierarchyProps> = ({
  asset,
  activeSection,
  meshComponentMode,
  onSectionChange,
  onMeshComponentModeChange,
}) => {
  const [geometryExpanded, setGeometryExpanded] = useState(true);
  const [deformExpanded, setDeformExpanded] = useState(true);
  const counts = useMemo(
    () => ({
      vertices: Math.floor(asset.geometry.vertices.length / 3),
      edges: countUniqueEdges(asset),
      faces: asset.topology?.faces?.length || Math.floor(asset.geometry.indices.length / 3),
      bones: asset.type === 'SKELETAL_MESH' ? asset.skeleton?.bones?.length || 0 : 0,
    }),
    [asset],
  );

  const selectMeshMode = (section: MeshHierarchySection, mode: MeshComponentMode) => {
    if (!assetViewportAllows(asset.type, meshModeActionId(mode))) return;
    onSectionChange(section);
    onMeshComponentModeChange(mode);
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="h-8 px-2.5 border-b border-white/10 bg-black/15 flex items-center gap-2 shrink-0">
        <Icon name="ListTree" size={12} className="text-accent" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-text-secondary">Hierarchy</span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
        <HierarchyTreeItem
          id={`${asset.id}:asset`}
          name={asset.name}
          icon={asset.type === 'SKELETAL_MESH' ? 'PersonStanding' : 'Box'}
          iconColor={asset.type === 'SKELETAL_MESH' ? 'text-purple-400' : 'text-blue-400'}
          isSelected={activeSection === 'ASSET'}
          canRename={false}
          onSelect={() => {
            onSectionChange('ASSET');
            if (assetViewportAllows(asset.type, 'mesh.object')) onMeshComponentModeChange('OBJECT');
          }}
        />

        <HierarchyTreeItem
          id={`${asset.id}:geometry`}
          name="Geometry"
          depth={1}
          icon="Boxes"
          hasChildren
          isExpanded={geometryExpanded}
          isSelected={activeSection === 'GEOMETRY'}
          canRename={false}
          onToggleExpand={() => setGeometryExpanded(v => !v)}
          onSelect={() => {
            onSectionChange('GEOMETRY');
            if (assetViewportAllows(asset.type, 'mesh.object')) onMeshComponentModeChange('OBJECT');
          }}
        >
          <HierarchyTreeItem
            id={`${asset.id}:vertices`}
            name="Vertices"
            depth={2}
            icon="CircleDot"
            badge={<CountBadge value={counts.vertices} />}
            isSelected={activeSection === 'VERTICES' || meshComponentMode === 'VERTEX'}
            canRename={false}
            onSelect={() => selectMeshMode('VERTICES', 'VERTEX')}
          />
          <HierarchyTreeItem
            id={`${asset.id}:edges`}
            name="Edges"
            depth={2}
            icon="Spline"
            badge={<CountBadge value={counts.edges} />}
            isSelected={activeSection === 'EDGES' || meshComponentMode === 'EDGE'}
            canRename={false}
            onSelect={() => selectMeshMode('EDGES', 'EDGE')}
          />
          <HierarchyTreeItem
            id={`${asset.id}:faces`}
            name="Faces"
            depth={2}
            icon="Square"
            badge={<CountBadge value={counts.faces} />}
            isSelected={activeSection === 'FACES' || meshComponentMode === 'FACE'}
            canRename={false}
            onSelect={() => selectMeshMode('FACES', 'FACE')}
          />
        </HierarchyTreeItem>

        {asset.type === 'SKELETAL_MESH' && (
          <HierarchyTreeItem
            id={`${asset.id}:deformation`}
            name="Deformation"
            depth={1}
            icon="Activity"
            hasChildren
            isExpanded={deformExpanded}
            canRename={false}
            onToggleExpand={() => setDeformExpanded(v => !v)}
          >
            <HierarchyTreeItem
              id={`${asset.id}:skin`}
              name="Skin Weights"
              depth={2}
              icon="Paintbrush"
              isSelected={activeSection === 'SKIN'}
              canRename={false}
              onSelect={() => onSectionChange('SKIN')}
            />
            <HierarchyTreeItem
              id={`${asset.id}:skeleton`}
              name="Skeleton"
              depth={2}
              icon="Bone"
              badge={<CountBadge value={counts.bones} />}
              isSelected={activeSection === 'SKELETON'}
              canRename={false}
              onSelect={() => onSectionChange('SKELETON')}
            />
          </HierarchyTreeItem>
        )}
      </div>
    </div>
  );
};
