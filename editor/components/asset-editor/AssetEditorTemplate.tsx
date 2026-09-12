import React, { useMemo, useState } from 'react';
import { AssetType } from '@/types';
import { Icon } from '@/editor/components/Icon';
import { getAssetViewportCapabilities } from './assetViewportCapabilities';

export interface AssetEditorTemplateProps {
  assetType: AssetType;
  assetName: string;
  hierarchy: React.ReactNode;
  inspector: React.ReactNode;
  children: React.ReactNode;
  headerExtra?: React.ReactNode;
  hierarchyWidth?: number;
  inspectorWidth?: number;
  defaultHierarchyVisible?: boolean;
  defaultInspectorVisible?: boolean;
}

const PanelToggle: React.FC<{
  label: string;
  icon: string;
  active: boolean;
  onClick: () => void;
}> = ({ label, icon, active, onClick }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    onClick={onClick}
    className={`h-6 px-2 rounded flex items-center gap-1.5 border transition-colors ${
      active
        ? 'bg-accent/15 border-accent/30 text-accent'
        : 'bg-black/20 border-white/5 text-text-secondary hover:text-white hover:bg-white/5'
    }`}
  >
    <Icon name={icon as any} size={11} />
    <span className="hidden lg:inline text-[9px] uppercase font-semibold tracking-wider">{label}</span>
  </button>
);

/**
 * Reusable three-column asset editor frame.
 *
 * This component owns only editor chrome/layout: hierarchy, viewport host,
 * inspector and panel visibility. Rendering/picking remains inside the viewport
 * child (normally AssetViewport3D).
 */
export const AssetEditorTemplate: React.FC<AssetEditorTemplateProps> = ({
  assetType,
  assetName,
  hierarchy,
  inspector,
  children,
  headerExtra,
  hierarchyWidth = 240,
  inspectorWidth = 304,
  defaultHierarchyVisible = true,
  defaultInspectorVisible = true,
}) => {
  const capabilities = useMemo(() => getAssetViewportCapabilities(assetType), [assetType]);
  const [showHierarchy, setShowHierarchy] = useState(
    defaultHierarchyVisible && capabilities.hasHierarchy,
  );
  const [showInspector, setShowInspector] = useState(
    defaultInspectorVisible && capabilities.hasInspector,
  );

  return (
    <div className="flex flex-col w-full h-full min-w-0 min-h-0 bg-[#151515] text-text-primary overflow-hidden select-none">
      <div className="h-8 shrink-0 border-b border-white/10 bg-[#1c1c1c] flex items-center gap-2 px-2">
        <div className="flex items-center gap-2 min-w-0 mr-auto">
          <Icon name="BoxSelect" size={12} className="text-accent shrink-0" />
          <span className="text-[10px] font-semibold text-white truncate">{assetName}</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-black/30 border border-white/5 text-text-secondary font-mono">
            {assetType}
          </span>
        </div>

        {headerExtra}

        {capabilities.hasHierarchy && (
          <PanelToggle
            label="Hierarchy"
            icon="ListTree"
            active={showHierarchy}
            onClick={() => setShowHierarchy(v => !v)}
          />
        )}
        {capabilities.hasInspector && (
          <PanelToggle
            label="Inspector"
            icon="SlidersHorizontal"
            active={showInspector}
            onClick={() => setShowInspector(v => !v)}
          />
        )}
      </div>

      <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
        {showHierarchy && capabilities.hasHierarchy && (
          <aside
            className="shrink-0 border-r border-white/10 bg-[#181818] min-h-0 overflow-hidden"
            style={{ width: hierarchyWidth }}
            aria-label={`${assetType} hierarchy`}
          >
            {hierarchy}
          </aside>
        )}

        <main className="flex-1 relative min-w-0 min-h-0 overflow-hidden">{children}</main>

        {showInspector && capabilities.hasInspector && (
          <aside
            className="shrink-0 border-l border-white/10 bg-[#181818] min-h-0 overflow-y-auto custom-scrollbar"
            style={{ width: inspectorWidth }}
            aria-label={`${assetType} inspector`}
          >
            {inspector}
          </aside>
        )}
      </div>
    </div>
  );
};
