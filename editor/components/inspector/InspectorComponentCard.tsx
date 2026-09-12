import React, { useState } from 'react';
import { Icon } from '@/editor/components/Icon';

export interface InspectorComponentCardProps {
  title: string;
  icon: string;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/**
 * Shared visual shell for component-like inspector sections used by both live
 * entities and asset editors. It does not imply ECS storage; assets may expose
 * editor-only preview components (for example Camera Preset Preview Transform).
 */
export const InspectorComponentCard: React.FC<InspectorComponentCardProps> = ({
  title,
  icon,
  badge,
  defaultOpen = true,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="bg-panel-header border border-black/20 rounded overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center p-2 hover:bg-white/5 select-none text-left"
        onClick={() => setOpen(value => !value)}
        title={`${open ? 'Collapse' : 'Expand'} ${title}`}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
        aria-expanded={open}
      >
        <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={12} className="mr-2 text-text-secondary" />
        <Icon name={icon as any} size={14} className="mr-2 text-accent" />
        <span className="font-semibold text-xs text-gray-200 flex-1">{title}</span>
        {badge && (
          <span className="text-[9px] uppercase tracking-wider text-text-secondary bg-black/20 px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </button>
      {open && <div className="p-3 bg-panel border-t border-black/10 text-xs">{children}</div>}
    </section>
  );
};
