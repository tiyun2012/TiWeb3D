import React, { useMemo } from 'react';
import { MeshComponentMode, SkeletalMeshAsset, StaticMeshAsset } from '@/types';
import { Icon } from '@/editor/components/Icon';
import { MeshHierarchySection } from './MeshAssetHierarchy';
import { MaterialSlotField } from '@/editor/components/inspector/MaterialSlotField';

export interface MeshAssetInspectorProps {
  asset: StaticMeshAsset | SkeletalMeshAsset;
  section: MeshHierarchySection;
  meshComponentMode: MeshComponentMode;
  selectionCounts: { object: number; vertices: number; edges: number; faces: number };
  renderModeLabel: string;
  wireframe: boolean;
  materialId: string;
  onMaterialChange: (materialId: string) => void;
}

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 py-1.5 border-b border-white/5 last:border-b-0">
    <span className="text-[10px] text-text-secondary">{label}</span>
    <span className="text-[10px] text-white font-mono text-right break-all">{value}</span>
  </div>
);

const Card: React.FC<{ title: string; icon: string; children: React.ReactNode }> = ({ title, icon, children }) => (
  <section className="rounded-md border border-white/10 bg-black/15 overflow-hidden">
    <div className="h-8 px-2.5 border-b border-white/10 flex items-center gap-2 bg-white/[0.02]">
      <Icon name={icon as any} size={12} className="text-accent" />
      <span className="text-[10px] uppercase tracking-wider font-semibold text-text-secondary">{title}</span>
    </div>
    <div className="px-2.5 py-1">{children}</div>
  </section>
);

function geometryCounts(asset: StaticMeshAsset | SkeletalMeshAsset) {
  return {
    vertices: Math.floor(asset.geometry.vertices.length / 3),
    triangles: Math.floor(asset.geometry.indices.length / 3),
    uvSets: asset.geometry.uvs?.length ? 1 : 0,
  };
}

export const MeshAssetInspector: React.FC<MeshAssetInspectorProps> = ({
  asset,
  section,
  meshComponentMode,
  selectionCounts,
  renderModeLabel,
  wireframe,
  materialId,
  onMaterialChange,
}) => {
  const counts = useMemo(() => geometryCounts(asset), [asset]);
  const aabb = asset.geometry.aabb;
  const selectedCount =
    meshComponentMode === 'VERTEX'
      ? selectionCounts.vertices
      : meshComponentMode === 'EDGE'
        ? selectionCounts.edges
        : meshComponentMode === 'FACE'
          ? selectionCounts.faces
          : selectionCounts.object;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="h-8 px-2.5 border-b border-white/10 bg-black/15 flex items-center gap-2 shrink-0">
        <Icon name="SlidersHorizontal" size={12} className="text-accent" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-text-secondary">Inspector</span>
      </div>

      <div className="p-2.5 space-y-2.5 overflow-y-auto custom-scrollbar">
        <Card title="Asset" icon={asset.type === 'SKELETAL_MESH' ? 'PersonStanding' : 'Box'}>
          <Row label="Name" value={asset.name} />
          <Row label="Type" value={asset.type} />
          <Row label="Section" value={section} />
          {asset.path && <Row label="Path" value={asset.path} />}
        </Card>

        {(section === 'ASSET' || section === 'GEOMETRY') && (
          <Card title="Material" icon="Palette">
            <MaterialSlotField
              value={materialId}
              defaultLabel="Standard Lambert"
              onChange={onMaterialChange}
              className="py-1.5"
            />
            <div className="pb-1.5 text-[9px] leading-relaxed text-text-secondary">
              This is the mesh asset default. Scene entities with no material override inherit this slot.
            </div>
          </Card>
        )}

        {(section === 'ASSET' || section === 'GEOMETRY' || ['VERTICES', 'EDGES', 'FACES'].includes(section)) && (
          <Card title="Geometry" icon="Boxes">
            <Row label="Vertices" value={counts.vertices} />
            <Row label="Triangles" value={counts.triangles} />
            <Row label="UV Sets" value={counts.uvSets} />
            <Row label="Edit Mode" value={meshComponentMode} />
            <Row label="Selected" value={selectedCount} />
            <Row label="Shading" value={renderModeLabel} />
            <Row label="Wireframe" value={wireframe ? 'On' : 'Off'} />
          </Card>
        )}

        {aabb && (section === 'ASSET' || section === 'GEOMETRY') && (
          <Card title="Bounds" icon="Scan">
            <Row label="Min" value={`${aabb.min.x.toFixed(2)}, ${aabb.min.y.toFixed(2)}, ${aabb.min.z.toFixed(2)}`} />
            <Row label="Max" value={`${aabb.max.x.toFixed(2)}, ${aabb.max.y.toFixed(2)}, ${aabb.max.z.toFixed(2)}`} />
          </Card>
        )}

        {asset.type === 'SKELETAL_MESH' && section === 'SKIN' && (
          <Card title="Skin Weights" icon="Paintbrush">
            <Row label="Joint Indices" value={asset.geometry.jointIndices?.length ? 'Available' : 'Missing'} />
            <Row label="Joint Weights" value={asset.geometry.jointWeights?.length ? 'Available' : 'Missing'} />
            <Row label="Vertices" value={counts.vertices} />
          </Card>
        )}

        {asset.type === 'SKELETAL_MESH' && section === 'SKELETON' && (
          <Card title="Skeleton" icon="Bone">
            <Row label="Bones" value={asset.skeleton?.bones?.length || 0} />
            <Row label="Skeleton Asset" value={asset.skeletonAssetId || 'Embedded'} />
            <Row label="Animations" value={asset.animations?.length || 0} />
          </Card>
        )}

        {['VERTICES', 'EDGES', 'FACES'].includes(section) && (
          <div className="rounded-md border border-accent/20 bg-accent/5 p-2.5 text-[10px] leading-relaxed text-text-secondary">
            The hierarchy switched the viewport to <span className="text-accent font-semibold">{meshComponentMode}</span> mode.
            Viewport picking and transform triggers are limited to that component type until Object mode is selected.
          </div>
        )}
      </div>
    </div>
  );
};
