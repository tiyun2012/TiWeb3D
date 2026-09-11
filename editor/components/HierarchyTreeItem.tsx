import React, { useEffect, useRef } from 'react';
import * as Lucide from 'lucide-react';
import { Icon } from './Icon';

export interface HierarchyTreeItemProps {
  /** Unique identifier for the item */
  id: string;
  /** Display label */
  name: string;
  /** Tree indentation depth level (starts at 0) */
  depth?: number;
  /** Pixel indentation step per depth level (default: 14) */
  indentStep?: number;

  /** Whether this item has child nodes */
  hasChildren?: boolean;
  /** Whether child nodes are currently expanded */
  isExpanded?: boolean;
  /** Callback to toggle expand/collapse */
  onToggleExpand?: (e: React.MouseEvent) => void;

  /** Lucide icon name for this object type */
  icon?: keyof typeof Lucide | string;
  /** Tailwind color or text class for the icon */
  iconColor?: string;
  /** Optional custom icon element override */
  iconNode?: React.ReactNode;
  /** Optional badge or counter displayed next to the label */
  badge?: React.ReactNode;

  /** Whether this node is selected */
  isSelected?: boolean;
  /** Click handler for selection */
  onSelect?: (e: React.MouseEvent) => void;
  /** Right-click context menu handler */
  onContextMenu?: (e: React.MouseEvent) => void;

  /** Whether this node is currently in inline rename mode */
  isRenaming?: boolean;
  /** Temporary text value during rename */
  renameValue?: string;
  /** Change handler for rename input text */
  onRenameChange?: (value: string) => void;
  /** Submit handler for committing new name */
  onRenameSubmit?: () => void;
  /** Cancel handler for discarding rename */
  onRenameCancel?: () => void;
  /** Triggered to begin renaming (e.g. on double-click or F2) */
  onStartRename?: () => void;
  /** Whether renaming is permitted on this item (default: true) */
  canRename?: boolean;

  /** Whether drag-and-drop is enabled */
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;

  /** Optional trailing actions (buttons, icons) */
  trailingActions?: React.ReactNode;
  /** Child items rendered when expanded */
  children?: React.ReactNode;
  /** Additional container CSS class names */
  className?: string;
}

const HierarchyTreeItemComponent: React.FC<HierarchyTreeItemProps> = ({
  id,
  name,
  depth = 0,
  indentStep = 14,
  hasChildren = false,
  isExpanded = false,
  onToggleExpand,
  icon = 'Box',
  iconColor = '',
  iconNode,
  badge,
  isSelected = false,
  onSelect,
  onContextMenu,
  isRenaming = false,
  renameValue = '',
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onStartRename,
  canRename = true,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
  trailingActions,
  children,
  className = '',
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus and highlight full text when entering rename mode
  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Prevent bubbling so engine viewport hotkeys (W, E, R, Q, F, Space) are suppressed
    e.stopPropagation();

    if (e.key === 'Enter') {
      onRenameSubmit?.();
    } else if (e.key === 'Escape') {
      onRenameCancel?.();
    }
  };

  const handleLabelDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (canRename && onStartRename) {
      onStartRename();
    }
  };

  const lastSelectTimeRef = useRef(0);
  const handleSelectTrigger = (e: React.MouseEvent<HTMLDivElement> | React.PointerEvent<HTMLDivElement>) => {
    // Prevent triggering on child buttons (like expand chevron or actions) or input fields
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) return;

    e.stopPropagation();

    const now = Date.now();
    if (now - lastSelectTimeRef.current < 200) return;
    lastSelectTimeRef.current = now;

    onSelect?.(e as any);
  };

  const leftPadding = depth * indentStep + 8;

  return (
    <div className="select-none">
      <div
        id={`hierarchy-item-${id}`}
        draggable={draggable}
        onPointerDown={e => {
          if (e.button === 0) handleSelectTrigger(e);
        }}
        onClick={handleSelectTrigger}
        onContextMenu={onContextMenu}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        style={{ paddingLeft: `${leftPadding}px` }}
        className={`group flex items-center gap-1.5 py-1 pr-2 cursor-pointer text-xs transition-colors border-l-2 ${
          isSelected
            ? 'bg-accent/20 text-accent font-semibold border-accent'
            : 'text-text-secondary hover:text-white hover:bg-white/5 border-transparent'
        } ${className}`}
      >
        {/* Expand / Collapse Chevron */}
        <button
          type="button"
          aria-label={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : 'Leaf'}
          title={hasChildren ? (isExpanded ? 'Collapse' : 'Expand') : ''}
          onClick={e => {
            e.stopPropagation();
            if (hasChildren && onToggleExpand) {
              onToggleExpand(e);
            }
          }}
          className={`w-4 h-4 flex items-center justify-center rounded hover:bg-white/10 transition-colors ${
            hasChildren ? 'visible' : 'invisible'
          }`}
        >
          {hasChildren && (
            <Icon
              name={isExpanded ? 'ChevronDown' : 'ChevronRight'}
              size={11}
              className={isSelected ? 'text-accent' : 'text-text-secondary'}
            />
          )}
        </button>

        {/* Object Type Icon */}
        <div className="flex items-center justify-center shrink-0">
          {iconNode ? (
            iconNode
          ) : (
            <Icon
              name={icon as keyof typeof Lucide}
              size={13}
              className={isSelected ? 'text-accent' : iconColor || 'text-text-secondary'}
            />
          )}
        </div>

        {/* Label or Inline Rename Input */}
        {isRenaming ? (
          <input
            ref={inputRef}
            type="text"
            title="Rename item"
            aria-label="Rename item"
            value={renameValue}
            onChange={e => onRenameChange?.(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={onRenameSubmit}
            onClick={e => e.stopPropagation()}
            className="flex-1 bg-black/70 border border-accent text-white text-xs px-1.5 py-0.5 rounded outline-none min-w-0 font-medium shadow-inner"
          />
        ) : (
          <span
            className="flex-1 truncate tracking-wide"
            title={canRename ? `${name} (Double-click to rename)` : name}
            onDoubleClick={handleLabelDoubleClick}
          >
            {name}
          </span>
        )}

        {/* Optional Badge */}
        {badge && <div className="shrink-0">{badge}</div>}

        {/* Trailing Actions */}
        {trailingActions && (
          <div
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={e => e.stopPropagation()}
          >
            {trailingActions}
          </div>
        )}
      </div>

      {/* Render nested children if expanded */}
      {hasChildren && isExpanded && children && <div>{children}</div>}
    </div>
  );
};

export const HierarchyTreeItem = React.memo(HierarchyTreeItemComponent);
