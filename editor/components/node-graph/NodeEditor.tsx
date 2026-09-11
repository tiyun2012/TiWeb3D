import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import { GraphNode, GraphConnection } from '@/types';
import { Icon } from '../Icon';
import { LayoutConfig } from './GraphConfig';
import { GraphUtils } from './GraphUtils';
import { NodeItem } from './NodeItem';
import { ConnectionLine } from './ConnectionLine';

export interface NodeEditorProps {
    nodes: GraphNode[];
    connections: GraphConnection[];
    onNodesChange: (nodes: GraphNode[] | ((prev: GraphNode[]) => GraphNode[])) => void;
    onConnectionsChange: (connections: GraphConnection[] | ((prev: GraphConnection[]) => GraphConnection[])) => void;
    onNodeDataChange: (id: string, key: string, value: any) => void;
    availableNodes: any[];
    onSelectionChange?: (selectedIds: Set<string>) => void;
    onNodeInspect?: (node: GraphNode | null) => void;
    onHistoryPush?: (nodes: GraphNode[], connections: GraphConnection[]) => void;
    children?: React.ReactNode;
}

export const NodeEditor: React.FC<NodeEditorProps> = ({
    nodes,
    connections,
    onNodesChange,
    onConnectionsChange,
    onNodeDataChange,
    availableNodes,
    onSelectionChange,
    onNodeInspect,
    onHistoryPush,
    children
}) => {
    // UI State
    const [showGrid, setShowGrid] = useState(true);
    const [snapToGrid, setSnapToGrid] = useState(false);
    const [connecting, setConnecting] = useState<{ nodeId: string, pinId: string, type: 'input'|'output', x: number, y: number, dataType: string } | null>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, visible: boolean } | null>(null);
    const [searchFilter, setSearchFilter] = useState('');
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectionBox, setSelectionBox] = useState<{ startX: number, startY: number, currentX: number, currentY: number } | null>(null);
    const [cuttingPath, setCuttingPath] = useState<{ x1: number, y1: number, x2: number, y2: number } | null>(null);

    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<HTMLDivElement>(null);
    const transformRef = useRef({ x: 0, y: 0, k: 1 });
    const isInteracting = useRef(false);
    const activeListenersRef = useRef<{ move?: (ev: MouseEvent) => void; up?: (ev: MouseEvent) => void; cleanup?: () => void }>({});
    const snapToGridRef = useRef(snapToGrid);

    useEffect(() => { snapToGridRef.current = snapToGrid; }, [snapToGrid]);

    useEffect(() => {
        if (onSelectionChange) onSelectionChange(selectedNodeIds);
    }, [selectedNodeIds, onSelectionChange]);

    const updateViewportStyle = useCallback(() => {
        if (viewRef.current && containerRef.current) {
            const { x, y, k } = transformRef.current;
            viewRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${k})`;
            if (showGrid) {
                containerRef.current.style.backgroundPosition = `${x}px ${y}px`;
                containerRef.current.style.backgroundSize = `${LayoutConfig.GRID_SIZE * k}px ${LayoutConfig.GRID_SIZE * k}px`;
                containerRef.current.style.backgroundImage = 'linear-gradient(#222 1px, transparent 1px), linear-gradient(90deg, #222 1px, transparent 1px)';
            } else {
                containerRef.current.style.backgroundImage = 'none';
            }
        }
    }, [showGrid]);

    useLayoutEffect(() => { updateViewportStyle(); }, [updateViewportStyle]);

    const cleanupListeners = useCallback(() => {
        if (activeListenersRef.current.move) window.removeEventListener('mousemove', activeListenersRef.current.move);
        if (activeListenersRef.current.up) window.removeEventListener('mouseup', activeListenersRef.current.up);
        activeListenersRef.current = {};
        isInteracting.current = false;
        containerRef.current?.classList.remove('is-interacting');
    }, []);

    // Graph Keyboard Shortcuts
    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            const active = document.activeElement;
            if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;

            if (e.key === 'c' || e.key === 'C') {
                if (selectedNodeIds.size > 0) {
                    const bounds = GraphUtils.getSelectionBounds(nodes, selectedNodeIds);
                    if (bounds) {
                        if (onHistoryPush) onHistoryPush(nodes, connections);
                        const commentId = crypto.randomUUID();
                        onNodesChange(prev => [
                            { 
                                id: commentId, 
                                type: 'Comment', 
                                position: { x: bounds.x, y: bounds.y }, 
                                width: bounds.w, 
                                height: bounds.h, 
                                data: { title: 'New Comment', color: 'rgba(255, 255, 255, 0.05)' } 
                            }, 
                            ...prev
                        ]);
                    }
                }
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                if (selectedNodeIds.size > 0) {
                    if (onHistoryPush) onHistoryPush(nodes, connections);
                    onNodesChange(prev => prev.filter(n => !selectedNodeIds.has(n.id)));
                    onConnectionsChange(prev => prev.filter(c => !selectedNodeIds.has(c.fromNode) && !selectedNodeIds.has(c.toNode)));
                    setSelectedNodeIds(new Set());
                    if (onNodeInspect) onNodeInspect(null);
                }
            } else if (e.key === 'g' || e.key === 'G') {
                setShowGrid(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [nodes, connections, selectedNodeIds, onHistoryPush, onNodesChange, onConnectionsChange, onNodeInspect]);

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.stopPropagation();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const zoomIntensity = 0.05;
        const wheel = e.deltaY < 0 ? 1 : -1;
        const zoomFactor = Math.exp(wheel * zoomIntensity);
        const current = transformRef.current;
        const newK = Math.min(Math.max(current.k * zoomFactor, 0.1), 3);
        const mouseX = (e.clientX - rect.left - current.x) / current.k;
        const mouseY = (e.clientY - rect.top - current.y) / current.k;
        const newX = e.clientX - rect.left - (mouseX * newK);
        const newY = e.clientY - rect.top - (mouseY * newK);
        transformRef.current = { x: newX, y: newY, k: newK };
        updateViewportStyle();
    }, [updateViewportStyle]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        setContextMenu(null);
        
        const worldPos = GraphUtils.screenToWorld(e.clientX, e.clientY, rect, transformRef.current);

        if (e.ctrlKey && e.button === 2) {
            e.preventDefault(); e.stopPropagation();
            cleanupListeners();
            const startX = worldPos.x;
            const startY = worldPos.y;
            setCuttingPath({ x1: startX, y1: startY, x2: startX, y2: startY });

            const onMove = (ev: MouseEvent) => {
                const movePos = GraphUtils.screenToWorld(ev.clientX, ev.clientY, rect, transformRef.current);
                setCuttingPath({ x1: startX, y1: startY, x2: movePos.x, y2: movePos.y });
            };

            const onUp = (ev: MouseEvent) => {
                const endPos = GraphUtils.screenToWorld(ev.clientX, ev.clientY, rect, transformRef.current);
                const cutStart = { x: startX, y: startY };
                const cutEnd = { x: endPos.x, y: endPos.y };

                onConnectionsChange(curr => {
                    const toDelete = curr.filter(conn => {
                        const from = nodes.find(n => n.id === conn.fromNode);
                        const to = nodes.find(n => n.id === conn.toNode);
                        if (!from || !to) return false;
                        
                        const p1 = GraphUtils.getPinPosition(from, conn.fromPin, 'output');
                        const p2 = GraphUtils.getPinPosition(to, conn.toPin, 'input');
                        
                        const samples = 16;
                        for (let i = 0; i < samples; i++) {
                            const t1 = i / samples;
                            const t2 = (i + 1) / samples;
                            
                            const getPoint = (t: number) => {
                                const dist = Math.abs(p1.x - p2.x) * 0.4;
                                const cx1 = p1.x + Math.max(dist, 50);
                                const cx2 = p2.x - Math.max(dist, 50);
                                const invT = 1 - t;
                                return {
                                    x: invT**3 * p1.x + 3 * invT**2 * t * cx1 + 3 * invT * t**2 * cx2 + t**3 * p2.x,
                                    y: invT**3 * p1.y + 3 * invT**2 * t * p1.y + 3 * invT * t**2 * p2.y + t**3 * p2.y
                                };
                            };

                            if (GraphUtils.checkLineIntersection(cutStart, cutEnd, getPoint(t1), getPoint(t2))) return true;
                        }
                        return false;
                    });
                    
                    if (toDelete.length > 0) {
                        if (onHistoryPush) onHistoryPush(nodes, curr);
                        return curr.filter(c => !toDelete.includes(c));
                    }
                    return curr;
                });
                setCuttingPath(null);
                cleanupListeners();
            };

            activeListenersRef.current = { move: onMove, up: onUp };
            window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
            return;
        }

        if (e.button === 1 || (e.altKey && e.button === 0)) {
            e.preventDefault(); e.stopPropagation();
            cleanupListeners();
            isInteracting.current = true;
            containerRef.current?.classList.add('is-interacting');
            const startX = e.clientX; const startY = e.clientY;
            const startTrans = { ...transformRef.current };
            const onMove = (ev: MouseEvent) => {
                transformRef.current.x = startTrans.x + (ev.clientX - startX);
                transformRef.current.y = startTrans.y + (ev.clientY - startY);
                updateViewportStyle();
            };
            activeListenersRef.current = { move: onMove, up: cleanupListeners };
            window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', cleanupListeners);
        } else if (e.button === 2 && !e.altKey) { 
            e.preventDefault(); e.stopPropagation();
            setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, visible: true });
            setSearchFilter('');
        } else if (e.button === 0 && !e.altKey) {
            if (!e.shiftKey && !e.ctrlKey) {
                setSelectedNodeIds(new Set());
                if (onNodeInspect) onNodeInspect(null);
            }
            const startX = e.clientX - rect.left; const startY = e.clientY - rect.top;
            setSelectionBox({ startX, startY, currentX: startX, currentY: startY });
            
            const onMove = (ev: MouseEvent) => {
                const curX = ev.clientX - rect.left; const curY = ev.clientY - rect.top;
                setSelectionBox(p => p ? { ...p, currentX: curX, currentY: curY } : null);
                
                const x1 = Math.min(startX, curX);
                const y1 = Math.min(startY, curY);
                const x2 = Math.max(startX, curX);
                const y2 = Math.max(startY, curY);

                const { x, y, k } = transformRef.current;
                const nextSelection = new Set<string>();
                
                nodes.forEach(node => {
                    const nx = node.position.x * k + x;
                    const ny = node.position.y * k + y;
                    const nw = (node.width || (node.type === 'CustomExpression' || node.type === 'ForLoop' ? LayoutConfig.CODE_NODE_WIDTH : LayoutConfig.NODE_WIDTH)) * k;
                    const nh = GraphUtils.getNodeHeight(node) * k; 
                    if (nx < x2 && nx + nw > x1 && ny < y2 && ny + nh > y1) {
                        nextSelection.add(node.id);
                    }
                });
                setSelectedNodeIds(nextSelection);
            };
            const onUp = () => { cleanupListeners(); setSelectionBox(null); };
            activeListenersRef.current = { move: onMove, up: onUp };
            window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
        }
    }, [nodes, connections, cleanupListeners, updateViewportStyle, onNodesChange, onConnectionsChange, onHistoryPush, onNodeInspect]);

    const handleNodeDragStart = useCallback((e: React.MouseEvent, node: GraphNode) => {
        if (e.altKey || isInteracting.current) return; 
        e.stopPropagation(); e.preventDefault();
        cleanupListeners();
        isInteracting.current = true;
        containerRef.current?.classList.add('is-interacting');

        let currentSelection = new Set(selectedNodeIds);
        if (!currentSelection.has(node.id)) {
            currentSelection = e.shiftKey || e.ctrlKey ? new Set(selectedNodeIds).add(node.id) : new Set([node.id]);
            setSelectedNodeIds(currentSelection);
            if (onNodeInspect) onNodeInspect(node);
        }

        const startMouse = { x: e.clientX, y: e.clientY };
        const k = transformRef.current.k;
        
        const nodeInitials = new Map<string, { x: number, y: number }>();
        nodes.forEach(n => {
            if (currentSelection.has(n.id)) {
                nodeInitials.set(n.id, { x: n.position.x, y: n.position.y });
            }
        });

        const onMove = (ev: MouseEvent) => {
            const dx = (ev.clientX - startMouse.x) / k;
            const dy = (ev.clientY - startMouse.y) / k;
            
            onNodesChange(prev => prev.map(n => {
                const init = nodeInitials.get(n.id);
                if (init) {
                    const tx = init.x + dx;
                    const ty = init.y + dy;
                    return { 
                        ...n, 
                        position: { 
                            x: snapToGridRef.current ? GraphUtils.snapToGrid(tx) : tx, 
                            y: snapToGridRef.current ? GraphUtils.snapToGrid(ty) : ty 
                        } 
                    };
                }
                return n;
            }));
        };

        const onUp = () => {
            if (onHistoryPush) onHistoryPush(nodes, connections);
            cleanupListeners();
        };

        activeListenersRef.current = { move: onMove, up: onUp };
        window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
    }, [nodes, connections, selectedNodeIds, cleanupListeners, onNodesChange, onHistoryPush, onNodeInspect]);

    const handlePinDown = useCallback((e: React.MouseEvent, nodeId: string, pinId: string, type: 'input'|'output', dataType: string) => {
        if (e.altKey || isInteracting.current) return;
        e.stopPropagation(); e.preventDefault();
        cleanupListeners();
        const rect = containerRef.current?.getBoundingClientRect(); if(!rect) return;
        const pos = GraphUtils.screenToWorld(e.clientX, e.clientY, rect, transformRef.current);
        
        setConnecting({ nodeId, pinId, type, x: pos.x, y: pos.y, dataType });
        const onMove = (ev: MouseEvent) => {
            const worldPos = GraphUtils.screenToWorld(ev.clientX, ev.clientY, rect, transformRef.current);
            setConnecting(prev => prev ? { ...prev, x: worldPos.x, y: worldPos.y } : null);
        };
        activeListenersRef.current = { move: onMove, up: () => { cleanupListeners(); setConnecting(null); } };
        window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', activeListenersRef.current.up!);
    }, [cleanupListeners]);

    const handlePinUp = useCallback((e: React.MouseEvent, nodeId: string, pinId: string, type: 'input'|'output') => {
        e.stopPropagation();
        setConnecting(prev => {
            if (prev && prev.nodeId !== nodeId && prev.type !== type) {
                // Determine source and target nodes
                const sourceNodeId = type === 'output' ? nodeId : prev.nodeId;
                const sourcePinId = type === 'output' ? pinId : prev.pinId;
                const targetNodeId = type === 'input' ? nodeId : prev.nodeId;
                const targetPinId = type === 'input' ? pinId : prev.pinId;
                
                // Validate types
                const sourceNode = nodes.find(n => n.id === sourceNodeId);
                const targetNode = nodes.find(n => n.id === targetNodeId);
                const sourceDef = availableNodes.find(d => d.type === sourceNode?.type);
                const targetDef = availableNodes.find(d => d.type === targetNode?.type);
                
                const sourceType = sourceDef?.outputs.find((p:any) => p.id === sourcePinId)?.type || 'any';
                const targetType = targetDef?.inputs.find((p:any) => p.id === targetPinId)?.type || 'any';

                if (GraphUtils.canConnect(sourceType, targetType)) {
                    if (onHistoryPush) onHistoryPush(nodes, connections);
                    onConnectionsChange(curr => {
                        const clean = curr.filter(c => !(c.toNode === targetNodeId && c.toPin === targetPinId));
                        const updated = [...clean, { id: crypto.randomUUID(), fromNode: sourceNodeId, fromPin: sourcePinId, toNode: targetNodeId, toPin: targetPinId }];
                        return updated;
                    });
                } else {
                    console.warn(`Cannot connect ${sourceType} to ${targetType}`);
                }
            }
            return null;
        });
    }, [nodes, availableNodes, connections, onHistoryPush, onConnectionsChange]);

    const nodeMap = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);

    const filteredNodes = availableNodes.filter(def => def.title.toLowerCase().includes(searchFilter.toLowerCase()));

    const handleNodeDataChange = useCallback((id: string, k: string, v: any) => {
        onNodeDataChange(id, k, v);
    }, [onNodeDataChange]);

    const handleNodeResize = useCallback((id: string, w: number, h: number) => {
        onNodesChange(prev => prev.map(n => n.id === id ? { ...n, width: w, height: h } : n));
    }, [onNodesChange]);

    const handlePinDownNode = useCallback((e: React.MouseEvent, nId: string, pId: string, t: 'input'|'output') => {
        const node = nodes.find(n => n.id === nId);
        const def = availableNodes.find(d => d.type === node?.type);
        const dt = def?.[t === 'input' ? 'inputs' : 'outputs'].find((p:any) => p.id === pId)?.type || 'any';
        handlePinDown(e, nId, pId, t, dt);
    }, [nodes, availableNodes, handlePinDown]);

    const noop = useCallback(() => {}, []);

    return (
        <div ref={containerRef} className="w-full h-full bg-[#0d0d0d] overflow-hidden relative select-none outline-none" onWheel={handleWheel} onMouseDown={handleMouseDown} onContextMenu={e => e.preventDefault()}>
            <style>{`
                .is-interacting *, .is-interacting { pointer-events: none !important; }
                .is-interacting .moving-target { pointer-events: auto !important; }
                .node-wrapper { position: absolute; top: 0; left: 0; transform-origin: top left; }
            `}</style>

            <div className="absolute top-3 left-3 z-[100] flex gap-2 items-center pointer-events-auto">
                <button 
                    onClick={() => setSnapToGrid(!snapToGrid)} 
                    className={`p-1.5 rounded bg-black/40 border border-white/5 transition-all hover:bg-black/60 ${snapToGrid ? 'text-accent border-accent/20 shadow-[0_0_10px_rgba(79,128,248,0.2)]' : 'text-text-secondary opacity-50'}`} 
                    title="Snap to Grid"
                >
                    <Icon name="Magnet" size={16} />
                </button>
                <button 
                    onClick={() => setShowGrid(!showGrid)} 
                    className={`p-1.5 rounded bg-black/40 border border-white/5 transition-all hover:bg-black/60 ${showGrid ? 'text-white' : 'text-text-secondary opacity-50'}`} 
                    title="Toggle Visual Grid"
                >
                    <Icon name="Grid" size={16} />
                </button>
            </div>

            {children}

            <div ref={viewRef} className="w-full h-full origin-top-left will-change-transform z-10 pointer-events-none">
                <svg className="absolute top-0 left-0 overflow-visible w-1 h-1">
                    {connections.map(c => <ConnectionLine key={c.id} connection={c} fromNode={nodeMap.get(c.fromNode)} toNode={nodeMap.get(c.toNode)} />)}
                    {connecting && <path d={GraphUtils.calculateCurve(connecting.type==='output'?GraphUtils.getPinPosition(nodeMap.get(connecting.nodeId)!, connecting.pinId, 'output').x:connecting.x, connecting.type==='output'?GraphUtils.getPinPosition(nodeMap.get(connecting.nodeId)!, connecting.pinId, 'output').y:connecting.y, connecting.type==='input'?GraphUtils.getPinPosition(nodeMap.get(connecting.nodeId)!, connecting.pinId, 'input').x:connecting.x, connecting.type==='input'?GraphUtils.getPinPosition(nodeMap.get(connecting.nodeId)!, connecting.pinId, 'input').y:connecting.y)} stroke={"#4f80f8"} strokeWidth="2.5" strokeDasharray="6,4" fill="none" opacity="0.8" />}
                    
                    {cuttingPath && (
                        <line x1={cuttingPath.x1} y1={cuttingPath.y1} x2={cuttingPath.x2} y2={cuttingPath.y2} stroke="#f87171" strokeWidth="2" strokeDasharray="4,2" />
                    )}
                </svg>
                
                {nodes.map(node => {
                    const isReroute = node.type === 'Reroute';
                    const isComment = node.type === 'Comment';
                    const nodeWidth = node.width || (isReroute ? LayoutConfig.REROUTE_SIZE : (node.type === 'CustomExpression' || node.type === 'ForLoop' ? LayoutConfig.CODE_NODE_WIDTH : LayoutConfig.NODE_WIDTH));
                    const nodeHeight = GraphUtils.getNodeHeight(node);

                    return (
                        <div 
                            key={node.id} 
                            className={`node-wrapper moving-target pointer-events-auto ${isComment ? 'z-0' : 'z-10'}`} 
                            style={{ 
                                transform: `translate(${node.position.x}px, ${node.position.y}px)`,
                                width: nodeWidth,
                                height: nodeHeight
                            }}
                        >
                            <NodeItem 
                                node={node} 
                                selected={selectedNodeIds.has(node.id)} 
                                connections={connections} 
                                connecting={connecting} 
                                onMouseDown={handleNodeDragStart} 
                                onPinDown={handlePinDownNode} 
                                onPinUp={handlePinUp} 
                                onPinEnter={noop} 
                                onPinLeave={noop} 
                                onDataChange={handleNodeDataChange}
                                onResize={handleNodeResize}
                            />
                        </div>
                    );
                })}
            </div>

            {selectionBox && (
                <div className="absolute border border-accent bg-accent/15 pointer-events-none z-[110]" style={{ left: Math.min(selectionBox.startX, selectionBox.currentX), top: Math.min(selectionBox.startY, selectionBox.currentY), width: Math.abs(selectionBox.currentX - selectionBox.startX), height: Math.abs(selectionBox.currentY - selectionBox.startY) }} />
            )}

            {contextMenu && contextMenu.visible && (
                <div className="absolute w-52 bg-[#1a1a1a]/95 backdrop-blur-md border border-white/10 shadow-2xl rounded-lg text-xs flex flex-col z-[1000] overflow-hidden animate-in fade-in zoom-in-95 duration-100" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={e => e.stopPropagation()}>
                    <input autoFocus placeholder="Search Nodes..." className="p-3 bg-black/40 text-white outline-none border-b border-white/5 text-[11px]" value={searchFilter} onChange={e => setSearchFilter(e.target.value)} />
                    <div className="max-h-72 overflow-y-auto custom-scrollbar">
                         <button className="w-full text-left px-4 py-2.5 text-accent border-b border-white/5 font-bold hover:bg-accent hover:text-white transition-colors" onClick={() => { 
                             const nid = crypto.randomUUID(); 
                             const pos = { x: (contextMenu.x - transformRef.current.x) / transformRef.current.k, y: (contextMenu.y - transformRef.current.y) / transformRef.current.k };
                             const snappedPos = snapToGridRef.current ? { x: GraphUtils.snapToGrid(pos.x), y: GraphUtils.snapToGrid(pos.y) } : pos;
                             onNodesChange(p=>[{id:nid, type:'Comment', position:snappedPos, width:300, height:200, data:{title:'Comment', color: 'rgba(255, 255, 255, 0.05)'}}, ...p]); 
                             setSelectedNodeIds(new Set([nid])); setContextMenu(null); 
                         }}>Add Comment</button>
                         {filteredNodes.map(def => (<button key={def.type} className="w-full text-left px-4 py-2 text-gray-300 hover:bg-accent hover:text-white transition-colors" onClick={() => { 
                             if (onHistoryPush) onHistoryPush(nodes, connections); 
                             const nid = crypto.randomUUID(); 
                             const pos = { x: (contextMenu.x - transformRef.current.x) / transformRef.current.k, y: (contextMenu.y - transformRef.current.y) / transformRef.current.k };
                             const snappedPos = snapToGridRef.current ? { x: GraphUtils.snapToGrid(pos.x), y: GraphUtils.snapToGrid(pos.y) } : pos;
                             onNodesChange(p=>[...p, {id:nid, type:def.type, position:snappedPos, data: { ...def.data }}]); 
                             setSelectedNodeIds(new Set([nid])); setContextMenu(null); 
                         }}>{def.title}</button>))}
                    </div>
                </div>
            )}
        </div>
    );
};
