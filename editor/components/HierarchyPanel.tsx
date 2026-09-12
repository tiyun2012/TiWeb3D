
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Entity, ComponentType } from '@/types';
import { SceneGraph } from '@/engine/SceneGraph';
import { Icon } from './Icon';
import { engineInstance } from '@/engine/engine';
import { HierarchyTreeItem } from './HierarchyTreeItem';
import { useInlineRename } from '@/editor/hooks/useInlineRename';

interface HierarchyPanelProps {
  entities: Entity[];
  sceneGraph: SceneGraph;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
}

const getEntityIcon = (entity: Entity) => {
    if (entity.components[ComponentType.LIGHT]) return 'Sun';
    if (entity.components[ComponentType.CAMERA]) return 'Camera';
    if (entity.components[ComponentType.VIRTUAL_PIVOT]) return 'Bone';
    if (entity.components[ComponentType.TRANSFORM] && Object.keys(entity.components).length === 1) return 'Circle'; 
    if (entity.name.includes('Camera')) return 'Camera';
    return 'Box';
};

const HierarchyItem: React.FC<{
  entityId: string;
  entityMap: Map<string, Entity>;
  sceneGraph: SceneGraph;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  depth: number;
  renamingId: string | null;
  onRenameStart: (id: string, name: string) => void;
  renameValue: string;
  setRenameValue: (val: string) => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
}> = ({ 
    entityId, entityMap, sceneGraph, selectedIds, onSelect, onContextMenu, depth,
    renamingId, onRenameStart, renameValue, setRenameValue, onRenameSubmit, onRenameCancel
}) => {
  const [expanded, setExpanded] = useState(true);
  const entity = entityMap?.get ? entityMap.get(entityId) : undefined;
  
  // Safe default calculations ensuring hooks run unconditionally
  const childrenIds = sceneGraph.getChildren(entityId);
  const hasChildren = childrenIds.length > 0;
  const isSelected = entity ? selectedIds.includes(entity.id) : false;
  const isRenaming = entity ? renamingId === entity.id : false;

  // Hook-safe early return
  if (!entity) return null;

  const handleClick = (e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
          if (isSelected) onSelect(selectedIds.filter(id => id !== entity.id));
          else onSelect([...selectedIds, entity.id]);
      } else if (e.shiftKey && selectedIds.length > 0) {
           onSelect([...new Set([...selectedIds, entity.id])]);
      } else {
          onSelect([entity.id]);
      }
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
      if (!selectedIds.includes(entity.id)) {
          onSelect([entity.id]);
      }
      e.dataTransfer.setData('text/plain', entity.id);
      e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const childId = e.dataTransfer.getData('text/plain');
      if (!childId) return;
      if (childId === entity.id) return;
      let current = sceneGraph.getParentId(entity.id);
      while (current) {
          if (current === childId) return;
          current = sceneGraph.getParentId(current);
      }
      sceneGraph.attach(childId, entity.id);
      engineInstance.notifyUI();
  };

  return (
    <HierarchyTreeItem
      id={entity.id}
      name={entity.name}
      depth={depth}
      indentStep={16}
      hasChildren={hasChildren}
      isExpanded={expanded}
      onToggleExpand={() => setExpanded(!expanded)}
      icon={getEntityIcon(entity)}
      iconColor={entity.components[ComponentType.LIGHT] ? 'text-yellow-500' : 'text-blue-400'}
      isSelected={isSelected}
      onSelect={handleClick}
      onContextMenu={(e) => onContextMenu(e, entity.id)}
      isRenaming={isRenaming}
      renameValue={renameValue}
      onRenameChange={setRenameValue}
      onRenameSubmit={onRenameSubmit}
      onRenameCancel={onRenameCancel}
      onStartRename={() => onRenameStart(entity.id, entity.name)}
      draggable
      onDragStart={handleDragStart}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {childrenIds.map(childId => (
        <HierarchyItemMemo
          key={childId}
          entityId={childId}
          entityMap={entityMap}
          sceneGraph={sceneGraph}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
          depth={depth + 1}
          renamingId={renamingId}
          onRenameStart={onRenameStart}
          renameValue={renameValue}
          setRenameValue={setRenameValue}
          onRenameSubmit={onRenameSubmit}
          onRenameCancel={onRenameCancel}
        />
      ))}
    </HierarchyTreeItem>
  );
};

const HierarchyItemMemo = React.memo(HierarchyItem);

export const HierarchyPanel: React.FC<HierarchyPanelProps> = ({ entities, sceneGraph, selectedIds, onSelect }) => {
  const rootIds = sceneGraph.getRootIds();
  const entityMap = useMemo(() => new Map(entities.map(entity => [entity.id, entity])), [entities]);
  const [searchTerm, setSearchTerm] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, id: string, visible: boolean } | null>(null);

  const {
      renamingId,
      renameValue,
      startRename,
      cancelRename,
      setRenameValue,
      submitRename,
  } = useInlineRename();

  useEffect(() => {
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, id, visible: true });
    if (!selectedIds.includes(id)) onSelect([id]);
  };

  const handleRenameStart = useCallback((id: string, currentName: string) => {
    startRename(id, currentName);
    setContextMenu(null);
  }, [startRename]);

  const handleRenameSubmit = useCallback(() => {
    submitRename((id, newName) => {
        const entity = entityMap.get(id);
        if (entity && entity.name !== newName) {
            engineInstance.pushUndoState();
            entity.name = newName;
            const idx = engineInstance?.ecs?.idToIndex?.get(id);
            if (idx !== undefined && engineInstance?.ecs?.store?.names) {
                engineInstance.ecs.store.names[idx] = newName;
            }
            engineInstance.notifyUI();
        }
    });
  }, [submitRename, entityMap]);

  const deleteEntity = (id: string) => {
    engineInstance.deleteEntity(id, engineInstance.sceneGraph);
    onSelect([]);
    setContextMenu(null);
  };

  return (
    <div className="h-full flex flex-col font-sans">
      <div className="p-2 border-b border-white/5 bg-black/20 flex items-center gap-2 shrink-0">
        <div className="relative flex-1">
            <Icon name="Search" size={12} className="absolute left-2 top-1.5 text-text-secondary" />
            <input 
                type="text" 
                placeholder="Search..." 
                aria-label="Search Hierarchy"
                title="Search Hierarchy"
                className="w-full bg-black/40 text-xs py-1 pl-7 pr-2 rounded outline-none border border-transparent focus:border-accent text-white placeholder:text-white/20 transition-all" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
        </div>
        <button 
            type="button"
            className="p-1.5 hover:bg-white/10 rounded text-text-secondary hover:text-white transition-colors"
            title="Create Empty Entity"
            aria-label="Create Empty Entity"
            onClick={() => {
                const id = engineInstance.ecs.createEntity('New Object');
                engineInstance.sceneGraph.registerEntity(id);
                engineInstance.notifyUI();
            }}
        >
            <Icon name="Plus" size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
        <div 
            className="flex items-center gap-2 text-xs text-text-primary px-3 py-1 font-semibold opacity-70 cursor-default"
            onClick={() => onSelect([])}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
                e.preventDefault();
                const childId = e.dataTransfer.getData('text/plain');
                if (!childId) return;
                sceneGraph.attach(childId, null);
                engineInstance.notifyUI();
            }}
        >
            <Icon name="Cuboid" size={12} />
            <span>MainScene</span>
        </div>
        
        <div className="mt-1">
            {rootIds.map(id => (
                <HierarchyItemMemo
                  key={id}
                  entityId={id}
                  entityMap={entityMap}
                  sceneGraph={sceneGraph}
                  selectedIds={selectedIds}
                  onSelect={onSelect}
                  onContextMenu={handleContextMenu}
                  depth={0}
                  renamingId={renamingId}
                  onRenameStart={handleRenameStart}
                  renameValue={renameValue}
                  setRenameValue={setRenameValue}
                  onRenameSubmit={handleRenameSubmit}
                  onRenameCancel={cancelRename}
                />
            ))}
        </div>
      </div>
      
      <div className="px-2 py-1 text-[9px] text-text-secondary bg-black/20 border-t border-white/5 flex justify-between items-center shrink-0">
        <span>{entities.length} Objects</span>
      </div>

      {contextMenu && contextMenu.visible && createPortal(
        <div 
            className="fixed bg-[#252525] border border-white/10 shadow-2xl rounded py-1 min-w-[140px] text-xs z-[10000]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
        >
            <div 
                className="px-3 py-1.5 hover:bg-accent hover:text-white cursor-pointer flex items-center gap-2"
                onClick={() => handleRenameStart(contextMenu.id, entityMap.get(contextMenu.id)?.name || '')}
            >
                <Icon name="Edit2" size={12} /> Rename
            </div>
            <div className="px-3 py-1.5 hover:bg-accent hover:text-white cursor-pointer flex items-center gap-2">
                <Icon name="Copy" size={12} /> Duplicate
            </div>
            <div className="border-t border-white/10 my-1"></div>
            <div 
                className="px-3 py-1.5 hover:bg-red-500/20 hover:text-red-400 cursor-pointer flex items-center gap-2"
                onClick={() => deleteEntity(contextMenu.id)}
            >
                <Icon name="Trash2" size={12} /> Delete
            </div>
        </div>,
        document.body
      )}
    </div>
  );
};
