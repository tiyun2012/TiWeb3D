import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { EditorContext } from '@/editor/state/EditorContext';
import { AssetViewportEngine } from '@/editor/viewports/AssetViewportEngine';
import { assetManager } from '@/engine/AssetManager';
import { eventBus } from '@/engine/EventBus';
import { GizmoSystem } from '@/engine/GizmoSystem';
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
} from '@/engine/MeshEdgeGeometry';
import { MeshEdgeOverlay } from '@/editor/viewports/MeshEdgeOverlay';
import { MESH_VERTEX_COLORS, MeshVertexOverlay } from '@/editor/viewports/MeshVertexOverlay';
import { MeshComponentMode, StaticMeshAsset, SkeletalMeshAsset, ToolType } from '@/types';

import { Icon } from './Icon';
import { PieMenu } from './PieMenu';
import { AssetViewport3D, AssetViewportRenderArgs, CameraState } from './AssetViewport3D';
import { AssetEditorTemplate } from './asset-editor/AssetEditorTemplate';
import { MeshAssetHierarchy, MeshHierarchySection } from './asset-editor/MeshAssetHierarchy';
import { MeshAssetInspector } from './asset-editor/MeshAssetInspector';
import { AssetViewportToolbarAction, assetViewportAllows, meshModeActionId } from './asset-editor/assetViewportCapabilities';

// Keep the asset editor's shared surface modes numerically identical to Scene View.
const RENDER_MODE_ITEMS: Array<{ id: number; label: string; icon: string }> = VIEW_MODES
  .filter(mode => mode.id <= MESH_SURFACE_RENDER_MODE.UNLIT)
  .map(mode => ({ ...mode }));

type DirtyKind = 'NONE' | 'VERTS' | 'FULL';

function computeFitCamera(
  asset: StaticMeshAsset | SkeletalMeshAsset
): { radius: number; target: { x: number; y: number; z: number } } {
  const aabb = asset.geometry.aabb;
  if (!aabb) return { radius: 3.0, target: { x: 0, y: 0, z: 0 } };
  const size = Vec3Utils.subtract(aabb.max, aabb.min, { x: 0, y: 0, z: 0 });
  const maxDim = Math.max(size.x, Math.max(size.y, size.z));
  const center = Vec3Utils.scale(Vec3Utils.add(aabb.min, aabb.max, { x: 0, y: 0, z: 0 }), 0.5, {
    x: 0,
    y: 0,
    z: 0,
  });
  return { radius: Math.max(maxDim * 1.5, 0.25), target: center };
}

export interface StaticMeshEditorProps {
  assetId: string;
  editorHeaderExtra?: React.ReactNode;
}

export const StaticMeshEditor: React.FC<StaticMeshEditorProps> = ({ assetId, editorHeaderExtra }) => {
  // Context shared with Scene viewport (tool + component mode)
  const editorCtx = useContext(EditorContext);
  const tool: ToolType = editorCtx?.tool ?? 'SELECT';
  const setTool = editorCtx?.setTool ?? (() => {});
  const meshComponentMode: MeshComponentMode = editorCtx?.meshComponentMode ?? 'OBJECT';
  const vertexSize = editorCtx?.uiConfig.vertexSize ?? 1.0;
  const setMeshComponentMode = editorCtx?.setMeshComponentMode ?? (() => {});

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

  // Buffers
  const glResourcesRef = useRef<{
    meshVao: WebGLVertexArrayObject | null;
    vbo: WebGLBuffer | null;
    nbo: WebGLBuffer | null;
    uvbo: WebGLBuffer | null;
    colorbo: WebGLBuffer | null;
    ibo: WebGLBuffer | null;
    edgeOverlay: MeshEdgeOverlay;
    selectedEdgeOverlay: MeshEdgeOverlay;
    vertexOverlay: MeshVertexOverlay;
    materialPreview: MaterialPreviewRenderer;
    selectionEdgeRevision: number;
    selectionEdgeMode: MeshComponentMode | null;
    selectionVertexRevision: number;
  }>({
    meshVao: null,
    vbo: null,
    nbo: null,
    uvbo: null,
    colorbo: null,
    ibo: null,
    edgeOverlay: new MeshEdgeOverlay(),
    selectedEdgeOverlay: new MeshEdgeOverlay(),
    vertexOverlay: new MeshVertexOverlay(),
    materialPreview: new MaterialPreviewRenderer(),
    selectionEdgeRevision: -1,
    selectionEdgeMode: null,
    selectionVertexRevision: -1,
  });

  // Keep local engine in-sync with global tool + component mode
  useEffect(() => {
    if (previewEngineRef.current) previewEngineRef.current.meshComponentMode = meshComponentMode;
  }, [meshComponentMode]);

  useEffect(() => {
    gizmoSystemRef.current?.setTool(tool);
  }, [tool]);

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

    const onGeometryUpdated = () => {
      if (dirtyRef.current === 'NONE') dirtyRef.current = 'VERTS';
    };

    const onGeometryFinalized = () => {
      dirtyRef.current = 'FULL';
      setStats({
        verts: asset.geometry.vertices.length / 3,
        tris: asset.geometry.indices.length / 3,
      });
    };

    const previewEngine = new AssetViewportEngine(onNotifyUI, onGeometryUpdated, onGeometryFinalized);
    const entityId = previewEngine.setPreviewMesh(assetId);
    previewEngine.syncTransforms(false);
    if (entityId) {
      previewEngine.selectionSystem.setSelected([entityId]);
    }
    previewEngine.meshComponentMode = meshComponentMode;

    previewEngineRef.current = previewEngine;
    const gs = new GizmoSystem(previewEngine);
    gs.renderInSelectTool = true;
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
    const ibo = gl.createBuffer();
    if (!meshVao || !vbo || !nbo || !uvbo || !colorbo || !ibo) return;

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
    const vertexOverlay = new MeshVertexOverlay();
    vertexOverlay.init(gl, vbo);
    const materialPreview = new MaterialPreviewRenderer();
    materialPreview.init(gl);
    gl.bindVertexArray(null);

    glResourcesRef.current = {
      meshVao,
      vbo,
      nbo,
      uvbo,
      colorbo,
      ibo,
      edgeOverlay,
      selectedEdgeOverlay,
      vertexOverlay,
      materialPreview,
      selectionEdgeRevision: -1,
      selectionEdgeMode: null,
      selectionVertexRevision: -1,
    };
  };

  const handleCleanupGl = (gl: WebGL2RenderingContext) => {
    const res = glResourcesRef.current;
    if (res.meshVao) gl.deleteVertexArray(res.meshVao);
    if (res.vbo) gl.deleteBuffer(res.vbo);
    if (res.nbo) gl.deleteBuffer(res.nbo);
    if (res.uvbo) gl.deleteBuffer(res.uvbo);
    if (res.colorbo) gl.deleteBuffer(res.colorbo);
    if (res.ibo) gl.deleteBuffer(res.ibo);
    res.edgeOverlay.dispose(gl);
    res.selectedEdgeOverlay.dispose(gl);
    res.vertexOverlay.dispose(gl);
    res.materialPreview.dispose(gl);
  };

  const handleRender = (args: AssetViewportRenderArgs) => {
    const { gl, vp, meshProgram, lineProgram, viewportSize, eye } = args;
    const asset = assetManager.getAsset(assetId) as StaticMeshAsset | SkeletalMeshAsset | undefined;
    if (!asset || (asset.type !== 'MESH' && asset.type !== 'SKELETAL_MESH')) return;

    const res = glResourcesRef.current;
    if (!res.meshVao || !res.vbo || !res.nbo || !res.uvbo || !res.colorbo || !res.ibo) return;

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
        res.edgeOverlay.update(
          gl,
          buildMeshEdgeIndices(asset.geometry.indices, asset.topology?.faces),
          gl.DYNAMIC_DRAW,
        );
        res.selectionEdgeRevision = -1;
        res.selectionVertexRevision = -1;
      }
      dirtyRef.current = 'NONE';
    }

    const engine = previewEngineRef.current;
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

    // Edge and face selections reuse the same edge-index contract instead of
    // maintaining a second renderer. Rebuild only when selection/mode changes.
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

    gl.bindVertexArray(null);
  };

  const focusCamera = () => {
    if (fitCamera) setCamera(p => ({ ...p, radius: fitCamera.radius, target: { ...fitCamera.target } }));
    else setCamera(p => ({ ...p, radius: 3.0, target: { x: 0, y: 0, z: 0 } }));
  };

  const resetTransform = () => {
    previewEngineRef.current?.resetPreviewTransform();
    previewEngineRef.current?.syncTransforms(false);
  };

  const handleMouseDown = (
    e: React.MouseEvent,
    coords: { x: number; y: number; width: number; height: number }
  ) => {
    if (pieMenu && e.button !== 2) setPieMenu(null);
    if (pieMenu) return;

    const engine = previewEngineRef.current;
    const gs = gizmoSystemRef.current;
    if (!engine || !gs) return;

    // RMB opens Pie Menu (Alt+RMB reserved for zoom in AssetViewport3D)
    if (e.button === 2 && !e.altKey) {
      const hitId = engine.selectionSystem.selectEntityAt(coords.x, coords.y, coords.width, coords.height);
      if (hitId) engine.selectionSystem.setSelected([hitId]);
      setPieMenu({ x: e.clientX, y: e.clientY });
      return;
    }

    // Gizmo interaction (LMB)
    if (e.button === 0 && !e.altKey) {
      gs.update(0, coords.x, coords.y, coords.width, coords.height, true, false);
      if (gs.activeAxis) return;

      // Component picking in edit modes
      if (meshComponentMode !== 'OBJECT') {
        const previewEntityId = engine.entityId;
        if (!previewEntityId) return;
        const picked = engine.selectionSystem.pickMeshComponent(
          previewEntityId,
          coords.x,
          coords.y,
          coords.width,
          coords.height
        );
        if (picked) {
          if (!e.shiftKey) {
            engine.selectionSystem.subSelection.vertexIds.clear();
            engine.selectionSystem.subSelection.edgeIds.clear();
            engine.selectionSystem.subSelection.faceIds.clear();
          }
          if (meshComponentMode === 'VERTEX') {
            const id = picked.vertexId;
            if (engine.selectionSystem.subSelection.vertexIds.has(id))
              engine.selectionSystem.subSelection.vertexIds.delete(id);
            else engine.selectionSystem.subSelection.vertexIds.add(id);
          } else if (meshComponentMode === 'EDGE') {
            const id = meshEdgeKey(picked.edgeId[0], picked.edgeId[1]);
            if (engine.selectionSystem.subSelection.edgeIds.has(id))
              engine.selectionSystem.subSelection.edgeIds.delete(id);
            else engine.selectionSystem.subSelection.edgeIds.add(id);
          } else if (meshComponentMode === 'FACE') {
            const id = picked.faceId;
            if (engine.selectionSystem.subSelection.faceIds.has(id))
              engine.selectionSystem.subSelection.faceIds.delete(id);
            else engine.selectionSystem.subSelection.faceIds.add(id);
          }
          engine.notifyUI();
          return;
        }
      }

      // Object picking
      const hitId = engine.selectionSystem.selectEntityAt(coords.x, coords.y, coords.width, coords.height);
      if (hitId) engine.selectionSystem.setSelected([hitId]);
      else engine.selectionSystem.setSelected([]);
      engine.notifyUI();
    }
  };

  const handleMouseMove = (
    _e: MouseEvent,
    coords: { x: number; y: number; width: number; height: number }
  ) => {
    const engine = previewEngineRef.current;
    const gs = gizmoSystemRef.current;
    if (engine && gs) {
      gs.update(0, coords.x, coords.y, coords.width, coords.height, false, false);
      if (meshComponentModeRef.current === 'VERTEX') {
        engine.selectionSystem.highlightVertexAt(coords.x, coords.y, coords.width, coords.height);
      }
    }
  };

  const handleMouseUp = (
    _e: MouseEvent,
    coords: { x: number; y: number; width: number; height: number }
  ) => {
    gizmoSystemRef.current?.update(0, coords.x, coords.y, coords.width, coords.height, false, true);
  };

  const handleContextMenu = (
    e: React.MouseEvent,
    coords: { x: number; y: number; clientX: number; clientY: number }
  ) => {
    e.preventDefault();
    if (e.altKey) return;
    const engine = previewEngineRef.current;
    if (engine) {
      const hitId = engine.selectionSystem.selectEntityAt(coords.x, coords.y, 1000, 1000);
      if (hitId) engine.selectionSystem.setSelected([hitId]);
    }
    setPieMenu({ x: coords.clientX, y: coords.clientY });
  };

  const renderModeItem = useMemo(
    () => RENDER_MODE_ITEMS.find(m => m.id === renderMode) ?? RENDER_MODE_ITEMS[0],
    [renderMode]
  );

  const currentAsset = useMemo(() => {
    const asset = assetManager.getAsset(assetId);
    return asset && (asset.type === 'MESH' || asset.type === 'SKELETAL_MESH')
      ? (asset as StaticMeshAsset | SkeletalMeshAsset)
      : null;
  }, [assetId, selectionTick, stats]);

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
    return !!engine && engine.selectionSystem.selectedIndices.size > 0;
  }, [selectionTick]);

  const handlePieAction = (action: string) => {
    if (!currentAsset) return;
    if (action === 'tool_select' && assetViewportAllows(currentAsset.type, 'tool.select')) setTool('SELECT');
    if (action === 'tool_move' && assetViewportAllows(currentAsset.type, 'tool.move')) setTool('MOVE');
    if (action === 'tool_rotate' && assetViewportAllows(currentAsset.type, 'tool.rotate')) setTool('ROTATE');
    if (action === 'tool_scale' && assetViewportAllows(currentAsset.type, 'tool.scale')) setTool('SCALE');

    if (action === 'toggle_grid' && assetViewportAllows(currentAsset.type, 'view.grid')) setShowGrid(v => !v);
    if (action === 'toggle_wire' && assetViewportAllows(currentAsset.type, 'mesh.wireframe')) setShowWireframe(v => !v);
    if ((action === 'reset_cam' || action === 'focus') && assetViewportAllows(currentAsset.type, 'view.focus')) focusCamera();

    if (action === 'duplicate' && assetViewportAllows(currentAsset.type, 'mesh.object')) resetTransform();
    if (action === 'delete' && assetViewportAllows(currentAsset.type, 'mesh.object')) {
      resetTransform();
      focusCamera();
    }
    setPieMenu(null);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
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
            setMeshComponentMode(mode);
            setHierarchySection(
              mode === 'VERTEX' ? 'VERTICES' : mode === 'EDGE' ? 'EDGES' : mode === 'FACE' ? 'FACES' : 'GEOMETRY',
            );
          },
        })),
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
      hierarchy={
        <MeshAssetHierarchy
          asset={currentAsset}
          activeSection={hierarchySection}
          meshComponentMode={meshComponentMode}
          onSectionChange={setHierarchySection}
          onMeshComponentModeChange={setMeshComponentMode}
        />
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
        />
      }
    >
      <AssetViewport3D
        assetType={currentAsset.type}
        tool={tool}
        setTool={setTool}
        camera={camera}
        onCameraChange={setCamera}
        fitCamera={fitCamera}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid(v => !v)}
        stats={[
          { label: 'Verts', value: stats.verts, color: 'text-accent' },
          { label: 'Tris', value: stats.tris, color: 'text-accent' },
          { label: 'Mode', value: meshComponentMode, color: 'text-accent' },
        ]}
        selectionBadge={{
          text: isSelected ? 'Selected' : 'No Sel',
          active: isSelected,
        }}
        engine={previewEngine}
        gizmoSystem={gizmoSystem}
        toolbarActions={meshToolbarActions}
        shortcutsLegend="Alt+LMB Orbit • Alt+MMB Pan • Alt+RMB Zoom • RMB Pie"
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
          pieMenu &&
          createPortal(
            <PieMenu
              x={pieMenu.x}
              y={pieMenu.y}
              currentMode={meshComponentMode}
              onSelectMode={m => {
                if (assetViewportAllows(currentAsset.type, meshModeActionId(m))) {
                  setMeshComponentMode(m);
                  setHierarchySection(
                    m === 'VERTEX' ? 'VERTICES' : m === 'EDGE' ? 'EDGES' : m === 'FACE' ? 'FACES' : 'GEOMETRY',
                  );
                }
                setPieMenu(null);
              }}
              onAction={handlePieAction}
              onClose={() => setPieMenu(null)}
            />,
            document.body
          )
        }
      />
    </AssetEditorTemplate>
  );
};
