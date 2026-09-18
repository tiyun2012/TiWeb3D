
import React, { useRef, useEffect, useState, useLayoutEffect, useContext, useCallback } from 'react';
import { useViewportSize } from '@/editor/hooks/useViewportSize';
import { useViewportInputContext } from '@/editor/hooks/useViewportInputContext';
import { SCENE_VIEWPORT_INPUT_ID, viewportInputRouter } from '@/editor/input/ViewportInputRouter';
import { createPortal } from 'react-dom';
import { ComponentType, ToolType } from '@/types';
import { SceneGraph } from '@/engine/SceneGraph';
import { engineInstance } from '@/engine/engine';
import { createEngineAPI } from '@/engine/api/createEngineAPI';
import { assetManager } from '@/engine/AssetManager';
import { Mat4Utils, Vec3Utils, RayUtils } from '@/engine/math';
import { VIEW_MODES } from '@/engine/constants';
import { meshEdgeKey } from '@/engine/MeshEdgeGeometry';
import type { MeshPickingResult } from '@/engine/MeshTopologyUtils';
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
    dragOrthographicZoomCamera,
    dragZoomCamera,
    getCameraEye,
    getCameraUp,
    orbitCamera,
    panCamera,
    wheelOrthographicZoomCamera,
    wheelZoomCamera,
} from '@/editor/viewports/viewportCamera';
import {
    cameraStatesApproximatelyEqual,
    readSceneCameraViewportState,
    writeSceneCameraViewportState,
} from '@/editor/viewports/SceneCameraViewportBinding';
import { resolveSceneCameraViewportProfile, resolveViewportProfile } from '@/editor/viewports/ViewportProfileResolver';
import { resolveSceneSelectionFocusTarget } from '@/editor/viewports/focusTargetResolvers';
import { frameCameraOnFocusTarget } from '@/editor/viewports/viewportFocus';
import type { EditorCommandCapability, EditorCommandContext } from '@/editor/commands/EditorCommandRegistry';
import '@/editor/commands/StaticMeshCommandCatalogue';
import { resolveSceneStaticMeshEditTarget } from '@/engine/mesh-editing/StaticMeshEditTarget';
import {
    executeMarqueeSelection,
    resolveMarqueeOperation,
    resolveSceneSelectionPolicy,
    selectionPoliciesMatch,
    type SelectionPolicy,
} from '@/editor/selection/SelectionPolicy';

const MARQUEE_DRAG_THRESHOLD_PX = 4;
type PendingSceneComponentPress = {
    policy: SelectionPolicy;
    startX: number;
    startY: number;
    shiftKey: boolean;
    picked: MeshPickingResult | null;
};
type SoftSelectionCommandSettings = Parameters<NonNullable<EditorCommandContext['services']['configureSoftSelection']>>[0];
const sceneEngineApi = createEngineAPI(engineInstance);

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
        softSelectionSurfaceBlend,
        softSelectionConnectivity,
        softSelectionHeatmapVisible,
        setSoftSelectionEnabled,
        setSoftSelectionRadius,
        setSoftSelectionMode,
        setSoftSelectionFalloff,
        setSoftSelectionSurfaceBlend,
        setSoftSelectionConnectivity,
        setSoftSelectionHeatmapVisible,
        setTool
    } = useContext(EditorContext)!;
    
    // State for local view settings
    const [renderMode, setRenderMode] = useState(0);
    const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
    
    const handleModeSelect = (modeId: number) => { 
        engineInstance.setRenderMode(modeId); 
        setRenderMode(modeId); 
        setIsViewMenuOpen(false); 
    };

    // A viewport always navigates one camera pose. Normally that is the editor
    // camera; View Through binds the exact same controller to a Scene Camera's
    // Transform while its lens comes from CameraResolver.
    const [camera, setCamera] = useState<CameraState>({ theta: 0.5, phi: 1.2, radius: 10, target: { x: 0, y: 0, z: 0 } });
    const cameraRef = useRef(camera);
    // Pointer devices can generate camera samples faster than React can render the
    // full Scene viewport. Keep the latest pose synchronously in cameraRef, but
    // publish React state at most once per animation frame so stale samples cannot
    // build a visible post-gesture tail.
    const cameraPublishRafRef = useRef<number | null>(null);
    const pendingCameraPublishRef = useRef<CameraState | null>(null);
    const [viewCameraEntityId, setViewCameraEntityId] = useState<string | null>(null);
    const viewCameraEntityIdRef = useRef<string | null>(null);
    const editorCameraBeforeBindingRef = useRef<CameraState | null>(null);
    // While viewport navigation owns a bound Scene Camera, ignore UI notifications
    // that would otherwise round-trip Transform -> CameraState back into the same drag.
    const boundCameraNavigationActiveRef = useRef(false);
    const boundCameraUiCommitTimerRef = useRef<number | null>(null);
    // Engine UI notifications are intentionally broad (selection, assets, tools, etc.).
    // Keep a snapshot of the bound camera's actual world transform so unrelated UI
    // notifications cannot round-trip Transform -> CameraState and perturb the view.
    const boundCameraWorldMatrixRef = useRef<Float32Array | null>(null);

    useEffect(() => { viewCameraEntityIdRef.current = viewCameraEntityId; }, [viewCameraEntityId]);
    useEffect(() => () => {
        if (boundCameraUiCommitTimerRef.current !== null) {
            window.clearTimeout(boundCameraUiCommitTimerRef.current);
            boundCameraUiCommitTimerRef.current = null;
        }
        if (cameraPublishRafRef.current !== null) {
            window.cancelAnimationFrame(cameraPublishRafRef.current);
            cameraPublishRafRef.current = null;
        }
    }, []);

    // Viewport behavior is independent from the camera source. Binding a Scene Camera
    // swaps pose/lens ownership, while grid/helpers/navigation remain viewport features.
    const activeViewportProfile = viewCameraEntityId
        ? resolveSceneCameraViewportProfile(engineInstance, viewCameraEntityId)
        : resolveViewportProfile();
    const gridBeforeCameraBindingRef = useRef<boolean | null>(null);

    const captureBoundCameraWorldMatrix = useCallback((entityId: string) => {
        const world = engineInstance.sceneGraph.getWorldMatrix(entityId);
        return world ? new Float32Array(world) : null;
    }, []);

    const boundCameraWorldMatrixChanged = useCallback((entityId: string) => {
        const current = captureBoundCameraWorldMatrix(entityId);
        if (!current) return { changed: true, current: null as Float32Array | null };

        const previous = boundCameraWorldMatrixRef.current;
        if (!previous || previous.length !== current.length) {
            return { changed: true, current };
        }

        for (let i = 0; i < current.length; i += 1) {
            if (Math.abs(current[i] - previous[i]) > 1e-5) {
                return { changed: true, current };
            }
        }
        return { changed: false, current };
    }, [captureBoundCameraWorldMatrix]);

    const publishCameraState = useCallback((next: CameraState, immediate = false) => {
        pendingCameraPublishRef.current = next;

        if (immediate) {
            if (cameraPublishRafRef.current !== null) {
                window.cancelAnimationFrame(cameraPublishRafRef.current);
                cameraPublishRafRef.current = null;
            }
            pendingCameraPublishRef.current = null;
            setCamera(next);
            return;
        }

        if (cameraPublishRafRef.current !== null) return;
        cameraPublishRafRef.current = window.requestAnimationFrame(() => {
            cameraPublishRafRef.current = null;
            const latest = pendingCameraPublishRef.current;
            pendingCameraPublishRef.current = null;
            if (latest) setCamera(latest);
        });
    }, []);

    // Navigation owns a local viewport pose while a gesture is active. Do not
    // round-trip every mouse sample through the Scene Camera Transform: the viewport
    // already renders from this CameraState, and repeatedly dirtying the SceneGraph
    // makes bound-camera navigation unnecessarily expensive. React publication is
    // also coalesced to one sample per animation frame to avoid pointer-event backlog.
    const updateViewportCamera = useCallback((updater: CameraState | ((previous: CameraState) => CameraState)) => {
        const previous = cameraRef.current;
        const next = typeof updater === 'function' ? updater(previous) : updater;
        cameraRef.current = next;
        publishCameraState(next);
    }, [publishCameraState]);

    const commitBoundCameraViewportState = useCallback((notify = true) => {
        const boundCameraId = viewCameraEntityIdRef.current;
        if (!boundCameraId) {
            boundCameraNavigationActiveRef.current = false;
            return false;
        }

        // Flush exactly the final viewport pose and discard any queued intermediate
        // React camera publish before committing the Scene Transform.
        publishCameraState(cameraRef.current, true);

        // Keep the self-resync guard active through notifyUI(). notifyUI is
        // synchronous, so the SceneView subscription must see this commit as its own
        // transaction rather than as an external Transform edit.
        boundCameraNavigationActiveRef.current = true;
        const committed = writeSceneCameraViewportState(engineInstance, boundCameraId, cameraRef.current);
        if (committed) {
            // Resolve only this camera's parent chain and remember the transform produced by
            // our own navigation transaction. A later selection notification must not be
            // mistaken for an external Camera Transform edit.
            boundCameraWorldMatrixRef.current = captureBoundCameraWorldMatrix(boundCameraId);
            if (notify) engineInstance.notifyUI();
        }
        boundCameraNavigationActiveRef.current = false;
        return committed;
    }, [captureBoundCameraWorldMatrix, publishCameraState]);

    const enterSceneCameraView = useCallback((entityId: string) => {
        // Finish any pending navigation transaction on the previously bound camera
        // before changing sources. This prevents a debounced wheel edit from being
        // silently lost when switching directly between cameras.
        if (viewCameraEntityIdRef.current && boundCameraNavigationActiveRef.current) {
            if (boundCameraUiCommitTimerRef.current !== null) {
                window.clearTimeout(boundCameraUiCommitTimerRef.current);
                boundCameraUiCommitTimerRef.current = null;
            }
            commitBoundCameraViewportState();
        }

        const next = readSceneCameraViewportState(engineInstance, entityId, cameraRef.current.radius);
        if (!next) return;
        if (!viewCameraEntityIdRef.current) {
            editorCameraBeforeBindingRef.current = cloneCamera(cameraRef.current);
        }
        viewCameraEntityIdRef.current = entityId;
        boundCameraWorldMatrixRef.current = captureBoundCameraWorldMatrix(entityId);
        setViewCameraEntityId(entityId);
        cameraRef.current = next;
        publishCameraState(next, true);
    }, [captureBoundCameraWorldMatrix, commitBoundCameraViewportState, publishCameraState]);

    const exitSceneCameraView = useCallback(() => {
        if (viewCameraEntityIdRef.current && boundCameraNavigationActiveRef.current) {
            if (boundCameraUiCommitTimerRef.current !== null) {
                window.clearTimeout(boundCameraUiCommitTimerRef.current);
                boundCameraUiCommitTimerRef.current = null;
            }
            commitBoundCameraViewportState();
        }

        viewCameraEntityIdRef.current = null;
        boundCameraWorldMatrixRef.current = null;
        setViewCameraEntityId(null);
        const previousEditorCamera = editorCameraBeforeBindingRef.current;
        if (previousEditorCamera) {
            const restored = cloneCamera(previousEditorCamera);
            cameraRef.current = restored;
            publishCameraState(restored, true);
        }
        editorCameraBeforeBindingRef.current = null;
    }, [commitBoundCameraViewportState, publishCameraState]);

    const containerRef = useRef<HTMLDivElement>(null);
    const viewportSize = useViewportSize(containerRef, { dprCap: 2 });
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const viewMenuRef = useRef<HTMLDivElement>(null);
    useViewportInputContext(SCENE_VIEWPORT_INPUT_ID, containerRef, { fallback: true });

    const configureSceneSoftSelection = useCallback((settings: SoftSelectionCommandSettings) => {
        if (settings.enabled !== undefined) setSoftSelectionEnabled(settings.enabled);
        if (settings.radius !== undefined) setSoftSelectionRadius(settings.radius);
        if (settings.mode !== undefined) setSoftSelectionMode(settings.mode);
        const distanceMetric = settings.distanceMetric ?? settings.falloff;
        if (distanceMetric !== undefined) setSoftSelectionFalloff(distanceMetric);
        if (settings.surfaceBlend !== undefined) setSoftSelectionSurfaceBlend(settings.surfaceBlend);
        if (settings.connectivity !== undefined) setSoftSelectionConnectivity(settings.connectivity);
        if (settings.heatmapVisible !== undefined) setSoftSelectionHeatmapVisible(settings.heatmapVisible);
    }, [
        setSoftSelectionEnabled,
        setSoftSelectionRadius,
        setSoftSelectionMode,
        setSoftSelectionFalloff,
        setSoftSelectionSurfaceBlend,
        setSoftSelectionConnectivity,
        setSoftSelectionHeatmapVisible,
    ]);

    const sceneBrushAvailable = meshComponentMode !== 'OBJECT'
        && Boolean(resolveSceneStaticMeshEditTarget(engineInstance, selectedIds));
    const { isAdjustingBrush, isBrushKeyHeld } = useBrushInteraction({
        viewportId: SCENE_VIEWPORT_INPUT_ID,
        available: sceneBrushAvailable,
        softSelectionEnabled,
        softSelectionRadius,
        configureSoftSelection: configureSceneSoftSelection,
        onBrushAdjustEnd: () => engineInstance.endVertexDrag(),
    });

    const selectedCameraId = selectedIds.find(id => engineInstance.ecs.hasComponent(id, ComponentType.CAMERA)) ?? null;
    const resolvedViewCamera = viewCameraEntityId ? engineInstance.getResolvedCamera(viewCameraEntityId) : null;
    const viewCameraLens = resolvedViewCamera?.settings ?? null;

    // Camera Focus Logic (Needed by Pie Menu Hook). Selection resolves a domain
    // target; shared viewport navigation decides how to frame it. Selection itself
    // never moves the camera -- only this explicit command does.
    const handleFocus = useCallback(() => {
        if (!activeViewportProfile.navigation.focus) return;

        const focusTarget = resolveSceneSelectionFocusTarget(engineInstance, selectedIds, meshComponentMode);
        if (focusTarget) {
            updateViewportCamera(previous => frameCameraOnFocusTarget(previous, focusTarget, {
                width: viewportSize.cssWidth,
                height: viewportSize.cssHeight,
                projectionSettings: viewCameraLens ?? undefined,
            }));
            if (viewCameraEntityIdRef.current) commitBoundCameraViewportState();
            return;
        }

        // Preserve the established no-selection behavior: F returns the editor
        // camera to a useful world overview instead of inventing a selection.
        updateViewportCamera(previous => ({
            ...previous,
            target: { x: 0, y: 0, z: 0 },
            radius: 10,
        }));
        if (viewCameraEntityIdRef.current) commitBoundCameraViewportState();
    }, [
        selectedIds,
        meshComponentMode,
        updateViewportCamera,
        commitBoundCameraViewportState,
        activeViewportProfile.navigation.focus,
        viewportSize.cssWidth,
        viewportSize.cssHeight,
        viewCameraLens,
    ]);

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
        // Component context changes commit any retained Live Falloff operation.
        // Radius/falloff changes are handled separately so they can recompose the
        // same operation while the component selection remains unchanged.
        engineInstance.clearDeformation();
        engineInstance.meshComponentMode = meshComponentMode;
        engineInstance.selectionSystem.clearMeshComponentHover();
        engineInstance.recalculateSoftSelection();
    }, [meshComponentMode]);

    useEffect(() => {
        sceneEngineApi.commands.meshEditing.configureSoftSelection({
            enabled: softSelectionEnabled,
            radius: softSelectionRadius,
            mode: softSelectionMode,
            falloff: softSelectionFalloff,
            surfaceBlend: softSelectionSurfaceBlend,
            connectivity: softSelectionConnectivity,
            heatmapVisible: softSelectionHeatmapVisible,
        });
    }, [
        softSelectionEnabled,
        softSelectionRadius,
        softSelectionMode,
        softSelectionFalloff,
        softSelectionSurfaceBlend,
        softSelectionConnectivity,
        softSelectionHeatmapVisible,
    ]);

    useEffect(() => {
        const gizmoSystem = engineInstance.gizmoSystem;
        gizmoSystem.setViewportEnabled(activeViewportProfile.overlays.gizmos);
        // Invariant: a bound camera never renders or picks itself in its own view.
        // Its world position is the picking-ray origin, so leaving its Camera pick sphere
        // active would make it the nearest hit for almost every object click.
        const suppressedEntityIds = viewCameraEntityId ? [viewCameraEntityId] : [];
        // Keep the direct expression as an architecture-audit contract for the gizmo path.
        gizmoSystem.setSuppressedEntityIds(viewCameraEntityId ? [viewCameraEntityId] : []);
        engineInstance.selectionSystem.setSuppressedEntityIds(suppressedEntityIds);

        return () => {
            gizmoSystem.setViewportEnabled(true);
            gizmoSystem.setSuppressedEntityIds([]);
            engineInstance.selectionSystem.setSuppressedEntityIds([]);
        };
    }, [viewCameraEntityId, activeViewportProfile.overlays.gizmos]);

    useEffect(() => {
        if (viewCameraEntityId) {
            if (gridBeforeCameraBindingRef.current === null) {
                gridBeforeCameraBindingRef.current = engineInstance.renderer.showGrid;
            }
            engineInstance.renderer.showGrid = activeViewportProfile.overlays.grid;
            engineInstance.notifyUI();
            return;
        }

        if (gridBeforeCameraBindingRef.current !== null) {
            engineInstance.renderer.showGrid = gridBeforeCameraBindingRef.current;
            gridBeforeCameraBindingRef.current = null;
            engineInstance.notifyUI();
        }
    }, [viewCameraEntityId, activeViewportProfile.overlays.grid]);

    useEffect(() => () => {
        if (gridBeforeCameraBindingRef.current !== null) {
            engineInstance.renderer.showGrid = gridBeforeCameraBindingRef.current;
            gridBeforeCameraBindingRef.current = null;
        }
    }, []);

    // Inspector/gizmo/parent edits to the bound Camera Transform should immediately
    // update the viewport. Engine notifications are broad, however, so selection or
    // unrelated asset/UI changes must not reconstruct the viewport pose from Transform.
    useEffect(() => {
        if (!viewCameraEntityId) return;
        return engineInstance.subscribe(() => {
            if (boundCameraNavigationActiveRef.current) return;
            if (!engineInstance.ecs.hasComponent(viewCameraEntityId, ComponentType.CAMERA)) {
                exitSceneCameraView();
                return;
            }

            const worldState = boundCameraWorldMatrixChanged(viewCameraEntityId);
            if (!worldState.current) {
                exitSceneCameraView();
                return;
            }
            if (!worldState.changed) return;

            // Record before publishing CameraState so any synchronous UI work caused by
            // that publication sees the same transform snapshot.
            boundCameraWorldMatrixRef.current = worldState.current;
            const next = readSceneCameraViewportState(
                engineInstance,
                viewCameraEntityId,
                cameraRef.current.radius,
            );
            if (!next) {
                exitSceneCameraView();
                return;
            }
            next.orthoScale = cameraRef.current.orthoScale ?? 1;
            if (!cameraStatesApproximatelyEqual(next, cameraRef.current)) {
                cameraRef.current = next;
                publishCameraState(next, true);
            }
        });
    }, [viewCameraEntityId, boundCameraWorldMatrixChanged, exitSceneCameraView, publishCameraState]);

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
    const pendingComponentPressRef = useRef<PendingSceneComponentPress | null>(null);

    const commitSelectionBoxState = (next: SelectionBoxState | null) => {
        selectionBoxRef.current = next;
        setSelectionBox(next);
    };

    useEffect(() => {
        pendingObjectPressRef.current = null;
        pendingComponentPressRef.current = null;
        commitSelectionBoxState(null);
    }, [meshComponentMode]);

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
        if (viewCameraLens?.projection === 'ORTHOGRAPHIC') {
            const halfHeight = Math.max(0.0005, viewCameraLens.orthoSize * 0.5 * (camera.orthoScale ?? 1));
            const halfWidth = halfHeight * aspect;
            Mat4Utils.orthographic(
                -halfWidth, halfWidth, -halfHeight, halfHeight,
                Math.max(0.0001, viewCameraLens.near),
                Math.max(viewCameraLens.near + 0.0001, viewCameraLens.far),
                proj,
            );
        } else {
            const fov = viewCameraLens?.fov ?? 45;
            const near = Math.max(0.0001, viewCameraLens?.near ?? 0.1);
            const far = Math.max(near + 0.0001, viewCameraLens?.far ?? 1000);
            Mat4Utils.perspective(fov * Math.PI / 180, aspect, near, far, proj);
        }
        const view = Mat4Utils.create();
        Mat4Utils.lookAt(eye, camera.target, getCameraUp(camera), view);
        const vp = Mat4Utils.create();
        Mat4Utils.multiply(proj, view, vp);
        
        engineInstance.updateCamera(vp, eye, width, height);
        engineInstance.gizmoSystem.setTool(tool);
    }, [
        camera,
        tool,
        viewportSize.cssWidth,
        viewportSize.cssHeight,
        viewCameraEntityId,
        viewCameraLens?.projection,
        viewCameraLens?.fov,
        viewCameraLens?.orthoSize,
        viewCameraLens?.near,
        viewCameraLens?.far,
    ]);

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
            if (!viewportInputRouter.isActive(SCENE_VIEWPORT_INPUT_ID)) return;
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

    const commitPendingSceneComponentClick = (pending: PendingSceneComponentPress) => {
        const currentPolicy = resolveSceneSelectionPolicy(engineInstance, selectedIds, meshComponentMode);
        if (!selectionPoliciesMatch(currentPolicy, pending.policy) || !pending.picked) return;
        if (pending.policy.target?.kind !== 'MESH_COMPONENTS') return;

        engineInstance.clearDeformation();
        if (!pending.shiftKey) {
            engineInstance.selectionSystem.subSelection.vertexIds.clear();
            engineInstance.selectionSystem.subSelection.edgeIds.clear();
            engineInstance.selectionSystem.subSelection.faceIds.clear();
        }

        if (pending.policy.domain === 'VERTEX') {
            const id = pending.picked.vertexId;
            if (pending.shiftKey && engineInstance.selectionSystem.subSelection.vertexIds.has(id)) {
                engineInstance.selectionSystem.subSelection.vertexIds.delete(id);
            } else {
                engineInstance.selectionSystem.subSelection.vertexIds.add(id);
            }
        } else if (pending.policy.domain === 'EDGE') {
            const id = meshEdgeKey(pending.picked.edgeId[0], pending.picked.edgeId[1]);
            if (pending.shiftKey && engineInstance.selectionSystem.subSelection.edgeIds.has(id)) {
                engineInstance.selectionSystem.subSelection.edgeIds.delete(id);
            } else {
                engineInstance.selectionSystem.subSelection.edgeIds.add(id);
            }
        } else if (pending.policy.domain === 'FACE') {
            const id = pending.picked.faceId;
            if (pending.shiftKey && engineInstance.selectionSystem.subSelection.faceIds.has(id)) {
                engineInstance.selectionSystem.subSelection.faceIds.delete(id);
            } else {
                engineInstance.selectionSystem.subSelection.faceIds.add(id);
            }
        }

        engineInstance.recalculateSoftSelection();
        engineInstance.notifyUI();
    };

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
            const policy = resolveSceneSelectionPolicy(engineInstance, selectedIds, meshComponentMode);
            if (policy.domain === 'OBJECT') {
                const hitId = engineInstance.selectionSystem.selectEntityAt(mx, my, rect.width, rect.height);
                if (hitId) {
                    if (!selectedIds.includes(hitId)) onSelect([hitId]);
                    openPieMenu(e.clientX, e.clientY, hitId);
                } else if (selectedIds.length > 0) {
                    openPieMenu(e.clientX, e.clientY);
                }
            } else if (policy.target?.kind === 'MESH_COMPONENTS') {
                // Component context owns RMB too: opening the modeling menu must not
                // silently switch object selection just because the cursor missed an edge/vertex.
                openPieMenu(e.clientX, e.clientY, policy.target.entityId);
            }
            return;
        }

        if (e.button === 0 && !isAdjustingBrush && !e.altKey) {
            engineInstance.isInputDown = true;
            pendingObjectPressRef.current = null;
            pendingComponentPressRef.current = null;
            commitSelectionBoxState(null);

            // Resolve Scene + mode + editable target before any selection query.
            // Component mode never falls through to object picking; changing the object
            // selection is an OBJECT-domain operation, not a side effect of a component miss.
            const policy = resolveSceneSelectionPolicy(engineInstance, selectedIds, meshComponentMode);

            if (policy.domain === 'OBJECT') {
                if (policy.target?.kind !== 'OBJECTS') return;
                const hitId = engineInstance.selectionSystem.selectEntityAt(mx, my, rect.width, rect.height);
                // Delay the click until mouse-up so the same press can become a marquee.
                // No drag threshold was crossed: this was a true click (handled on mouse-up).
                pendingObjectPressRef.current = {
                    startX: mx,
                    startY: my,
                    hitId,
                    shiftKey: e.shiftKey,
                };
                return;
            }

            if (!policy.supportsMarquee || policy.target?.kind !== 'MESH_COMPONENTS') return;
            pendingComponentPressRef.current = {
                policy,
                startX: mx,
                startY: my,
                shiftKey: e.shiftKey,
                picked: engineInstance.selectionSystem.pickMeshComponent(
                    policy.target.entityId,
                    mx,
                    my,
                    rect.width,
                    rect.height,
                ),
            };
            return;
        }

        if (e.altKey && (e.button !== 0 || !isAdjustingBrush)) {
            let mode: CameraDragMode = 'ORBIT';
            if (e.button === 1) mode = 'PAN';
            if (e.button === 2) mode = 'ZOOM';
            const allowed = mode === 'ORBIT'
                ? activeViewportProfile.navigation.orbit
                : mode === 'PAN'
                    ? activeViewportProfile.navigation.pan
                    : activeViewportProfile.navigation.zoom;
            if (allowed) {
                e.preventDefault();
                if (viewCameraEntityIdRef.current) {
                    // A mouse drag supersedes a pending wheel transaction. Its final
                    // mouse-up commit includes the current local viewport pose.
                    if (boundCameraUiCommitTimerRef.current !== null) {
                        window.clearTimeout(boundCameraUiCommitTimerRef.current);
                        boundCameraUiCommitTimerRef.current = null;
                    }
                    boundCameraNavigationActiveRef.current = true;
                }
                setDragState({ isDragging: true, startX: e.clientX, startY: e.clientY, mode, startCamera: cloneCamera(cameraRef.current) });
            }
        }
    };

    const handleGlobalMouseMove = (e: MouseEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        if (isAdjustingBrush) return; // Handled by hook

        const pendingComponentPress = pendingComponentPressRef.current;
        if (pendingComponentPress && !dragState && !selectionBoxRef.current) {
            const currentPolicy = resolveSceneSelectionPolicy(engineInstance, selectedIds, meshComponentMode);
            if (selectionPoliciesMatch(currentPolicy, pendingComponentPress.policy)) {
                const selectionX = Math.max(0, Math.min(rect.width, mx));
                const selectionY = Math.max(0, Math.min(rect.height, my));
                const dx = selectionX - pendingComponentPress.startX;
                const dy = selectionY - pendingComponentPress.startY;
                if ((dx * dx) + (dy * dy) >= MARQUEE_DRAG_THRESHOLD_PX * MARQUEE_DRAG_THRESHOLD_PX) {
                    engineInstance.selectionSystem.clearMeshComponentHover();
                    commitSelectionBoxState({
                        startX: pendingComponentPress.startX,
                        startY: pendingComponentPress.startY,
                        currentX: selectionX,
                        currentY: selectionY,
                        isSelecting: true,
                    });
                }
            }
        }

        const pendingObjectPress = pendingObjectPressRef.current;
        if (pendingObjectPress && !dragState && !selectionBoxRef.current) {
            const currentPolicy = resolveSceneSelectionPolicy(engineInstance, selectedIds, meshComponentMode);
            if (currentPolicy.domain === 'OBJECT' && currentPolicy.target?.kind === 'OBJECTS') {
                const dx = mx - pendingObjectPress.startX;
                const dy = my - pendingObjectPress.startY;
                if ((dx * dx) + (dy * dy) >= MARQUEE_DRAG_THRESHOLD_PX * MARQUEE_DRAG_THRESHOLD_PX) {
                    const selectionX = Math.max(0, Math.min(rect.width, mx));
                    const selectionY = Math.max(0, Math.min(rect.height, my));
                    commitSelectionBoxState({
                        startX: pendingObjectPress.startX,
                        startY: pendingObjectPress.startY,
                        currentX: selectionX,
                        currentY: selectionY,
                        isSelecting: true,
                    });
                }
            }
        }

        engineInstance.gizmoSystem.update(0, mx, my, rect.width, rect.height, false, false);

        const hoverPolicy = resolveSceneSelectionPolicy(engineInstance, selectedIds, meshComponentMode);
        if (!selectionBoxRef.current && hoverPolicy.target?.kind === 'MESH_COMPONENTS') {
            engineInstance.selectionSystem.hoverMeshComponentAt(mx, my, rect.width, rect.height);
        } else if (meshComponentMode !== 'OBJECT') {
            engineInstance.selectionSystem.clearMeshComponentHover();
        }

        if (dragState && dragState.isDragging) {
            const dx = e.clientX - dragState.startX;
            const dy = e.clientY - dragState.startY;
             if (dragState.mode === 'ORBIT') {
                updateViewportCamera(orbitCamera(dragState.startCamera, dx, dy, { minPhi: 0.1, maxPhi: Math.PI - 0.1 }));
            } else if (dragState.mode === 'ZOOM') {
                if (viewCameraLens?.projection === 'ORTHOGRAPHIC') {
                    updateViewportCamera(dragOrthographicZoomCamera(dragState.startCamera, dx, dy));
                } else {
                    updateViewportCamera(dragZoomCamera(dragState.startCamera, dx, dy, { minRadius: 1 }));
                }
            } else if (dragState.mode === 'PAN') {
                updateViewportCamera(panCamera(dragState.startCamera, dx, dy));
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

            // Finalize the gesture through the policy captured on mouse-down. The
            // active viewport/context already decided OBJECT vs mesh component domain;
            // marquee execution therefore cannot accidentally fall through across domains.
            const activeSelectionBox = selectionBoxRef.current;
            const pendingObjectPress = pendingObjectPressRef.current;
            const pendingComponentPress = pendingComponentPressRef.current;

            const commitObjectClick = () => {
                if (!pendingObjectPress || e.button !== 0) return;
                const policy = resolveSceneSelectionPolicy(engineInstance, selectedIds, meshComponentMode);
                if (policy.domain !== 'OBJECT' || policy.target?.kind !== 'OBJECTS') return;
                if (pendingObjectPress.hitId) {
                    const operation = resolveMarqueeOperation(pendingObjectPress);
                    const next = operation === 'TOGGLE'
                        ? (selectedIds.includes(pendingObjectPress.hitId)
                            ? selectedIds.filter(id => id !== pendingObjectPress.hitId)
                            : [...selectedIds, pendingObjectPress.hitId])
                        : [pendingObjectPress.hitId];
                    onSelect(next);
                } else if (!pendingObjectPress.shiftKey) {
                    onSelect([]);
                }
            };

            if (activeSelectionBox?.isSelecting) {
                const x = Math.min(activeSelectionBox.startX, selectionX);
                const y = Math.min(activeSelectionBox.startY, selectionY);
                const w = Math.abs(selectionX - activeSelectionBox.startX);
                const h = Math.abs(selectionY - activeSelectionBox.startY);

                if (w >= MARQUEE_DRAG_THRESHOLD_PX || h >= MARQUEE_DRAG_THRESHOLD_PX) {
                    if (pendingComponentPress) {
                        const currentPolicy = resolveSceneSelectionPolicy(engineInstance, selectedIds, meshComponentMode);
                        if (selectionPoliciesMatch(currentPolicy, pendingComponentPress.policy)) {
                            executeMarqueeSelection(
                                engineInstance,
                                pendingComponentPress.policy,
                                {
                                    x,
                                    y,
                                    width: w,
                                    height: h,
                                    viewportWidth: rect.width,
                                    viewportHeight: rect.height,
                                },
                                resolveMarqueeOperation(pendingComponentPress),
                            );
                        }
                    } else if (pendingObjectPress) {
                        const policy = resolveSceneSelectionPolicy(engineInstance, selectedIds, meshComponentMode);
                        if (policy.domain === 'OBJECT') {
                            const result = executeMarqueeSelection(
                                engineInstance,
                                policy,
                                {
                                    x,
                                    y,
                                    width: w,
                                    height: h,
                                    viewportWidth: rect.width,
                                    viewportHeight: rect.height,
                                },
                                resolveMarqueeOperation(pendingObjectPress),
                                selectedIds,
                            );
                            if (result.kind === 'OBJECTS') onSelect(result.selectedIds);
                        }
                    }
                } else if (pendingComponentPress && e.button === 0) {
                    commitPendingSceneComponentClick(pendingComponentPress);
                } else {
                    commitObjectClick();
                }

                commitSelectionBoxState(null);
            } else if (pendingComponentPress && e.button === 0) {
                // No drag threshold was crossed: component click, not object picking.
                commitPendingSceneComponentClick(pendingComponentPress);
            } else {
                commitObjectClick();
            }

            pendingObjectPressRef.current = null;
            pendingComponentPressRef.current = null;
        }

        if (viewCameraEntityIdRef.current && dragState?.isDragging) {
            // One Transform write + one UI notification for the whole gesture. The
            // notification occurs while the navigation guard is still active, so this
            // viewport cannot consume its own commit and start a resync tail.
            commitBoundCameraViewportState();
        } else {
            if (dragState?.isDragging) publishCameraState(cameraRef.current, true);
            boundCameraNavigationActiveRef.current = false;
        }
        setDragState(null);
    };

    const handleWindowBlur = () => {
        engineInstance.isInputDown = false;
        pendingObjectPressRef.current = null;
        pendingComponentPressRef.current = null;
        if (viewCameraEntityIdRef.current && boundCameraNavigationActiveRef.current) {
            commitBoundCameraViewportState();
        } else {
            boundCameraNavigationActiveRef.current = false;
        }
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
    }, [dragState, selectionBox, meshComponentMode, isAdjustingBrush, selectedIds, onSelect, commitBoundCameraViewportState, publishCameraState]);

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

    const commandContext: EditorCommandContext = (() => {
        const staticMeshTarget = resolveSceneStaticMeshEditTarget(engineInstance, selectedIds);
        const capabilities = new Set<EditorCommandCapability>([
            'VIEW_FOCUS',
            'VIEW_RESET',
            'VIEW_GRID',
            'MESH_WIREFRAME',
            'OBJECT_EDIT',
        ]);
        if (staticMeshTarget) {
            capabilities.add('STATIC_MESH_EDIT');
            capabilities.add('STATIC_MESH_COMPONENT_EDIT');
        }
        const subSelection = engineInstance.selectionSystem.subSelection;
        return {
            capabilities,
            meshComponentMode,
            selectionCounts: {
                object: selectedIds.length,
                vertices: subSelection.vertexIds.size,
                edges: subSelection.edgeIds.size,
                faces: subSelection.faceIds.size,
            },
            staticMeshTarget,
            softSelection: {
                enabled: softSelectionEnabled,
                radius: softSelectionRadius,
                mode: softSelectionMode,
                distanceMetric: softSelectionFalloff,
                falloff: softSelectionFalloff,
                surfaceBlend: softSelectionSurfaceBlend,
                connectivity: softSelectionConnectivity,
                heatmapVisible: softSelectionHeatmapVisible,
            },
            services: {
                setTool,
                setComponentMode: setMeshComponentMode,
                focus: handleFocus,
                resetCamera: handleFocus,
                toggleGrid: () => engineInstance.toggleGrid(),
                toggleWireframe: () => handleModeSelect(3),
                duplicateSelection: () => selectedIds.forEach(id => engineInstance.duplicateEntity(id)),
                deleteSelection: () => {
                    selectedIds.forEach(id => engineInstance.deleteEntity(id, sceneGraph));
                    onSelect([]);
                },
                selectLoop: mode => {
                    engineInstance.meshComponentMode = mode;
                    setMeshComponentMode(mode);
                    engineInstance.selectLoop(mode);
                },
                expandSelection: mode => {
                    engineInstance.meshComponentMode = mode;
                    setMeshComponentMode(mode);
                    engineInstance.expandSelection(mode);
                },
                shrinkSelection: mode => {
                    engineInstance.meshComponentMode = mode;
                    setMeshComponentMode(mode);
                    engineInstance.shrinkSelection(mode);
                },
                selectRing: mode => {
                    engineInstance.meshComponentMode = mode;
                    setMeshComponentMode(mode);
                    engineInstance.selectRing(mode);
                },
                topologyCommand: command => {
                    if (command === 'EXTRUDE') engineInstance.extrudeFaces();
                    if (command === 'BEVEL') engineInstance.bevelEdges();
                    if (command === 'WELD') engineInstance.weldVertices();
                    if (command === 'CONNECT') engineInstance.connectComponents();
                    if (command === 'DELETE_FACE') engineInstance.deleteSelectedFaces();
                },
                // Scene topology still uses the legacy live-edit engine. Keep asset-level
                // Logical Mesh operations disabled here until the Scene adapter
                // routes them through StaticMeshAssetAPI as well.
                supportsTopologyCommand: command => command !== 'INSET' && command !== 'SPLIT_EDGE' && command !== 'CUT_FACE',
                configureSoftSelection: configureSceneSoftSelection,
            },
        };
    })();

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
                onWheel: (e) => {
                    if (!activeViewportProfile.navigation.zoom) return;
                    const boundCameraId = viewCameraEntityIdRef.current;
                    if (boundCameraId) boundCameraNavigationActiveRef.current = true;
                    if (viewCameraLens?.projection === 'ORTHOGRAPHIC') {
                        updateViewportCamera(cameraState => wheelOrthographicZoomCamera(cameraState, e.deltaY));
                    } else {
                        updateViewportCamera(cameraState => wheelZoomCamera(cameraState, e.deltaY, { minRadius: 2, sensitivity: 0.01 }));
                    }
                    if (boundCameraId) {
                        if (boundCameraUiCommitTimerRef.current !== null) {
                            window.clearTimeout(boundCameraUiCommitTimerRef.current);
                        }
                        boundCameraUiCommitTimerRef.current = window.setTimeout(() => {
                            boundCameraUiCommitTimerRef.current = null;
                            commitBoundCameraViewportState();
                        }, 90);
                    }
                },
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
                        <ViewportIconButton label="Toggle Grid" active={engineInstance.renderer.showGrid} onClick={() => engineInstance.toggleGrid()}>
                            <Icon name="Grid" size={14} />
                        </ViewportIconButton>
                    </ViewportToolbarGroup>

                    {(viewCameraEntityId || selectedCameraId) && (
                        <ViewportToolbarGroup>
                            {viewCameraEntityId && (
                                <ViewportIconButton
                                    label="Exit Scene Camera View"
                                    active
                                    onClick={exitSceneCameraView}
                                >
                                    <Icon name="EyeOff" size={14} />
                                </ViewportIconButton>
                            )}
                            {selectedCameraId && selectedCameraId !== viewCameraEntityId && (
                                <ViewportIconButton
                                    label="View Through Selected Camera"
                                    onClick={() => enterSceneCameraView(selectedCameraId)}
                                >
                                    <Icon name="Camera" size={14} />
                                </ViewportIconButton>
                            )}
                        </ViewportToolbarGroup>
                    )}

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
                    <span>
                        {viewCameraEntityId
                            ? `Cam: ${engineInstance.ecs.createProxy(viewCameraEntityId, sceneGraph)?.name ?? 'Scene Camera'} • Through`
                            : `Cam: ${camera.target.x.toFixed(1)}, ${camera.target.y.toFixed(1)}, ${camera.target.z.toFixed(1)}`}
                    </span>
                    {softSelectionEnabled && meshComponentMode !== 'OBJECT' && (
                        <span className="text-accent">
                            Soft Sel ({softSelectionMode === 'FIXED' ? 'Fixed' : softSelectionMode === 'LIVE_FALLOFF' ? 'Live' : 'Slide'}): {softSelectionRadius.toFixed(1)}m
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
                            commandContext={commandContext}
                            onClose={closePieMenu}
                        />,
                        document.body,
                    )}
                </>
            }
        />
    );

};
