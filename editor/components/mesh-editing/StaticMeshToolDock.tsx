import React, { useEffect, useMemo, useRef, useState } from 'react';

import type { SoftSelectionMode } from '@/engine/mesh-editing/SoftSelection';
import { editorCommandRegistry, type EditorCommandContext, type ResolvedEditorCommand } from '@/editor/commands/EditorCommandRegistry';
import type { MeshComponentMode, SoftSelectionConnectivity, SoftSelectionFalloff, StaticMeshAsset } from '@/types';
import type { StaticMeshCompositionSource } from '@/engine/api/StaticMeshAssetAPI';

import { Icon } from '../Icon';
import { Select } from '../ui/Select';
import { MeshAssetHierarchy, type MeshHierarchySection } from '../asset-editor/MeshAssetHierarchy';
import { StaticMeshAssetField } from '../inspector/StaticMeshAssetField';

interface MeshSelectionCounts {
  object: number;
  vertices: number;
  edges: number;
  faces: number;
}

export interface StaticMeshToolDockProps {
  asset: StaticMeshAsset;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  activeSection: MeshHierarchySection;
  meshComponentMode: MeshComponentMode;
  onSectionChange: (section: MeshHierarchySection) => void;
  onMeshComponentModeChange: (mode: MeshComponentMode) => void;
  selectedShellIds?: readonly string[];
  onShellSelect?: (shellId: string | null, operation?: 'REPLACE' | 'TOGGLE') => void;
  onShellComponentSelect?: (shellId: string, mode: Exclude<MeshComponentMode, 'OBJECT'>, operation?: 'REPLACE' | 'TOGGLE') => void;
  onGlobalComponentSelect?: (mode: Exclude<MeshComponentMode, 'OBJECT'>) => void;
  onObjectSelect?: () => void;
  assetRevision?: number;
  selectionCounts: MeshSelectionCounts;
  softSelectionEnabled: boolean;
  softSelectionRadius: number;
  softSelectionMode: SoftSelectionMode;
  softSelectionFalloff: SoftSelectionFalloff;
  softSelectionSurfaceBlend: number;
  softSelectionConnectivity: SoftSelectionConnectivity;
  softSelectionHeatmapVisible: boolean;
  onSoftSelectionRadiusChange: (radius: number) => void;
  onSoftSelectionFalloffChange: (falloff: SoftSelectionFalloff) => void;
  onSoftSelectionSurfaceBlendChange: (surfaceBlend: number) => void;
  onSoftSelectionConnectivityChange: (connectivity: SoftSelectionConnectivity) => void;
  compositionSources?: StaticMeshCompositionSource[];
  onAppendMesh?: (sourceAssetId: string) => void;
  commandContext: EditorCommandContext;
}


const SOFT_MODE_COMMANDS: Array<{ mode: SoftSelectionMode; id: string }> = [
  { mode: 'FIXED', id: 'staticMesh.softTransform.fixed' },
  { mode: 'LIVE_FALLOFF', id: 'staticMesh.softTransform.live' },
  { mode: 'SLIDE', id: 'staticMesh.sculpt.slide' },
];

const FALLOFF_OPTIONS = [
  { label: 'Volume (Euclidean)', value: 'VOLUME' },
  { label: 'Surface (Face-aware)', value: 'SURFACE' },
  { label: 'Hybrid (Blend)', value: 'HYBRID' },
];

const CONNECTIVITY_OPTIONS = [
  { label: 'None', value: 'NONE' },
  { label: 'Same Island', value: 'SAME_ISLAND' },
  { label: 'Flood Within Radius', value: 'FLOOD_WITHIN_RADIUS' },
];

const MODE_LABEL: Record<MeshComponentMode, string> = {
  OBJECT: 'Object',
  VERTEX: 'Vertex',
  EDGE: 'Edge',
  FACE: 'Face',
};

const SELECTION_TOOL_COMMANDS = [
  'staticMesh.selection.expand',
  'staticMesh.selection.shrink',
  'staticMesh.selection.ring',
] as const;

const PLACEHOLDER_SELECTION_TOOLS = [
  { id: 'selection.boundary', label: 'Boundary', icon: 'Spline', milestone: 'M2', hint: 'Select the current boundary loop.' },
] as const;

const PLACEHOLDER_BASIC_SCULPT_TOOLS = [
  { id: 'brush.move', label: 'Move', icon: 'Move', milestone: 'M3', hint: 'Brush move sculpt with no preselection.' },
  { id: 'brush.smooth', label: 'Smooth', icon: 'Waves', milestone: 'M3', hint: 'Smooth surface noise under the brush.' },
  { id: 'brush.inflate', label: 'Inflate', icon: 'CircleDot', milestone: 'M3', hint: 'Inflate or deflate surface volume.' },
  { id: 'brush.relax', label: 'Relax', icon: 'ScanLine', milestone: 'M3', hint: 'Relax or flatten local vertex flow.' },
] as const;

const PLACEHOLDER_TOPOLOGY_TOOLS = [
  { id: 'topology.bevel', label: 'Bevel', icon: 'Ungroup', milestone: 'M3', hint: 'Bevel selected edges or faces.' },
  { id: 'topology.extrude', label: 'Extrude', icon: 'ArrowUpSquare', milestone: 'M3', hint: 'Extrude selected faces.' },
  { id: 'topology.inset', label: 'Inset', icon: 'Shrink', milestone: 'M3', hint: 'Inset the current face region.' },
  { id: 'topology.connect', label: 'Connect', icon: 'GitCommit', milestone: 'M3', hint: 'Connect selected components with new topology.' },
] as const;

const SectionHeader: React.FC<{
  icon: string;
  title: string;
  expanded: boolean;
  onToggle: () => void;
}> = ({ icon, title, expanded, onToggle }) => (
  <button
    type="button"
    title={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
    onClick={onToggle}
    className="h-7 w-full px-2 flex items-center gap-2 border-b border-white/10 bg-black/15 text-text-secondary hover:text-white transition-colors"
  >
    <Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} size={11} />
    <Icon name={icon as any} size={11} className="text-accent" />
    <span className="text-[9px] uppercase tracking-wider font-semibold truncate">{title}</span>
  </button>
);

const SubsectionLabel: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <div className="space-y-0.5">
    <div className="text-[9px] uppercase tracking-wider font-semibold text-text-secondary">{title}</div>
    {subtitle && <div className="text-[8px] leading-3 text-text-secondary/70">{subtitle}</div>}
  </div>
);

const ToolGrid: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="grid grid-cols-2 gap-1.5">{children}</div>
);

const SquareToolButton: React.FC<{
  label: string;
  icon: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  badge?: string;
  onClick?: () => void;
}> = ({ label, icon, hint, active = false, disabled = false, badge, onClick }) => (
  <button
    type="button"
    title={hint ?? label}
    aria-label={label}
    disabled={disabled}
    onClick={onClick}
    className={`relative min-h-[58px] rounded border px-2 py-2 flex flex-col items-center justify-center gap-1.5 text-center transition-colors ${
      disabled
        ? 'bg-black/10 border-white/5 text-text-secondary/40 cursor-not-allowed'
        : active
          ? 'bg-accent/10 border-accent/35 text-white'
          : 'bg-black/20 border-white/5 text-text-secondary hover:text-white hover:bg-white/5'
    }`}
  >
    {badge && (
      <span className="absolute top-1 right-1 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-[7px] font-semibold tracking-wide text-text-secondary">
        {badge}
      </span>
    )}
    <Icon name={icon as any} size={13} className={active ? 'text-accent' : ''} />
    <span className="text-[9px] font-semibold leading-3">{label}</span>
  </button>
);

const CommandToolButton: React.FC<{
  command: ResolvedEditorCommand | null;
  fallbackLabel: string;
  fallbackIcon?: string;
  active?: boolean;
  forcedDisabled?: boolean;
  badge?: string;
  onClick?: () => void;
}> = ({ command, fallbackLabel, fallbackIcon = 'Square', active = false, forcedDisabled = false, badge, onClick }) => {
  const disabled = forcedDisabled || !command?.isEnabled;
  return (
    <SquareToolButton
      label={command?.label ?? fallbackLabel}
      icon={command?.icon ?? fallbackIcon}
      hint={command?.description ?? fallbackLabel}
      active={active}
      disabled={disabled}
      badge={badge}
      onClick={onClick}
    />
  );
};

export const StaticMeshToolDock: React.FC<StaticMeshToolDockProps> = ({
  asset,
  collapsed,
  onCollapsedChange,
  activeSection,
  meshComponentMode,
  onSectionChange,
  onMeshComponentModeChange,
  selectedShellIds = [],
  onShellSelect,
  onShellComponentSelect,
  onGlobalComponentSelect,
  onObjectSelect,
  assetRevision = 0,
  selectionCounts,
  softSelectionEnabled,
  softSelectionRadius,
  softSelectionMode,
  softSelectionFalloff,
  softSelectionSurfaceBlend,
  softSelectionConnectivity,
  softSelectionHeatmapVisible,
  onSoftSelectionRadiusChange,
  onSoftSelectionFalloffChange,
  onSoftSelectionSurfaceBlendChange,
  onSoftSelectionConnectivityChange,
  compositionSources = [],
  onAppendMesh,
  commandContext,
}) => {
  const [hierarchyExpanded, setHierarchyExpanded] = useState(true);
  const [toolsExpanded, setToolsExpanded] = useState(true);
  const [appendSourceAssetId, setAppendSourceAssetId] = useState('');

  useEffect(() => {
    if (compositionSources.some(source => source.id === appendSourceAssetId)) return;
    setAppendSourceAssetId(compositionSources[0]?.id ?? '');
  }, [appendSourceAssetId, compositionSources]);

  const appendSource = compositionSources.find(source => source.id === appendSourceAssetId) ?? null;
  const [hierarchyPercent, setHierarchyPercent] = useState(36);
  const [resizingSections, setResizingSections] = useState(false);
  const resizingSectionsRef = useRef(false);
  const sectionStackRef = useRef<HTMLDivElement>(null);

  const componentEditing = meshComponentMode !== 'OBJECT';
  const componentSeedCount = meshComponentMode === 'VERTEX'
    ? selectionCounts.vertices
    : meshComponentMode === 'EDGE'
      ? selectionCounts.edges
      : meshComponentMode === 'FACE'
        ? selectionCounts.faces
        : 0;

  const componentModeSummary = componentEditing
    ? `${MODE_LABEL[meshComponentMode]} mode • ${componentSeedCount} selected`
    : 'Enter Vertex, Edge, or Face mode to use selection-driven tools.';

  const softToggleCommand = editorCommandRegistry.resolve('staticMesh.softSelection.toggle', commandContext);
  const heatmapCommand = editorCommandRegistry.resolve('staticMesh.softSelection.toggleHeatmap', commandContext);
  const loopCommand = editorCommandRegistry.resolve('staticMesh.selectLoop', commandContext);
  const deformationCommands = SOFT_MODE_COMMANDS.map(item => ({ item, command: editorCommandRegistry.resolve(item.id, commandContext) }));

  const selectionActionButtons = useMemo(() => {
    const items: Array<{
      key: string;
      command?: ResolvedEditorCommand | null;
      label: string;
      icon: string;
      badge?: string;
      hint?: string;
      active?: boolean;
      disabled?: boolean;
      onClick?: () => void;
    }> = [];

    items.push({
      key: 'loop',
      command: loopCommand,
      label: loopCommand?.label ?? 'Loop',
      icon: loopCommand?.icon ?? 'RefreshCw',
      hint: loopCommand?.description,
      onClick: () => editorCommandRegistry.execute('staticMesh.selectLoop', commandContext),
      disabled: !componentEditing,
    });

    SELECTION_TOOL_COMMANDS.forEach(commandId => {
      const command = editorCommandRegistry.resolve(commandId, commandContext);
      if (!command) return;
      items.push({
        key: commandId,
        command,
        label: command.label,
        icon: command.icon,
        hint: command.description,
        onClick: () => editorCommandRegistry.execute(commandId, commandContext),
        disabled: !componentEditing,
      });
    });

    PLACEHOLDER_SELECTION_TOOLS.forEach(tool => {
      items.push({
        key: tool.id,
        label: tool.label,
        icon: tool.icon,
        badge: tool.milestone,
        hint: tool.hint,
        disabled: true,
      });
    });

    return items;
  }, [commandContext, componentEditing, loopCommand]);

  const topologyActionButtons = useMemo(() => {
    const maybeCommand = (id: string) => editorCommandRegistry.resolve(id, commandContext);
    return [
      { key: 'bevel', command: maybeCommand('staticMesh.bevel'), label: 'Bevel', icon: 'Ungroup', badge: 'M3', hint: 'Bevel selected edges or faces.' },
      { key: 'extrude', command: maybeCommand('staticMesh.extrude'), label: 'Extrude', icon: 'ArrowUpSquare', badge: 'M3', hint: 'Extrude selected faces.' },
      { key: 'inset', label: 'Inset', icon: 'Shrink', badge: 'M3', hint: 'Inset the current face region.' },
      { key: 'connect', command: maybeCommand('staticMesh.connect'), label: 'Connect', icon: 'GitCommit', badge: 'M3', hint: 'Connect selected components with new topology.' },
    ];
  }, [commandContext]);

  const executeCommand = (id: string) => editorCommandRegistry.execute(id, commandContext);

  const updateSectionSplit = (clientY: number) => {
    const container = sectionStackRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    if (rect.height <= 0) return;

    const minSectionPixels = 92;
    const minPercent = Math.min(45, (minSectionPixels / rect.height) * 100);
    const maxPercent = Math.max(55, 100 - minPercent);
    const nextPercent = ((clientY - rect.top) / rect.height) * 100;
    setHierarchyPercent(Math.max(minPercent, Math.min(maxPercent, nextPercent)));
  };

  const handleSplitterPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!hierarchyExpanded || !toolsExpanded) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizingSectionsRef.current = true;
    setResizingSections(true);
    updateSectionSplit(event.clientY);
  };

  const handleSplitterPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingSectionsRef.current) return;
    updateSectionSplit(event.clientY);
  };

  const stopSectionResize = () => {
    resizingSectionsRef.current = false;
    setResizingSections(false);
  };

  const handleSplitterPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizingSectionsRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    stopSectionResize();
  };

  const handleSplitterKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const delta = event.key === 'ArrowUp' ? -5 : 5;
    setHierarchyPercent(value => Math.max(15, Math.min(85, value + delta)));
  };


  const renderHierarchySection = () => {
    const splitActive = hierarchyExpanded && toolsExpanded;
    return (
      <section
        className={`${hierarchyExpanded ? 'min-h-[92px]' : 'h-7'} shrink-0 min-w-0 flex flex-col`}
        style={splitActive ? { flexBasis: `${hierarchyPercent}%` } : hierarchyExpanded ? { flex: '1 1 auto' } : undefined}
      >
        <SectionHeader
          icon="ListTree"
          title="Hierarchy"
          expanded={hierarchyExpanded}
          onToggle={() => setHierarchyExpanded(value => !value)}
        />
        {hierarchyExpanded && (
          <div className="flex-1 min-h-0 overflow-hidden">
            <MeshAssetHierarchy
              asset={asset}
              activeSection={activeSection}
              meshComponentMode={meshComponentMode}
              onSectionChange={onSectionChange}
              onMeshComponentModeChange={onMeshComponentModeChange}
              selectedShellIds={selectedShellIds}
              onShellSelect={onShellSelect}
              onShellComponentSelect={onShellComponentSelect}
              onGlobalComponentSelect={onGlobalComponentSelect}
              onObjectSelect={onObjectSelect}
              selectionCounts={selectionCounts}
              assetRevision={assetRevision}
              showHeader={false}
            />
          </div>
        )}
      </section>
    );
  };

  const renderToolsSection = () => {
    return (
      <section className={`${toolsExpanded ? 'flex-1 min-h-[92px]' : 'h-7'} min-w-0 flex flex-col`}>
        <SectionHeader
          icon="Wrench"
          title="Sculpt Tools"
          expanded={toolsExpanded}
          onToggle={() => setToolsExpanded(value => !value)}
        />

        {toolsExpanded && (
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 space-y-3">
            <div className="space-y-1.5">
              <SubsectionLabel
                title="Mesh Assembly"
                subtitle="Choose a Static Mesh asset, then append a remapped copy into this asset."
              />
              {compositionSources.length === 0 ? (
                <div className="rounded border border-white/5 bg-black/15 p-2 text-[9px] leading-4 text-text-secondary">
                  No other Static Mesh assets are available. Create or import a mesh to use it as an append source.
                </div>
              ) : (
                <div className="rounded border border-white/5 bg-black/15 p-2 space-y-1.5">
                  <StaticMeshAssetField
                    label="Source"
                    sources={compositionSources}
                    value={appendSourceAssetId}
                    onChange={setAppendSourceAssetId}
                  />
                  {appendSource && (
                    <div className="px-0.5 text-[8px] leading-3 text-text-secondary/70">
                      {appendSource.shellCount} Mesh Shell{appendSource.shellCount === 1 ? '' : 's'} • {appendSource.vertexCount} vertices • {appendSource.triangleCount} triangles • {appendSource.faceCount} faces
                    </div>
                  )}
                  <button
                    type="button"
                    title={appendSource
                      ? `Append ${appendSource.name}. New component IDs start after the current target ranges.`
                      : 'Choose a Static Mesh to append.'}
                    aria-label="Append selected Static Mesh"
                    disabled={!onAppendMesh || !appendSource || appendSource.vertexCount === 0}
                    onClick={() => appendSource && onAppendMesh?.(appendSource.id)}
                    className={`w-full h-7 rounded border text-[9px] font-semibold transition-colors ${
                      onAppendMesh && appendSource && appendSource.vertexCount > 0
                        ? 'border-white/10 bg-white/[0.03] text-text-primary hover:bg-white/[0.07] hover:text-white'
                        : 'border-white/5 bg-black/10 text-text-secondary/35 cursor-not-allowed'
                    }`}
                  >
                    Append Mesh
                  </button>
                </div>
              )}
              <div className="text-[8px] leading-3 text-text-secondary/70">
                Append copies geometry and remaps vertex/triangle/face IDs after the current ranges. It does not weld coincident vertices.
              </div>
            </div>

            <div className="space-y-1.5 pt-1 border-t border-white/5">
              <SubsectionLabel title="Influence" subtitle="Shared settings for selection-driven deformation." />
              <button
                type="button"
                title="Toggle soft selection"
                aria-label="Toggle soft selection"
                disabled={!softToggleCommand?.isEnabled}
                onClick={() => executeCommand('staticMesh.softSelection.toggle')}
                className={`w-full p-2 rounded border text-left transition-colors ${
                  !componentEditing
                    ? 'bg-black/10 border-white/5 text-text-secondary/40 cursor-not-allowed'
                    : softSelectionEnabled
                      ? 'bg-accent/10 border-accent/35 text-white'
                      : 'bg-black/20 border-white/5 text-text-secondary hover:text-white hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon name="Target" size={13} className={softSelectionEnabled ? 'text-accent' : ''} />
                  <span className="text-[10px] font-semibold">{softToggleCommand?.label ?? 'Soft Selection'}</span>
                  <span className={`ml-auto text-[8px] px-1.5 py-0.5 rounded border ${
                    softSelectionEnabled
                      ? 'text-accent border-accent/30 bg-accent/10'
                      : 'text-text-secondary border-white/10 bg-black/20'
                  }`}>
                    {softSelectionEnabled ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="mt-1 text-[9px] leading-4 text-text-secondary">Weighted influence around the current component selection.</div>
              </button>
            </div>

            <div className="space-y-1.5 pt-1 border-t border-white/5">
              <SubsectionLabel title="Selection Deform" subtitle={componentModeSummary} />
              {!componentEditing && (
                <div className="rounded border border-white/5 bg-black/15 p-2 text-[9px] leading-4 text-text-secondary">
                  Enter Vertex, Edge, or Face mode to activate selection-based deformation tools.
                </div>
              )}
              <ToolGrid>
                {deformationCommands.map(({ item, command }) => (
                  <CommandToolButton
                    key={item.mode}
                    command={command}
                    fallbackLabel={item.mode}
                    active={softSelectionEnabled && softSelectionMode === item.mode}
                    forcedDisabled={!componentEditing}
                    onClick={() => executeCommand(item.id)}
                  />
                ))}
              </ToolGrid>
            </div>

            {softSelectionEnabled && componentEditing && (
              <div className="space-y-2 rounded border border-white/5 bg-black/20 p-2">
                <div className="flex items-center justify-between text-[9px] text-text-secondary">
                  <span>Radius</span>
                  <span className="font-mono text-white/80">{softSelectionRadius.toFixed(1)}m</span>
                </div>
                <input
                  type="range"
                  title="Soft selection radius"
                  aria-label="Soft selection radius"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={softSelectionRadius}
                  onChange={event => onSoftSelectionRadiusChange(Number(event.target.value))}
                  className="w-full"
                />

                <div className="space-y-1">
                  <span className="text-[9px] text-text-secondary">Distance</span>
                  <Select
                    value={softSelectionFalloff}
                    options={FALLOFF_OPTIONS}
                    onChange={value => onSoftSelectionFalloffChange(value as SoftSelectionFalloff)}
                    className="w-full"
                  />
                </div>

                {softSelectionFalloff === 'HYBRID' && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[9px] text-text-secondary">
                      <span>Surface Blend</span>
                      <span className="font-mono text-white/80">{Math.round(softSelectionSurfaceBlend * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      title="Hybrid surface blend"
                      aria-label="Hybrid surface blend"
                      min="0"
                      max="1"
                      step="0.05"
                      value={softSelectionSurfaceBlend}
                      onChange={event => onSoftSelectionSurfaceBlendChange(Number(event.target.value))}
                      className="w-full"
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <span className="text-[9px] text-text-secondary">Connectivity</span>
                  <Select
                    value={softSelectionConnectivity}
                    options={CONNECTIVITY_OPTIONS}
                    onChange={value => onSoftSelectionConnectivityChange(value as SoftSelectionConnectivity)}
                    className="w-full"
                  />
                  <div className="text-[8px] leading-3 text-text-secondary/70">
                    {softSelectionConnectivity === 'NONE'
                      ? 'Distance only; disconnected Mesh Shells may be influenced.'
                      : softSelectionConnectivity === 'SAME_ISLAND'
                        ? 'Restrict influence to topology connected to the selection.'
                        : 'Flood connected neighbors only while they remain inside the spatial radius.'}
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[9px] text-text-secondary">Display</span>
                  <ToolGrid>
                    <CommandToolButton
                      command={heatmapCommand}
                      fallbackLabel="Heatmap"
                      fallbackIcon="Flame"
                      active={softSelectionHeatmapVisible}
                      forcedDisabled={!componentEditing}
                      onClick={() => executeCommand('staticMesh.softSelection.toggleHeatmap')}
                    />
                  </ToolGrid>
                </div>
              </div>
            )}

            <div className="space-y-1.5 pt-1 border-t border-white/5">
              <SubsectionLabel title="Selection Actions" subtitle="Operations that require a vertex, edge, or face selection." />
              <ToolGrid>
                {selectionActionButtons.map(button => button.command ? (
                  <CommandToolButton
                    key={button.key}
                    command={button.command}
                    fallbackLabel={button.label}
                    fallbackIcon={button.icon}
                    active={button.active}
                    forcedDisabled={button.disabled}
                    badge={button.badge}
                    onClick={button.onClick}
                  />
                ) : (
                  <SquareToolButton
                    key={button.key}
                    label={button.label}
                    icon={button.icon}
                    hint={button.hint}
                    disabled={button.disabled}
                    badge={button.badge}
                  />
                ))}
              </ToolGrid>
            </div>

            <div className="space-y-1.5 pt-1 border-t border-white/5">
              <SubsectionLabel title="Basic Sculpt" subtitle="Brush-style sculpt tools that will not require preselection." />
              <ToolGrid>
                {PLACEHOLDER_BASIC_SCULPT_TOOLS.map(tool => (
                  <SquareToolButton
                    key={tool.id}
                    label={tool.label}
                    icon={tool.icon}
                    hint={tool.hint}
                    disabled={true}
                    badge={tool.milestone}
                  />
                ))}
              </ToolGrid>
            </div>

            <div className="space-y-1.5 pt-1 border-t border-white/5">
              <SubsectionLabel title="Topology" subtitle="Milestone tools for future topology editing tests." />
              <ToolGrid>
                {topologyActionButtons.map(tool => tool.command ? (
                  <CommandToolButton
                    key={tool.key}
                    command={tool.command}
                    fallbackLabel={tool.label}
                    fallbackIcon={tool.icon}
                    badge={tool.badge}
                    forcedDisabled={false}
                    onClick={() => tool.command && editorCommandRegistry.execute(tool.command.id, commandContext)}
                  />
                ) : (
                  <SquareToolButton
                    key={tool.key}
                    label={tool.label}
                    icon={tool.icon}
                    hint={tool.hint}
                    disabled={true}
                    badge={tool.badge}
                  />
                ))}
              </ToolGrid>
            </div>
          </div>
        )}
      </section>
    );
  };

  if (collapsed) {
    return (
      <div className="h-full flex flex-col items-center bg-[#181818]">
        <button
          type="button"
          title="Expand mesh workspace dock"
          aria-label="Expand mesh workspace dock"
          onClick={() => onCollapsedChange(false)}
          className="w-full h-8 flex items-center justify-center border-b border-white/10 text-text-secondary hover:text-white hover:bg-white/5"
        >
          <Icon name="ChevronRight" size={13} />
        </button>
        <div className="mt-2 flex flex-col items-center gap-2 text-text-secondary/60">
          <Icon name="ListTree" size={12} />
          <Icon name="Wrench" size={12} />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 flex flex-col bg-[#181818]">
      <div className="h-8 shrink-0 px-2 border-b border-white/10 bg-[#1d1d1d] flex items-center gap-2">
        <Icon name="Wrench" size={12} className="text-accent" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-white/80">Mesh Workspace</span>
        <button
          type="button"
          title="Collapse mesh workspace dock"
          aria-label="Collapse mesh workspace dock"
          onClick={() => onCollapsedChange(true)}
          className="ml-auto w-6 h-6 flex items-center justify-center rounded text-text-secondary hover:text-white hover:bg-white/5"
        >
          <Icon name="ChevronLeft" size={12} />
        </button>
      </div>

      <div ref={sectionStackRef} className="flex-1 min-h-0 flex flex-col">
        {renderHierarchySection()}

        {hierarchyExpanded && toolsExpanded && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize hierarchy and sculpt tools"
            aria-valuemin={15}
            aria-valuemax={85}
            aria-valuenow={Math.round(hierarchyPercent)}
            tabIndex={0}
            title="Drag to resize Hierarchy and Sculpt Tools"
            onPointerDown={handleSplitterPointerDown}
            onPointerMove={handleSplitterPointerMove}
            onPointerUp={handleSplitterPointerUp}
            onPointerCancel={handleSplitterPointerUp}
            onLostPointerCapture={stopSectionResize}
            onKeyDown={handleSplitterKeyDown}
            className={`group relative h-2 shrink-0 cursor-row-resize touch-none outline-none ${
              resizingSections ? 'bg-accent/10' : 'bg-transparent'
            }`}
          >
            <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px transition-colors ${
              resizingSections ? 'bg-accent' : 'bg-white/10 group-hover:bg-accent/60 group-focus:bg-accent/60'
            }`} />
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-1 rounded-full bg-white/10 group-hover:bg-accent/50 group-focus:bg-accent/50" />
          </div>
        )}

        {renderToolsSection()}
      </div>
    </div>
  );
};
