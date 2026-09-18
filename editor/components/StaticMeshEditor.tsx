import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { EditorContext } from '@/editor/state/EditorContext';
import { useBrushInteraction } from '@/editor/hooks/useBrushInteraction';
import { AssetViewportEngine } from '@/editor/viewports/AssetViewportEngine';
import { resolveMeshFocusTarget } from '@/editor/viewports/focusTargetResolvers';
import type { EditorCommandCapability, EditorCommandContext } from '@/editor/commands/EditorCommandRegistry';
import '@/editor/commands/StaticMeshCommandCatalogue';
import { resolveAssetStaticMeshEditTarget } from '@/engine/mesh-editing/StaticMeshEditTarget';
import {
  getStaticMeshComponentSelection,
  getStaticMeshShellsComponentSelection,
  resolveStaticMeshShells,
} from '@/engine/mesh-editing/StaticMeshShells';
import {
  executeMarqueeSelection,
  resolveMarqueeOperation,
  resolveStaticMeshEditorSelectionPolicy,
  selectionPoliciesMatch,
  type SelectionPolicy,
} from '@/editor/selection/SelectionPolicy';
import { createFocusTargetFromPoints, type ViewportFocusProvider } from '@/editor/viewports/viewportFocus';
import { assetManager } from '@/engine/AssetManager';
import { staticMeshAssetAPI } from '@/engine/api/StaticMeshAssetAPI';
import { eventBus } from '@/engine/EventBus';
import { GizmoSystem } from '@/engine/GizmoSystem';
import type { MeshPickingResult } from '@/engine/MeshTopologyUtils';
import { Mat4Utils, Vec3Utils } from '@/engine/math';
import { getMeshVertexPointSizes, getViewportPixelRatio } from '@/engine/MeshComponentVisualStyle';
import { VIEW_MODES } from '@/engine/constants';
import {
  applyMeshSurfaceUniforms,
  DEFAULT_MESH_PREVIEW_LIGHT,
  DEFAULT_MESH_SURFACE_MATERIAL,
  MESH_SURFACE_RENDER_MODE,
} from '@/engine/renderers/MeshSurfaceContract';
import { MaterialPreviewRenderer } from '@/engine/renderers/MaterialPreviewRenderer';
import {
  buildMeshEdgeIndices,
  buildMeshEdgeIndicesFromKeys,
  collectFaceEdgeKeys,
  MESH_EDGE_COLORS,
  meshEdgeKey,
  meshEdgePairFromKey,
} from '@/engine/MeshEdgeGeometry';
import { MeshEdgeOverlay } from '@/editor/viewports/MeshEdgeOverlay';
import { MeshFaceOverlay } from '@/editor/viewports/MeshFaceOverlay';
import { MESH_VERTEX_COLORS, MeshVertexOverlay } from '@/editor/viewports/MeshVertexOverlay';
import { buildMeshFaceTriangleIndices, MESH_FACE_COLORS } from '@/engine/MeshFaceGeometry';
import { MeshComponentMode, SoftSelectionConnectivity, SoftSelectionFalloff, StaticMeshAsset, SkeletalMeshAsset, ToolType } from '@/types';

import { Icon } from './Icon';
import { PieMenu } from './PieMenu';
import { AssetViewport3D, type AssetViewport3DHandle, AssetViewportRenderArgs, CameraState } from './AssetViewport3D';
import { AssetEditorTemplate } from './asset-editor/AssetEditorTemplate';
import { MeshAssetHierarchy, type MeshHierarchySection } from './asset-editor/MeshAssetHierarchy';
import { StaticMeshToolDock } from './mesh-editing/StaticMeshToolDock';
import { MeshAssetInspector } from './asset-editor/MeshAssetInspector';
import { AssetViewportToolbarAction, assetViewportAllows, meshModeActionId } from './asset-editor/assetViewportCapabilities';

// Keep the asset editor's shared surface modes numerically identical to Scene View.
const RENDER_MODE_ITEMS: Array<{ id: number; label: string; icon: string }> = VIEW_MODES
  .filter(mode => mode.id <= MESH_SURFACE_RENDER_MODE.UNLIT)
  .map(mode => ({ ...mode }));

type DirtyKind = 'NONE' | 'VERTS' | 'FULL';
const MARQUEE_DRAG_THRESHOLD_PX = 4;

const REFERENCE_MESH_SURFACE_MATERIAL = {
  albedo: [0.46, 0.58, 0.68] as const,
  metallic: 0.0,
  smoothness: 0.42,
};

const CONSTRUCTION_POINT_COLORS = {
  base: { r: 0.15, g: 0.82, b: 0.95, a: 1.0 },
  selected: { r: 1.0, g: 0.9, b: 0.1, a: 1.0 },
} as const;

type ReferenceMeshGpuResource = {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  nbo: WebGLBuffer;
  softWeightBo: WebGLBuffer;
  ibo: WebGLBuffer;
  indexCount: number;
  indexType: number;
};

type SelectionBoxState = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  isSelecting: boolean;
};

type PendingComponentPress = {
  policy: SelectionPolicy;
  entityId: string;
  mode: Exclude<MeshComponentMode, 'OBJECT'>;
  startX: number;
  startY: number;
  shiftKey: boolean;
  picked: MeshPickingResult | null;
};
type PendingObjectPress = {
  policy: SelectionPolicy;
  startX: number;
  startY: number;
  shiftKey: boolean;
  hitId: string | null;
};
type SoftSelectionCommandSettings = Parameters<NonNullable<EditorCommandContext['services']['configureSoftSelection']>>[0];
type TopologyCommand = Parameters<NonNullable<EditorCommandContext['services']['topologyCommand']>>[0];

const EMPTY_STATIC_MESH_CAMERA = {
  radius: 3.5,
  target: { x: 0, y: 0, z: 0 },
} as const;

function computeFitCamera(
  asset: StaticMeshAsset | SkeletalMeshAsset
): { radius: number; target: { x: number; y: number; z: number } } {
  const constructionPoints = asset.type === 'MESH' ? asset.construction?.points ?? [] : [];
  const aabb = asset.geometry.aabb;
  const hasGeometry = asset.geometry.vertices.length > 0 && !!aabb;
  if (!hasGeometry && constructionPoints.length === 0) {
    return {
      radius: EMPTY_STATIC_MESH_CAMERA.radius,
      target: { ...EMPTY_STATIC_MESH_CAMERA.target },
    };
  }

  let minX = hasGeometry && aabb ? aabb.min.x : Infinity;
  let minY = hasGeometry && aabb ? aabb.min.y : Infinity;
  let minZ = hasGeometry && aabb ? aabb.min.z : Infinity;
  let maxX = hasGeometry && aabb ? aabb.max.x : -Infinity;
  let maxY = hasGeometry && aabb ? aabb.max.y : -Infinity;
  let maxZ = hasGeometry && aabb ? aabb.max.z : -Infinity;

  constructionPoints.forEach(point => {
    minX = Math.min(minX, point.position.x);
    minY = Math.min(minY, point.position.y);
    minZ = Math.min(minZ, point.position.z);
    maxX = Math.max(maxX, point.position.x);
    maxY = Math.max(maxY, point.position.y);
    maxZ = Math.max(maxZ, point.position.z);
  });

  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) {
    return {
      radius: EMPTY_STATIC_MESH_CAMERA.radius,
      target: { ...EMPTY_STATIC_MESH_CAMERA.target },
    };
  }

  const size = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
  const maxDim = Math.max(size.x, Math.max(size.y, size.z));
  const center = { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5, z: (minZ + maxZ) * 0.5 };
  return { radius: Math.max(maxDim * 1.5, 0.25), target: center };
}


export interface StaticMeshEditorProps {
  assetId: string;
  editorHeaderExtra?: React.ReactNode;
}

export const StaticMeshEditor: React.FC<StaticMeshEditorProps> = ({ assetId, editorHeaderExtra }) => {
  // Static Mesh editing owns transient tool/component/soft-selection state.
  // Reusing the same command catalogue and mesh-editing implementation must not
  // put the Scene viewport into component-edit mode or show its heatmap/cage.
  const editorCtx = useContext(EditorContext);
  const vertexSize = editorCtx?.uiConfig.vertexSize ?? 1.0;
  const [tool, setTool] = useState<ToolType>('SELECT');
  const [meshComponentMode, setMeshComponentMode] = useState<MeshComponentMode>('OBJECT');
  const [softSelectionEnabled, setSoftSelectionEnabled] = useState(false);
  const [softSelectionRadius, setSoftSelectionRadius] = useState(2.0);
  const [softSelectionMode, setSoftSelectionMode] = useState<'FIXED' | 'LIVE_FALLOFF' | 'SLIDE'>('FIXED');
  const [softSelectionFalloff, setSoftSelectionFalloff] = useState<SoftSelectionFalloff>('VOLUME');
  const [softSelectionSurfaceBlend, setSoftSelectionSurfaceBlend] = useState(0.5);
  const [softSelectionConnectivity, setSoftSelectionConnectivity] = useState<SoftSelectionConnectivity>('NONE');
  const [softSelectionHeatmapVisible, setSoftSelectionHeatmapVisible] = useState(true);
  const [topologyInsetAmount, setTopologyInsetAmount] = useState(0.25);
  const [topologyExtrudeDistance, setTopologyExtrudeDistance] = useState(1.0);
  const [topologySplitPosition, setTopologySplitPosition] = useState(0.5);
  const [topologyBevelWidth, setTopologyBevelWidth] = useState(0.25);
  const [topologyFeedback, setTopologyFeedback] = useState<string | null>(null);

  const meshComponentModeRef = useRef<MeshComponentMode>(meshComponentMode);
  useEffect(() => {
    meshComponentModeRef.current = meshComponentMode;
  }, [meshComponentMode]);

  // Viewport-local UI state
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [showWireframe, setShowWireframe] = useState<boolean>(false);
  const [renderMode, setRenderMode] = useState<number>(0);
  const showWireframeRef = useRef<boolean>(showWireframe);
  useEffect(() => {
    showWireframeRef.current = showWireframe;
  }, [showWireframe]);
  const renderModeRef = useRef<number>(renderMode);
  useEffect(() => {
    renderModeRef.current = renderMode;
  }, [renderMode]);

  const [stats, setStats] = useState<{ verts: number; tris: number }>({ verts: 0, tris: 0 });
  const [pieMenu, setPieMenu] = useState<{ x: number; y: number } | null>(null);
  const [hierarchySection, setHierarchySection] = useState<MeshHierarchySection>('ASSET');
  const [selectedShellIds, setSelectedShellIds] = useState<string[]>([]);
  const [selectedConstructionPointIds, setSelectedConstructionPointIds] = useState<string[]>([]);
  const constructionPointScreenRef = useRef<Array<{ id: string; x: number; y: number }>>([]);
  const [leftDockCollapsed, setLeftDockCollapsed] = useState(false);
  const [materialId, setMaterialId] = useState<string>('');
  const materialIdRef = useRef<string>('');
  const materialRevisionRef = useRef(0);
  useEffect(() => {
    materialIdRef.current = materialId;
  }, [materialId]);

  useEffect(() => {
    const asset = assetManager.getAsset(assetId);
    const nextMaterialId = asset && (asset.type === 'MESH' || asset.type === 'SKELETAL_MESH')
      ? asset.materialId || ''
      : '';
    setMaterialId(nextMaterialId);
    materialIdRef.current = nextMaterialId;
  }, [assetId]);

  useEffect(() => eventBus.on('ASSET_UPDATED', payload => {
    if (payload?.type === 'MATERIAL' && payload.id === materialIdRef.current) {
      materialRevisionRef.current += 1;
    }
  }), []);

  const handleMaterialChange = (nextMaterialId: string) => {
    setMaterialId(nextMaterialId);
    materialIdRef.current = nextMaterialId;
    materialRevisionRef.current += 1;
    assetManager.updateAsset(assetId, { materialId: nextMaterialId || undefined });
  };

  // Local selection/gizmo engine for this viewport
  const previewEngineRef = useRef<AssetViewportEngine | null>(null);
  const gizmoSystemRef = useRef<GizmoSystem | null>(null);
  const [previewEngine, setPreviewEngine] = useState<AssetViewportEngine | null>(null);
  const [gizmoSystem, setGizmoSystem] = useState<GizmoSystem | null>(null);
  const selectionTickRef = useRef<number>(0);
  const [selectionTick, setSelectionTick] = useState<number>(0); // UI refresh only
  const dirtyRef = useRef<DirtyKind>('NONE');
  const referenceRevisionRef = useRef(0);
  const [assetRevision, setAssetRevision] = useState(0);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
  const selectionBoxRef = useRef<SelectionBoxState | null>(null);
  const pendingComponentPressRef = useRef<PendingComponentPress | null>(null);
  const pendingObjectPressRef = useRef<PendingObjectPress | null>(null);

  const changeMeshComponentMode = useCallback((mode: MeshComponentMode) => {
    const engine = previewEngineRef.current;
    if (mode === 'OBJECT' && engine && meshComponentModeRef.current !== 'OBJECT') {
      // Component modes keep the preview entity selected only as an internal edit
      // target. A mode-only switch back to Object must not reinterpret that hidden
      // target as an explicit whole-object selection/gizmo. Hierarchy Asset/Geometry
      // clicks opt into object selection separately via handleHierarchyObjectSelect().
      engine.api.commands.selection.clear();
    }
    setMeshComponentMode(mode);
  }, []);

  useEffect(() => {
    const refreshMeshAssets = (payload: { id?: string; type?: string } | undefined) => {
      if (payload?.type !== 'MESH') return;
      referenceRevisionRef.current += 1;
      setAssetRevision(value => value + 1);
      if (payload.id === assetId) dirtyRef.current = 'FULL';
    };
    const offUpdated = eventBus.on('ASSET_UPDATED', refreshMeshAssets);
    const offCreated = eventBus.on('ASSET_CREATED', refreshMeshAssets);
    const offDeleted = eventBus.on('ASSET_DELETED', refreshMeshAssets);
    return () => {
      offUpdated?.();
      offCreated?.();
      offDeleted?.();
    };
  }, [assetId]);

  const commitSelectionBoxState = useCallback((next: SelectionBoxState | null) => {
    selectionBoxRef.current = next;
    setSelectionBox(next);
  }, []);

  useEffect(() => eventBus.on('ASSET_HISTORY_CHANGED', payload => {
    if (payload?.id === assetId) setHistoryRevision(value => value + 1);
  }), [assetId]);

  useEffect(() => {
    pendingComponentPressRef.current = null;
    pendingObjectPressRef.current = null;
    commitSelectionBoxState(null);
  }, [assetId, meshComponentMode, commitSelectionBoxState]);

  useEffect(() => {
    setSelectedConstructionPointIds([]);
    constructionPointScreenRef.current = [];
  }, [assetId]);

  // Camera state
  const [camera, setCamera] = useState<CameraState>({
    theta: 0.5,
    phi: 1.2,
    radius: 3.0,
    target: { x: 0, y: 0, z: 0 },
  });
  const [fitCamera, setFitCamera] = useState<{
    radius: number;
    target: { x: number; y: number; z: number };
  } | null>(null);


  // Construction can be changed by AI/scripts while this editor remains open.
  // Keep framing/statistics and semantic selection synchronized with asset events
  // without resetting the user's current camera on every modeling operation.
  useEffect(() => {
    const asset = assetManager.getAsset(assetId) as StaticMeshAsset | SkeletalMeshAsset | undefined;
    if (!asset || (asset.type !== 'MESH' && asset.type !== 'SKELETAL_MESH')) return;
    setStats({
      verts: asset.geometry.vertices.length / 3,
      tris: asset.geometry.indices.length / 3,
    });
    setFitCamera(computeFitCamera(asset));
    if (asset.type === 'MESH') {
      const validPointIds = new Set((asset.construction?.points ?? []).map(point => point.id));
      setSelectedConstructionPointIds(current => {
        const next = current.filter(pointId => validPointIds.has(pointId));
        return next.length === current.length ? current : next;
      });
    }
  }, [assetId, assetRevision]);

  const viewportRef = useRef<AssetViewport3DHandle | null>(null);
  const viewportInputId = `static-mesh:${assetId}`;

  // Buffers
  const glResourcesRef = useRef<{
    meshVao: WebGLVertexArrayObject | null;
    vbo: WebGLBuffer | null;
    nbo: WebGLBuffer | null;
    uvbo: WebGLBuffer | null;
    colorbo: WebGLBuffer | null;
    softWeightBo: WebGLBuffer | null;
    ibo: WebGLBuffer | null;
    edgeOverlay: MeshEdgeOverlay;
    selectedEdgeOverlay: MeshEdgeOverlay;
    hoveredEdgeOverlay: MeshEdgeOverlay;
    selectedFaceOverlay: MeshFaceOverlay;
    hoveredFaceOverlay: MeshFaceOverlay;
    vertexOverlay: MeshVertexOverlay;
    constructionPointVbo: WebGLBuffer | null;
    constructionPointOverlay: MeshVertexOverlay;
    constructionPointRevision: number;
    constructionPointSelectionSignature: string;
    materialPreview: MaterialPreviewRenderer;
    selectionEdgeRevision: number;
    selectionEdgeMode: MeshComponentMode | null;
    hoveredEdgeSignature: string;
    selectedFaceRevision: number;
    hoveredFaceSignature: string;
    selectionVertexRevision: number;
    softWeightRevision: number;
    referenceMeshes: Map<string, ReferenceMeshGpuResource>;
    referenceRevision: number;
  }>({
    meshVao: null,
    vbo: null,
    nbo: null,
    uvbo: null,
    colorbo: null,
    softWeightBo: null,
    ibo: null,
    edgeOverlay: new MeshEdgeOverlay(),
    selectedEdgeOverlay: new MeshEdgeOverlay(),
    hoveredEdgeOverlay: new MeshEdgeOverlay(),
    selectedFaceOverlay: new MeshFaceOverlay(),
    hoveredFaceOverlay: new MeshFaceOverlay(),
    vertexOverlay: new MeshVertexOverlay(),
    constructionPointVbo: null,
    constructionPointOverlay: new MeshVertexOverlay(),
    constructionPointRevision: -1,
    constructionPointSelectionSignature: '',
    materialPreview: new MaterialPreviewRenderer(),
    selectionEdgeRevision: -1,
    selectionEdgeMode: null,
    hoveredEdgeSignature: '',
    selectedFaceRevision: -1,
    hoveredFaceSignature: '',
    selectionVertexRevision: -1,
    softWeightRevision: -1,
    referenceMeshes: new Map(),
    referenceRevision: -1,
  });

  // Keep the local preview engine in-sync with this asset editor session.
  useEffect(() => {
    const engine = previewEngineRef.current;
    if (engine) {
      engine.clearDeformation();
      engine.meshComponentMode = meshComponentMode;
      engine.selectionSystem.clearMeshComponentHover();

      // Component editing has one fixed preview-entity target. Repair that
      // invariant when entering/switching component modes instead of allowing a
      // stale object-selection miss to leave the gizmo permanently unavailable.
      const previewEntityId = engine.entityId;
      if (meshComponentMode !== 'OBJECT' && previewEntityId) {
        const entityIndex = engine.ecs.idToIndex.get(previewEntityId);
        if (entityIndex !== undefined && !engine.selectionSystem.selectedIndices.has(entityIndex)) {
          engine.selectionSystem.setSelected([previewEntityId], false);
        }
      }
      engine.recalculateSoftSelection();
    }
  }, [meshComponentMode]);

  useEffect(() => {
    gizmoSystemRef.current?.setTool(tool);
  }, [tool]);

  // Static Mesh focus adapter: object mode frames the whole asset; component
  // modes frame only the selected vertices/edge endpoints/face vertices. The
  // provider reads live refs so F always resolves the current selection without
  // coupling AssetViewport3D to mesh topology.
  const focusProvider = useMemo<ViewportFocusProvider>(() => ({
    getFocusTarget: () => {
      const asset = assetManager.getAsset(assetId) as StaticMeshAsset | SkeletalMeshAsset | undefined;
      if (!asset || (asset.type !== 'MESH' && asset.type !== 'SKELETAL_MESH')) return null;

      const engine = previewEngineRef.current;
      const entityId = engine?.entityId ?? null;
      const world = entityId ? engine?.sceneGraph.getWorldMatrix(entityId) ?? null : null;

      if (hierarchySection === 'CONSTRUCTION_POINTS' && selectedConstructionPointIds.length > 0 && asset.type === 'MESH') {
        const selected = new Set(selectedConstructionPointIds);
        const worldPoint = { x: 0, y: 0, z: 0 };
        const points = (asset.construction?.points ?? [])
          .filter(point => selected.has(point.id))
          .map(point => {
            if (!world) return { ...point.position };
            Vec3Utils.transformMat4(point.position, world, worldPoint);
            return { ...worldPoint };
          });
        const constructionTarget = createFocusTargetFromPoints(points, { minWorldRadius: 0.12, padding: 1.35 });
        if (constructionTarget) return constructionTarget;
      }

      const componentVertices = meshComponentModeRef.current !== 'OBJECT'
        ? engine?.selectionSystem.getSelectionAsVertices() ?? null
        : null;

      return resolveMeshFocusTarget(
        asset,
        componentVertices && componentVertices.size > 0 ? componentVertices : null,
        world,
      );
    },
  }), [assetId, hierarchySection, selectedConstructionPointIds]);

  // Create / dispose local preview engine
  useEffect(() => {
    const asset = assetManager.getAsset(assetId) as StaticMeshAsset | SkeletalMeshAsset | undefined;
    if (!asset || (asset.type !== 'MESH' && asset.type !== 'SKELETAL_MESH')) return;

    setStats({
      verts: asset.geometry.vertices.length / 3,
      tris: asset.geometry.indices.length / 3,
    });

    const fit = computeFitCamera(asset);
    setFitCamera(fit);
    setCamera(p => ({ ...p, radius: fit.radius, target: { ...fit.target } }));

    const onNotifyUI = () => {
      selectionTickRef.current += 1;
      setSelectionTick(selectionTickRef.current);
    };

    const onGeometryUpdated = (updatedAssetId: string) => {
      if (dirtyRef.current === 'NONE') dirtyRef.current = 'VERTS';
      // Live preview is a render invalidation, not a persisted Asset update.
      // Scene instances of this asset can refresh their solid GPU geometry
      // without making Scene enter the Static Mesh Editor's component mode.
      eventBus.emit('MESH_GEOMETRY_PREVIEW_UPDATED', { id: updatedAssetId, type: 'MESH' });
    };

    const onGeometryFinalized = (updatedAssetId: string) => {
      dirtyRef.current = 'FULL';
      setStats({
        verts: asset.geometry.vertices.length / 3,
        tris: asset.geometry.indices.length / 3,
      });
      // Geometry is already mutated in the edit session; route the transaction
      // boundary through AssetManager so every normal asset subscriber sees one
      // canonical update without receiving one on every mouse move.
      assetManager.updateAsset(updatedAssetId, {
        geometry: asset.geometry,
        topology: asset.topology,
      });
    };

    const previewEngine = new AssetViewportEngine(onNotifyUI, onGeometryUpdated, onGeometryFinalized);
    previewEngine.setPreviewMesh(assetId, { select: false });
    previewEngine.syncTransforms(false);
    previewEngine.meshComponentMode = meshComponentMode;
    previewEngine.api.commands.meshEditing.configureSoftSelection({
      enabled: softSelectionEnabled,
      radius: softSelectionRadius,
      mode: softSelectionMode,
      falloff: softSelectionFalloff,
      surfaceBlend: softSelectionSurfaceBlend,
      connectivity: softSelectionConnectivity,
      heatmapVisible: softSelectionHeatmapVisible,
    });

    previewEngineRef.current = previewEngine;
    const gs = new GizmoSystem(previewEngine);
    // Select is selection-only in the Static Mesh editor. The transform gizmo
    // becomes visible/interactable only after the user explicitly activates
    // Move/Rotate/Scale; changing component mode or selection never opts in.
    gs.renderInSelectTool = false;
    gs.setTool(tool);
    gizmoSystemRef.current = gs;

    setPreviewEngine(previewEngine);
    setGizmoSystem(gs);

    return () => {
      previewEngineRef.current = null;
      gizmoSystemRef.current = null;
      setPreviewEngine(null);
      setGizmoSystem(null);
    };
  }, [assetId]);

  const handleInitGl = (gl: WebGL2RenderingContext) => {
    const asset = assetManager.getAsset(assetId) as StaticMeshAsset | SkeletalMeshAsset | undefined;
    if (!asset || (asset.type !== 'MESH' && asset.type !== 'SKELETAL_MESH')) return;

    const meshVao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const nbo = gl.createBuffer();
    const uvbo = gl.createBuffer();
    const colorbo = gl.createBuffer();
    const softWeightBo = gl.createBuffer();
    const ibo = gl.createBuffer();
    const constructionPointVbo = gl.createBuffer();
    if (!meshVao || !vbo || !nbo || !uvbo || !colorbo || !softWeightBo || !ibo || !constructionPointVbo) return;

    gl.bindVertexArray(meshVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, asset.geometry.vertices, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
    gl.bufferData(gl.ARRAY_BUFFER, asset.geometry.normals, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    const vertexCount = asset.geometry.vertices.length / 3;
    const sourceUvs = asset.geometry.uvs;
    const uvs = sourceUvs && sourceUvs.length >= vertexCount * 2
      ? sourceUvs
      : new Float32Array(vertexCount * 2);
    gl.bindBuffer(gl.ARRAY_BUFFER, uvbo);
    gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(8);
    gl.vertexAttribPointer(8, 2, gl.FLOAT, false, 0, 0);

    const sourceColors = asset.geometry.colors;
    const colors = sourceColors && sourceColors.length >= vertexCount * 3
      ? sourceColors
      : new Float32Array(vertexCount * 3).fill(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, colorbo);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(13);
    gl.vertexAttribPointer(13, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, softWeightBo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexCount), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(14);
    gl.vertexAttribPointer(14, 1, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, asset.geometry.indices, gl.DYNAMIC_DRAW);

    const edgeOverlay = new MeshEdgeOverlay();
    edgeOverlay.init(
      gl,
      vbo,
      buildMeshEdgeIndices(asset.geometry.indices, asset.topology?.faces),
      gl.DYNAMIC_DRAW,
    );
    const selectedEdgeOverlay = new MeshEdgeOverlay();
    selectedEdgeOverlay.init(
      gl,
      vbo,
      buildMeshEdgeIndicesFromKeys([], asset.geometry.indices instanceof Uint32Array),
      gl.DYNAMIC_DRAW,
    );
    const hoveredEdgeOverlay = new MeshEdgeOverlay();
    hoveredEdgeOverlay.init(
      gl,
      vbo,
      buildMeshEdgeIndicesFromKeys([], asset.geometry.indices instanceof Uint32Array),
      gl.DYNAMIC_DRAW,
    );
    const selectedFaceOverlay = new MeshFaceOverlay();
    selectedFaceOverlay.init(
      gl,
      vbo,
      buildMeshFaceTriangleIndices(asset.geometry.indices, asset.topology?.triangleToFaceIndex, []),
      gl.DYNAMIC_DRAW,
    );
    const hoveredFaceOverlay = new MeshFaceOverlay();
    hoveredFaceOverlay.init(
      gl,
      vbo,
      buildMeshFaceTriangleIndices(asset.geometry.indices, asset.topology?.triangleToFaceIndex, []),
      gl.DYNAMIC_DRAW,
    );
    const vertexOverlay = new MeshVertexOverlay();
    vertexOverlay.init(gl, vbo);
    gl.bindBuffer(gl.ARRAY_BUFFER, constructionPointVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(0), gl.DYNAMIC_DRAW);
    const constructionPointOverlay = new MeshVertexOverlay();
    constructionPointOverlay.init(gl, constructionPointVbo);
    const materialPreview = new MaterialPreviewRenderer();
    materialPreview.init(gl);
    gl.bindVertexArray(null);

    glResourcesRef.current = {
      meshVao,
      vbo,
      nbo,
      uvbo,
      colorbo,
      softWeightBo,
      ibo,
      edgeOverlay,
      selectedEdgeOverlay,
      hoveredEdgeOverlay,
      selectedFaceOverlay,
      hoveredFaceOverlay,
      vertexOverlay,
      constructionPointVbo,
      constructionPointOverlay,
      constructionPointRevision: -1,
      constructionPointSelectionSignature: '',
      materialPreview,
      selectionEdgeRevision: -1,
      selectionEdgeMode: null,
      hoveredEdgeSignature: '',
      selectedFaceRevision: -1,
      hoveredFaceSignature: '',
      selectionVertexRevision: -1,
      softWeightRevision: -1,
      referenceMeshes: new Map(),
      referenceRevision: -1,
    };
  };

  const handleCleanupGl = (gl: WebGL2RenderingContext) => {
    const res = glResourcesRef.current;
    if (res.meshVao) gl.deleteVertexArray(res.meshVao);
    if (res.vbo) gl.deleteBuffer(res.vbo);
    if (res.nbo) gl.deleteBuffer(res.nbo);
    if (res.uvbo) gl.deleteBuffer(res.uvbo);
    if (res.colorbo) gl.deleteBuffer(res.colorbo);
    if (res.softWeightBo) gl.deleteBuffer(res.softWeightBo);
    if (res.ibo) gl.deleteBuffer(res.ibo);
    res.edgeOverlay.dispose(gl);
    res.selectedEdgeOverlay.dispose(gl);
    res.hoveredEdgeOverlay.dispose(gl);
    res.selectedFaceOverlay.dispose(gl);
    res.hoveredFaceOverlay.dispose(gl);
    res.vertexOverlay.dispose(gl);
    res.constructionPointOverlay.dispose(gl);
    if (res.constructionPointVbo) gl.deleteBuffer(res.constructionPointVbo);
    res.referenceMeshes.forEach(reference => {
      gl.deleteVertexArray(reference.vao);
      gl.deleteBuffer(reference.vbo);
      gl.deleteBuffer(reference.nbo);
      gl.deleteBuffer(reference.softWeightBo);
      gl.deleteBuffer(reference.ibo);
    });
    res.referenceMeshes.clear();
    res.materialPreview.dispose(gl);
  };

  const handleRender = (args: AssetViewportRenderArgs) => {
    const { gl, vp, meshProgram, lineProgram, viewportSize, eye, project } = args;
    const asset = assetManager.getAsset(assetId) as StaticMeshAsset | SkeletalMeshAsset | undefined;
    if (!asset || (asset.type !== 'MESH' && asset.type !== 'SKELETAL_MESH')) return;

    const res = glResourcesRef.current;
    if (!res.meshVao || !res.vbo || !res.nbo || !res.uvbo || !res.colorbo || !res.softWeightBo || !res.ibo) return;

    // Apply geometry updates from modeling/vertex edits
    const dirty = dirtyRef.current;
    if (dirty !== 'NONE') {
      gl.bindBuffer(gl.ARRAY_BUFFER, res.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, asset.geometry.vertices, gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.nbo);
      gl.bufferData(gl.ARRAY_BUFFER, asset.geometry.normals, gl.DYNAMIC_DRAW);

      if (dirty === 'FULL') {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, asset.geometry.indices, gl.DYNAMIC_DRAW);

        const vertexCount = asset.geometry.vertices.length / 3;
        const uvs = asset.geometry.uvs?.length >= vertexCount * 2
          ? asset.geometry.uvs
          : new Float32Array(vertexCount * 2);
        gl.bindBuffer(gl.ARRAY_BUFFER, res.uvbo);
        gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.DYNAMIC_DRAW);

        const colors = asset.geometry.colors && asset.geometry.colors.length >= vertexCount * 3
          ? asset.geometry.colors
          : new Float32Array(vertexCount * 3).fill(1);
        gl.bindBuffer(gl.ARRAY_BUFFER, res.colorbo);
        gl.bufferData(gl.ARRAY_BUFFER, colors, gl.DYNAMIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, res.softWeightBo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexCount), gl.DYNAMIC_DRAW);

        res.edgeOverlay.update(
          gl,
          buildMeshEdgeIndices(asset.geometry.indices, asset.topology?.faces),
          gl.DYNAMIC_DRAW,
        );
        res.selectedFaceRevision = -1;
        res.hoveredFaceSignature = '';
        res.selectionEdgeRevision = -1;
        res.hoveredEdgeSignature = '__geometry_changed__';
        res.selectionVertexRevision = -1;
        res.softWeightRevision = -1;
      }
      dirtyRef.current = 'NONE';
    }

    if (res.referenceRevision !== referenceRevisionRef.current) {
      res.referenceMeshes.forEach(reference => {
        gl.deleteVertexArray(reference.vao);
        gl.deleteBuffer(reference.vbo);
        gl.deleteBuffer(reference.nbo);
        gl.deleteBuffer(reference.softWeightBo);
        gl.deleteBuffer(reference.ibo);
      });
      res.referenceMeshes.clear();

      if (asset.type === 'MESH') {
        for (const referenceId of staticMeshAssetAPI.getReferenceMeshIds(asset.id)) {
          const referenceAsset = assetManager.getAsset(referenceId);
          if (!referenceAsset || referenceAsset.type !== 'MESH') continue;
          const vertexCount = Math.floor(referenceAsset.geometry.vertices.length / 3);
          if (vertexCount === 0 || referenceAsset.geometry.indices.length === 0) continue;

          const vao = gl.createVertexArray();
          const vbo = gl.createBuffer();
          const nbo = gl.createBuffer();
          const softWeightBo = gl.createBuffer();
          const ibo = gl.createBuffer();
          if (!vao || !vbo || !nbo || !softWeightBo || !ibo) {
            if (vao) gl.deleteVertexArray(vao);
            if (vbo) gl.deleteBuffer(vbo);
            if (nbo) gl.deleteBuffer(nbo);
            if (softWeightBo) gl.deleteBuffer(softWeightBo);
            if (ibo) gl.deleteBuffer(ibo);
            continue;
          }

          gl.bindVertexArray(vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
          gl.bufferData(gl.ARRAY_BUFFER, referenceAsset.geometry.vertices, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(0);
          gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

          let referenceNormals = referenceAsset.geometry.normals;
          if (referenceNormals.length < vertexCount * 3) {
            referenceNormals = new Float32Array(vertexCount * 3);
            for (let vertexId = 0; vertexId < vertexCount; vertexId++) {
              referenceNormals[vertexId * 3 + 1] = 1;
            }
          }
          gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
          gl.bufferData(gl.ARRAY_BUFFER, referenceNormals, gl.STATIC_DRAW);
          gl.enableVertexAttribArray(1);
          gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

          gl.bindBuffer(gl.ARRAY_BUFFER, softWeightBo);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexCount), gl.STATIC_DRAW);
          gl.enableVertexAttribArray(14);
          gl.vertexAttribPointer(14, 1, gl.FLOAT, false, 0, 0);

          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, referenceAsset.geometry.indices, gl.STATIC_DRAW);
          gl.bindVertexArray(null);

          res.referenceMeshes.set(referenceId, {
            vao,
            vbo,
            nbo,
            softWeightBo,
            ibo,
            indexCount: referenceAsset.geometry.indices.length,
            indexType: referenceAsset.geometry.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
          });
        }
      }
      res.referenceRevision = referenceRevisionRef.current;
    }

    const engine = previewEngineRef.current;
    if (engine && res.softWeightRevision !== engine.softSelectionRevision) {
      const vertexCount = asset.geometry.vertices.length / 3;
      const weights = engine.softSelectionWeights && engine.softSelectionWeights.length === vertexCount
        ? engine.softSelectionWeights
        : new Float32Array(vertexCount);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.softWeightBo);
      gl.bufferData(gl.ARRAY_BUFFER, weights, gl.DYNAMIC_DRAW);
      res.softWeightRevision = engine.softSelectionRevision;
    }

    const previewEntityId = engine?.entityId;
    const model = previewEntityId
      ? engine.sceneGraph.getWorldMatrix(previewEntityId) ?? Mat4Utils.create()
      : Mat4Utils.create();
    const mvp = Mat4Utils.create();
    Mat4Utils.multiply(vp, model, mvp);

    // Draw mesh. Empty material slot intentionally uses the built-in Standard
    // Lambert fallback; assigning a project Material compiles that exact graph
    // in this viewport's WebGL context.
    const assignedMaterialProgram = res.materialPreview.setMaterial(
      gl,
      materialIdRef.current,
      materialRevisionRef.current,
    );
    const activeMeshProgram = assignedMaterialProgram ?? meshProgram;
    gl.useProgram(activeMeshProgram);
    if (assignedMaterialProgram) {
      res.materialPreview.bindCommonUniforms(gl, activeMeshProgram, {
        mvp,
        model,
        cameraPosition: eye,
        renderMode: renderModeRef.current,
        timeSeconds: performance.now() / 1000,
        lightDirection: DEFAULT_MESH_PREVIEW_LIGHT.direction,
        lightColor: DEFAULT_MESH_PREVIEW_LIGHT.color,
        lightIntensity: DEFAULT_MESH_PREVIEW_LIGHT.intensity,
        softSelectionHeatmapVisible:
          !!engine?.softSelectionEnabled &&
          engine.meshComponentMode !== 'OBJECT' &&
          engine.softSelectionHeatmapVisible,
      });
    } else {
      gl.uniformMatrix4fv(gl.getUniformLocation(activeMeshProgram, 'u_mvp'), false, mvp);
      gl.uniformMatrix4fv(gl.getUniformLocation(activeMeshProgram, 'u_model'), false, model);
      applyMeshSurfaceUniforms(gl, activeMeshProgram, {
        cameraPosition: eye,
        renderMode: renderModeRef.current,
        light: DEFAULT_MESH_PREVIEW_LIGHT,
        material: DEFAULT_MESH_SURFACE_MATERIAL,
      });
      gl.uniform1f(gl.getUniformLocation(activeMeshProgram, 'u_time'), performance.now() / 1000);
      gl.uniform1f(
        gl.getUniformLocation(activeMeshProgram, 'u_showHeatmap'),
        engine?.softSelectionEnabled &&
        engine.meshComponentMode !== 'OBJECT' &&
        engine.softSelectionHeatmapVisible
          ? 1.0
          : 0.0,
      );
    }
    gl.bindVertexArray(res.meshVao);
    if (assignedMaterialProgram) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    const idxType =
      asset.geometry.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    gl.drawElements(gl.TRIANGLES, asset.geometry.indices.length, idxType, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    if (assignedMaterialProgram) gl.disable(gl.BLEND);

    // Reference meshes are editor-only and non-selectable, but they use the
    // normal shaded surface path rather than a topology cage. A cool neutral
    // material distinguishes them from the editable target without changing
    // their geometry or participating in component picking.
    if (res.referenceMeshes.size > 0) {
      const referenceModel = Mat4Utils.create();
      const referenceMvp = Mat4Utils.create();
      Mat4Utils.multiply(vp, referenceModel, referenceMvp);
      gl.useProgram(meshProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, 'u_mvp'), false, referenceMvp);
      gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, 'u_model'), false, referenceModel);
      applyMeshSurfaceUniforms(gl, meshProgram, {
        cameraPosition: eye,
        renderMode: renderModeRef.current,
        light: DEFAULT_MESH_PREVIEW_LIGHT,
        material: REFERENCE_MESH_SURFACE_MATERIAL,
      });
      gl.uniform1f(gl.getUniformLocation(meshProgram, 'u_time'), performance.now() / 1000);
      gl.uniform1f(gl.getUniformLocation(meshProgram, 'u_showHeatmap'), 0.0);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(2, 2);
      res.referenceMeshes.forEach(reference => {
        gl.bindVertexArray(reference.vao);
        gl.drawElements(gl.TRIANGLES, reference.indexCount, reference.indexType, 0);
      });
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindVertexArray(null);
    }

    // Authored polygon-edge overlay. Component edit modes always show a dim
    // topology cage; Object mode only shows it when Wireframe is enabled.
    const componentMode = meshComponentModeRef.current;
    const showTopologyCage = showWireframeRef.current || componentMode !== 'OBJECT';
    if (showTopologyCage) {
      const baseColor = componentMode === 'OBJECT'
        ? MESH_EDGE_COLORS.wireframe
        : { ...MESH_EDGE_COLORS.dim, a: 0.9 };
      res.edgeOverlay.draw(gl, lineProgram, mvp, baseColor);
    }

    // Face mode adds a soft translucent surface cue. The logical face-to-
    // triangle mapping determines the fill, while the existing edge overlay
    // remains the stronger boundary cue. Picking and topology stay unchanged.
    if (componentMode === 'FACE') {
      const selection = engine?.selectionSystem.subSelection;
      if (selection && res.selectedFaceRevision !== selectionTickRef.current) {
        res.selectedFaceOverlay.update(
          gl,
          buildMeshFaceTriangleIndices(
            asset.geometry.indices,
            asset.topology?.triangleToFaceIndex,
            selection.faceIds,
            asset.geometry.indices instanceof Uint32Array,
          ),
          gl.DYNAMIC_DRAW,
        );
        res.selectedFaceRevision = selectionTickRef.current;
      }
      res.selectedFaceOverlay.draw(gl, lineProgram, mvp, MESH_FACE_COLORS.selected);

      const hovered = engine?.selectionSystem.hoveredMeshComponent;
      let hoveredFaceId: number | null = null;
      if (hovered && hovered.entityId === previewEntityId && hovered.mode === 'FACE') {
        hoveredFaceId = hovered.faceId;
      }
      const hoverSignature = hoveredFaceId !== null && !selection?.faceIds.has(hoveredFaceId)
        ? `FACE:${hoveredFaceId}`
        : '';
      if (res.hoveredFaceSignature !== hoverSignature) {
        res.hoveredFaceOverlay.update(
          gl,
          buildMeshFaceTriangleIndices(
            asset.geometry.indices,
            asset.topology?.triangleToFaceIndex,
            hoverSignature ? [hoveredFaceId!] : [],
            asset.geometry.indices instanceof Uint32Array,
          ),
          gl.DYNAMIC_DRAW,
        );
        res.hoveredFaceSignature = hoverSignature;
      }
      res.hoveredFaceOverlay.draw(gl, lineProgram, mvp, MESH_FACE_COLORS.hovered);
    }

    // Edge and face selections reuse the same edge-index contract for their
    // boundary cue. Rebuild only when selection/mode changes.
    if (componentMode === 'EDGE' || componentMode === 'FACE') {
      const selection = engine?.selectionSystem.subSelection;
      if (selection && (res.selectionEdgeRevision !== selectionTickRef.current || res.selectionEdgeMode !== componentMode)) {
        const selectedKeys = componentMode === 'EDGE'
          ? selection.edgeIds
          : collectFaceEdgeKeys(asset.topology?.faces, selection.faceIds);
        res.selectedEdgeOverlay.update(
          gl,
          buildMeshEdgeIndicesFromKeys(selectedKeys, asset.geometry.indices instanceof Uint32Array),
          gl.DYNAMIC_DRAW,
        );
        res.selectionEdgeRevision = selectionTickRef.current;
        res.selectionEdgeMode = componentMode;
      }
      res.selectedEdgeOverlay.draw(gl, lineProgram, mvp, { ...MESH_EDGE_COLORS.selected, a: 1.0 });

      const hovered = engine?.selectionSystem.hoveredMeshComponent;
      const hoveredKeys = new Set<string>();
      let hoverSignature = '';
      if (hovered && hovered.entityId === previewEntityId) {
        switch (hovered.mode) {
          case 'EDGE':
            if (componentMode === 'EDGE') {
              hoveredKeys.add(hovered.edgeKey);
              hoverSignature = `EDGE:${hovered.edgeKey}`;
            }
            break;
          case 'FACE':
            if (componentMode === 'FACE') {
              collectFaceEdgeKeys(asset.topology?.faces, [hovered.faceId]).forEach(key => hoveredKeys.add(key));
              hoverSignature = `FACE:${hovered.faceId}`;
            }
            break;
          case 'VERTEX':
            break;
        }
      }
      if (res.hoveredEdgeSignature !== hoverSignature) {
        res.hoveredEdgeOverlay.update(
          gl,
          buildMeshEdgeIndicesFromKeys(hoveredKeys, asset.geometry.indices instanceof Uint32Array),
          gl.DYNAMIC_DRAW,
        );
        res.hoveredEdgeSignature = hoverSignature;
      }
      res.hoveredEdgeOverlay.draw(gl, lineProgram, mvp, { ...MESH_EDGE_COLORS.hovered, a: 1.0 });
    }

    // Vertex mode uses the same position VBO through a reusable point overlay.
    // Draw base vertices first, then selected/hovered points at the same depth
    // with LEQUAL + depth writes disabled so the highlight cannot disappear
    // behind the base point pass.
    if (componentMode === 'VERTEX') {
      const selection = engine?.selectionSystem;
      const vertexCount = asset.geometry.vertices.length / 3;
      if (selection && res.selectionVertexRevision !== selectionTickRef.current) {
        res.vertexOverlay.updateSelected(gl, selection.subSelection.vertexIds, vertexCount);
        res.selectionVertexRevision = selectionTickRef.current;
      }

      const pointSizes = getMeshVertexPointSizes(
        vertexSize,
        getViewportPixelRatio(viewportSize.pixelWidth, viewportSize.cssWidth),
      );
      res.vertexOverlay.drawAll(gl, lineProgram, mvp, vertexCount, MESH_VERTEX_COLORS.base, pointSizes.base);
      res.vertexOverlay.drawSelected(gl, lineProgram, mvp, MESH_VERTEX_COLORS.selected, pointSizes.selected);

      const hovered = selection?.hoveredVertex;
      const hoveredIndex = hovered && hovered.entityId === previewEntityId ? hovered.index : null;
      res.vertexOverlay.drawHovered(
        gl,
        lineProgram,
        mvp,
        hoveredIndex,
        vertexCount,
        MESH_VERTEX_COLORS.hovered,
        pointSizes.hovered,
      );
    }

    // Construction Points are semantic planning handles and deliberately use a
    // separate VBO from mesh vertices. They remain visible in every mesh mode.
    if (asset.type === 'MESH' && res.constructionPointVbo) {
      const points = asset.construction?.points ?? [];
      if (res.constructionPointRevision !== assetRevision) {
        const positions = new Float32Array(points.length * 3);
        points.forEach((point, index) => {
          positions[index * 3] = point.position.x;
          positions[index * 3 + 1] = point.position.y;
          positions[index * 3 + 2] = point.position.z;
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, res.constructionPointVbo);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
        res.constructionPointRevision = assetRevision;
        res.constructionPointSelectionSignature = '';
      }

      const selectedSet = new Set(selectedConstructionPointIds);
      const selectedIndices = points
        .map((point, index) => selectedSet.has(point.id) ? index : -1)
        .filter(index => index >= 0);
      const selectionSignature = selectedConstructionPointIds.slice().sort().join('|');
      if (res.constructionPointSelectionSignature !== selectionSignature) {
        res.constructionPointOverlay.updateSelected(gl, selectedIndices, points.length);
        res.constructionPointSelectionSignature = selectionSignature;
      }

      const pointSizes = getMeshVertexPointSizes(
        Math.max(1.15, vertexSize * 1.25),
        getViewportPixelRatio(viewportSize.pixelWidth, viewportSize.cssWidth),
      );
      res.constructionPointOverlay.drawAll(
        gl,
        lineProgram,
        mvp,
        points.length,
        CONSTRUCTION_POINT_COLORS.base,
        pointSizes.base,
      );
      res.constructionPointOverlay.drawSelected(
        gl,
        lineProgram,
        mvp,
        CONSTRUCTION_POINT_COLORS.selected,
        pointSizes.selected,
      );

      const projected: Array<{ id: string; x: number; y: number }> = [];
      const worldPoint = { x: 0, y: 0, z: 0 };
      points.forEach(point => {
        Vec3Utils.transformMat4(point.position, model, worldPoint);
        const screen = project(worldPoint.x, worldPoint.y, worldPoint.z);
        if (screen) projected.push({ id: point.id, x: screen.x, y: screen.y });
      });
      constructionPointScreenRef.current = projected;
    } else {
      constructionPointScreenRef.current = [];
    }

    gl.bindVertexArray(null);
  };

  const handleConstructionPointSelect = useCallback((
    pointId: string | null,
    operation: 'REPLACE' | 'TOGGLE' = 'REPLACE',
  ) => {
    setSelectedShellIds([]);
    const engine = previewEngineRef.current;
    if (meshComponentModeRef.current !== 'OBJECT') changeMeshComponentMode('OBJECT');
    engine?.api.commands.selection.clear();

    setSelectedConstructionPointIds(current => {
      if (!pointId) return [];
      if (operation === 'TOGGLE') {
        return current.includes(pointId)
          ? current.filter(id => id !== pointId)
          : [...current, pointId];
      }
      return [pointId];
    });
  }, [changeMeshComponentMode]);

  const pickConstructionPoint = useCallback((x: number, y: number, threshold = 11): string | null => {
    let bestId: string | null = null;
    let bestDistanceSq = threshold * threshold;
    for (const point of constructionPointScreenRef.current) {
      const dx = point.x - x;
      const dy = point.y - y;
      const distanceSq = dx * dx + dy * dy;
      if (distanceSq <= bestDistanceSq) {
        bestDistanceSq = distanceSq;
        bestId = point.id;
      }
    }
    return bestId;
  }, []);

  const focusCamera = () => {
    if (fitCamera) setCamera(p => ({ ...p, radius: fitCamera.radius, target: { ...fitCamera.target } }));
    else setCamera(p => ({ ...p, radius: 3.0, target: { x: 0, y: 0, z: 0 } }));
  };

  const resetTransform = () => {
    previewEngineRef.current?.resetPreviewTransform();
    previewEngineRef.current?.syncTransforms(false);
  };

  const commitPendingComponentClick = useCallback((pending: PendingComponentPress) => {
    const engine = previewEngineRef.current;
    if (!engine || meshComponentModeRef.current !== pending.mode) return;

    // A plain LMB click owns the component selection result. If it hits empty
    // viewport space, REPLACE with an empty set so the gizmo/heatmap/hierarchy
    // all observe "nothing selected", matching empty marquee behavior. Shift+LMB
    // on empty space is a no-op so additive/toggle workflows preserve selection.
    if (!pending.picked) {
      if (!pending.shiftKey) {
        setSelectedShellIds([]);
        if (pending.mode === 'VERTEX') {
          engine.api.commands.selection.setMeshComponents({ mode: 'VERTEX', ids: [], operation: 'REPLACE' });
        } else if (pending.mode === 'EDGE') {
          engine.api.commands.selection.setMeshComponents({ mode: 'EDGE', ids: [], operation: 'REPLACE' });
        } else {
          engine.api.commands.selection.setMeshComponents({ mode: 'FACE', ids: [], operation: 'REPLACE' });
        }
      }
      return;
    }

    // Once viewport picking changes an explicit hierarchy scope, the hierarchy
    // stops presenting it as a full Mesh Shell/global selection. Route the click
    // through the same public operation-aware API used by hierarchy multi-select.
    setSelectedShellIds([]);
    const operation = pending.shiftKey ? 'TOGGLE' : 'REPLACE';

    if (pending.mode === 'VERTEX') {
      engine.api.commands.selection.setMeshComponents({
        mode: 'VERTEX',
        ids: [pending.picked.vertexId],
        operation,
      });
    } else if (pending.mode === 'EDGE') {
      engine.api.commands.selection.setMeshComponents({
        mode: 'EDGE',
        ids: [meshEdgeKey(pending.picked.edgeId[0], pending.picked.edgeId[1])],
        operation,
      });
    } else {
      engine.api.commands.selection.setMeshComponents({
        mode: 'FACE',
        ids: [pending.picked.faceId],
        operation,
      });
    }
  }, []);

  const handleMouseDown = (
    e: React.MouseEvent,
    coords: { x: number; y: number; width: number; height: number }
  ) => {
    if (pieMenu && e.button !== 2) setPieMenu(null);
    if (pieMenu) return;

    const engine = previewEngineRef.current;
    if (!engine) return;

    if (e.button === 0 && !e.altKey && hierarchySection === 'CONSTRUCTION_POINTS') {
      const pointId = pickConstructionPoint(coords.x, coords.y);
      if (pointId) handleConstructionPointSelect(pointId, e.shiftKey ? 'TOGGLE' : 'REPLACE');
      else if (!e.shiftKey) handleConstructionPointSelect(null);
      return;
    }

    // RMB opens Pie Menu (Alt+RMB reserved for zoom in AssetViewport3D).
    // In component mode the preview entity is already the edit target; object
    // picking here would call setSelected() and wipe vertex/edge/face selection,
    // which also removes the component gizmo and soft-selection heatmap.
    if (e.button === 2 && !e.altKey) {
      if (meshComponentMode === 'OBJECT') {
        const hitId = engine.selectionSystem.selectEntityAt(coords.x, coords.y, coords.width, coords.height);
        if (hitId) engine.selectionSystem.setSelected([hitId]);
      }
      setPieMenu({ x: e.clientX, y: e.clientY });
      return;
    }

    // Resolve selection ownership before doing any query. The gesture layer does
    // not decide whether this is object/component selection; the active editor +
    // component mode resolves a policy first, then click/marquee follows it.
    if (e.button === 0 && !e.altKey) {
      const policy = resolveStaticMeshEditorSelectionPolicy(meshComponentMode, engine.entityId);

      // Component-mode mouse-down stays pending until mouse-up. This lets the
      // gesture become either a true click or a marquee once it crosses the
      // drag threshold, even when the press started directly over mesh geometry.
      if (policy.domain !== 'OBJECT') {
        if (!policy.supportsMarquee || policy.target?.kind !== 'MESH_COMPONENTS') return;
        const previewEntityId = policy.target.entityId;
        const entityIndex = engine.ecs.idToIndex.get(previewEntityId);
        if (entityIndex !== undefined && !engine.selectionSystem.selectedIndices.has(entityIndex)) {
          engine.selectionSystem.setSelected([previewEntityId], false);
        }

        pendingComponentPressRef.current = {
          policy,
          entityId: previewEntityId,
          mode: policy.domain,
          startX: coords.x,
          startY: coords.y,
          shiftKey: e.shiftKey,
          picked: engine.selectionSystem.pickMeshComponent(
            previewEntityId,
            coords.x,
            coords.y,
            coords.width,
            coords.height,
          ),
        };
        commitSelectionBoxState(null);
        return;
      }

      // Object mode uses the same pending-press lifecycle as component mode so a
      // press can become either a true click or an object-domain marquee.
      if (policy.target?.kind !== 'OBJECTS') return;
      pendingObjectPressRef.current = {
        policy,
        startX: coords.x,
        startY: coords.y,
        shiftKey: e.shiftKey,
        hitId: engine.selectionSystem.selectEntityAt(coords.x, coords.y, coords.width, coords.height),
      };
      commitSelectionBoxState(null);
    }
  };

  const handleMouseMove = useCallback((
    _e: MouseEvent,
    coords: { x: number; y: number; width: number; height: number }
  ) => {
    const engine = previewEngineRef.current;
    if (!engine) return;

    const pendingComponent = pendingComponentPressRef.current;
    const pendingObject = pendingObjectPressRef.current;
    const pending = pendingComponent ?? pendingObject;
    const activeBox = selectionBoxRef.current;
    if (pending && !gizmoSystemRef.current?.activeAxis) {
      const currentPolicy = resolveStaticMeshEditorSelectionPolicy(meshComponentModeRef.current, engine.entityId);
      if (selectionPoliciesMatch(currentPolicy, pending.policy)) {
        const selectionX = Math.max(0, Math.min(coords.width, coords.x));
        const selectionY = Math.max(0, Math.min(coords.height, coords.y));

        if (activeBox?.isSelecting) {
          commitSelectionBoxState({
            ...activeBox,
            currentX: selectionX,
            currentY: selectionY,
          });
          return;
        }

        const dx = selectionX - pending.startX;
        const dy = selectionY - pending.startY;
        if ((dx * dx) + (dy * dy) >= MARQUEE_DRAG_THRESHOLD_PX * MARQUEE_DRAG_THRESHOLD_PX) {
          if (pendingComponent) engine.selectionSystem.clearMeshComponentHover();
          commitSelectionBoxState({
            startX: pending.startX,
            startY: pending.startY,
            currentX: selectionX,
            currentY: selectionY,
            isSelecting: true,
          });
          return;
        }
      }
    }

    // AssetViewport3D already advanced the GizmoSystem for this mouse move.
    // Do not double-drive the drag state; only update component hover when the
    // gizmo is not actively dragging and no marquee is active.
    if (!selectionBoxRef.current && !gizmoSystemRef.current?.activeAxis && meshComponentModeRef.current !== 'OBJECT') {
      engine.selectionSystem.hoverMeshComponentAt(coords.x, coords.y, coords.width, coords.height);
    }
  }, [commitSelectionBoxState]);

  const handleMouseUp = useCallback((
    e: MouseEvent,
    coords: { x: number; y: number; width: number; height: number }
  ) => {
    const pendingComponent = pendingComponentPressRef.current;
    const pendingObject = pendingObjectPressRef.current;
    const pending = pendingComponent ?? pendingObject;
    if (!pending) {
      commitSelectionBoxState(null);
      return;
    }

    const engine = previewEngineRef.current;
    const activeBox = selectionBoxRef.current;
    pendingComponentPressRef.current = null;
    pendingObjectPressRef.current = null;

    if (!engine) {
      commitSelectionBoxState(null);
      return;
    }

    const currentPolicy = resolveStaticMeshEditorSelectionPolicy(meshComponentModeRef.current, engine.entityId);
    if (!selectionPoliciesMatch(currentPolicy, pending.policy)) {
      commitSelectionBoxState(null);
      return;
    }

    const commitObjectClick = () => {
      if (!pendingObject || e.button !== 0) return;
      const currentIds = engine.api.getSelectedIds();
      if (pendingObject.hitId) {
        const next = pendingObject.shiftKey
          ? (currentIds.includes(pendingObject.hitId)
              ? currentIds.filter(id => id !== pendingObject.hitId)
              : [...currentIds, pendingObject.hitId])
          : [pendingObject.hitId];
        engine.api.commands.selection.setSelected(next);
      } else if (!pendingObject.shiftKey) {
        engine.api.commands.selection.clear();
      }
    };

    if (activeBox?.isSelecting) {
      const selectionX = Math.max(0, Math.min(coords.width, coords.x));
      const selectionY = Math.max(0, Math.min(coords.height, coords.y));
      const x = Math.min(activeBox.startX, selectionX);
      const y = Math.min(activeBox.startY, selectionY);
      const w = Math.abs(selectionX - activeBox.startX);
      const h = Math.abs(selectionY - activeBox.startY);

      if (w >= MARQUEE_DRAG_THRESHOLD_PX || h >= MARQUEE_DRAG_THRESHOLD_PX) {
        const result = executeMarqueeSelection(
          engine,
          pending.policy,
          {
            x,
            y,
            width: w,
            height: h,
            viewportWidth: coords.width,
            viewportHeight: coords.height,
          },
          resolveMarqueeOperation(pending),
          engine.api.getSelectedIds(),
        );
        if (result.kind === 'OBJECTS') {
          engine.api.commands.selection.setSelected(result.selectedIds);
        } else if (result.kind === 'MESH_COMPONENTS') {
          setSelectedShellIds([]);
        }
      } else if (pendingComponent && e.button === 0) {
        commitPendingComponentClick(pendingComponent);
      } else {
        commitObjectClick();
      }
    } else if (pendingComponent && e.button === 0) {
      commitPendingComponentClick(pendingComponent);
    } else {
      commitObjectClick();
    }

    commitSelectionBoxState(null);
  }, [commitPendingComponentClick, commitSelectionBoxState]);

  const handleContextMenu = (
    e: React.MouseEvent,
    coords: { x: number; y: number; clientX: number; clientY: number }
  ) => {
    e.preventDefault();
    if (e.altKey) return;
    const engine = previewEngineRef.current;
    if (engine && meshComponentModeRef.current === 'OBJECT') {
      const hitId = engine.selectionSystem.selectEntityAt(coords.x, coords.y, 1000, 1000);
      if (hitId) engine.selectionSystem.setSelected([hitId]);
    }
    setPieMenu({ x: coords.clientX, y: coords.clientY });
  };

  const renderModeItem = useMemo(
    () => RENDER_MODE_ITEMS.find(m => m.id === renderMode) ?? RENDER_MODE_ITEMS[0],
    [renderMode]
  );

  const assetHistoryState = useMemo(() => {
    const historyAsset = assetManager.getAsset(assetId);
    return historyAsset?.type === 'MESH'
      ? staticMeshAssetAPI.getHistoryState(assetId)
      : { canUndo: false, canRedo: false, undoLabel: undefined, redoLabel: undefined, inTransaction: false };
  }, [assetId, historyRevision]);

  const reconcileSelectionAfterAssetRestore = useCallback(() => {
    const restored = assetManager.getAsset(assetId);
    if (!restored || restored.type !== 'MESH') return;
    const restoredMesh = restored as StaticMeshAsset;

    const validShellIds = new Set(resolveStaticMeshShells(restoredMesh).map(shell => shell.id));
    setSelectedShellIds(current => current.filter(shellId => validShellIds.has(shellId)));

    const validPointIds = new Set((restoredMesh.construction?.points ?? []).map(point => point.id));
    setSelectedConstructionPointIds(current => current.filter(pointId => validPointIds.has(pointId)));

    const engine = previewEngineRef.current;
    engine?.refreshAfterAssetRestore();
    gizmoSystemRef.current?.resetInteraction();
  }, [assetId]);

  const cancelActiveMeshDrag = useCallback((): boolean => {
    const gizmo = gizmoSystemRef.current;
    if (gizmo?.isActiveDrag()) {
      const cancelled = gizmo.cancelActiveDrag();
      if (cancelled) reconcileSelectionAfterAssetRestore();
      return cancelled;
    }

    const engine = previewEngineRef.current;
    if (engine?.hasActiveVertexDrag()) {
      engine.cancelVertexDrag();
      reconcileSelectionAfterAssetRestore();
      return true;
    }
    return false;
  }, [reconcileSelectionAfterAssetRestore]);

  const undoAssetEdit = useCallback(() => {
    if (assetManager.getAsset(assetId)?.type !== 'MESH') return;
    // An unfinished gizmo gesture is not a history entry yet. First Ctrl/Cmd+Z
    // cancels it back to the drag-start snapshot; a subsequent Undo addresses
    // the previous committed asset edit.
    if (cancelActiveMeshDrag()) return;
    if (staticMeshAssetAPI.undo(assetId)) {
      reconcileSelectionAfterAssetRestore();
    }
  }, [assetId, cancelActiveMeshDrag, reconcileSelectionAfterAssetRestore]);

  const redoAssetEdit = useCallback(() => {
    if (assetManager.getAsset(assetId)?.type !== 'MESH') return;
    if (cancelActiveMeshDrag()) return;
    if (staticMeshAssetAPI.redo(assetId)) {
      reconcileSelectionAfterAssetRestore();
    }
  }, [assetId, cancelActiveMeshDrag, reconcileSelectionAfterAssetRestore]);

  const currentAsset = useMemo(() => {
    const asset = assetManager.getAsset(assetId);
    return asset && (asset.type === 'MESH' || asset.type === 'SKELETAL_MESH')
      ? (asset as StaticMeshAsset | SkeletalMeshAsset)
      : null;
  }, [assetId, selectionTick, stats, assetRevision]);

  const compositionSources = useMemo(() => {
    if (!currentAsset || currentAsset.type !== 'MESH') return [];
    return staticMeshAssetAPI.listCompositionSources(currentAsset.id);
  }, [currentAsset, assetRevision]);

  const referenceMeshes = useMemo(() => {
    if (!currentAsset || currentAsset.type !== 'MESH') return [];
    return staticMeshAssetAPI.getReferenceMeshIds(currentAsset.id)
      .map(id => assetManager.getAsset(id))
      .filter((asset): asset is StaticMeshAsset => Boolean(asset && asset.type === 'MESH'))
      .map(asset => ({ id: asset.id, name: asset.name }));
  }, [currentAsset, assetRevision]);

  const ensurePreviewSelectionTarget = useCallback((engine: AssetViewportEngine) => {
    const previewEntityId = engine.entityId;
    if (previewEntityId && !engine.selectionSystem.isSelected(previewEntityId)) {
      engine.api.commands.selection.setSelected([previewEntityId]);
    }
  }, []);

  const applyComponentSelection = useCallback((
    engine: AssetViewportEngine,
    mode: Exclude<MeshComponentMode, 'OBJECT'>,
    selection: { vertexIds: number[]; edgeIds: string[]; faceIds: number[] },
  ) => {
    engine.api.commands.mesh.setComponentMode(mode);
    if (mode === 'VERTEX') {
      engine.api.commands.selection.setMeshComponents({ mode, ids: selection.vertexIds });
    } else if (mode === 'EDGE') {
      engine.api.commands.selection.setMeshComponents({ mode, ids: selection.edgeIds });
    } else {
      engine.api.commands.selection.setMeshComponents({ mode, ids: selection.faceIds });
    }
  }, []);

  const applyShellSelection = useCallback((
    shellIds: readonly string[],
    mode: Exclude<MeshComponentMode, 'OBJECT'>,
  ) => {
    const asset = assetManager.getAsset(assetId);
    const engine = previewEngineRef.current;
    if (!asset || asset.type !== 'MESH' || !engine) return;

    ensurePreviewSelectionTarget(engine);
    const shellIdSet = new Set(shellIds);
    const shells = resolveStaticMeshShells(asset as StaticMeshAsset).filter(shell => shellIdSet.has(shell.id));
    const selection = getStaticMeshShellsComponentSelection(asset as StaticMeshAsset, shells);
    applyComponentSelection(engine, mode, selection);
    changeMeshComponentMode(mode);
    setSelectedShellIds(shells.map(shell => shell.id));
  }, [applyComponentSelection, assetId, changeMeshComponentMode, ensurePreviewSelectionTarget]);

  const nextShellSelection = useCallback((
    shellId: string,
    operation: 'REPLACE' | 'TOGGLE',
  ): string[] => {
    if (operation === 'REPLACE') return [shellId];
    return selectedShellIds.includes(shellId)
      ? selectedShellIds.filter(id => id !== shellId)
      : [...selectedShellIds, shellId];
  }, [selectedShellIds]);

  const handleShellSelect = useCallback((
    shellId: string,
    operation: 'REPLACE' | 'TOGGLE' = 'REPLACE',
  ) => {
    const next = nextShellSelection(shellId, operation);
    setSelectedConstructionPointIds([]);
    // A Mesh Shell transform is a vertex-domain transform. The hierarchy keeps
    // the user-facing scope as SHELL while the normal component/gizmo pipeline
    // receives exactly the vertices owned by the selected shell(s).
    applyShellSelection(next, 'VERTEX');
    setHierarchySection(next.length > 0 ? 'SHELL' : 'GEOMETRY');
  }, [applyShellSelection, nextShellSelection]);

  const handleShellComponentSelect = useCallback((
    shellId: string,
    mode: Exclude<MeshComponentMode, 'OBJECT'>,
    operation: 'REPLACE' | 'TOGGLE' = 'REPLACE',
  ) => {
    const next = nextShellSelection(shellId, operation);
    setSelectedConstructionPointIds([]);
    applyShellSelection(next, mode);
    setHierarchySection(
      next.length === 0
        ? 'GEOMETRY'
        : mode === 'VERTEX'
          ? 'VERTICES'
          : mode === 'EDGE'
            ? 'EDGES'
            : 'FACES',
    );
  }, [applyShellSelection, nextShellSelection]);

  const handleGlobalComponentSelect = useCallback((mode: Exclude<MeshComponentMode, 'OBJECT'>) => {
    const asset = assetManager.getAsset(assetId);
    const engine = previewEngineRef.current;
    if (!asset || asset.type !== 'MESH' || !engine) return;

    setSelectedConstructionPointIds([]);
    ensurePreviewSelectionTarget(engine);
    applyComponentSelection(engine, mode, getStaticMeshComponentSelection(asset as StaticMeshAsset));
    changeMeshComponentMode(mode);
    setSelectedShellIds([]);
  }, [applyComponentSelection, assetId, changeMeshComponentMode, ensurePreviewSelectionTarget]);

  const handleHierarchyObjectSelect = useCallback(() => {
    const engine = previewEngineRef.current;
    if (!engine) return;
    const previewEntityId = engine.entityId;
    engine.api.commands.mesh.setComponentMode('OBJECT');
    changeMeshComponentMode('OBJECT');
    setSelectedShellIds([]);
    setSelectedConstructionPointIds([]);
    if (previewEntityId) engine.api.commands.selection.setSelected([previewEntityId]);
    else engine.api.commands.selection.clear();
  }, [changeMeshComponentMode]);

  const handleAppendMesh = useCallback((sourceAssetId: string) => {
    const target = assetManager.getAsset(assetId);
    if (!target || target.type !== 'MESH') return;
    const previousShellIds = new Set(resolveStaticMeshShells(target as StaticMeshAsset).map(shell => shell.id));

    const result = staticMeshAssetAPI.appendMesh({
      targetAssetId: target.id,
      sourceAssetId,
    });
    if (result.verticesAdded <= 0) return;

    const updated = assetManager.getAsset(target.id) as StaticMeshAsset;
    const appendedShells = resolveStaticMeshShells(updated).filter(shell => !previousShellIds.has(shell.id));
    if (appendedShells.length > 0) {
      setSelectedConstructionPointIds([]);
      applyShellSelection(appendedShells.map(shell => shell.id), 'VERTEX');
      setHierarchySection('SHELL');
    }

    dirtyRef.current = 'FULL';
    previewEngineRef.current?.clearDeformation();
    setStats({
      verts: updated.geometry.vertices.length / 3,
      tris: updated.geometry.indices.length / 3,
    });
    const fit = computeFitCamera(updated);
    setFitCamera(fit);
    setAssetRevision(value => value + 1);
  }, [applyShellSelection, assetId]);

  const handleAddReferenceMesh = useCallback((sourceAssetId: string) => {
    const target = assetManager.getAsset(assetId);
    if (!target || target.type !== 'MESH') return;
    staticMeshAssetAPI.addReferenceMesh(target.id, sourceAssetId);
    referenceRevisionRef.current += 1;
    setAssetRevision(value => value + 1);
  }, [assetId]);

  const handleRemoveReferenceMesh = useCallback((referenceAssetId: string) => {
    const target = assetManager.getAsset(assetId);
    if (!target || target.type !== 'MESH') return;
    staticMeshAssetAPI.removeReferenceMesh(target.id, referenceAssetId);
    referenceRevisionRef.current += 1;
    setAssetRevision(value => value + 1);
  }, [assetId]);

  const selectionCounts = useMemo(() => {
    const selection = previewEngineRef.current?.selectionSystem;
    return {
      object: selection?.selectedIndices.size ?? 0,
      vertices: selection?.subSelection.vertexIds.size ?? 0,
      edges: selection?.subSelection.edgeIds.size ?? 0,
      faces: selection?.subSelection.faceIds.size ?? 0,
    };
  }, [selectionTick]);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _tick = selectionTick;
  const isSelected = useMemo(() => {
    const engine = previewEngineRef.current;
    if (!engine) return false;
    if (meshComponentMode === 'VERTEX') return engine.selectionSystem.subSelection.vertexIds.size > 0;
    if (meshComponentMode === 'EDGE') return engine.selectionSystem.subSelection.edgeIds.size > 0;
    if (meshComponentMode === 'FACE') return engine.selectionSystem.subSelection.faceIds.size > 0;
    return engine.selectionSystem.selectedIndices.size > 0;
  }, [meshComponentMode, selectionTick]);

  const selectedConstructionFace = useMemo(() => {
    if (!currentAsset || currentAsset.type !== 'MESH' || meshComponentMode !== 'FACE') return null;
    const meshAsset = currentAsset as StaticMeshAsset;
    const engine = previewEngineRef.current;
    if (!engine) return null;
    const selectedFaceIds = Array.from(engine.selectionSystem.subSelection.faceIds);
    if (selectedFaceIds.length !== 1) return null;
    return meshAsset.construction?.faces.find(face => face.faceId === selectedFaceIds[0]) ?? null;
  }, [currentAsset, meshComponentMode, selectionTick, assetRevision]);

  const selectedConstructionEdge = useMemo(() => {
    if (!currentAsset || currentAsset.type !== 'MESH' || meshComponentMode !== 'EDGE') return null;
    const engine = previewEngineRef.current;
    if (!engine) return null;
    const selectedEdgeIds = Array.from(engine.selectionSystem.subSelection.edgeIds);
    if (selectedEdgeIds.length !== 1) return null;
    const vertexIds = meshEdgePairFromKey(selectedEdgeIds[0]);
    if (!vertexIds) return null;
    const pointIds = staticMeshAssetAPI.getConstructionEdgePointIds(assetId, vertexIds[0], vertexIds[1]);
    if (!pointIds) return null;
    return { edgeId: selectedEdgeIds[0], vertexIds, pointIds };
  }, [assetId, currentAsset, meshComponentMode, selectionTick, assetRevision]);

  const selectedConstructionCut = useMemo(() => {
    if (!currentAsset || currentAsset.type !== 'MESH' || meshComponentMode !== 'VERTEX') return null;
    const meshAsset = currentAsset as StaticMeshAsset;
    const engine = previewEngineRef.current;
    if (!engine) return null;
    const vertexIds = Array.from(engine.selectionSystem.subSelection.vertexIds);
    if (vertexIds.length !== 2) return null;
    const pointIds = vertexIds.map(vertexId => staticMeshAssetAPI.getConstructionPointId(assetId, vertexId));
    if (!pointIds[0] || !pointIds[1] || pointIds[0] === pointIds[1]) return null;

    const candidateFaces = (meshAsset.construction?.faces ?? []).filter(face => {
      const pointAIndex = face.pointIds.indexOf(pointIds[0]!);
      const pointBIndex = face.pointIds.indexOf(pointIds[1]!);
      if (pointAIndex < 0 || pointBIndex < 0 || face.pointIds.length < 4) return false;
      const distance = Math.abs(pointAIndex - pointBIndex);
      return distance > 1 && distance < face.pointIds.length - 1;
    });
    if (candidateFaces.length !== 1) return null;
    return {
      vertexIds: [vertexIds[0], vertexIds[1]] as [number, number],
      pointIds: [pointIds[0], pointIds[1]] as [string, string],
      face: candidateFaces[0],
    };
  }, [assetId, currentAsset, meshComponentMode, selectionTick, assetRevision]);

  useEffect(() => {
    // Validation feedback belongs to the current authored face. Never carry an
    // old inset error onto a different selection or asset.
    setTopologyFeedback(null);
  }, [assetId, selectedConstructionFace?.id, selectedConstructionEdge?.edgeId, selectedConstructionCut?.face.id]);

  const selectLogicalFace = useCallback((logicalFaceId: number | null) => {
    const engine = previewEngineRef.current;
    if (!engine) return;
    ensurePreviewSelectionTarget(engine);
    engine.api.commands.mesh.setComponentMode('FACE');
    engine.api.commands.selection.setMeshComponents({
      mode: 'FACE',
      ids: logicalFaceId == null ? [] : [logicalFaceId],
      operation: 'REPLACE',
    });
    changeMeshComponentMode('FACE');
    setSelectedShellIds([]);
    setSelectedConstructionPointIds([]);
    setHierarchySection('FACES');
  }, [changeMeshComponentMode, ensurePreviewSelectionTarget]);

  const selectLogicalFaces = useCallback((logicalFaceIds: readonly number[]) => {
    const engine = previewEngineRef.current;
    if (!engine) return;
    ensurePreviewSelectionTarget(engine);
    engine.api.commands.mesh.setComponentMode('FACE');
    engine.api.commands.selection.setMeshComponents({
      mode: 'FACE',
      ids: [...logicalFaceIds],
      operation: 'REPLACE',
    });
    changeMeshComponentMode('FACE');
    setSelectedShellIds([]);
    setSelectedConstructionPointIds([]);
    setHierarchySection('FACES');
  }, [changeMeshComponentMode, ensurePreviewSelectionTarget]);

  const selectLogicalEdges = useCallback((edgeIds: readonly string[]) => {
    const engine = previewEngineRef.current;
    if (!engine) return;
    ensurePreviewSelectionTarget(engine);
    engine.api.commands.mesh.setComponentMode('EDGE');
    engine.api.commands.selection.setMeshComponents({
      mode: 'EDGE',
      ids: [...edgeIds],
      operation: 'REPLACE',
    });
    changeMeshComponentMode('EDGE');
    setSelectedShellIds([]);
    setSelectedConstructionPointIds([]);
    setHierarchySection('EDGES');
  }, [changeMeshComponentMode, ensurePreviewSelectionTarget]);

  const handleTopologyCommand = useCallback((command: TopologyCommand) => {
    const asset = assetManager.getAsset(assetId);
    const engine = previewEngineRef.current;
    if (!asset || asset.type !== 'MESH' || !engine) return;
    const meshAsset = asset as StaticMeshAsset;

    setTopologyFeedback(null);

    try {
      if (command === 'SPLIT_EDGE') {
        const selectedEdgeIds = Array.from(engine.selectionSystem.subSelection.edgeIds);
        if (selectedEdgeIds.length !== 1) return;
        const vertexPair = meshEdgePairFromKey(selectedEdgeIds[0]);
        if (!vertexPair) return;
        const pointIds = staticMeshAssetAPI.getConstructionEdgePointIds(assetId, vertexPair[0], vertexPair[1]);
        if (!pointIds) return;
        if (!Number.isFinite(topologySplitPosition) || topologySplitPosition <= 0 || topologySplitPosition >= 1) {
          setTopologyFeedback('Split position must be greater than 0 and less than 1.');
          return;
        }
        const result = staticMeshAssetAPI.splitEdge({
          assetId,
          pointAId: pointIds[0],
          pointBId: pointIds[1],
          t: topologySplitPosition,
        });
        selectLogicalEdges(result.edgeIds);
        return;
      }

      if (command === 'BEVEL') {
        if (!selectedConstructionEdge) return;
        if (!Number.isFinite(topologyBevelWidth) || topologyBevelWidth <= 0) {
          setTopologyFeedback('Bevel width must be greater than 0.');
          return;
        }
        const result = staticMeshAssetAPI.bevelEdge({
          assetId,
          pointAId: selectedConstructionEdge.pointIds[0],
          pointBId: selectedConstructionEdge.pointIds[1],
          width: topologyBevelWidth,
        });
        selectLogicalEdges(result.bevelEdgeIds);
        return;
      }

      if (command === 'CUT_FACE') {
        if (!selectedConstructionCut) return;
        const result = staticMeshAssetAPI.cutFace({
          assetId,
          faceId: selectedConstructionCut.face.id,
          pointAId: selectedConstructionCut.pointIds[0],
          pointBId: selectedConstructionCut.pointIds[1],
        });
        selectLogicalEdges([result.cutEdgeId]);
        return;
      }

      const selectedFaceIds = Array.from(engine.selectionSystem.subSelection.faceIds);
      if (selectedFaceIds.length !== 1) return;
      const constructionFace = meshAsset.construction?.faces.find(face => face.faceId === selectedFaceIds[0]);
      if (!constructionFace) return;

      if (command === 'INSET') {
        if (!Number.isFinite(topologyInsetAmount) || topologyInsetAmount <= 0) {
          setTopologyFeedback('Inset amount must be greater than 0.');
          return;
        }
        const result = staticMeshAssetAPI.insetFace({
          assetId,
          faceId: constructionFace.id,
          amount: topologyInsetAmount,
        });
        const updated = assetManager.getAsset(assetId);
        const updatedMesh = updated?.type === 'MESH' ? updated as StaticMeshAsset : null;
        const logicalFaceId = updatedMesh?.construction?.faces.find(face => face.id === result.innerFaceId)?.faceId;
        selectLogicalFace(logicalFaceId ?? null);
      } else if (command === 'EXTRUDE') {
        if (!Number.isFinite(topologyExtrudeDistance) || Math.abs(topologyExtrudeDistance) <= 1e-8) {
          setTopologyFeedback('Extrude distance must be a non-zero finite number.');
          return;
        }
        const result = staticMeshAssetAPI.extrudeFace({
          assetId,
          faceId: constructionFace.id,
          distance: topologyExtrudeDistance,
        });
        const updated = assetManager.getAsset(assetId);
        const updatedMesh = updated?.type === 'MESH' ? updated as StaticMeshAsset : null;
        const logicalFaceId = updatedMesh?.construction?.faces.find(face => face.id === result.topFaceId)?.faceId;
        selectLogicalFace(logicalFaceId ?? null);
        // UI-only modeller convenience: after Extrude, keep the new top face
        // selected and enter Move so the transform gizmo is immediately ready
        // for manual adjustment. The core API never activates editor tools, so
        // AI/script callers remain deterministic and UI-neutral.
        setTool('MOVE');
      } else if (command === 'DELETE_FACE') {
        staticMeshAssetAPI.deleteFace({ assetId, faceId: constructionFace.id });
        selectLogicalFace(null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : `${command} failed.`;
      setTopologyFeedback(
        command === 'INSET' && message === 'Inset amount is too large for this face.'
          ? `${message} Enter a smaller value.`
          : message,
      );

      // Expected modeling validation is normal user input, not an editor fault.
      // Keep unexpected failures visible to developers while avoiding a noisy
      // console stack for safe API rejections.
      const expectedModelingValidation = error instanceof Error && (
        (command === 'INSET' && (error.message.startsWith('Inset ') || error.message.startsWith('Inset currently')))
        || (command === 'SPLIT_EDGE' && (error.message.startsWith('Split ') || error.message.startsWith('The Construction Points')))
        || (command === 'BEVEL' && error.message.startsWith('Bevel '))
        || (command === 'CUT_FACE' && error.message.startsWith('Cut Face'))
      );
      if (!expectedModelingValidation) console.error(`[StaticMeshEditor] ${command} failed`, error);
    }
  }, [
    assetId,
    selectLogicalEdges,
    selectLogicalFace,
    selectedConstructionCut,
    setTool,
    topologyExtrudeDistance,
    topologyInsetAmount,
    topologySplitPosition,
    topologyBevelWidth,
    selectedConstructionEdge,
  ]);

  const handleSelectLoop = (mode: MeshComponentMode = meshComponentMode) => {
    if (mode === 'OBJECT') return;
    const engine = previewEngineRef.current;
    if (!engine) return;
    setSelectedShellIds([]);
    engine.meshComponentMode = mode;
    engine.selectionSystem.selectLoop(mode);
  };

  const handleSelectEdgeRing = useCallback((mode: MeshComponentMode = meshComponentMode) => {
    if (mode !== 'EDGE') return;
    const engine = previewEngineRef.current;
    const asset = assetManager.getAsset(assetId);
    if (!engine || !asset || asset.type !== 'MESH') return;
    const selectedEdges = Array.from(engine.selectionSystem.subSelection.edgeIds);
    const edgeId = selectedEdges[selectedEdges.length - 1];
    if (!edgeId) return;
    const edge = meshEdgePairFromKey(edgeId);
    if (!edge) return;
    const trace = staticMeshAssetAPI.traceEdgeRing({ assetId, vertexAId: edge[0], vertexBId: edge[1] });
    selectLogicalEdges(trace.edgeIds);
  }, [assetId, meshComponentMode, selectLogicalEdges]);

  const handleSelectQuadStrip = useCallback((mode: MeshComponentMode = meshComponentMode) => {
    if (mode !== 'EDGE') return;
    const engine = previewEngineRef.current;
    const asset = assetManager.getAsset(assetId);
    if (!engine || !asset || asset.type !== 'MESH') return;
    const selectedEdges = Array.from(engine.selectionSystem.subSelection.edgeIds);
    const edgeId = selectedEdges[selectedEdges.length - 1];
    if (!edgeId) return;
    const edge = meshEdgePairFromKey(edgeId);
    if (!edge) return;
    const trace = staticMeshAssetAPI.traceFaceStrip({ assetId, vertexAId: edge[0], vertexBId: edge[1] });
    if (trace.faceIds.length > 0) selectLogicalFaces(trace.faceIds);
  }, [assetId, meshComponentMode, selectLogicalFaces]);

  const configureSoftSelection = useCallback((settings: SoftSelectionCommandSettings) => {
    // The local edit engine owns deformation weights and heatmap invalidation.
    // Apply the command synchronously, then mirror its settings into React UI state.
    previewEngineRef.current?.api.commands.meshEditing.configureSoftSelection(settings);

    if (settings.enabled !== undefined) setSoftSelectionEnabled(settings.enabled);
    if (settings.radius !== undefined) setSoftSelectionRadius(settings.radius);
    if (settings.mode !== undefined) setSoftSelectionMode(settings.mode);
    const distanceMetric = settings.distanceMetric ?? settings.falloff;
    if (distanceMetric !== undefined) setSoftSelectionFalloff(distanceMetric);
    if (settings.surfaceBlend !== undefined) setSoftSelectionSurfaceBlend(settings.surfaceBlend);
    if (settings.connectivity !== undefined) setSoftSelectionConnectivity(settings.connectivity);
    if (settings.heatmapVisible !== undefined) setSoftSelectionHeatmapVisible(settings.heatmapVisible);
  }, []);

  const commandContext = useMemo<EditorCommandContext>(() => {
    const staticMeshTarget = currentAsset && currentAsset.type === 'MESH'
      ? resolveAssetStaticMeshEditTarget(currentAsset as StaticMeshAsset)
      : null;
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

    return {
      capabilities,
      meshComponentMode,
      selectionCounts,
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
        setComponentMode: changeMeshComponentMode,
        focus: () => viewportRef.current?.focus(),
        resetCamera: focusCamera,
        toggleGrid: () => setShowGrid(value => !value),
        toggleWireframe: () => setShowWireframe(value => !value),
        duplicateSelection: resetTransform,
        deleteSelection: () => {
          resetTransform();
          focusCamera();
        },
        selectLoop: handleSelectLoop,
        expandSelection: mode => {
          const engine = previewEngineRef.current;
          if (!engine || mode === 'OBJECT') return;
          setSelectedShellIds([]);
          engine.meshComponentMode = mode;
          engine.selectionSystem.expandSelection(mode);
        },
        shrinkSelection: mode => {
          const engine = previewEngineRef.current;
          if (!engine || mode === 'OBJECT') return;
          setSelectedShellIds([]);
          engine.meshComponentMode = mode;
          engine.selectionSystem.shrinkSelection(mode);
        },
        selectRing: handleSelectEdgeRing,
        selectQuadStrip: handleSelectQuadStrip,
        topologyCommand: handleTopologyCommand,
        supportsTopologyCommand: command => (command === 'SPLIT_EDGE' || command === 'BEVEL')
          ? Boolean(selectedConstructionEdge)
          : command === 'CUT_FACE'
            ? Boolean(selectedConstructionCut)
            : Boolean(selectedConstructionFace)
              && (command === 'EXTRUDE' || command === 'INSET' || command === 'DELETE_FACE'),
        configureSoftSelection,
      },
    };
  }, [
    currentAsset,
    meshComponentMode,
    selectionCounts,
    softSelectionEnabled,
    softSelectionRadius,
    softSelectionMode,
    softSelectionFalloff,
    softSelectionSurfaceBlend,
    softSelectionConnectivity,
    softSelectionHeatmapVisible,
    setTool,
    changeMeshComponentMode,
    selectedConstructionFace,
    selectedConstructionEdge,
    selectedConstructionCut,
    handleTopologyCommand,
    handleSelectEdgeRing,
    handleSelectQuadStrip,
    configureSoftSelection,
  ]);

  const { isAdjustingBrush } = useBrushInteraction({
    viewportId: viewportInputId,
    available: currentAsset?.type === 'MESH' && meshComponentMode !== 'OBJECT',
    softSelectionEnabled,
    softSelectionRadius,
    configureSoftSelection,
    onBrushAdjustEnd: () => previewEngineRef.current?.endVertexDrag(),
  });

  const handlePieAction = (action: string) => {
    if (!currentAsset) return;
    if (action === 'tool_select' && assetViewportAllows(currentAsset.type, 'tool.select')) setTool('SELECT');
    if (action === 'tool_move' && assetViewportAllows(currentAsset.type, 'tool.move')) setTool('MOVE');
    if (action === 'tool_rotate' && assetViewportAllows(currentAsset.type, 'tool.rotate')) setTool('ROTATE');
    if (action === 'tool_scale' && assetViewportAllows(currentAsset.type, 'tool.scale')) setTool('SCALE');

    if (action === 'toggle_grid' && assetViewportAllows(currentAsset.type, 'view.grid')) setShowGrid(v => !v);
    if (action === 'toggle_wire' && assetViewportAllows(currentAsset.type, 'mesh.wireframe')) setShowWireframe(v => !v);
    if (action === 'focus' && assetViewportAllows(currentAsset.type, 'view.focus')) viewportRef.current?.focus();
    if (action === 'reset_cam' && assetViewportAllows(currentAsset.type, 'view.focus')) focusCamera();

    if (action === 'duplicate' && assetViewportAllows(currentAsset.type, 'mesh.object')) resetTransform();
    if (action === 'delete' && assetViewportAllows(currentAsset.type, 'mesh.object')) {
      resetTransform();
      focusCamera();
    }

    // Loop selection already lives in SelectionSystem; the asset editor must
    // route its local Pie Menu actions to the local preview engine rather than
    // the main Scene engine.
    if (action === 'loop_vert' && meshComponentMode === 'VERTEX') handleSelectLoop('VERTEX');
    if (action === 'loop_edge' && meshComponentMode === 'EDGE') handleSelectLoop('EDGE');
    if (action === 'loop_face' && meshComponentMode === 'FACE') handleSelectLoop('FACE');

    setPieMenu(null);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && cancelActiveMeshDrag()) {
      e.preventDefault();
      return;
    }
    const historyModifier = e.ctrlKey || e.metaKey;
    if (historyModifier && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redoAssetEdit();
      else undoAssetEdit();
      return;
    }
    if (historyModifier && (e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      redoAssetEdit();
      return;
    }
    if ((e.key === 'z' || e.key === 'Z') && currentAsset && assetViewportAllows(currentAsset.type, 'mesh.wireframe')) {
      setShowWireframe(v => !v);
    }
  };

  const meshToolbarActions: AssetViewportToolbarAction[] = currentAsset
    ? [
        ...(['OBJECT', 'VERTEX', 'EDGE', 'FACE'] as MeshComponentMode[]).map(mode => ({
          id: meshModeActionId(mode),
          group: 'component-mode',
          label: `${mode.charAt(0) + mode.slice(1).toLowerCase()} Mode`,
          icon: mode === 'OBJECT' ? 'Box' : mode === 'VERTEX' ? 'CircleDot' : mode === 'EDGE' ? 'Spline' : 'Square',
          active: meshComponentMode === mode,
          onTrigger: () => {
            setSelectedShellIds([]);
            setSelectedConstructionPointIds([]);
            changeMeshComponentMode(mode);
            setHierarchySection(
              mode === 'VERTEX' ? 'VERTICES' : mode === 'EDGE' ? 'EDGES' : mode === 'FACE' ? 'FACES' : 'GEOMETRY',
            );
          },
        })),
        {
          id: 'history.undo',
          group: 'history',
          label: assetHistoryState.undoLabel ? `Undo ${assetHistoryState.undoLabel} (Ctrl+Z)` : 'Undo (Ctrl+Z)',
          icon: 'Undo2',
          disabled: !assetHistoryState.canUndo,
          className: !assetHistoryState.canUndo ? 'opacity-40 cursor-not-allowed' : undefined,
          onTrigger: undoAssetEdit,
        },
        {
          id: 'history.redo',
          group: 'history',
          label: assetHistoryState.redoLabel ? `Redo ${assetHistoryState.redoLabel} (Ctrl+Shift+Z)` : 'Redo (Ctrl+Shift+Z)',
          icon: 'Redo2',
          disabled: !assetHistoryState.canRedo,
          className: !assetHistoryState.canRedo ? 'opacity-40 cursor-not-allowed' : undefined,
          onTrigger: redoAssetEdit,
        },
        {
          id: 'mesh.shading',
          group: 'display',
          label: `Shading: ${renderModeItem.label}`,
          icon: renderModeItem.icon,
          onTrigger: () => setRenderMode(p => (p + 1) % RENDER_MODE_ITEMS.length),
        },
        {
          id: 'mesh.wireframe',
          group: 'display',
          label: 'Toggle Wireframe (Z)',
          icon: 'Codepen',
          active: showWireframe,
          onTrigger: () => setShowWireframe(v => !v),
        },
      ]
    : [];

  if (!currentAsset) {
    return (
      <div className="h-full flex items-center justify-center bg-[#151515] text-text-secondary text-xs">
        Mesh asset could not be loaded.
      </div>
    );
  }

  return (
    <AssetEditorTemplate
      assetType={currentAsset.type}
      assetName={currentAsset.name}
      headerExtra={editorHeaderExtra}
      hierarchyWidth={leftDockCollapsed && currentAsset.type === 'MESH' ? 36 : 252}
      hierarchy={
        currentAsset.type === 'MESH' ? (
          <StaticMeshToolDock
            asset={currentAsset}
            collapsed={leftDockCollapsed}
            onCollapsedChange={setLeftDockCollapsed}
            activeSection={hierarchySection}
            meshComponentMode={meshComponentMode}
            onSectionChange={setHierarchySection}
            onMeshComponentModeChange={changeMeshComponentMode}
            selectedShellIds={selectedShellIds}
            selectedConstructionPointIds={selectedConstructionPointIds}
            onConstructionPointSelect={(pointId, operation) => {
              if (pointId) setHierarchySection('CONSTRUCTION_POINTS');
              handleConstructionPointSelect(pointId, operation);
            }}
            onShellSelect={(shellId, operation) => {
              if (shellId) handleShellSelect(shellId, operation ?? 'REPLACE');
              else setSelectedShellIds([]);
            }}
            onShellComponentSelect={handleShellComponentSelect}
            onGlobalComponentSelect={handleGlobalComponentSelect}
            onObjectSelect={handleHierarchyObjectSelect}
            assetRevision={assetRevision}
            selectionCounts={selectionCounts}
            softSelectionEnabled={softSelectionEnabled}
            softSelectionRadius={softSelectionRadius}
            softSelectionMode={softSelectionMode}
            softSelectionFalloff={softSelectionFalloff}
            softSelectionSurfaceBlend={softSelectionSurfaceBlend}
            softSelectionConnectivity={softSelectionConnectivity}
            softSelectionHeatmapVisible={softSelectionHeatmapVisible}
            onSoftSelectionRadiusChange={radius => configureSoftSelection({ radius })}
            onSoftSelectionFalloffChange={falloff => configureSoftSelection({ falloff })}
            onSoftSelectionSurfaceBlendChange={surfaceBlend => configureSoftSelection({ surfaceBlend })}
            onSoftSelectionConnectivityChange={connectivity => configureSoftSelection({ connectivity })}
            compositionSources={compositionSources}
            onAppendMesh={handleAppendMesh}
            topologyInsetAmount={topologyInsetAmount}
            topologyExtrudeDistance={topologyExtrudeDistance}
            topologySplitPosition={topologySplitPosition}
            topologyBevelWidth={topologyBevelWidth}
            topologySplitEndpointLabel={selectedConstructionEdge ? `${selectedConstructionEdge.pointIds[0]} → ${selectedConstructionEdge.pointIds[1]}` : null}
            topologyCutEndpointLabel={selectedConstructionCut ? `${selectedConstructionCut.pointIds[0]} ↔ ${selectedConstructionCut.pointIds[1]} on ${selectedConstructionCut.face.id}` : null}
            topologyFeedback={topologyFeedback}
            onTopologyInsetAmountChange={amount => {
              setTopologyInsetAmount(amount);
              setTopologyFeedback(null);
            }}
            onTopologyExtrudeDistanceChange={distance => {
              setTopologyExtrudeDistance(distance);
              setTopologyFeedback(null);
            }}
            onTopologySplitPositionChange={position => {
              setTopologySplitPosition(position);
              setTopologyFeedback(null);
            }}
            onTopologyBevelWidthChange={width => {
              setTopologyBevelWidth(width);
              setTopologyFeedback(null);
            }}
            commandContext={commandContext}
          />
        ) : (
          <MeshAssetHierarchy
            asset={currentAsset}
            activeSection={hierarchySection}
            meshComponentMode={meshComponentMode}
            onSectionChange={setHierarchySection}
            onMeshComponentModeChange={changeMeshComponentMode}
            assetRevision={assetRevision}
          />
        )
      }
      inspector={
        <MeshAssetInspector
          asset={currentAsset}
          section={hierarchySection}
          meshComponentMode={meshComponentMode}
          selectionCounts={selectionCounts}
          renderModeLabel={renderModeItem.label}
          wireframe={showWireframe}
          materialId={materialId}
          onMaterialChange={handleMaterialChange}
          availableMeshSources={compositionSources}
          referenceMeshes={referenceMeshes}
          onAddReferenceMesh={handleAddReferenceMesh}
          onRemoveReferenceMesh={handleRemoveReferenceMesh}
          selectedShellIds={selectedShellIds}
          assetRevision={assetRevision}
        />
      }
    >
      <AssetViewport3D
        ref={viewportRef}
        assetType={currentAsset.type}
        inputContextId={viewportInputId}
        tool={tool}
        setTool={setTool}
        camera={camera}
        onCameraChange={setCamera}
        fitCamera={fitCamera}
        focusProvider={focusProvider}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid(v => !v)}
        stats={[
          { label: 'Verts', value: stats.verts, color: 'text-accent' },
          { label: 'Tris', value: stats.tris, color: 'text-accent' },
          ...(currentAsset.type === 'MESH' ? [{ label: 'Points', value: currentAsset.construction?.points.length ?? 0, color: 'text-cyan-300' }] : []),
          { label: 'Mode', value: meshComponentMode, color: 'text-accent' },
        ]}
        selectionBadge={{
          text: isAdjustingBrush
            ? `Radius ${softSelectionRadius.toFixed(2)}`
            : selectedConstructionPointIds.length > 0
              ? `${selectedConstructionPointIds.length} Point${selectedConstructionPointIds.length === 1 ? '' : 's'}`
              : isSelected ? 'Selected' : 'No Sel',
          active: selectedConstructionPointIds.length > 0 || isSelected,
        }}
        engine={previewEngine}
        gizmoSystem={gizmoSystem}
        toolbarActions={meshToolbarActions}
        shortcutsLegend="Drag Box Select • Shift+Drag Toggle • Esc Cancel Drag • Ctrl+Z Undo • F Focus • B Radius • Alt+LMB Orbit • Alt+MMB Pan • Alt+RMB Zoom • RMB Pie"
        onInitGl={handleInitGl}
        onCleanupGl={handleCleanupGl}
        onRender={handleRender}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
        onResetView={() => {
          resetTransform();
          focusCamera();
        }}
        onKeyDown={handleKeyDown}
        overlayChildren={
          <>
            {selectionBox?.isSelecting && (
              <div
                className="absolute border border-blue-500 bg-blue-500/20 pointer-events-none z-30"
                style={{
                  left: Math.min(selectionBox.startX, selectionBox.currentX),
                  top: Math.min(selectionBox.startY, selectionBox.currentY),
                  width: Math.abs(selectionBox.currentX - selectionBox.startX),
                  height: Math.abs(selectionBox.currentY - selectionBox.startY),
                }}
              />
            )}
            {pieMenu &&
              createPortal(
                <PieMenu
                  x={pieMenu.x}
                  y={pieMenu.y}
                  currentMode={meshComponentMode}
                  onSelectMode={m => {
                    if (assetViewportAllows(currentAsset.type, meshModeActionId(m))) {
                      setSelectedShellIds([]);
                      changeMeshComponentMode(m);
                      setHierarchySection(
                        m === 'VERTEX' ? 'VERTICES' : m === 'EDGE' ? 'EDGES' : m === 'FACE' ? 'FACES' : 'GEOMETRY',
                      );
                    }
                    setPieMenu(null);
                  }}
                  onAction={handlePieAction}
                  commandContext={commandContext}
                  onClose={() => setPieMenu(null)}
                />,
                document.body
              )}
          </>
        }
      />
    </AssetEditorTemplate>
  );
};
