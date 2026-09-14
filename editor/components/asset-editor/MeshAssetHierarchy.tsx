import React, { useEffect, useMemo, useState } from 'react';
import { MeshComponentMode, SkeletalMeshAsset, StaticMeshAsset } from '@/types';
import { getStaticMeshShellCounts, resolveStaticMeshShells } from '@/engine/mesh-editing/StaticMeshShells';
import { HierarchyTreeItem } from '@/editor/components/HierarchyTreeItem';
import { Icon } from '@/editor/components/Icon';
import { assetViewportAllows, meshModeActionId } from './assetViewportCapabilities';

export type MeshHierarchySection =
  | 'ASSET'
  | 'GEOMETRY'
  | 'SHELL'
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
  selectedShellId?: string | null;
  onShellSelect?: (shellId: string) => void;
  /** Reactive revision for AssetManager assets, which are mutated in place. */
  assetRevision?: number;
  showHeader?: boolean;
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

const ShellSummaryBadge: React.FC<{ vertices: number; faces: number }> = ({ vertices, faces }) => (
  <span className="text-[8px] font-mono text-text-secondary/80 bg-black/20 rounded px-1.5 py-0.5 border border-white/5 whitespace-nowrap">
    V {vertices} · F {faces}
  </span>
);

export const MeshAssetHierarchy: React.FC<MeshAssetHierarchyProps> = ({
  asset,
  activeSection,
  meshComponentMode,
  onSectionChange,
  onMeshComponentModeChange,
  selectedShellId = null,
  onShellSelect,
  assetRevision = 0,
  showHeader = true,
}) => {
  const [geometryExpanded, setGeometryExpanded] = useState(true);
  const [shellsExpanded, setShellsExpanded] = useState(true);
  const [componentsExpanded, setComponentsExpanded] = useState(true);
  const [deformExpanded, setDeformExpanded] = useState(true);
  const [expandedShellIds, setExpandedShellIds] = useState<Set<string>>(() => new Set());

  const counts = useMemo(
    () => ({
      vertices: Math.floor(asset.geometry.vertices.length / 3),
      edges: countUniqueEdges(asset),
      faces: asset.topology?.faces?.length || Math.floor(asset.geometry.indices.length / 3),
      bones: asset.type === 'SKELETAL_MESH' ? asset.skeleton?.bones?.length || 0 : 0,
    }),
    [asset, assetRevision],
  );

  const shells = useMemo(
    () => asset.type === 'MESH' ? resolveStaticMeshShells(asset) : [],
    [asset, assetRevision],
  );

  const shellCounts = useMemo(() => {
    if (asset.type !== 'MESH') return new Map<string, ReturnType<typeof getStaticMeshShellCounts>>();
    return new Map(shells.map(shell => [shell.id, getStaticMeshShellCounts(asset, shell)]));
  }, [asset, shells, assetRevision]);

  useEffect(() => {
    if (!selectedShellId) return;
    setGeometryExpanded(true);
    setShellsExpanded(true);
    setExpandedShellIds(current => {
      if (current.has(selectedShellId)) return current;
      const next = new Set(current);
      next.add(selectedShellId);
      return next;
    });
  }, [selectedShellId]);

  const selectMeshMode = (section: MeshHierarchySection, mode: MeshComponentMode) => {
    if (!assetViewportAllows(asset.type, meshModeActionId(mode))) return;
    onSectionChange(section);
    onMeshComponentModeChange(mode);
  };

  const selectShell = (shellId: string) => {
    onSectionChange('SHELL');
    if (assetViewportAllows(asset.type, 'mesh.object')) onMeshComponentModeChange('OBJECT');
    onShellSelect?.(shellId);
  };

  const toggleShell = (shellId: string) => {
    setExpandedShellIds(current => {
      const next = new Set(current);
      if (next.has(shellId)) next.delete(shellId);
      else next.add(shellId);
      return next;
    });
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      {showHeader && (
        <div className="h-8 px-2.5 border-b border-white/10 bg-black/15 flex items-center gap-2 shrink-0">
          <Icon name="ListTree" size={12} className="text-accent" />
          <span className="text-[10px] uppercase tracking-wider font-semibold text-text-secondary">Hierarchy</span>
        </div>
      )}

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
          badge={asset.type === 'MESH' ? <CountBadge value={shells.length} /> : undefined}
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
          {asset.type === 'MESH' && (
            <HierarchyTreeItem
              id={`${asset.id}:shells`}
              name="Shells"
              depth={2}
              icon="Layers3"
              badge={<CountBadge value={shells.length} />}
              hasChildren={shells.length > 0}
              isExpanded={shellsExpanded}
              canRename={false}
              onToggleExpand={() => setShellsExpanded(v => !v)}
            >
              {shells.map((shell, index) => {
                const shellCount = shellCounts.get(shell.id) ?? { vertices: 0, edges: 0, faces: 0, triangles: 0 };
                const expanded = expandedShellIds.has(shell.id);
                return (
                  <HierarchyTreeItem
                    key={shell.id}
                    id={`${asset.id}:shell:${shell.id}`}
                    name={`Shell ${index} · ${shell.name}`}
                    depth={3}
                    icon="Box"
                    iconColor="text-blue-300"
                    badge={<ShellSummaryBadge vertices={shellCount.vertices} faces={shellCount.faces} />}
                    hasChildren
                    isExpanded={expanded}
                    isSelected={activeSection === 'SHELL' && selectedShellId === shell.id}
                    canRename={false}
                    onToggleExpand={() => toggleShell(shell.id)}
                    onSelect={() => selectShell(shell.id)}
                  >
                    <HierarchyTreeItem
                      id={`${asset.id}:shell:${shell.id}:vertices`}
                      name="Vertices"
                      depth={4}
                      icon="CircleDot"
                      badge={<CountBadge value={shellCount.vertices} />}
                      canRename={false}
                      className="cursor-default"
                      onSelect={() => selectShell(shell.id)}
                    />
                    <HierarchyTreeItem
                      id={`${asset.id}:shell:${shell.id}:edges`}
                      name="Edges"
                      depth={4}
                      icon="Spline"
                      badge={<CountBadge value={shellCount.edges} />}
                      canRename={false}
                      className="cursor-default"
                      onSelect={() => selectShell(shell.id)}
                    />
                    <HierarchyTreeItem
                      id={`${asset.id}:shell:${shell.id}:faces`}
                      name="Faces"
                      depth={4}
                      icon="Square"
                      badge={<CountBadge value={shellCount.faces} />}
                      canRename={false}
                      className="cursor-default"
                      onSelect={() => selectShell(shell.id)}
                    />
                    <HierarchyTreeItem
                      id={`${asset.id}:shell:${shell.id}:triangles`}
                      name="Triangles"
                      depth={4}
                      icon="Triangle"
                      badge={<CountBadge value={shellCount.triangles} />}
                      canRename={false}
                      className="cursor-default"
                      onSelect={() => selectShell(shell.id)}
                    />
                  </HierarchyTreeItem>
                );
              })}
            </HierarchyTreeItem>
          )}

          {asset.type === 'MESH' ? (
            <HierarchyTreeItem
              id={`${asset.id}:components`}
              name="Components"
              depth={2}
              icon="Component"
              hasChildren
              isExpanded={componentsExpanded}
              canRename={false}
              onToggleExpand={() => setComponentsExpanded(v => !v)}
            >
              <HierarchyTreeItem
                id={`${asset.id}:vertices`}
                name="Vertices"
                depth={3}
                icon="CircleDot"
                badge={<CountBadge value={counts.vertices} />}
                isSelected={activeSection === 'VERTICES' || meshComponentMode === 'VERTEX'}
                canRename={false}
                onSelect={() => selectMeshMode('VERTICES', 'VERTEX')}
              />
              <HierarchyTreeItem
                id={`${asset.id}:edges`}
                name="Edges"
                depth={3}
                icon="Spline"
                badge={<CountBadge value={counts.edges} />}
                isSelected={activeSection === 'EDGES' || meshComponentMode === 'EDGE'}
                canRename={false}
                onSelect={() => selectMeshMode('EDGES', 'EDGE')}
              />
              <HierarchyTreeItem
                id={`${asset.id}:faces`}
                name="Faces"
                depth={3}
                icon="Square"
                badge={<CountBadge value={counts.faces} />}
                isSelected={activeSection === 'FACES' || meshComponentMode === 'FACE'}
                canRename={false}
                onSelect={() => selectMeshMode('FACES', 'FACE')}
              />
            </HierarchyTreeItem>
          ) : (
            <>
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
            </>
          )}
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
