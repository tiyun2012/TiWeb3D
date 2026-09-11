import React from 'react';
import { SkeletonVizSettings } from '@/editor/state/EditorContext';
import { Icon } from '../Icon';
import { DraggableNumber } from '../ui/InputControls';

export interface SkeletonDisplayOptionsProps {
  options: SkeletonVizSettings;
  onChange: (options: SkeletonVizSettings) => void;
  title?: string;
  showMeshOverlay?: boolean;
  meshOverlayActive?: boolean;
  onToggleMeshOverlay?: () => void;
  showWireframe?: boolean;
  wireframeActive?: boolean;
  onToggleWireframe?: () => void;
  compact?: boolean;
  className?: string;
}

export const SkeletonDisplayOptions: React.FC<SkeletonDisplayOptionsProps> = ({
  options,
  onChange,
  title = 'Skeleton Display',
  showMeshOverlay = false,
  meshOverlayActive = true,
  onToggleMeshOverlay,
  showWireframe = false,
  wireframeActive = false,
  onToggleWireframe,
  compact = false,
  className = ''
}) => {
  const updateOption = <K extends keyof SkeletonVizSettings>(key: K, val: SkeletonVizSettings[K]) => {
    onChange({
      ...options,
      [key]: val,
    });
  };

  return (
    <div className={`bg-[#1e1e20] p-3 rounded-md border border-white/10 space-y-3 ${className}`}>
      {/* Header with Enable Switch */}
      <div className="flex items-center justify-between pb-1 border-b border-white/5">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-text-primary tracking-wide">
          <Icon name="Bone" size={13} className="text-accent" />
          <span>{title}</span>
        </div>
        <label
          className="flex items-center gap-1.5 cursor-pointer select-none"
          title="Enable or disable skeleton visualization"
        >
          <span className="text-[10px] text-text-secondary font-medium">
            {options.enabled ? 'Enabled' : 'Disabled'}
          </span>
          <input
            type="checkbox"
            checked={options.enabled}
            onChange={e => updateOption('enabled', e.target.checked)}
            className="w-3.5 h-3.5 accent-accent cursor-pointer"
            title="Toggle skeleton visualization enabled"
            aria-label="Toggle skeleton visualization enabled"
          />
        </label>
      </div>

      {options.enabled && (
        <div className="space-y-3 pt-1">
          {/* Drawing Elements Toggles */}
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary opacity-70">
              Drawing Elements
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              <label
                className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-xs cursor-pointer select-none transition-colors ${
                  options.drawJoints
                    ? 'bg-accent/15 border-accent/40 text-accent font-medium'
                    : 'bg-black/20 border-white/5 text-text-secondary hover:text-text-primary'
                }`}
                title="Toggle drawing of joints"
              >
                <input
                  type="checkbox"
                  checked={options.drawJoints}
                  onChange={e => updateOption('drawJoints', e.target.checked)}
                  className="hidden"
                  title="Toggle joints"
                  aria-label="Toggle joints"
                />
                <Icon name="CircleDot" size={12} />
                <span>Joints</span>
              </label>

              <label
                className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-xs cursor-pointer select-none transition-colors ${
                  options.drawBones
                    ? 'bg-accent/15 border-accent/40 text-accent font-medium'
                    : 'bg-black/20 border-white/5 text-text-secondary hover:text-text-primary'
                }`}
                title="Toggle drawing of bones"
              >
                <input
                  type="checkbox"
                  checked={options.drawBones}
                  onChange={e => updateOption('drawBones', e.target.checked)}
                  className="hidden"
                  title="Toggle bones"
                  aria-label="Toggle bones"
                />
                <Icon name="Maximize2" size={12} />
                <span>Bones</span>
              </label>

              <label
                className={`flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-xs cursor-pointer select-none transition-colors ${
                  options.drawAxes
                    ? 'bg-accent/15 border-accent/40 text-accent font-medium'
                    : 'bg-black/20 border-white/5 text-text-secondary hover:text-text-primary'
                }`}
                title="Toggle drawing of RGB orientation axes"
              >
                <input
                  type="checkbox"
                  checked={options.drawAxes}
                  onChange={e => updateOption('drawAxes', e.target.checked)}
                  className="hidden"
                  title="Toggle axes"
                  aria-label="Toggle axes"
                />
                <Icon name="Compass" size={12} />
                <span>Axes</span>
              </label>
            </div>
          </div>

          {/* Sizing Controls */}
          <div className="space-y-2 pt-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary opacity-70">
              Scale & Dimensions
            </span>
            <div className="space-y-2">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px] text-text-secondary">
                  <span>Joint Radius</span>
                  <span className="font-mono text-[10px] text-text-primary">{Math.round(options.jointRadius)}px</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="2"
                    max="50"
                    step="1"
                    value={options.jointRadius}
                    onChange={e => updateOption('jointRadius', Math.max(2, Math.min(50, parseFloat(e.target.value))))}
                    className="flex-1 h-1.5 bg-black/40 rounded-lg appearance-none cursor-pointer accent-accent"
                    title="Adjust joint radius"
                    aria-label="Adjust joint radius"
                  />
                  <div className="w-16">
                    <DraggableNumber
                      label="R"
                      value={options.jointRadius}
                      onChange={v => updateOption('jointRadius', Math.max(2, Math.min(50, v)))}
                      step={1}
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px] text-text-secondary">
                  <span>Root Joint Multiplier</span>
                  <span className="font-mono text-[10px] text-text-primary">{options.rootScale.toFixed(2)}x</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="1"
                    max="4"
                    step="0.05"
                    value={options.rootScale}
                    onChange={e => updateOption('rootScale', Math.max(1, Math.min(4, parseFloat(e.target.value))))}
                    className="flex-1 h-1.5 bg-black/40 rounded-lg appearance-none cursor-pointer accent-accent"
                    title="Adjust root scale multiplier"
                    aria-label="Adjust root scale multiplier"
                  />
                  <div className="w-16">
                    <DraggableNumber
                      label="S"
                      value={options.rootScale}
                      onChange={v => updateOption('rootScale', Math.max(1, Math.min(4, v)))}
                      step={0.05}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Optional Mesh / Wireframe overlays */}
          {(showMeshOverlay || showWireframe) && (
            <div className="pt-2 border-t border-white/5 flex items-center gap-2">
              {showMeshOverlay && onToggleMeshOverlay && (
                <button
                  type="button"
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border text-xs transition-colors ${
                    meshOverlayActive
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400 font-medium'
                      : 'bg-black/20 border-white/5 text-text-secondary hover:text-text-primary'
                  }`}
                  onClick={onToggleMeshOverlay}
                  title="Toggle linked skeletal mesh overlay"
                  aria-label="Toggle linked skeletal mesh overlay"
                >
                  <Icon name="Box" size={12} />
                  <span>Mesh Overlay</span>
                </button>
              )}
              {showWireframe && onToggleWireframe && (
                <button
                  type="button"
                  className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded border text-xs transition-colors ${
                    wireframeActive
                      ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400 font-medium'
                      : 'bg-black/20 border-white/5 text-text-secondary hover:text-text-primary'
                  }`}
                  onClick={onToggleWireframe}
                  title="Toggle wireframe rendering"
                  aria-label="Toggle wireframe rendering"
                >
                  <Icon name="Grid" size={12} />
                  <span>Wireframe</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
