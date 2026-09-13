import React, { useState } from 'react';

import type { SoftSelectionMode } from '@/engine/mesh-editing/SoftSelection';
import { editorCommandRegistry, type EditorCommandContext } from '@/editor/commands/EditorCommandRegistry';
import type { MeshComponentMode, SoftSelectionFalloff, StaticMeshAsset } from '@/types';

import { Icon } from '../Icon';
import { Select } from '../ui/Select';
import { MeshAssetHierarchy, type MeshHierarchySection } from '../asset-editor/MeshAssetHierarchy';

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
  selectionCounts: MeshSelectionCounts;
  softSelectionEnabled: boolean;
  softSelectionRadius: number;
  softSelectionMode: SoftSelectionMode;
  softSelectionFalloff: SoftSelectionFalloff;
  softSelectionHeatmapVisible: boolean;
  onSoftSelectionRadiusChange: (radius: number) => void;
  onSoftSelectionFalloffChange: (falloff: SoftSelectionFalloff) => void;
  commandContext: EditorCommandContext;
}

const SOFT_MODE_COMMANDS: Array<{ mode: SoftSelectionMode; id: string }> = [
  { mode: 'FIXED', id: 'staticMesh.softTransform.fixed' },
  { mode: 'LIVE_FALLOFF', id: 'staticMesh.softTransform.live' },
  { mode: 'SLIDE', id: 'staticMesh.sculpt.slide' },
];

const FALLOFF_OPTIONS = [
  { label: 'Volume (Euclidean)', value: 'VOLUME' },
  { label: 'Surface (Geodesic)', value: 'SURFACE' },
];

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
    <span className="text-[9px] uppercase tracking-wider font-semibold">{title}</span>
  </button>
);

export const StaticMeshToolDock: React.FC<StaticMeshToolDockProps> = ({
  asset,
  collapsed,
  onCollapsedChange,
  activeSection,
  meshComponentMode,
  onSectionChange,
  onMeshComponentModeChange,
  selectionCounts,
  softSelectionEnabled,
  softSelectionRadius,
  softSelectionMode,
  softSelectionFalloff,
  softSelectionHeatmapVisible,
  onSoftSelectionRadiusChange,
  onSoftSelectionFalloffChange,
  commandContext,
}) => {
  const [hierarchyExpanded, setHierarchyExpanded] = useState(true);
  const [toolsExpanded, setToolsExpanded] = useState(true);

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

  const componentEditing = meshComponentMode !== 'OBJECT';
  const loopCommand = editorCommandRegistry.resolve('staticMesh.selectLoop', commandContext);
  const loopLabel = loopCommand?.label ?? 'Loop Select';
  const loopHint = loopCommand?.description ?? 'Loop selection is unavailable in this context.';
  const loopAvailable = Boolean(loopCommand?.isEnabled);
  const loopSeedCount = meshComponentMode === 'VERTEX'
    ? selectionCounts.vertices
    : meshComponentMode === 'EDGE'
      ? selectionCounts.edges
      : meshComponentMode === 'FACE'
        ? selectionCounts.faces
        : 0;
  const softToggleCommand = editorCommandRegistry.resolve('staticMesh.softSelection.toggle', commandContext);

  const executeCommand = (id: string) => editorCommandRegistry.execute(id, commandContext);

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

      <section className={`${hierarchyExpanded ? 'min-h-[120px] basis-[36%]' : 'basis-7'} shrink-0 min-w-0 flex flex-col border-b border-white/10`}>
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
              showHeader={false}
            />
          </div>
        )}
      </section>

      <section className="flex-1 min-h-0 flex flex-col">
        <SectionHeader
          icon="Wrench"
          title="Sculpt Tools"
          expanded={toolsExpanded}
          onToggle={() => setToolsExpanded(value => !value)}
        />

        {toolsExpanded && (
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-2 space-y-3">
            <div className="space-y-1.5">
              <div className="text-[9px] uppercase tracking-wider font-semibold text-text-secondary">Influence</div>
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

            <div className="space-y-1.5">
              <div className="text-[9px] uppercase tracking-wider font-semibold text-text-secondary">Deformation Tool</div>
              {!componentEditing && (
                <div className="rounded border border-white/5 bg-black/15 p-2 text-[9px] leading-4 text-text-secondary">
                  Enter Vertex, Edge, or Face mode to activate mesh deformation tools.
                </div>
              )}
              {SOFT_MODE_COMMANDS.map(item => {
                const command = editorCommandRegistry.resolve(item.id, commandContext);
                if (!command) return null;
                const active = softSelectionEnabled && softSelectionMode === item.mode;
                return (
                  <button
                    key={item.mode}
                    type="button"
                    title={command.description}
                    aria-label={command.label}
                    disabled={!command.isEnabled}
                    onClick={() => executeCommand(item.id)}
                    className={`w-full p-2 rounded border text-left transition-colors ${
                      !componentEditing
                        ? 'bg-black/10 border-white/5 text-text-secondary/40 cursor-not-allowed'
                        : active
                          ? 'bg-accent/10 border-accent/35 text-white'
                          : 'bg-black/20 border-white/5 text-text-secondary hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon name={command.icon as any} size={12} className={active ? 'text-accent' : ''} />
                      <span className="text-[10px] font-semibold">{command.label}</span>
                    </div>
                    <div className="mt-1 text-[9px] leading-4 text-text-secondary">{command.description}</div>
                  </button>
                );
              })}
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

                <label className="flex items-center justify-between gap-2 text-[9px] text-text-secondary cursor-pointer">
                  <span>Show Heatmap</span>
                  <input
                    type="checkbox"
                    title="Show soft selection heatmap"
                    aria-label="Show soft selection heatmap"
                    checked={softSelectionHeatmapVisible}
                    onChange={() => executeCommand('staticMesh.softSelection.toggleHeatmap')}
                    className="accent-accent"
                  />
                </label>
              </div>
            )}

            <div className="space-y-1.5 pt-1 border-t border-white/5">
              <div className="text-[9px] uppercase tracking-wider font-semibold text-text-secondary">Selection Tools</div>
              <button
                type="button"
                title={loopHint}
                aria-label={loopLabel}
                disabled={!loopAvailable}
                onClick={() => executeCommand('staticMesh.selectLoop')}
                className={`w-full p-2 rounded border text-left transition-colors ${
                  loopAvailable
                    ? 'bg-black/20 border-white/5 text-text-primary hover:text-white hover:bg-white/5'
                    : 'bg-black/10 border-white/5 text-text-secondary/40 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Icon name="Repeat" size={12} />
                  <span className="text-[10px] font-semibold">{loopLabel}</span>
                  <span className="ml-auto text-[8px] font-mono text-text-secondary">{loopSeedCount}</span>
                </div>
                <div className="mt-1 text-[9px] leading-4 text-text-secondary/80">{loopHint}</div>
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
