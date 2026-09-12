import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { BoneData, SkeletonAsset } from '@/types';
import { assetManager } from '@/engine/AssetManager';
import { Icon } from './Icon';
import { HierarchyTreeItem } from './HierarchyTreeItem';
import { useInlineRename } from '@/editor/hooks/useInlineRename';

interface SkeletonHierarchyProps {
    asset: SkeletonAsset;
    onUpdate: () => void;
    selectedBoneIndex?: number | null;
    onSelectBone?: (index: number | null) => void;
    editable?: boolean;
    onSkeletonChange?: (bones: BoneData[], options?: { structural?: boolean }) => void;
}

interface BoneNodeProps {
    asset: SkeletonAsset;
    boneIndex: number;
    depth: number;
    selectedBoneIndex: number | null;
    setSelectedBoneIndex: (idx: number | null) => void;
    onContextMenu: (e: React.MouseEvent, idx: number) => void;
    expanded: Set<number>;
    toggleExpand: (idx: number) => void;
    renamingId: string | null;
    renameValue: string;
    onStartRename: (id: string, name: string) => void;
    onRenameChange: (value: string) => void;
    onRenameSubmit: () => void;
    onRenameCancel: () => void;
    editable: boolean;
}

const BoneNode: React.FC<BoneNodeProps> = ({
    asset,
    boneIndex,
    depth,
    selectedBoneIndex,
    setSelectedBoneIndex,
    onContextMenu,
    expanded,
    toggleExpand,
    renamingId,
    renameValue,
    onStartRename,
    onRenameChange,
    onRenameSubmit,
    onRenameCancel,
    editable
}) => {
    const bones = asset.skeleton?.bones || [];
    const bone = bones[boneIndex];
    if (!bone) return null;

    const children = bones
        .map((b: any, i: number) => ({ b, i }))
        .filter(({ b }: any) => b.parentIndex === boneIndex);

    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(boneIndex);
    const isSelected = selectedBoneIndex === boneIndex;
    const isRenaming = renamingId === String(boneIndex);

    const handleSelect = (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();
        setSelectedBoneIndex(boneIndex);
    };

    return (
        <HierarchyTreeItem
            id={String(boneIndex)}
            name={bone.name}
            depth={depth}
            indentStep={14}
            hasChildren={hasChildren}
            isExpanded={isExpanded}
            onToggleExpand={() => toggleExpand(boneIndex)}
            icon="Bone"
            iconColor={isSelected ? 'text-accent' : 'text-emerald-400'}
            isSelected={isSelected}
            onSelect={handleSelect}
            onContextMenu={editable ? (e) => onContextMenu(e, boneIndex) : undefined}
            isRenaming={isRenaming}
            renameValue={renameValue}
            onRenameChange={onRenameChange}
            onRenameSubmit={onRenameSubmit}
            onRenameCancel={onRenameCancel}
            onStartRename={editable ? () => onStartRename(String(boneIndex), bone.name) : undefined}
            canRename={editable}
        >
            {children.map(({ i }: any) => (
                <BoneNodeMemo
                    key={i}
                    asset={asset}
                    boneIndex={i}
                    depth={depth + 1}
                    selectedBoneIndex={selectedBoneIndex}
                    setSelectedBoneIndex={setSelectedBoneIndex}
                    onContextMenu={onContextMenu}
                    expanded={expanded}
                    toggleExpand={toggleExpand}
                    renamingId={renamingId}
                    renameValue={renameValue}
                    onStartRename={onStartRename}
                    onRenameChange={onRenameChange}
                    onRenameSubmit={onRenameSubmit}
                    onRenameCancel={onRenameCancel}
                    editable={editable}
                />
            ))}
        </HierarchyTreeItem>
    );
};

const BoneNodeMemo = React.memo(BoneNode);

export const SkeletonHierarchy: React.FC<SkeletonHierarchyProps> = ({ asset, onUpdate, selectedBoneIndex: externalSelectedBoneIndex, onSelectBone, editable = true, onSkeletonChange }) => {
    const [internalSelected, setInternalSelected] = useState<number | null>(null);
    const selectedBoneIndex = externalSelectedBoneIndex !== undefined ? externalSelectedBoneIndex : internalSelected;
    
    const setSelectedBoneIndex = (idx: number | null) => {
        if (onSelectBone) onSelectBone(idx);
        else setInternalSelected(idx);
    };

    const commitSkeletonChange = useCallback((bones: BoneData[], structural = false) => {
        if (!editable) return;
        if (onSkeletonChange) {
            onSkeletonChange(bones, { structural });
        } else {
            assetManager.updateAsset(asset.id, { skeleton: { ...asset.skeleton, bones } });
        }
        onUpdate();
    }, [editable, onSkeletonChange, asset, onUpdate]);

    const [expanded, setExpanded] = useState<Set<number>>(new Set([0]));
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, boneIndex: number | null } | null>(null);

    const {
        renamingId,
        renameValue,
        startRename,
        cancelRename,
        setRenameValue,
        submitRename,
    } = useInlineRename();

    const handleRenameSubmit = useCallback(() => {
        if (!editable) return;
        submitRename((id, newName) => {
            const bIdx = parseInt(id, 10);
            const bones = asset.skeleton?.bones;
            if (bones && bones[bIdx]) {
                bones[bIdx].name = newName;
                commitSkeletonChange(bones, false);
            }
        });
    }, [editable, submitRename, asset, commitSkeletonChange]);

    const handleStartRename = useCallback((id: string, name: string) => {
        if (!editable) return;
        startRename(id, name);
    }, [editable, startRename]);

    const toggleExpand = (idx: number) => {
        const next = new Set(expanded);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        setExpanded(next);
    };

    const handleAddJoint = (parentIndex: number) => {
        if (!editable) return;
        const bones = asset.skeleton?.bones;
        if (!bones) return;

        const identityMatrix = new Float32Array([
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ]);

        // If parent exists, offset local position along Y by 1.0 unit so bone has length
        if (parentIndex >= 0) {
            identityMatrix[13] = 1.0;
        }

        const newIndex = bones.length;
        const newBone: BoneData = {
            name: `Joint_${newIndex}`,
            parentIndex,
            bindPose: new Float32Array(identityMatrix),
            inverseBindPose: new Float32Array([
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                0, parentIndex >= 0 ? -1.0 : 0, 0, 1
            ]),
            visual: {
                color: { x: 0, y: 1, z: 0 },
                size: 1.0
            }
        };

        bones.push(newBone);
        commitSkeletonChange(bones, true);
        if (parentIndex >= 0) {
            setExpanded(prev => new Set(prev).add(parentIndex));
        }
        setSelectedBoneIndex(newIndex);
    };

    const handleDeleteJoint = (boneIndex: number) => {
        if (!editable) return;
        const bones = asset.skeleton?.bones;
        if (!bones || bones.length <= 1) return;

        const parentIdx = bones[boneIndex].parentIndex;
        const newBones = bones.filter((_, idx) => idx !== boneIndex);

        newBones.forEach(b => {
            if (b.parentIndex === boneIndex) {
                b.parentIndex = parentIdx;
            } else if (b.parentIndex > boneIndex) {
                b.parentIndex -= 1;
            }
        });

        commitSkeletonChange(newBones, true);
        if (selectedBoneIndex === boneIndex) {
            setSelectedBoneIndex(null);
        } else if (selectedBoneIndex !== null && selectedBoneIndex > boneIndex) {
            setSelectedBoneIndex(selectedBoneIndex - 1);
        }
    };

    const rootBones = (asset.skeleton?.bones || [])
        .map((b: any, i: number) => ({ b, i }))
        .filter(({ b }: any) => b.parentIndex === -1);

    const handleNodeContextMenu = (e: React.MouseEvent, boneIndex: number) => {
        if (!editable) return;
        e.preventDefault();
        e.stopPropagation();
        setSelectedBoneIndex(boneIndex);
        setContextMenu({ x: e.clientX, y: e.clientY, boneIndex });
    };

    const handleContainerContextMenu = (e: React.MouseEvent) => {
        if (!editable) return;
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, boneIndex: null });
    };

    // Keyboard shortcuts: F2 to rename selected joint
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (editable && e.key === 'F2' && selectedBoneIndex !== null && selectedBoneIndex !== undefined) {
                const bone = asset.skeleton?.bones?.[selectedBoneIndex];
                if (bone) {
                    e.preventDefault();
                    startRename(String(selectedBoneIndex), bone.name);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [editable, selectedBoneIndex, asset, startRename]);

    useEffect(() => {
        const hideMenu = () => setContextMenu(null);
        window.addEventListener('click', hideMenu);
        window.addEventListener('contextmenu', (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest?.('.skeleton-context-menu')) {
                hideMenu();
            }
        });
        return () => {
            window.removeEventListener('click', hideMenu);
        };
    }, []);

    return (
        <div className="flex flex-col h-full min-h-[200px] border border-white/10 rounded mt-2 bg-black/20">
            <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/5 bg-white/5">
                <span className="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Hierarchy</span>
                <span className="text-xs text-text-secondary opacity-50">{asset.skeleton?.bones?.length || 0} joints</span>
            </div>
            
            <div 
                className="flex-1 overflow-y-auto py-1"
                onContextMenu={handleContainerContextMenu}
                onClick={(e) => {
                    if (e.target === e.currentTarget) {
                        setSelectedBoneIndex(null);
                    }
                }}
            >
                {rootBones.map(({ i }: any) => (
                    <BoneNodeMemo
                        key={i}
                        asset={asset}
                        boneIndex={i}
                        depth={0}
                        selectedBoneIndex={selectedBoneIndex}
                        setSelectedBoneIndex={setSelectedBoneIndex}
                        onContextMenu={handleNodeContextMenu}
                        expanded={expanded}
                        toggleExpand={toggleExpand}
                        renamingId={renamingId}
                        renameValue={renameValue}
                        onStartRename={handleStartRename}
                        onRenameChange={setRenameValue}
                        onRenameSubmit={handleRenameSubmit}
                        onRenameCancel={cancelRename}
                        editable={editable}
                    />
                ))}
            </div>

            {editable && contextMenu && createPortal(
                <div 
                    className="skeleton-context-menu fixed z-[99999] bg-[#1a1a1a] border border-white/10 shadow-2xl rounded py-1 min-w-[140px] text-xs text-text-primary backdrop-blur-md"
                    style={{ 
                        left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 160)), 
                        top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 120)) 
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {contextMenu.boneIndex !== null ? (
                        <>
                            <div 
                                className="px-3 py-1.5 hover:bg-accent hover:text-white cursor-pointer flex items-center gap-2"
                                onClick={() => {
                                    const bIdx = contextMenu.boneIndex!;
                                    const bone = asset.skeleton?.bones?.[bIdx];
                                    setContextMenu(null);
                                    if (bone) {
                                        startRename(String(bIdx), bone.name);
                                    }
                                }}
                            >
                                <Icon name="Edit2" size={12} />
                                <span>Rename Joint</span>
                            </div>
                            <div 
                                className="px-3 py-1.5 hover:bg-accent hover:text-white cursor-pointer flex items-center gap-2"
                                onClick={() => {
                                    const bIdx = contextMenu.boneIndex!;
                                    setContextMenu(null);
                                    handleAddJoint(bIdx);
                                }}
                            >
                                <Icon name="Plus" size={12} />
                                <span>Add Child Joint</span>
                            </div>
                            {(asset.skeleton?.bones?.length || 0) > 1 && (
                                <div 
                                    className="px-3 py-1.5 hover:bg-red-500/20 hover:text-red-400 cursor-pointer flex items-center gap-2 text-red-400"
                                    onClick={() => {
                                        const bIdx = contextMenu.boneIndex!;
                                        setContextMenu(null);
                                        handleDeleteJoint(bIdx);
                                    }}
                                >
                                    <Icon name="Trash2" size={12} />
                                    <span>Delete Joint</span>
                                </div>
                            )}
                        </>
                    ) : (
                        <div 
                            className="px-3 py-1.5 hover:bg-accent hover:text-white cursor-pointer flex items-center gap-2"
                            onClick={() => {
                                setContextMenu(null);
                                handleAddJoint(selectedBoneIndex !== null ? selectedBoneIndex : -1);
                            }}
                        >
                            <Icon name="Plus" size={12} />
                            <span>Add Joint</span>
                        </div>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
};

