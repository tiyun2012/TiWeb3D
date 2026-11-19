import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Icon } from '@/editor/components/Icon';
import { ViewportIconButton, ViewportToolbarGroup } from '@/editor/components/viewport/ViewportTemplate';

export interface StaticMeshDisplayMenuProps {
  showGrid: boolean;
  onShowGridChange: (value: boolean) => void;
  wireframe: boolean;
  onWireframeChange: (value: boolean) => void;
  showFaceFill: boolean;
  onShowFaceFillChange: (value: boolean) => void;
  showFaceNormals: boolean;
  onShowFaceNormalsChange: (value: boolean) => void;
  showVertexNormals: boolean;
  onShowVertexNormalsChange: (value: boolean) => void;
  normalSize: number;
  onNormalSizeChange: (value: number) => void;
  shadingLabel: string;
  onCycleShading: () => void;
}

const ToggleRow: React.FC<{
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}> = ({ label, value, onChange }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={value}
    onClick={() => onChange(!value)}
    className="flex h-7 w-full items-center justify-between rounded px-2 text-left text-[10px] text-text-secondary hover:bg-white/5 hover:text-white"
  >
    <span>{label}</span>
    <span className={`flex h-4 w-4 items-center justify-center rounded border ${value ? 'border-accent/60 bg-accent/20 text-accent' : 'border-white/15 text-transparent'}`}>
      <Icon name="Check" size={11} />
    </span>
  </button>
);

/** Compact Static Mesh viewport display popover. It is intentionally a viewport
 * presentation surface only; topology/modeling state never lives here. */
export const StaticMeshDisplayMenu: React.FC<StaticMeshDisplayMenuProps> = ({
  showGrid,
  onShowGridChange,
  wireframe,
  onWireframeChange,
  showFaceFill,
  onShowFaceFillChange,
  showFaceNormals,
  onShowFaceNormalsChange,
  showVertexNormals,
  onShowVertexNormalsChange,
  normalSize,
  onNormalSizeChange,
  shadingLabel,
  onCycleShading,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPosition, setPopoverPosition] = useState({ left: 8, top: 8 });

  const updatePopoverPosition = useCallback(() => {
    const trigger = rootRef.current;
    if (!trigger || typeof window === 'undefined') return;

    const triggerRect = trigger.getBoundingClientRect();
    const popoverRect = popoverRef.current?.getBoundingClientRect();
    const width = popoverRect?.width ?? 224;
    const height = popoverRect?.height ?? 300;
    const margin = 8;
    const gap = 6;

    let left = triggerRect.left + triggerRect.width / 2 - width / 2;
    left = Math.min(Math.max(left, margin), Math.max(margin, window.innerWidth - width - margin));

    const below = triggerRect.bottom + gap;
    const above = triggerRect.top - height - gap;
    let top = below + height <= window.innerHeight - margin ? below : above;
    top = Math.min(Math.max(top, margin), Math.max(margin, window.innerHeight - height - margin));

    setPopoverPosition({ left, top });
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePopoverPosition();
    const frame = window.requestAnimationFrame(updatePopoverPosition);
    window.addEventListener('resize', updatePopoverPosition);
    window.addEventListener('scroll', updatePopoverPosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePopoverPosition);
      window.removeEventListener('scroll', updatePopoverPosition, true);
    };
  }, [open, updatePopoverPosition]);

  const normalsVisible = showFaceNormals || showVertexNormals;

  return (
    <div ref={rootRef} className="relative">
      <ViewportToolbarGroup>
        <ViewportIconButton
          label="Viewport Display"
          active={open || normalsVisible}
          onClick={() => setOpen(value => !value)}
        >
          <Icon name="Eye" size={14} />
        </ViewportIconButton>
      </ViewportToolbarGroup>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          ref={popoverRef}
          className="fixed z-[100] w-56 rounded-md border border-white/10 bg-[#181818]/95 p-2 shadow-2xl backdrop-blur"
          style={{ left: popoverPosition.left, top: popoverPosition.top }}
          onMouseDown={event => event.stopPropagation()}
          onPointerDown={event => event.stopPropagation()}
        >
          <div className="mb-1 flex items-center justify-between border-b border-white/5 px-2 pb-2">
            <div>
              <div className="text-[10px] font-medium text-white">Display</div>
              <div className="text-[8px] text-text-secondary">Static Mesh viewport overlays</div>
            </div>
            <Icon name="Eye" size={14} className="text-text-secondary" />
          </div>

          <button
            type="button"
            title="Cycle mesh shading mode"
            aria-label="Cycle mesh shading mode"
            onClick={onCycleShading}
            className="mb-1 flex h-7 w-full items-center justify-between rounded px-2 text-[10px] text-text-secondary hover:bg-white/5 hover:text-white"
          >
            <span>Shading</span>
            <span className="font-mono text-[9px] text-white/80">{shadingLabel}</span>
          </button>

          <ToggleRow label="Grid" value={showGrid} onChange={onShowGridChange} />
          <ToggleRow label="Wireframe" value={wireframe} onChange={onWireframeChange} />
          <ToggleRow label="Face Selection Fill" value={showFaceFill} onChange={onShowFaceFillChange} />

          <div className="my-1 border-t border-white/5" />
          <ToggleRow label="Face Normals" value={showFaceNormals} onChange={onShowFaceNormalsChange} />
          <ToggleRow label="Vertex Normals" value={showVertexNormals} onChange={onShowVertexNormalsChange} />

          <label className="mt-2 block rounded bg-black/20 px-2 py-2 text-[9px] text-text-secondary">
            <span className="mb-1 flex items-center justify-between">
              <span>Normal Size</span>
              <span className="font-mono text-white/80">{normalSize.toFixed(2)}</span>
            </span>
            <input
              type="range"
              title="Normal display size"
              aria-label="Normal display size"
              min="0.02"
              max="2"
              step="0.02"
              value={normalSize}
              onChange={event => onNormalSizeChange(Number(event.target.value))}
              className="w-full"
            />
          </label>
        </div>,
        document.body,
      )}
    </div>
  );
};
