import React, { useEffect, useMemo, useState } from 'react';
import { MeshComponentMode, SkeletalMeshAsset, StaticMeshAsset } from '@/types';
import { Icon } from '@/editor/components/Icon';
import { MeshHierarchySection } from './MeshAssetHierarchy';
import { MaterialSlotField } from '@/editor/components/inspector/MaterialSlotField';
import type { StaticMeshCompositionSource } from '@/engine/api/StaticMeshAssetAPI';
import { getStaticMeshShellCounts, resolveStaticMeshShells } from '@/engine/mesh-editing/StaticMeshShells';
import { StaticMeshAssetField } from '@/editor/components/inspector/StaticMeshAssetField';

export interface MeshAssetInspectorProps {
  asset: StaticMeshAsset | SkeletalMeshAsset;
  section: MeshHierarchySection;
  meshComponentMode: MeshComponentMode;
  selectionCounts: { object: number; vertices: number; edges: number; faces: number };
  renderModeLabel: string;
  wireframe: boolean;
  materialId: string;
  onMaterialChange: (materialId: string) => void;
  availableMeshSources?: StaticMeshCompositionSource[];
  referenceMeshes?: Array<{ id: string; name: string }>;
  onAddReferenceMesh?: (assetId: string) => void;
  onRemoveReferenceMesh?: (assetId: string) => void;
  selectedShellId?: string | null;
  /** Reactive revision for AssetManager assets, which are mutated in place. */
  assetRevision?: number;
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


const formatIdSet = (ids: readonly number[]): string => {
  if (ids.length === 0) return '—';
  let contiguous = true;
  for (let i = 1; i < ids.length; i += 1) {
    if (ids[i] !== ids[i - 1] + 1) { contiguous = false; break; }
  }
  if (contiguous) return ids.length === 1 ? `${ids[0]}` : `${ids[0]}–${ids[ids.length - 1]}`;
  const preview = ids.slice(0, 6).join(', ');
  return ids.length > 6 ? `${preview}, … (${ids.length})` : preview;
};

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
  availableMeshSources = [],
  referenceMeshes = [],
  onAddReferenceMesh,
  onRemoveReferenceMesh,
  selectedShellId = null,
  assetRevision = 0,
}) => {
  const counts = useMemo(() => geometryCounts(asset), [asset, assetRevision]);
  const selectedShell = useMemo(() => {
    if (asset.type !== 'MESH' || !selectedShellId) return null;
    return resolveStaticMeshShells(asset).find(shell => shell.id === selectedShellId) ?? null;
  }, [asset, selectedShellId, assetRevision]);
  const selectedShellCounts = useMemo(
    () => asset.type === 'MESH' && selectedShell ? getStaticMeshShellCounts(asset, selectedShell) : null,
    [asset, selectedShell, assetRevision],
  );
  const selectedShellSource = selectedShell?.sourceAssetId
    ? availableMeshSources.find(source => source.id === selectedShell.sourceAssetId) ?? null
    : null;
  const aabb = asset.geometry.aabb;
  const referenceCandidates = useMemo(
    () => availableMeshSources.filter(source => !referenceMeshes.some(reference => reference.id === source.id)),
    [availableMeshSources, referenceMeshes],
  );
  const [referenceSourceAssetId, setReferenceSourceAssetId] = useState('');

  useEffect(() => {
    if (referenceCandidates.some(source => source.id === referenceSourceAssetId)) return;
    setReferenceSourceAssetId(referenceCandidates[0]?.id ?? '');
  }, [referenceCandidates, referenceSourceAssetId]);

  const referenceSource = referenceCandidates.find(source => source.id === referenceSourceAssetId) ?? null;
  const selectedCount =
    meshComponentMode === 'VERTEX'
      ? selectionCounts.vertices
      : meshComponentMode === 'EDGE'
        ? selectionCounts.edges
        : meshComponentMode === 'FACE'
          ? selectionCounts.faces
          : selectionCounts.object;

  const shellComponentLabel = section === 'VERTICES'
    ? 'Vertices'
    : section === 'EDGES'
      ? 'Edges'
      : section === 'FACES'
        ? 'Faces'
        : null;

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

        {asset.type === 'MESH' && selectedShell && selectedShellCounts && (
          <Card title={section === 'SHELL' ? 'Shell' : 'Shell Selection Scope'} icon="Box">
            <Row label="Name" value={selectedShell.name} />
            <Row label="Source" value={selectedShellSource?.name ?? (selectedShell.sourceAssetId ? 'Appended Mesh' : 'Base Geometry')} />
            {shellComponentLabel && <Row label="Component" value={shellComponentLabel} />}
            {shellComponentLabel && <Row label="Selected" value={selectedCount} />}
            <Row label="Vertices" value={selectedShellCounts.vertices} />
            <Row label="Edges" value={selectedShellCounts.edges} />
            <Row label="Faces" value={selectedShellCounts.faces} />
            <Row label="Triangles" value={selectedShellCounts.triangles} />
            <Row label="Vertex IDs" value={formatIdSet(selectedShell.vertexIds)} />
            <Row label="Face IDs" value={formatIdSet(selectedShell.faceIds)} />
            <div className="py-1.5 text-[9px] leading-relaxed text-text-secondary/70">
              {shellComponentLabel
                ? `This hierarchy row selected every ${shellComponentLabel.toLowerCase()} element owned by this shell. Viewport picking or marquee selection releases the shell-wide scope.`
                : 'Select Vertices, Edges, or Faces below this shell to switch component mode and select every matching element in the shell.'}
            </div>
          </Card>
        )}

        {asset.type === 'MESH' && (section === 'ASSET' || section === 'GEOMETRY') && (
          <Card title="Reference Meshes" icon="Eye">
            <div className="py-1.5 space-y-2">
              <div className="text-[9px] leading-relaxed text-text-secondary/70">
                Add non-destructive Static Mesh references for shape comparison. References render shaded but remain non-selectable.
              </div>

              {referenceCandidates.length === 0 ? (
                <div className="rounded border border-white/5 bg-black/10 p-2 text-[9px] text-text-secondary/60">
                  {availableMeshSources.length === 0
                    ? 'No other Static Mesh assets are available.'
                    : 'All available Static Mesh assets are already referenced.'}
                </div>
              ) : (
                <div className="rounded border border-white/5 bg-black/10 p-2 space-y-1.5">
                  <StaticMeshAssetField
                    label="Source"
                    sources={referenceCandidates}
                    value={referenceSourceAssetId}
                    onChange={setReferenceSourceAssetId}
                  />
                  {referenceSource && (
                    <div className="px-0.5 text-[8px] leading-3 text-text-secondary/70">
                      {referenceSource.shellCount} shell{referenceSource.shellCount === 1 ? '' : 's'} • {referenceSource.vertexCount} vertices • {referenceSource.triangleCount} triangles • {referenceSource.faceCount} faces
                    </div>
                  )}
                  <button
                    type="button"
                    title={referenceSource ? `Add ${referenceSource.name} as a reference` : 'Choose a Static Mesh reference'}
                    aria-label="Add selected Static Mesh reference"
                    disabled={!referenceSource || !onAddReferenceMesh}
                    onClick={() => referenceSource && onAddReferenceMesh?.(referenceSource.id)}
                    className={`w-full h-7 rounded border text-[9px] font-semibold transition-colors ${
                      referenceSource && onAddReferenceMesh
                        ? 'border-white/10 bg-white/[0.03] text-text-primary hover:bg-white/[0.07] hover:text-white'
                        : 'border-white/5 bg-black/10 text-text-secondary/35 cursor-not-allowed'
                    }`}
                  >
                    Add Reference
                  </button>
                </div>
              )}

              {referenceMeshes.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[8px] uppercase tracking-wider font-semibold text-text-secondary/70">Active References</div>
                  {referenceMeshes.map(reference => (
                    <div key={reference.id} className="h-7 px-1.5 rounded border border-white/5 bg-black/10 flex items-center gap-1.5">
                      <Icon name="Box" size={10} className="text-cyan-300" />
                      <span className="min-w-0 flex-1 truncate text-[9px] text-text-primary">{reference.name}</span>
                      <button
                        type="button"
                        title={`Remove ${reference.name} reference`}
                        aria-label={`Remove ${reference.name} reference`}
                        onClick={() => onRemoveReferenceMesh?.(reference.id)}
                        className="w-5 h-5 flex items-center justify-center rounded text-text-secondary hover:text-white hover:bg-white/5"
                      >
                        <Icon name="X" size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        )}

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
            The hierarchy switched the viewport to <span className="text-accent font-semibold">{meshComponentMode}</span> mode.{' '}
            {selectedShell && shellComponentLabel
              ? `All ${shellComponentLabel.toLowerCase()} elements in ${selectedShell.name} are selected.`
              : 'Viewport picking and transform triggers are limited to that component type until Object mode is selected.'}
          </div>
        )}
      </div>
    </div>
  );
};
