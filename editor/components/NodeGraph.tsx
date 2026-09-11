import React, { useState, useEffect, useContext, useMemo, useRef, useLayoutEffect } from 'react';
import { AssetType } from '@/types';
import { engineInstance } from '@/engine/engine';
import { NodeRegistry } from '@/engine/NodeRegistry';
import { Icon } from './Icon';
import { assetManager } from '@/engine/AssetManager';
import { EditorContext } from '@/editor/state/EditorContext';
import { ShaderPreview } from './ShaderPreview';
import { NodeEditor } from './node-graph/NodeEditor';
import { useGraphHistory } from './node-graph/useGraphHistory';

interface NodeGraphProps {
    assetId?: string | null;
}

const ALLOWED_CATEGORIES: Record<string, string[]> = {
    'MATERIAL': ['Output', 'Shader', 'Geometry', 'Effects', 'Pro', 'Advanced', 'Shader Math', 'Input', 'Math', 'Vector', 'Vec2 Math', 'Vec3 Math'],
    'SCRIPT': ['Query', 'Entity', 'Input', 'Math', 'Vector', 'Vec2 Math', 'Vec3 Math', 'Logic'],
    'RIG': ['Rigging', 'Input', 'Math', 'Vector', 'Vec2 Math', 'Vec3 Math', 'Logic'],
};

export const NodeGraph: React.FC<NodeGraphProps> = ({ assetId }) => {
    const context = useContext(EditorContext)!;
    const { setInspectedNode, setActiveGraphConnections, setOnNodeDataChange } = context;
    
    // Internal generic graph state
    const [nodes, setNodes] = useState<any[]>([]);
    const [connections, setConnections] = useState<any[]>([]);
    const [assetType, setAssetType] = useState<AssetType | null>(null);

    // Analysis Hub UI State
    const [viewportPrimitive, setViewportPrimitive] = useState<'sphere' | 'cube' | 'plane'>('sphere');
    const [viewportDisplay, setViewportDisplay] = useState<'WINDOW' | 'BACKDROP' | 'HIDDEN'>('WINDOW');
    const [syncWithScene, setSyncWithScene] = useState(true);
    const [autoRotate, setAutoRotate] = useState(true);
    const [viewportPos, setViewportPos] = useState({ x: -1, y: 12 }); 
    const containerRef = useRef<HTMLDivElement>(null);

    const { pushSnapshot } = useGraphHistory(nodes, connections, setNodes, setConnections);

    // Asset Loading Logic
    useEffect(() => {
        if (assetId) {
            const asset = assetManager.getAsset(assetId);
            if (asset && (asset.type === 'MATERIAL' || asset.type === 'SCRIPT' || asset.type === 'RIG')) {
                setAssetType(asset.type);
                setNodes(asset.data.nodes || []);
                setConnections(asset.data.connections || []);
                setActiveGraphConnections(asset.data.connections || []);
            }
        }
    }, [assetId, setActiveGraphConnections]);

    // Setup the external context so other panels (Inspector) can update node data
    useEffect(() => {
        setOnNodeDataChange((id, key, value) => {
            setNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, [key]: value } } : n));
        });
        return () => setOnNodeDataChange(() => {});
    }, [setOnNodeDataChange]);

    // Live Sync Effect
    useEffect(() => {
        if (syncWithScene && assetId && assetType === 'MATERIAL') {
            const timeout = setTimeout(() => {
                engineInstance.compileGraph(nodes, connections, assetId);
            }, 150); 
            return () => clearTimeout(timeout);
        }
    }, [nodes, connections, syncWithScene, assetId, assetType]);

    // Viewport position init
    useLayoutEffect(() => {
        if (viewportPos.x === -1 && containerRef.current) {
            setViewportPos({ x: containerRef.current.clientWidth - 300, y: 12 });
        }
    }, [viewportPos.x]);

    const availableNodes = useMemo(() => {
        return Object.values(NodeRegistry).filter(def => 
            !assetType || ALLOWED_CATEGORIES[assetType]?.includes(def.category) || def.category === 'Input'
        );
    }, [assetType]);

    const handleNodeDataChange = (id: string, key: string, value: any) => {
        setNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, [key]: value } } : n));
    };

    const handleConnectionsChange = (newConnections: any) => {
        setConnections(newConnections);
        // We evaluate functional updates to sync external graph state
        if (typeof newConnections === 'function') {
            setConnections(prev => {
                const next = newConnections(prev);
                setActiveGraphConnections(next);
                return next;
            });
        } else {
            setActiveGraphConnections(newConnections);
        }
    };

    return (
        <div ref={containerRef} className="w-full h-full relative">
            <NodeEditor
                nodes={nodes}
                connections={connections}
                onNodesChange={setNodes}
                onConnectionsChange={handleConnectionsChange}
                onNodeDataChange={handleNodeDataChange}
                availableNodes={availableNodes}
                onNodeInspect={setInspectedNode}
                onHistoryPush={pushSnapshot}
            >
                {assetType === 'MATERIAL' && viewportDisplay === 'WINDOW' && (
                    <div className="absolute z-[60] glass-panel flex flex-col rounded-lg shadow-2xl border border-white/10 overflow-hidden moving-target pointer-events-auto" style={{ left: viewportPos.x, top: viewportPos.y, width: 280, height: 380 }} onMouseDown={e => e.stopPropagation()}>
                        <div className="h-9 px-3 flex items-center justify-between border-b border-white/5 bg-panel-header shrink-0 cursor-grab active:cursor-grabbing" onMouseDown={(e) => {
                             e.stopPropagation(); e.preventDefault();
                             let startX = e.clientX, startY = e.clientY;
                             let initPos = { ...viewportPos };
                             let lastTime = performance.now();
                             let lastX = e.clientX;
                             let lastY = e.clientY;
                             const onMove = (ev: MouseEvent) => {
                                 const now = performance.now();
                                 const dt = now - lastTime;
                                 let newX = initPos.x + (ev.clientX - startX);
                                 let newY = initPos.y + (ev.clientY - startY);
                                 
                                 if (dt > 0) {
                                     const vx = (ev.clientX - lastX) / dt;
                                     const vy = (ev.clientY - lastY) / dt;
                                     const VELOCITY_THRESHOLD = 2.0;
                                     if (Math.abs(vx) > VELOCITY_THRESHOLD && Math.abs(vx) > Math.abs(vy)) {
                                         newX = vx < 0 ? 0 : window.innerWidth - 280;
                                         startX = ev.clientX;
                                         initPos.x = newX;
                                     } else if (Math.abs(vy) > VELOCITY_THRESHOLD && Math.abs(vy) > Math.abs(vx)) {
                                         newY = vy < 0 ? 0 : window.innerHeight - 380;
                                         startY = ev.clientY;
                                         initPos.y = newY;
                                     }
                                 }
                                 
                                 lastX = ev.clientX;
                                 lastY = ev.clientY;
                                 lastTime = now;
                                 
                                 setViewportPos({ x: newX, y: newY });
                             };
                             const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
                             window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
                        }}>
                            <div className="flex items-center gap-2 pointer-events-none">
                                <Icon name="Monitor" size={12} className="text-accent" />
                                <span className="text-[10px] font-bold text-white uppercase tracking-wider">Analysis Hub</span>
                            </div>
                            <div className="flex items-center gap-1" onMouseDown={e => e.stopPropagation()}>
                                 <button onClick={() => setAutoRotate(!autoRotate)} className={`p-1.5 rounded transition-all ${autoRotate ? 'text-emerald-400 bg-emerald-500/10' : 'text-text-secondary'}`} title="Toggle Auto-Rotation"><Icon name="RotateCw" size={12}/></button>
                                 <button onClick={() => setViewportDisplay('HIDDEN')} className="p-1.5 text-text-secondary hover:text-red-400"><Icon name="X" size={12}/></button>
                            </div>
                        </div>
                        <div className="flex-1 bg-black relative"><ShaderPreview minimal primitive={viewportPrimitive} autoRotate={autoRotate} /></div>
                        <div className="p-2 border-t border-white/5 bg-panel-header/50 flex items-center justify-between pointer-events-auto">
                             <div className="flex bg-black/40 p-0.5 rounded-md gap-0.5">
                                <button onClick={() => setViewportPrimitive('sphere')} className={`p-1.5 rounded ${viewportPrimitive === 'sphere' ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-white'}`} title="Sphere Primitive"><Icon name="Circle" size={12}/></button>
                                <button onClick={() => setViewportPrimitive('cube')} className={`p-1.5 rounded ${viewportPrimitive === 'cube' ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-white'}`} title="Cube Primitive"><Icon name="Box" size={12}/></button>
                                <button onClick={() => setViewportPrimitive('plane')} className={`p-1.5 rounded ${viewportPrimitive === 'plane' ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-white'}`} title="Plane Primitive"><Icon name="Minus" size={12}/></button>
                             </div>
                             <button onClick={() => setSyncWithScene(!syncWithScene)} className={`px-2.5 py-1 rounded text-[9px] font-bold uppercase transition-all ${syncWithScene ? 'text-emerald-400 border border-emerald-500/40 bg-emerald-500/10' : 'text-text-secondary hover:text-white'}`} title="Sync Graph to Active Scene">Live Sync</button>
                        </div>
                    </div>
                )}
            </NodeEditor>
        </div>
    );
};
