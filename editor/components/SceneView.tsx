
import React, { useRef, useEffect, useState, useLayoutEffect, useContext, useCallback } from 'react';
import { useViewportSize } from '@/editor/hooks/useViewportSize';
import { createPortal } from 'react-dom';
import { ToolType } from '@/types';
import { SceneGraph } from '@/engine/SceneGraph';
import { engineInstance } from '@/engine/engine';
import { assetManager } from '@/engine/AssetManager';
import { Mat4Utils, Vec3Utils, RayUtils, AABBUtils } from '@/engine/math';
import { VIEW_MODES } from '@/engine/constants';
import { meshEdgeKey } from '@/engine/MeshEdgeGeometry';
import { Icon } from './Icon';
import { PieMenu } from './PieMenu';
import { EditorContext } from '@/editor/state/EditorContext';
import { consoleService } from '@/engine/Console';
import { useBrushInteraction } from '@/editor/hooks/useBrushInteraction';
import { usePieMenuInteraction } from '@/editor/hooks/usePieMenuInteraction';
import { ViewportHud, ViewportIconButton, ViewportTemplate, ViewportToolbarGroup } from './viewport/ViewportTemplate';
import {
    CameraDragMode,
    CameraState,
    cloneCamera,
    dragZoomCamera,
    getCameraEye,
    orbitCamera,
    panCamera,
    wheelZoomCamera,
} from '@/editor/viewports/viewportCamera';

const MARQUEE_DRAG_THRESHOLD_PX = 4;

interface SceneViewProps {
  sceneGraph: SceneGraph;
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  tool: ToolType;
}

export const SceneView: React.FC<SceneViewProps> = ({ sceneGraph, onSelect, selectedIds, tool }) => {
    const { 
        meshComponentMode, setMeshComponentMode, 
        softSelectionEnabled,
        softSelectionRadius,
        softSelectionMode, 
        softSelectionFalloff,
        softSelectionHeatmapVisible,
        setTool
    } = useContext(EditorContext)!;
    
    // --- HOOKS ---
    const { isAdjustingBrush, isBrushKeyHeld } = useBrushInteraction({
        onBrushAdjustEnd: () => engineInstance.endVertexDrag()
    });
    
    // State for local view settings
    const [renderMode, setRenderMode] = useState(0);
    const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
    
    const handleModeSelect = (modeId: number) => { 
        engineInstance.setRenderMode(modeId); 
        setRenderMode(modeId); 
        setIsViewMenuOpen(false); 
    };

    // Camera Focus Logic (Needed by Pie Menu Hook)
    const handleFocus = useCallback(() => {
        if (selectedIds.length > 0) {
            const bounds = AABBUtils.create();
            let valid = false;
            selectedIds.forEach(id => {
                const pos = sceneGraph.getWorldPosition(id);
                if (pos) {
                    valid = true;
                    const idx = engineInstance.ecs.idToIndex.get(id);
                    let radius = 0.5;
                    if (idx !== undefined) {
                        const sx = Math.abs(engineInstance.ecs.store.scaleX[idx]);
                        const sy = Math.abs(engineInstance.ecs.store.scaleY[idx]);
                        const sz = Math.abs(engineInstance.ecs.store.scaleZ[idx]);
                        radius = Math.max(sx, Math.max(sy, sz)) * 0.5; 
                    }
                    AABBUtils.expandPoint(bounds, { x: pos.x - radius, y: pos.y - radius, z: pos.z - radius });
                    AABBUtils.expandPoint(bounds, { x: pos.x + radius, y: pos.y + radius, z: pos.z + radius });
                }
            });
            if (valid) {
                const center = AABBUtils.center(bounds, Vec3Utils.create());
                const size = AABBUtils.size(bounds, Vec3Utils.create());
                const maxDim = Math.max(size.x, Math.max(size.y, size.z));
                setCamera(prev => ({ ...prev, target: center, radius: Math.max(maxDim * 1.5, 2.0) }));
            }
        } else {
            setCamera(prev => ({ ...prev, target: {x:0, y:0, z:0}, radius: 10 }));
        }
    }, [selectedIds, sceneGraph]);

    // Use Pie Menu Hook
    const { 
        pieMenuState, 
        openPieMenu, 
        closePieMenu, 
        handlePieAction 
    } = usePieMenuInteraction({
        sceneGraph,
        selectedIds,
        onSelect,
        setTool,
        setMeshComponentMode,
        handleFocus,
        handleModeSelect
    });

    useEffect(() => {
        engineInstance.meshComponentMode = meshComponentMode;
        engineInstance.softSelectionEnabled = softSelectionEnabled;
        engineInstance.softSelectionRadius = softSelectionRadius;
        engineInstance.softSelectionMode = softSelectionMode;
        engineInstance.softSelectionFalloff = softSelectionFalloff;
        engineInstance.softSelectionHeatmapVisible = softSelectionHeatmapVisible;
        
        engineInstance.recalculateSoftSelection(); 
    }, [
        meshComponentMode, 
        softSelectionEnabled, 
        softSelectionRadius, 
        softSelectionMode, 
        softSelectionFalloff, 
        softSelectionHeatmapVisible,
        selectedIds
    ]);

    const containerRef = useRef<HTMLDivElement>(null);
    const viewportSize = useViewportSize(containerRef, { dprCap: 2 });
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const viewMenuRef = useRef<HTMLDivElement>(null);

    const [camera, setCamera] = useState<CameraState>({ theta: 0.5, phi: 1.2, radius: 10, target: { x: 0, y: 0, z: 0 } });
    
    const [dragState, setDragState] = useState<{
        isDragging: boolean;
        startX: number;
        startY: number;
        mode: CameraDragMode;
        startCamera: typeof camera;
    } | null>(null);

    type SelectionBoxState = {
        startX: number;
        startY: number;
        currentX: number;
        currentY: number;
        isSelecting: boolean;
    };

    const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
    const selectionBoxRef = useRef<SelectionBoxState | null>(null);
    const pendingObjectPressRef = useRef<{
        startX: number;
        startY: number;
        hitId: string | null;
        shiftKey: boolean;
    } | null>(null);

    const commitSelectionBoxState = (next: SelectionBoxState | null) => {
        selectionBoxRef.current = next;
        setSelectionBox(next);
    };

    useLayoutEffect(() => {
        if (canvasRef.current && !engineInstance.renderer.gl) {
            engineInstance.initGL(canvasRef.current);
        }

        // Start Engine Render Loop
        engineInstance.startSystem();

        return () => {
            // Optional: Stop engine loop if scene view unmounts
            engineInstance.stopSystem();
        };
    }, []);

    // Resize renderer (HiDPI-aware)
    useEffect(() => {
        engineInstance.resize(viewportSize.cssWidth, viewportSize.cssHeight, viewportSize.dpr);
    }, [viewportSize.cssWidth, viewportSize.cssHeight, viewportSize.dpr]);


    // Sync Camera Data to Engine on Change
    useEffect(() => {
        const eye = getCameraEye(camera);
        
        const width = viewportSize.cssWidth || 1;
        const height = viewportSize.cssHeight || 1;
        
        const aspect = width / height;
        const proj = Mat4Utils.create();
        Mat4Utils.perspective(45 * Math.PI / 180, aspect, 0.1, 1000.0, proj);
        const view = Mat4Utils.create();
        Mat4Utils.lookAt(eye, camera.target, {x:0,y:1,z:0}, view);
        const vp = Mat4Utils.create();
        Mat4Utils.multiply(proj, view, vp);
        
        engineInstance.updateCamera(vp, eye, width, height);
        engineInstance.gizmoSystem.setTool(tool);
    }, [camera, tool, viewportSize.cssWidth, viewportSize.cssHeight]);

    // Debug Draw for Soft Selection Brush
    useEffect(() => {
        const updateBrushDraw = () => {
            if (engineInstance.meshComponentMode !== 'OBJECT' && engineInstance.selectionSystem.selectedIndices.size > 0 && softSelectionEnabled) {
                const idx = Array.from(engineInstance.selectionSystem.selectedIndices)[0];
                const entityId = engineInstance.ecs.store.ids[idx];
                if (entityId) {
                    const worldPos = engineInstance.sceneGraph.getWorldPosition(entityId); 
                    const rad = softSelectionRadius;
                    
                    const segments = 32;
                    const prev = { x: worldPos.x + rad, y: worldPos.y, z: worldPos.z };
                    engineInstance.debugRenderer.begin(); // Reset previous debug lines for this frame (handled by Engine tick usually, but safe here)
                    for(let i=1; i<=segments; i++) {
                        const th = (i/segments) * Math.PI * 2;
                        const cur = { 
                            x: worldPos.x + Math.cos(th) * rad, 
                            y: worldPos.y, 
                            z: worldPos.z + Math.sin(th) * rad 
                        };
                        engineInstance.debugRenderer.drawLine(prev, cur, { r: 1, g: 1, b: 0 });
                        prev.x = cur.x; prev.y = cur.y; prev.z = cur.z;
                    }
                }
            }
        };
        // We can hook into the engine update loop via subscription if we want per-frame updates
        // or just rely on react state changes. 
        // For smooth brush resizing, the useBrushInteraction hook updates softSelectionRadius state, triggering this effect.
        updateBrushDraw();
    }, [softSelectionEnabled, softSelectionRadius, meshComponentMode, selectedIds]);


    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const active = document.activeElement;
            if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;
            if (e.key === 'f' || e.key === 'F') {
                e.preventDefault();
                handleFocus();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [handleFocus]);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (isBrushKeyHeld.current) return;

        if (pieMenuState && e.button !== 2) closePieMenu();
        if (pieMenuState) return;
        
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const mx = e.clientX - rect.left; 
        const my = e.clientY - rect.top;

        if (e.button === 0 && !isAdjustingBrush && !e.altKey) {
            engineInstance.gizmoSystem.update(0, mx, my, rect.width, rect.height, true, false);
            if (engineInstance.gizmoSystem.activeAxis) return; 
        }

        if (e.button === 2 && !e.altKey) {
            const hitId = engineInstance.selectionSystem.selectEntityAt(mx, my, rect.width, rect.height);
            if (hitId) {
                if (!selectedIds.includes(hitId)) onSelect([hitId]);
                openPieMenu(e.clientX, e.clientY, hitId);
            } else if (selectedIds.length > 0) {
                openPieMenu(e.clientX, e.clientY);
            }
            return;
        }

        if (e.button === 0 && !isAdjustingBrush && !e.altKey) {
            engineInstance.isInputDown = true;
            let componentHit = false;
            
            if (meshComponentMode !== 'OBJECT' && selectedIds.length > 0) {
                const result = engineInstance.selectionSystem.pickMeshComponent(selectedIds[0], mx, my, rect.width, rect.height);
                
                if (result) {
                    engineInstance.clearDeformation(); 
                    componentHit = true;
                    
                    if (!e.shiftKey) {
                        engineInstance.selectionSystem.subSelection.vertexIds.clear();
                        engineInstance.selectionSystem.subSelection.edgeIds.clear();
                        engineInstance.selectionSystem.subSelection.faceIds.clear();
                    }

                    if (meshComponentMode === 'VERTEX') {
                        const id = result.vertexId;
                        if (engineInstance.selectionSystem.subSelection.vertexIds.has(id)) engineInstance.selectionSystem.subSelection.vertexIds.delete(id);
                        else engineInstance.selectionSystem.subSelection.vertexIds.add(id);
                    } else if (meshComponentMode === 'EDGE') {
                        const id = meshEdgeKey(result.edgeId[0], result.edgeId[1]);
                        if (engineInstance.selectionSystem.subSelection.edgeIds.has(id)) engineInstance.selectionSystem.subSelection.edgeIds.delete(id);
                        else engineInstance.selectionSystem.subSelection.edgeIds.add(id);
                    } else if (meshComponentMode === 'FACE') {
                        const id = result.faceId;
                        if (engineInstance.selectionSystem.subSelection.faceIds.has(id)) engineInstance.selectionSystem.subSelection.faceIds.delete(id);
                        else engineInstance.selectionSystem.subSelection.faceIds.add(id);
                    }
                    
                    engineInstance.recalculateSoftSelection(); 
                    engineInstance.notifyUI();
                    return;
                }
            }

            if (!componentHit) {
                const hitId = engineInstance.selectionSystem.selectEntityAt(mx, my, rect.width, rect.height);

                if (meshComponentMode === 'OBJECT') {
                    // Do not commit object picking on mouse-down. A ray hit may be a mesh,
                    // light, joint, or bone helper, and committing here makes that projected
                    // geometry a dead zone where a marquee can never begin. Keep the hit as
                    // a pending click and promote the gesture to box selection once it moves.
                    pendingObjectPressRef.current = {
                        startX: mx,
                        startY: my,
                        hitId,
                        shiftKey: e.shiftKey,
                    };
                } else if (hitId) {
                    // Preserve component-mode behavior: a click that misses the active
                    // component but lands on another object changes the object selection.
                    if (e.shiftKey) {
                        const newSel = selectedIds.includes(hitId) ? selectedIds.filter(id => id !== hitId) : [...selectedIds, hitId];
                        onSelect(newSel);
                    } else {
                        onSelect([hitId]);
                    }
                } else {
                    commitSelectionBoxState({ startX: mx, startY: my, currentX: mx, currentY: my, isSelecting: true });
                }
            }
        }

        if (e.altKey && (e.button !== 0 || !isAdjustingBrush)) {
            e.preventDefault();
            let mode: CameraDragMode = 'ORBIT';
            if (e.button === 1) mode = 'PAN';
            if (e.button === 2) mode = 'ZOOM';
            
            setDragState({ isDragging: true, startX: e.clientX, startY: e.clientY, mode, startCamera: cloneCamera(camera) });
        }
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (isAdjustingBrush) return; // Handled by hook

        if (engineInstance.isInputDown && !dragState && !selectionBoxRef.current && meshComponentMode === 'VERTEX') {
            engineInstance.selectionSystem.selectVerticesInBrush(mx, my, rect.width, rect.height, !e.ctrlKey); 
        }

        const pendingObjectPress = pendingObjectPressRef.current;
        if (pendingObjectPress && !dragState && !selectionBoxRef.current && meshComponentMode === 'OBJECT') {
            const dx = mx - pendingObjectPress.startX;
            const dy = my - pendingObjectPress.startY;
            if ((dx * dx) + (dy * dy) >= MARQUEE_DRAG_THRESHOLD_PX * MARQUEE_DRAG_THRESHOLD_PX) {
                const selectionX = Math.max(0, Math.min(rect.width, mx));
                const selectionY = Math.max(0, Math.min(rect.height, my));
                pendingObjectPressRef.current = null;
                commitSelectionBoxState({
                    startX: pendingObjectPress.startX,
                    startY: pendingObjectPress.startY,
                    currentX: selectionX,
                    currentY: selectionY,
                    isSelecting: true,
                });
            }
        }

        engineInstance.gizmoSystem.update(0, mx, my, rect.width, rect.height, false, false);

        if (meshComponentMode !== 'OBJECT') {
            if (meshComponentMode === 'VERTEX') engineInstance.selectionSystem.highlightVertexAt(mx, my, rect.width, rect.height);
        }

        if (dragState && dragState.isDragging) {
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;
             if (dragState.mode === 'ORBIT') {
                setCamera(orbitCamera(dragState.startCamera, dx, dy, { minPhi: 0.1, maxPhi: Math.PI - 0.1 }));
            } else if (dragState.mode === 'ZOOM') {
                setCamera(dragZoomCamera(dragState.startCamera, dx, dy, { minRadius: 1 }));
            } else if (dragState.mode === 'PAN') {
                setCamera(panCamera(dragState.startCamera, dx, dy));
            }
        }

        const activeSelectionBox = selectionBoxRef.current;
        if (activeSelectionBox?.isSelecting) {
            // Keep marquee coordinates in viewport CSS pixels even when the pointer
            // leaves through an edge/corner. The global mouseup handler will still
            // commit the selection, so edge releases cannot leave selection stuck.
            const selectionX = Math.max(0, Math.min(rect.width, mx));
            const selectionY = Math.max(0, Math.min(rect.height, my));
            commitSelectionBoxState({
                ...activeSelectionBox,
                currentX: selectionX,
                currentY: selectionY,
            });
        }
    };

    const handleGlobalMouseUp = (e: MouseEvent) => {
        engineInstance.isInputDown = false;

        if (containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const selectionX = Math.max(0, Math.min(rect.width, mx));
            const selectionY = Math.max(0, Math.min(rect.height, my));

            engineInstance.gizmoSystem.update(0, mx, my, rect.width, rect.height, false, true);

            // Finalize marquee selection globally rather than on the viewport div.
            // Releasing just outside a viewport corner/edge otherwise never delivered
            // the local mouseup and left rectangle selection looking disabled/stuck.
            const activeSelectionBox = selectionBoxRef.current;
            if (activeSelectionBox?.isSelecting) {
                const x = Math.min(activeSelectionBox.startX, selectionX);
                const y = Math.min(activeSelectionBox.startY, selectionY);
                const w = Math.abs(selectionX - activeSelectionBox.startX);
                const h = Math.abs(selectionY - activeSelectionBox.startY);

                if (w > 3 || h > 3) {
                    const hitIds = engineInstance.selectionSystem.selectEntitiesInRect(
                        x,
                        y,
                        w,
                        h,
                        rect.width,
                        rect.height,
                    );
                    if (e.shiftKey) {
                        const nextSelection = new Set(selectedIds);
                        hitIds.forEach(id => {
                            if (nextSelection.has(id)) nextSelection.delete(id);
                            else nextSelection.add(id);
                        });
                        onSelect(Array.from(nextSelection));
                    } else {
                        onSelect(hitIds);
                    }
                } else if (!e.shiftKey && e.button === 0) {
                    onSelect([]);
                }

                commitSelectionBoxState(null);
            } else {
                // No drag threshold was crossed: this was a true click. Apply the raycast
                // hit captured on mouse-down now, after we know it was not a marquee.
                const pendingObjectPress = pendingObjectPressRef.current;
                if (pendingObjectPress && e.button === 0) {
                    if (pendingObjectPress.hitId) {
                        if (pendingObjectPress.shiftKey) {
                            const newSelection = selectedIds.includes(pendingObjectPress.hitId)
                                ? selectedIds.filter(id => id !== pendingObjectPress.hitId)
                                : [...selectedIds, pendingObjectPress.hitId];
                            onSelect(newSelection);
                        } else {
                            onSelect([pendingObjectPress.hitId]);
                        }
                    } else if (!pendingObjectPress.shiftKey) {
                        onSelect([]);
                    }
                }
            }

            pendingObjectPressRef.current = null;
        }

        setDragState(null);
    };

    const handleWindowBlur = () => {
        engineInstance.isInputDown = false;
        pendingObjectPressRef.current = null;
        setDragState(null);
        commitSelectionBoxState(null);
    };

    useEffect(() => {
        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);
        window.addEventListener('blur', handleWindowBlur);
        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
            window.removeEventListener('blur', handleWindowBlur);
        };
    }, [dragState, selectionBox, meshComponentMode, isAdjustingBrush, selectedIds, onSelect]);

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const assetId = e.dataTransfer.getData('application/ti3d-asset');
        if (assetId && containerRef.current) {
            const rect = containerRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            
            const invVP = new Float32Array(16);
            if (Mat4Utils.invert(engineInstance.currentViewProj!, invVP)) {
                const ray = RayUtils.create();
                RayUtils.fromScreen(x, y, rect.width, rect.height, invVP, ray);
                let pos = { x: 0, y: 0, z: 0 };
                if (Math.abs(ray.direction.y) > 0.001) {
                    const t = -ray.origin.y / ray.direction.y;
                    if (t > 0) pos = Vec3Utils.add(ray.origin, Vec3Utils.scale(ray.direction, t, {x:0,y:0,z:0}), {x:0,y:0,z:0});
                    else pos = Vec3Utils.add(ray.origin, Vec3Utils.scale(ray.direction, 10, {x:0,y:0,z:0}), {x:0,y:0,z:0});
                } else {
                    pos = Vec3Utils.add(ray.origin, Vec3Utils.scale(ray.direction, 10, {x:0,y:0,z:0}), {x:0,y:0,z:0});
                }
                const droppedAsset = assetManager.getAsset(assetId);
                const id = droppedAsset?.type === 'CAMERA_PRESET'
                    ? engineInstance.createCameraFromPreset(assetId, pos)
                    : engineInstance.createEntityFromAsset(assetId, pos);
                if (id) {
                    onSelect([id]);
                } else {
                    consoleService.warn("Failed to drop asset. Check console for details.", "SceneView");
                }
            }
        }
    };

    const activeViewMode = VIEW_MODES.find(mode => mode.id === renderMode) || VIEW_MODES[0];

    return (
        <ViewportTemplate
            containerRef={containerRef}
            canvasRef={canvasRef}
            className={
                isAdjustingBrush
                    ? 'cursor-ew-resize'
                    : dragState
                        ? dragState.mode === 'PAN' ? 'cursor-move' : 'cursor-grabbing'
                        : 'cursor-default'
            }
            containerProps={{
                onMouseDown: handleMouseDown,
                onDragOver: handleDragOver,
                onDrop: handleDrop,
                onWheel: (e) => setCamera(cameraState => wheelZoomCamera(cameraState, e.deltaY, { minRadius: 2, sensitivity: 0.01 })),
                onContextMenu: (e) => e.preventDefault(),
            }}
            viewportChildren={
                selectionBox?.isSelecting ? (
                    <div
                        className="absolute border border-blue-500 bg-blue-500/20 pointer-events-none z-30"
                        style={{
                            left: Math.min(selectionBox.startX, selectionBox.currentX),
                            top: Math.min(selectionBox.startY, selectionBox.currentY),
                            width: Math.abs(selectionBox.currentX - selectionBox.startX),
                            height: Math.abs(selectionBox.currentY - selectionBox.startY),
                        }}
                    />
                ) : null
            }
            toolbarLeft={
                <>
                    <ViewportToolbarGroup>
                        <ViewportIconButton label="Toggle Grid" onClick={() => engineInstance.toggleGrid()}>
                            <Icon name="Grid" size={14} />
                        </ViewportIconButton>
                    </ViewportToolbarGroup>

                    <div className="relative" ref={viewMenuRef}>
                        <button
                            type="button"
                            className="bg-black/40 backdrop-blur border border-white/5 rounded-md flex items-center px-2 py-1 text-[10px] text-text-secondary min-w-[100px] justify-between cursor-pointer hover:bg-white/5 group"
                            onClick={() => setIsViewMenuOpen(open => !open)}
                            title="Viewport shading mode"
                            aria-label="Viewport shading mode"
                            aria-expanded={isViewMenuOpen}
                        >
                            <div className="flex items-center gap-2">
                                <Icon name={activeViewMode.icon as any} size={12} className="text-accent" />
                                <span className="font-semibold text-white/90">{activeViewMode.label}</span>
                            </div>
                            <Icon
                                name="ChevronDown"
                                size={10}
                                className={`text-text-secondary transition-transform ${isViewMenuOpen ? 'rotate-180' : ''}`}
                            />
                        </button>

                        {isViewMenuOpen && (
                            <div className="absolute top-full left-0 mt-1 w-32 bg-[#252525] border border-white/10 rounded-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-100 z-50">
                                {VIEW_MODES.map(mode => (
                                    <button
                                        type="button"
                                        key={mode.id}
                                        onClick={() => handleModeSelect(mode.id as number)}
                                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-[10px] hover:bg-accent hover:text-white transition-colors text-left ${
                                            mode.id === renderMode ? 'bg-white/5 text-white font-bold' : 'text-text-secondary'
                                        }`}
                                        title={`Use ${mode.label} shading`}
                                        aria-label={`Use ${mode.label} shading`}
                                    >
                                        <Icon name={mode.icon as any} size={12} />
                                        <span>{mode.label}</span>
                                        {mode.id === renderMode && <Icon name="Check" size={10} className="ml-auto" />}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </>
            }
            hudBottomRight={
                <ViewportHud className="items-end">
                    <span>Cam: {camera.target.x.toFixed(1)}, {camera.target.y.toFixed(1)}, {camera.target.z.toFixed(1)}</span>
                    {softSelectionEnabled && meshComponentMode !== 'OBJECT' && (
                        <span className="text-accent">
                            Soft Sel ({softSelectionMode === 'FIXED' ? 'Fixed' : 'Dynamic'}): {softSelectionRadius.toFixed(1)}m
                        </span>
                    )}
                </ViewportHud>
            }
            overlayChildren={
                <>
                    {isAdjustingBrush && (
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white font-bold text-2xl drop-shadow-md z-50 pointer-events-none">
                            Radius: {softSelectionRadius.toFixed(2)}
                        </div>
                    )}

                    {pieMenuState && createPortal(
                        <PieMenu
                            x={pieMenuState.x}
                            y={pieMenuState.y}
                            entityId={pieMenuState.entityId}
                            currentMode={meshComponentMode}
                            onSelectMode={(mode) => {
                                setMeshComponentMode(mode);
                                closePieMenu();
                            }}
                            onAction={handlePieAction}
                            onClose={closePieMenu}
                        />,
                        document.body,
                    )}
                </>
            }
        />
    );

};
