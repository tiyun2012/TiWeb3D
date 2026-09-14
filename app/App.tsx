
import React, { useState, useEffect, useCallback, useContext, useRef, useMemo } from 'react';
import { engineInstance, SoftSelectionMode } from '@/engine/engine';
import { skeletonTool } from '@/engine/tools/SkeletonTool';
import { Entity, ToolType, TransformSpace, SelectionType, GraphNode, GraphConnection, MeshComponentMode, SimulationMode, SoftSelectionConnectivity, SoftSelectionFalloff } from '@/types';
import { EditorContext, EditorContextType, DEFAULT_UI_CONFIG, UIConfiguration, GridConfiguration, DEFAULT_GRID_CONFIG, SnapSettings, DEFAULT_SNAP_CONFIG, DEFAULT_SKELETON_VIZ, SkeletonVizSettings } from '@/editor/state/EditorContext';
import { assetManager } from '@/engine/AssetManager';
import { consoleService } from '@/engine/Console';
import '@/editor/commands/StaticMeshCommandCatalogue';
import { SCENE_VIEWPORT_INPUT_ID, viewportInputRouter } from '@/editor/input/ViewportInputRouter';

// Components
import { Toolbar } from '@/editor/components/Toolbar';
import { HierarchyPanel } from '@/editor/components/HierarchyPanel';
import { InspectorPanel } from '@/editor/components/InspectorPanel';
import { SceneView } from '@/editor/components/SceneView';
import { ProjectPanel } from '@/editor/components/ProjectPanel';
import { ConsolePanel } from '@/editor/components/ConsolePanel'; 
import { Icon } from '@/editor/components/Icon';
import { PreferencesModal } from '@/editor/components/PreferencesModal';
import { WindowManager, WindowManagerContext, WindowManagerContextType } from '@/editor/components/WindowManager';
import { GeometrySpreadsheet } from '@/editor/components/GeometrySpreadsheet';
import { UVEditor } from '@/editor/components/UVEditor';
import { Timeline } from '@/editor/components/Timeline';
import { SkinningEditor } from '@/editor/components/SkinningEditor';
import { ToolOptionsPanel } from '@/editor/components/ToolOptionsPanel'; 
import { WorkspaceShell } from '@/editor/components/WorkspaceShell';

// --- Widget Wrappers ---

const HierarchyWrapper = () => {
  const ctx = useContext(EditorContext) as EditorContextType | null;
  if (!ctx) return null;
  return (
    <HierarchyPanel 
      entities={ctx.entities} 
      sceneGraph={ctx.sceneGraph}
      selectedIds={ctx.selectedIds}
      onSelect={(ids) => {
          ctx.setSelectedIds(ids);
          ctx.setSelectionType('ENTITY');
      }}
    />
  );
};

const InspectorWrapper = () => {
  const ctx = useContext(EditorContext) as EditorContextType | null;
  if (!ctx) return null;
  
  let target: any = null;
  let count = 0;

  // Priority: Graph Node > Entity/Asset Selection
  if (ctx.inspectedNode) {
      target = ctx.inspectedNode;
      return <InspectorPanel object={target} type="NODE" />;
  }

  if (ctx.selectionType === 'ENTITY') {
      if (ctx.selectedIds.length > 0) {
          target = ctx.entities.find(e => e.id === ctx.selectedIds[0]) || null;
          count = ctx.selectedIds.length;
      }
  } else if (ctx.selectionType === 'ASSET') {
      if (ctx.selectedAssetIds.length > 0) {
          target = assetManager.getAsset(ctx.selectedAssetIds[0]) || null;
          count = ctx.selectedAssetIds.length;
      }
  } else if (['VERTEX', 'EDGE', 'FACE'].includes(ctx.selectionType)) {
      if (ctx.selectedIds.length > 0) {
          // For component modes, we still target the Entity, but the Inspector will read engineInstance.subSelection
          target = ctx.entities.find(e => e.id === ctx.selectedIds[0]) || null;
      }
  }

  return <InspectorPanel object={target} selectionCount={count} type={ctx.selectionType} />;
};

const SceneWrapper = () => {
  const ctx = useContext(EditorContext) as EditorContextType | null;
  if (!ctx) return null;
  return (
    <SceneView 
      sceneGraph={ctx.sceneGraph}
      selectedIds={ctx.selectedIds}
      onSelect={(ids) => {
          ctx.setSelectedIds(ids);
          ctx.setSelectionType('ENTITY');
      }}
      tool={ctx.tool}
    />
  );
};

const ProjectWrapper = () => <ProjectPanel />;
const ConsoleWrapper = () => <ConsolePanel />;
const ToolOptionsWrapper = () => <ToolOptionsPanel />; 

const StatsContent = () => {
    const [metrics, setMetrics] = useState(engineInstance.metrics);
    useEffect(() => {
        const i = setInterval(() => setMetrics({ ...engineInstance.metrics }), 500);
        return () => clearInterval(i);
    }, []);

    return (
        <div className="p-4 space-y-3 bg-transparent">
            <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2 bg-black/30 rounded border border-white/5">
                    <div className="text-text-secondary">FPS</div>
                    <div className="text-lg font-mono text-emerald-400">{metrics.fps.toFixed(0)}</div>
                </div>
                <div className="p-2 bg-black/30 rounded border border-white/5">
                    <div className="text-text-secondary">Frame Time</div>
                    <div className="text-lg font-mono text-blue-400">{metrics.frameTime.toFixed(2)}ms</div>
                </div>
                <div className="p-2 bg-black/30 rounded border border-white/5">
                    <div className="text-text-secondary">Draw Calls</div>
                    <div className="text-lg font-mono text-orange-400">{metrics.drawCalls}</div>
                </div>
                <div className="p-2 bg-black/30 rounded border border-white/5">
                    <div className="text-text-secondary">Entities</div>
                    <div className="text-lg font-mono text-white">{metrics.entityCount}</div>
                </div>
            </div>
        </div>
    );
};

const StatusBarInfo: React.FC = () => {
    const { meshComponentMode, selectedIds, simulationMode } = useContext(EditorContext) as EditorContextType;
    const [statusText, setStatusText] = useState('Ready');
    const [hintText, setHintText] = useState('');

    useEffect(() => {
        const update = () => {
            if (simulationMode !== 'STOPPED') {
                setStatusText(simulationMode === 'GAME' ? 'GAME MODE' : 'SIMULATING');
                setHintText('Press Esc to release cursor');
                return;
            }

            if (meshComponentMode === 'OBJECT') {
                if (selectedIds.length > 0) {
                    const count = selectedIds.length;
                    const lastId = selectedIds[count - 1];
                    const idx = engineInstance?.ecs?.idToIndex?.get(lastId);
                    const name = idx !== undefined && engineInstance?.ecs?.store?.names ? engineInstance.ecs.store.names[idx] : 'Object';
                    setStatusText(count === 1 ? name : `${count} Objects`);
                    setHintText('Alt+LMB Orbit • MMB Pan • Wheel Zoom');
                } else {
                    setStatusText('Ready');
                    setHintText('Select an object to edit');
                }
            } else {
                const sub = engineInstance.selectionSystem.subSelection;
                if (meshComponentMode === 'VERTEX') {
                    const count = sub.vertexIds.size;
                    if (count === 0) {
                        setStatusText('Vertex Mode');
                        setHintText('Click to select vertices');
                    } else {
                        const last = Array.from(sub.vertexIds).pop();
                        setStatusText(count === 1 ? `Vertex ID: ${last}` : `${count} Vertices`);
                        setHintText(count === 1 ? 'Alt+Click 2nd Vertex for Loop' : 'Drag to Move Selection');
                    }
                } else if (meshComponentMode === 'EDGE') {
                    const count = sub.edgeIds.size;
                    if (count === 0) {
                        setStatusText('Edge Mode');
                        setHintText('Click to select edges');
                    } else {
                        setStatusText(count === 1 ? `Edge Selection` : `${count} Edges`);
                        setHintText('Alt+Click for Loop');
                    }
                } else if (meshComponentMode === 'FACE') {
                    const count = sub.faceIds.size;
                    if (count === 0) {
                        setStatusText('Face Mode');
                        setHintText('Click to select faces');
                    } else {
                        const last = Array.from(sub.faceIds).pop();
                        setStatusText(count === 1 ? `Face ID: ${last}` : `${count} Faces`);
                        setHintText('Alt+Click edge for Strip');
                    }
                }
            }
        };

        update();
        const unsub = engineInstance.subscribe(update);
        return unsub;
    }, [meshComponentMode, selectedIds, simulationMode]);

    return (
        <div className="flex items-center gap-3">
            {simulationMode === 'GAME' ? (
                <span className="text-emerald-500 animate-pulse font-bold flex items-center gap-2"><Icon name="Gamepad2" size={12} /> GAME MODE</span>
            ) : simulationMode === 'SIMULATE' ? (
                <span className="text-indigo-400 animate-pulse font-bold flex items-center gap-2"><Icon name="Activity" size={12} /> SIMULATING</span>
            ) : (
                <>
                    <span className="font-semibold text-white/90 text-[11px]">{statusText}</span>
                    {hintText && <div className="h-3 w-px bg-white/10 mx-1"></div>}
                    <span className="text-text-secondary hidden sm:inline text-[10px] opacity-70">{hintText}</span>
                </>
            )}
        </div>
    );
};

const EditorInterface: React.FC = () => {
    const wm = useContext(WindowManagerContext) as WindowManagerContextType | null;
    const editor = useContext(EditorContext) as EditorContextType | null;
    const initialized = useRef(false);

    useEffect(() => {
        if (!wm) return;

        wm.registerWindow({
            id: 'hierarchy', title: 'Hierarchy', icon: 'ListTree', content: <HierarchyWrapper />, 
            width: 280, height: 500, initialPosition: { x: 80, y: 100 }
        });
        wm.registerWindow({
            id: 'inspector', title: 'Inspector', icon: 'Settings2', content: <InspectorWrapper />, 
            width: 320, height: 600, initialPosition: { x: window.innerWidth - 340, y: 100 }
        });
        wm.registerWindow({
            id: 'tool_options', title: 'Tool Options', icon: 'Tool', content: <ToolOptionsWrapper />, 
            width: 280, height: 350, initialPosition: { x: window.innerWidth - 640, y: 100 }
        });
        wm.registerWindow({
            id: 'project', title: 'Project Browser', icon: 'FolderOpen', content: <ProjectWrapper />, 
            width: 600, height: 350, initialPosition: { x: 380, y: window.innerHeight - 370 }
        });
        wm.registerWindow({
            id: 'console', title: 'Console', icon: 'Terminal', content: <ConsoleWrapper />, 
            width: 500, height: 250, initialPosition: { x: 80, y: window.innerHeight - 270 }
        });
        wm.registerWindow({
            id: 'spreadsheet', title: 'Geometry Spreadsheet', icon: 'Table', content: <GeometrySpreadsheet />, 
            width: 550, height: 400, initialPosition: { x: 450, y: window.innerHeight - 450 }
        });
        wm.registerWindow({
            id: 'preferences', title: 'Preferences', icon: 'Settings', content: <PreferencesModal onClose={() => wm.closeWindow('preferences')} />, 
            width: 500
        });
        wm.registerWindow({
            id: 'stats', title: 'Performance', icon: 'Activity', content: <StatsContent />, 
            width: 280, initialPosition: { x: window.innerWidth - 300, y: 60 }
        });
        wm.registerWindow({
            id: 'uveditor', title: 'UV Editor', icon: 'LayoutGrid', content: <UVEditor />, 
            width: 500, height: 500, initialPosition: { x: 200, y: 200 }
        });
        wm.registerWindow({
            id: 'skinning', title: 'Skinning Editor', icon: 'PersonStanding', content: <SkinningEditor />, 
            width: 300, height: 400, initialPosition: { x: window.innerWidth - 650, y: 100 }
        });
        wm.registerWindow({
            id: 'timeline', title: 'Timeline', icon: 'Film', content: <Timeline />, 
            width: window.innerWidth - 450, height: 200, initialPosition: { x: 400, y: window.innerHeight - 220 }
        });

        if (!initialized.current) {
            wm.openWindow('hierarchy');
            wm.openWindow('inspector');
            wm.openWindow('tool_options'); // Open by default
            wm.openWindow('project');
            // wm.openWindow('timeline'); // Disabled by default to save space
            consoleService.init(); // Initialize global error catching
            initialized.current = true;
        }
    }, [wm]);

    // Keyboard Shortcuts (Delete Object)
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Delete' || e.key === 'Backspace') {
                // Object deletion belongs to Scene context. Asset editors may have
                // their own Delete command for components/topology.
                if (!viewportInputRouter.isActive(SCENE_VIEWPORT_INPUT_ID)) return;
                const active = document.activeElement;
                const isInput = active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA';
                if (!isInput && editor?.selectedIds.length && editor.selectionType === 'ENTITY') {
                    e.preventDefault();
                    editor.selectedIds.forEach(id => engineInstance.deleteEntity(id, engineInstance.sceneGraph));
                    editor.setSelectedIds([]);
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [editor?.selectedIds, editor?.selectionType]);

    if (!editor) return <div className="flex h-screen items-center justify-center text-white">Initializing...</div>;

    const handleLoad = () => {
        const json = localStorage.getItem('ti3d_scene');
        if (json) {
            engineInstance.loadScene(json);
            consoleService.success("Scene Loaded Successfully", "System");
        } else {
            consoleService.warn("No saved scene found in local storage.", "System");
        }
    };

    const handleSave = () => {
        const json = engineInstance.saveScene();
        localStorage.setItem('ti3d_scene', json);
        consoleService.success("Scene Saved", "System");
    };

    return (
        <div className="flex flex-col h-screen bg-[#101010] text-text-primary overflow-hidden font-sans relative">
            {/* Unified Top Toolbar (Menus + Tools + Transport) */}
            <Toolbar onSave={handleSave} onLoad={handleLoad} />

            <div className="flex-1 min-h-0 relative z-0">
                <WorkspaceShell>
                    <SceneWrapper />
                </WorkspaceShell>
            </div>

            <div className="w-full h-6 bg-panel-header/90 backdrop-blur flex items-center px-4 justify-between text-[10px] text-text-secondary shrink-0 select-none z-50 border-t border-white/5">
                <StatusBarInfo />
                <div className="flex items-center gap-4 font-mono opacity-60">
                    <span>{engineInstance.metrics.entityCount} Objects</span>
                    <span>{engineInstance.metrics.fps.toFixed(0)} FPS</span>
                </div>
            </div>
        </div>
    );
};

const App: React.FC = () => {
    const [entities, setEntities] = useState<Entity[]>([]);
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
    const [selectionType, setSelectionType] = useState<SelectionType>('ENTITY');
    const [tool, setTool] = useState<ToolType>('SELECT');
    const [transformSpace, setTransformSpace] = useState<TransformSpace>('World');
    const [meshComponentMode, setMeshComponentMode] = useState<MeshComponentMode>('OBJECT');
    
    // Per-object mode memory: Map<EntityID, Mode>
    const [perObjectModes] = useState(() => new Map<string, MeshComponentMode>());

    // Soft Selection State
    const [softSelectionEnabled, setSoftSelectionEnabled] = useState(false);
    const [softSelectionRadius, setSoftSelectionRadius] = useState(2.0);
    const [softSelectionMode, setSoftSelectionMode] = useState<SoftSelectionMode>('FIXED');
    const [softSelectionFalloff, setSoftSelectionFalloff] = useState<SoftSelectionFalloff>('VOLUME');
    const [softSelectionSurfaceBlend, setSoftSelectionSurfaceBlend] = useState(0.5);
    const [softSelectionConnectivity, setSoftSelectionConnectivity] = useState<SoftSelectionConnectivity>('NONE');
    const [softSelectionHeatmapVisible, setSoftSelectionHeatmapVisible] = useState(true);

    // New State for Simulation
    const [simulationMode, setSimulationMode] = useState<SimulationMode>('STOPPED');

    // Graph
    const [inspectedNode, setInspectedNode] = useState<GraphNode | null>(null);
    const [activeGraphConnections, setActiveGraphConnections] = useState<GraphConnection[]>([]);
    
    // Configs
    const [uiConfig, setUiConfig] = useState<UIConfiguration>(DEFAULT_UI_CONFIG);
    const [gridConfig, setGridConfig] = useState<GridConfiguration>(DEFAULT_GRID_CONFIG);
    const [snapSettings, setSnapSettings] = useState<SnapSettings>(DEFAULT_SNAP_CONFIG);
    const [skeletonViz, setSkeletonViz] = useState<SkeletonVizSettings>(DEFAULT_SKELETON_VIZ);

    const onNodeDataChangeRef = useRef<((nodeId: string, key: string, value: any) => void) | null>(null);

    // Sync Skeleton visualization settings to the engine debug tool
    useEffect(() => {
        skeletonTool.setOptions(skeletonViz);
    }, [skeletonViz]);

    useEffect(() => {
        const update = () => {
            setEntities(engineInstance.ecs.getAllProxies(engineInstance.sceneGraph));
            setSimulationMode(engineInstance.simulationMode); // Sync engine mode to UI
        };
        update();
        return engineInstance.subscribe(update);
    }, []);

    // Sync mesh component mode to engine
    useEffect(() => {
        engineInstance.meshComponentMode = meshComponentMode;
        engineInstance.notifyUI();
    }, [meshComponentMode]);

    useEffect(() => { engineInstance.setGridConfig(gridConfig); }, [gridConfig]);
    useEffect(() => { engineInstance.setUiConfig(uiConfig); }, [uiConfig]);

    // Wrappers for smart selection and mode switching
    const handleSetSelectedIds = useCallback((ids: string[]) => {
        setSelectedIds(ids);
        // Use the engine delegate so selection side-effects (e.g. skeleton debug tool) stay in sync.
        engineInstance.setSelected(ids);
        
        if (ids.length > 0) setInspectedNode(null);

        // MODE MEMORY LOGIC:
        if (ids.length === 1) {
            // Restore mode for this specific object
            const savedMode = perObjectModes?.get ? (perObjectModes.get(ids[0]) || 'OBJECT') : 'OBJECT';
            // Only update if different to avoid redundant effects
            if (savedMode !== meshComponentMode) {
                setMeshComponentMode(savedMode);
            }
        } else {
            // For multi-selection or empty selection, default to Object mode
            if (meshComponentMode !== 'OBJECT') {
                setMeshComponentMode('OBJECT');
            }
        }
    }, [meshComponentMode, perObjectModes]);

    const handleSetMeshComponentMode = useCallback((mode: MeshComponentMode) => {
        setMeshComponentMode(mode);
        // Save mode for the currently selected single object
        if (selectedIds.length === 1 && perObjectModes?.set) {
            perObjectModes.set(selectedIds[0], mode);
        }
    }, [selectedIds, perObjectModes]);

    const contextValue = useMemo<EditorContextType>(() => ({
        entities,
        sceneGraph: engineInstance.sceneGraph,
        selectedIds,
        setSelectedIds: handleSetSelectedIds,
        selectedAssetIds,
        setSelectedAssetIds,
        inspectedNode,
        setInspectedNode,
        activeGraphConnections,
        setActiveGraphConnections,
        updateInspectedNodeData: (key, value) => {
            if (inspectedNode) {
                setInspectedNode(prev => prev ? { ...prev, data: { ...prev.data, [key]: value } } : null);
            }
        },
        onNodeDataChange: (nodeId, key, value) => {
            if (onNodeDataChangeRef.current) onNodeDataChangeRef.current(nodeId, key, value);
        },
        setOnNodeDataChange: (cb) => { onNodeDataChangeRef.current = cb; },
        selectionType,
        setSelectionType,
        meshComponentMode,
        setMeshComponentMode: handleSetMeshComponentMode,
        softSelectionEnabled,
        setSoftSelectionEnabled,
        softSelectionRadius,
        setSoftSelectionRadius,
        softSelectionMode,
        setSoftSelectionMode,
        softSelectionFalloff,
        setSoftSelectionFalloff,
        softSelectionSurfaceBlend,
        setSoftSelectionSurfaceBlend,
        softSelectionConnectivity,
        setSoftSelectionConnectivity,
        softSelectionHeatmapVisible,
        setSoftSelectionHeatmapVisible,
        tool,
        setTool,
        transformSpace,
        setTransformSpace,
        isPlaying: engineInstance.isPlaying,
        simulationMode, // Pass to context
        uiConfig,
        setUiConfig,
        gridConfig,
        setGridConfig,
        snapSettings,
        setSnapSettings,

        // Skeleton visualization (shared between Tool Options + Inspector)
        skeletonViz,
        setSkeletonViz
    }), [
        entities, selectedIds, selectedAssetIds, inspectedNode, activeGraphConnections, 
        selectionType, meshComponentMode, tool, transformSpace, uiConfig, gridConfig, 
        snapSettings, skeletonViz, engineInstance.isPlaying, simulationMode, softSelectionEnabled, softSelectionRadius, softSelectionMode,
        softSelectionFalloff, softSelectionSurfaceBlend, softSelectionConnectivity, softSelectionHeatmapVisible, handleSetSelectedIds, handleSetMeshComponentMode
    ]);

    return (
        <EditorContext.Provider value={contextValue}>
            <WindowManager>
                <EditorInterface />
            </WindowManager>
        </EditorContext.Provider>
    );
};

export default App;
