
import React, { useState, useContext, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { assetManager, RIG_TEMPLATES } from '@/engine/AssetManager';
import { EditorContext } from '@/editor/state/EditorContext';
import { WindowManagerContext } from './WindowManager';
import { MATERIAL_TEMPLATES } from '@/engine/MaterialTemplates';
import { engineInstance } from '@/engine/engine';
import { ImportWizard } from './ImportWizard';
import { consoleService } from '@/engine/Console';
import { Asset, AssetType } from '@/types';
import { eventBus } from '@/engine/EventBus';
import { assetTypeRegistry, AssetCreateCategory } from '@/engine/AssetTypeRegistry';
import { assetEditorRegistry } from '@/editor/AssetEditorRegistry';

type ViewMode = 'GRID' | 'LIST';

const CREATE_CATEGORY_ORDER: AssetCreateCategory[] = ['Project', 'Rendering', 'Animation', 'Logic', 'Physics', 'Other'];

const getSubFolders = (assets: Asset[], path: string) => {
    return assets.filter(a => a.type === 'FOLDER' && a.path === path);
};


const AssetItem: React.FC<{ 
    asset: Asset; 
    selected: boolean; 
    onSelect: (multi: boolean) => void; 
    onDoubleClick: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    viewMode: ViewMode;
    renaming: boolean;
    onRename: (newName: string) => void;
}> = ({ asset, selected, onSelect, onDoubleClick, onContextMenu, viewMode, renaming, onRename }) => {
    const [tempName, setTempName] = useState(asset.name);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (renaming && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [renaming]);

    const assetDefinition = assetTypeRegistry.get(asset.type);
    const iconName = asset.type === 'FOLDER' ? 'Folder' : (assetDefinition?.icon ?? 'File');
    const color = assetDefinition?.colorClass ?? 'text-text-secondary';

    return (
        <div 
            className={`group relative flex ${viewMode === 'GRID' ? 'flex-col items-center p-2' : 'flex-row items-center px-2 py-1'} rounded cursor-pointer transition-colors border border-transparent
                ${selected ? 'bg-accent/20 border-accent/50' : 'hover:bg-white/5 hover:border-white/5'}
            `}
            onClick={(e) => {
                e.stopPropagation();
                onSelect(e.shiftKey || e.ctrlKey);
            }}
            onDoubleClick={(e) => {
                e.stopPropagation();
                onDoubleClick();
            }}
            onContextMenu={onContextMenu}
            draggable={!!assetDefinition?.placeable}
            onDragStart={(e) => e.dataTransfer.setData('application/ti3d-asset', asset.id)}
        >
            <div className={`${viewMode === 'GRID' ? 'w-12 h-12 mb-2 bg-black/20' : 'w-6 h-6 mr-3'} rounded flex items-center justify-center shrink-0`}>
                {asset.type === 'TEXTURE' ? (
                    <img src={(asset as any).source} className="w-full h-full object-cover rounded" />
                ) : (
                    <Icon name={iconName as any} size={viewMode === 'GRID' ? 24 : 14} className={color} />
                )}
            </div>
            
            {renaming ? (
                <input 
                    ref={inputRef}
                    type="text"
                    title="Rename asset"
                    aria-label="Rename asset"
                    className="bg-black/80 border border-accent text-white text-xs px-1 rounded outline-none w-full text-center"
                    value={tempName}
                    onChange={(e) => setTempName(e.target.value)}
                    onBlur={() => onRename(tempName)}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') onRename(tempName);
                        if (e.key === 'Escape') onRename(asset.name); // Cancel
                    }}
                    onClick={(e) => e.stopPropagation()}
                />
            ) : (
                <span className={`text-xs text-center truncate w-full ${selected ? 'text-white font-bold' : 'text-text-primary group-hover:text-white'}`}>
                    {asset.name}
                </span>
            )}
        </div>
    );
};

export const ProjectPanel: React.FC = () => {
    const { selectedAssetIds, setSelectedAssetIds, setInspectedNode } = useContext(EditorContext)!;
    const wm = useContext(WindowManagerContext);
    
    const [currentPath, setCurrentPath] = useState('/Content');
    const [viewMode, setViewMode] = useState<ViewMode>('GRID');
    const [assets, setAssets] = useState<Asset[]>([]);
    const [search, setSearch] = useState('');
    const [showImport, setShowImport] = useState(false);
    
    // Context Menu State
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, type: 'BG' | 'ASSET', assetId?: string } | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [, setAssetRegistryVersion] = useState(0);

    // Keep the Create menu live when modules/plugins register asset types after startup.
    useEffect(() => assetTypeRegistry.subscribe(() => setAssetRegistryVersion((version) => version + 1)), []);

    // Editors

    // Refresh assets
    const refresh = () => {
        setAssets(assetManager.getAllAssets());
    };

    useEffect(() => {
        refresh();
        const unsub1 = eventBus.on('ASSET_CREATED', refresh);
        const unsub2 = eventBus.on('ASSET_DELETED', refresh);
        const unsub3 = eventBus.on('ASSET_UPDATED', refresh);
        return () => { unsub1(); unsub2(); unsub3(); };
    }, []);

    // Close Context Menu
    useEffect(() => {
        const close = () => setContextMenu(null);
        window.addEventListener('click', close);
        return () => window.removeEventListener('click', close);
    }, []);

    const filteredAssets = useMemo(() => {
        return assets.filter(a => {
            if (!assetTypeRegistry.isVisibleInContentBrowser(a.type)) return false;
            if (search) return a.name.toLowerCase().includes(search.toLowerCase());
            return a.path === currentPath;
        }).sort((a, b) => {
            if (a.type === 'FOLDER' && b.type !== 'FOLDER') return -1;
            if (a.type !== 'FOLDER' && b.type === 'FOLDER') return 1;
            return a.name.localeCompare(b.name);
        });
    }, [assets, currentPath, search]);

    const handleNavigate = (path: string) => {
        setCurrentPath(path);
        setSelectedAssetIds([]);
    };

    const handleBreadcrumb = (index: number) => {
        const parts = currentPath.split('/').filter(Boolean);
        const newPath = '/' + parts.slice(0, index + 1).join('/');
        handleNavigate(newPath);
    };

    const handleCreate = (type: AssetType) => {
        try {
            const created = assetTypeRegistry.create(type, { path: currentPath });
            setSelectedAssetIds([created.id]);
            setRenamingId(created.id);
        } catch (error) {
            consoleService.error(error instanceof Error ? error.message : String(error));
        }
    };

    const handleOpen = (asset: Asset) => {
        if (asset.type === 'FOLDER') {
            handleNavigate(`${currentPath === '/' ? '' : currentPath}/${asset.name}`);
            return;
        }

        const editorDefinition = assetEditorRegistry.get(asset.type);
        if (editorDefinition && wm) {
            const windowConfig = editorDefinition.createWindow(asset);
            wm.registerWindow(windowConfig);
            wm.openWindow(windowConfig.id);
            return;
        }

        if (asset.type === 'SCENE') {
            if (confirm("Load Scene? Unsaved changes will be lost.")) {
                engineInstance.loadSceneFromAsset(asset.id);
            }
        }
    };

    const handleDelete = (id: string) => {
        if (confirm("Delete Asset?")) {
            assetManager.deleteAsset(id);
            if (selectedAssetIds.includes(id)) setSelectedAssetIds([]);
        }
    };

    const handleRename = (id: string, newName: string) => {
        if (newName.trim()) {
            assetManager.renameAsset(id, newName.trim());
        }
        setRenamingId(null);
    };

    const pathParts = currentPath.split('/').filter(Boolean);
    const createGroups = CREATE_CATEGORY_ORDER
        .map((category) => ({
            category,
            definitions: assetTypeRegistry.getCreatable().filter((definition) => (definition.createCategory ?? 'Other') === category),
        }))
        .filter((group) => group.definitions.length > 0);

    return (
        <div className="h-full flex flex-col bg-[#1a1a1a] text-xs font-sans relative" onContextMenu={(e) => e.preventDefault()}>
            {/* Toolbar */}
            <div className="flex items-center justify-between p-2 border-b border-white/5 bg-panel-header">
                <div className="flex items-center gap-2">
                    <button onClick={() => setShowImport(true)} className="flex items-center gap-1 px-3 py-1.5 bg-accent hover:bg-accent-hover text-white rounded transition-colors shadow-sm">
                        <Icon name="Upload" size={12} /> Import
                    </button>
                    <div className="h-4 w-px bg-white/10 mx-1"></div>
                    <button onClick={() => handleCreate('MATERIAL')} className="p-1.5 hover:bg-white/10 rounded text-text-secondary hover:text-white" title="New Material"><Icon name="Palette" size={14}/></button>
                    <button onClick={() => handleCreate('SCRIPT')} className="p-1.5 hover:bg-white/10 rounded text-text-secondary hover:text-white" title="New Script"><Icon name="FileCode" size={14}/></button>
                    <button onClick={() => handleCreate('RIG')} className="p-1.5 hover:bg-white/10 rounded text-text-secondary hover:text-white" title="New Rig"><Icon name="GitBranch" size={14}/></button>
                    <button onClick={() => handleCreate('FOLDER')} className="p-1.5 hover:bg-white/10 rounded text-text-secondary hover:text-white" title="New Folder"><Icon name="FolderPlus" size={14}/></button>
                </div>
                <div className="flex items-center gap-2">
                    <input 
                        type="text" 
                        placeholder="Search..." 
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="bg-black/20 border border-white/5 rounded px-2 py-1 text-white outline-none focus:border-accent w-32 transition-all focus:w-48"
                    />
                    <div className="flex bg-black/20 rounded p-0.5 border border-white/5">
                        <button onClick={() => setViewMode('GRID')} className={`p-1 rounded ${viewMode==='GRID'?'bg-white/10 text-white':'text-text-secondary'}`}><Icon name="LayoutGrid" size={12}/></button>
                        <button onClick={() => setViewMode('LIST')} className={`p-1 rounded ${viewMode==='LIST'?'bg-white/10 text-white':'text-text-secondary'}`}><Icon name="List" size={12}/></button>
                    </div>
                </div>
            </div>

            {/* Breadcrumb */}
            <div className="flex items-center px-3 py-1.5 border-b border-white/5 bg-black/10 gap-1 overflow-x-auto custom-scrollbar">
                <button 
                    onClick={() => handleNavigate('/Content')} 
                    className={`flex items-center gap-1 hover:text-white ${currentPath === '/Content' ? 'text-white font-bold' : 'text-text-secondary'}`}
                >
                    <Icon name="Home" size={10} /> Content
                </button>
                {pathParts.slice(1).map((part, i) => (
                    <React.Fragment key={i}>
                        <Icon name="ChevronRight" size={10} className="text-text-secondary opacity-50" />
                        <button 
                            onClick={() => handleBreadcrumb(i + 1)}
                            className={`hover:text-white ${i === pathParts.length - 2 ? 'text-white font-bold' : 'text-text-secondary'}`}
                        >
                            {part}
                        </button>
                    </React.Fragment>
                ))}
            </div>

            {/* Grid Area */}
            <div 
                className="flex-1 overflow-y-auto p-2 custom-scrollbar"
                onClick={() => setSelectedAssetIds([])}
                onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, type: 'BG' });
                }}
            >
                <div className={viewMode === 'GRID' ? 'grid grid-cols-[repeat(auto-fill,minmax(90px,1fr))] gap-2' : 'flex flex-col gap-1'}>
                    {currentPath !== '/Content' && !search && (
                        <div 
                            className={`group flex ${viewMode === 'GRID' ? 'flex-col items-center p-2' : 'flex-row items-center px-2 py-1'} rounded cursor-pointer hover:bg-white/5 border border-transparent`}
                            onDoubleClick={() => handleNavigate(currentPath.split('/').slice(0, -1).join('/') || '/')}
                        >
                            <div className={`${viewMode === 'GRID' ? 'w-12 h-12 mb-2 bg-black/20' : 'w-6 h-6 mr-3'} rounded flex items-center justify-center`}>
                                <Icon name="Folder" size={viewMode === 'GRID' ? 24 : 14} className="text-text-secondary opacity-50" />
                            </div>
                            <span className="text-xs text-text-secondary">..</span>
                        </div>
                    )}
                    
                    {filteredAssets.map(asset => (
                        <AssetItem 
                            key={asset.id} 
                            asset={asset} 
                            viewMode={viewMode}
                            selected={selectedAssetIds.includes(asset.id)}
                            renaming={renamingId === asset.id}
                            onRename={(name) => handleRename(asset.id, name)}
                            onSelect={(multi) => {
                                wm?.openWindow('inspector');
                                if (multi) setSelectedAssetIds([...selectedAssetIds, asset.id]);
                                else setSelectedAssetIds([asset.id]);
                                setInspectedNode(null); // Clear graph selection
                            }}
                            onDoubleClick={() => handleOpen(asset)}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setContextMenu({ x: e.clientX, y: e.clientY, type: 'ASSET', assetId: asset.id });
                                setSelectedAssetIds([asset.id]);
                            }}
                        />
                    ))}
                </div>
                
                {/* Empty State Hint */}
                {filteredAssets.length === 0 && currentPath !== '/Content' && (
                    <div className="flex flex-col items-center justify-center h-full text-text-secondary opacity-20 pointer-events-none select-none">
                        <Icon name="MousePointer2" size={32} />
                        <span className="mt-2 text-[10px]">Right-click to create assets</span>
                    </div>
                )}
            </div>

            {/* Modals */}
            {showImport && (
                <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-8">
                    <div className="w-full max-w-lg h-[500px] bg-panel border border-white/10 rounded-lg shadow-2xl flex flex-col overflow-hidden">
                        <div className="px-4 py-3 border-b border-white/10 bg-panel-header flex justify-between items-center">
                            <span className="font-bold text-white">Import Asset</span>
                            <button onClick={() => setShowImport(false)}><Icon name="X" size={16} /></button>
                        </div>
                        <ImportWizard 
                            onClose={() => setShowImport(false)} 
                            onImportSuccess={(id) => {
                                const asset = assetManager.getAsset(id);
                                if (asset && asset.type !== 'FOLDER') {
                                    asset.path = currentPath;
                                }
                                refresh();
                            }} 
                        />
                    </div>
                </div>
            )}

            {/* CONTEXT MENU */}
            {contextMenu && createPortal(
                <div 
                    className="fixed bg-[#252525] border border-white/10 shadow-2xl rounded py-1 min-w-[160px] text-xs z-[9999]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {contextMenu.type === 'BG' && (
                        <>
                            {createGroups.map((group, groupIndex) => (
                                <React.Fragment key={group.category}>
                                    {groupIndex > 0 && <div className="border-t border-white/10 my-1" />}
                                    <div className="px-3 pt-1.5 pb-1 text-[9px] uppercase tracking-wider text-text-secondary/60 select-none">
                                        {group.category}
                                    </div>
                                    {group.definitions.map((definition) => (
                                        <div
                                            key={definition.type}
                                            className="px-3 py-1.5 hover:bg-accent hover:text-white cursor-pointer flex items-center gap-2"
                                            title={definition.description}
                                            onClick={() => {
                                                handleCreate(definition.type);
                                                setContextMenu(null);
                                            }}
                                        >
                                            <Icon name={definition.icon as any} size={14} className={definition.colorClass} />
                                            <span>{definition.label}</span>
                                        </div>
                                    ))}
                                </React.Fragment>
                            ))}
                        </>
                    )}

                    {contextMenu.type === 'ASSET' && contextMenu.assetId && (
                        <>
                            {(() => {
                                const a = assetManager.getAsset(contextMenu.assetId);
                                const canPlace = !!(a && assetTypeRegistry.get(a.type)?.placeable);
                                if (canPlace) return (
                                    <>
                                        <div className="px-3 py-1.5 hover:bg-accent hover:text-white cursor-pointer flex items-center gap-2" 
                                            onClick={() => { 
                                                const selectedAsset = assetManager.getAsset(contextMenu.assetId!);
                                                const newId = selectedAsset?.type === 'CAMERA_PRESET'
                                                    ? engineInstance.createCameraFromPreset(contextMenu.assetId!, { x: 0, y: 0, z: 0 })
                                                    : engineInstance.createEntityFromAsset(contextMenu.assetId!, { x: 0, y: 0, z: 0 });
                                                setContextMenu(null);
                                            }}>
                                            <Icon name="PlusSquare" size={14} /> Place in Scene
                                        </div>
                                        <div className="border-t border-white/10 my-1"></div>
                                    </>
                                );
                                return null;
                            })()}
                            
                            <div className="px-3 py-1.5 hover:bg-accent hover:text-white cursor-pointer flex items-center gap-2" 
                                onClick={() => { 
                                    setRenamingId(contextMenu.assetId!);
                                    setContextMenu(null);
                                }}>
                                <Icon name="Edit2" size={14} /> Rename
                            </div>
                            <div className="px-3 py-1.5 hover:bg-accent hover:text-white cursor-pointer flex items-center gap-2" 
                                onClick={() => { 
                                    assetManager.duplicateAsset(contextMenu.assetId!);
                                    setContextMenu(null);
                                    refresh();
                                }}>
                                <Icon name="Copy" size={14} /> Duplicate
                            </div>
                            <div className="border-t border-white/10 my-1"></div>
                            <div className="px-3 py-1.5 hover:bg-red-500/20 hover:text-red-400 cursor-pointer flex items-center gap-2" 
                                onClick={() => {
                                    handleDelete(contextMenu.assetId!);
                                    setContextMenu(null);
                                }}>
                                <Icon name="Trash2" size={14} /> Delete
                            </div>
                        </>
                    )}
                </div>,
                document.body
            )}
        </div>
    );
};
