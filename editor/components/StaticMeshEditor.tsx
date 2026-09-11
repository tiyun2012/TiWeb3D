import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { EditorContext } from '@/editor/state/EditorContext';
import { AssetViewportEngine } from '@/editor/viewports/AssetViewportEngine';
import { assetManager } from '@/engine/AssetManager';
import { GizmoSystem } from '@/engine/GizmoSystem';
import { Mat4Utils, Vec3Utils } from '@/engine/math';
import { MeshComponentMode, StaticMeshAsset, SkeletalMeshAsset, ToolType } from '@/types';

import { Icon } from './Icon';
import { PieMenu } from './PieMenu';
import { AssetViewport3D, AssetViewportRenderArgs, CameraState } from './AssetViewport3D';

const RENDER_MODE_ITEMS: Array<{ id: number; label: string; icon: string }> = [
  { id: 0, label: 'Lit', icon: 'Sun' },
  { id: 1, label: 'Flat', icon: 'Square' },
  { id: 2, label: 'Normals', icon: 'BoxSelect' },
];

type DirtyKind = 'NONE' | 'VERTS' | 'FULL';

function buildWireframeIndices(
  indices: Uint16Array | Uint32Array,
  faces?: number[][]
): { wire: Uint16Array | Uint32Array; useUint32: boolean } {
  const edgeSet = new Set<string>();
  const edges: number[] = [];
  const add = (a: number, b: number) => {
    const i0 = Math.min(a, b);
    const i1 = Math.max(a, b);
    const k = `${i0}_${i1}`;
    if (edgeSet.has(k)) return;
    edgeSet.add(k);
    edges.push(i0, i1);
  };

  if (faces && faces.length > 0) {
    for (let i = 0; i < faces.length; i++) {
      const face = faces[i];
      for (let j = 0; j < face.length; j++) {
        add(face[j], face[(j + 1) % face.length]);
      }
    }
  } else {
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      add(a, b);
      add(b, c);
      add(c, a);
    }
  }

  const maxIndex = edges.reduce((m, v) => (v > m ? v : m), 0);
  const useUint32 = indices instanceof Uint32Array || maxIndex > 65535;
  return { wire: useUint32 ? new Uint32Array(edges) : new Uint16Array(edges), useUint32 };
}

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

export const StaticMeshEditor: React.FC<{ assetId: string }> = ({ assetId }) => {
  // Context shared with Scene viewport (tool + component mode)
  const editorCtx = useContext(EditorContext);
  const tool: ToolType = editorCtx?.tool ?? 'SELECT';
  const setTool = editorCtx?.setTool ?? (() => {});
  const meshComponentMode: MeshComponentMode = editorCtx?.meshComponentMode ?? 'OBJECT';
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
    ibo: WebGLBuffer | null;
    wireVao: WebGLVertexArrayObject | null;
    wireIbo: WebGLBuffer | null;
    wire: { wire: Uint16Array | Uint32Array; useUint32: boolean } | null;
  }>({
    meshVao: null,
    vbo: null,
    nbo: null,
    ibo: null,
    wireVao: null,
    wireIbo: null,
    wire: null,
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
    const ibo = gl.createBuffer();
    if (!meshVao || !vbo || !nbo || !ibo) return;

    gl.bindVertexArray(meshVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, asset.geometry.vertices, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
    gl.bufferData(gl.ARRAY_BUFFER, asset.geometry.normals, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, asset.geometry.indices, gl.DYNAMIC_DRAW);

    const wire = buildWireframeIndices(asset.geometry.indices, asset.topology?.faces);
    const wireVao = gl.createVertexArray();
    const wireIbo = gl.createBuffer();
    if (!wireVao || !wireIbo) return;

    gl.bindVertexArray(wireVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wireIbo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wire.wire, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);

    glResourcesRef.current = { meshVao, vbo, nbo, ibo, wireVao, wireIbo, wire };
  };

  const handleCleanupGl = (gl: WebGL2RenderingContext) => {
    const res = glResourcesRef.current;
    if (res.meshVao) gl.deleteVertexArray(res.meshVao);
    if (res.vbo) gl.deleteBuffer(res.vbo);
    if (res.nbo) gl.deleteBuffer(res.nbo);
    if (res.ibo) gl.deleteBuffer(res.ibo);
    if (res.wireVao) gl.deleteVertexArray(res.wireVao);
    if (res.wireIbo) gl.deleteBuffer(res.wireIbo);
  };

  const handleRender = (args: AssetViewportRenderArgs) => {
    const { gl, vp, meshProgram, lineProgram } = args;
    const asset = assetManager.getAsset(assetId) as StaticMeshAsset | SkeletalMeshAsset | undefined;
    if (!asset || (asset.type !== 'MESH' && asset.type !== 'SKELETAL_MESH')) return;

    const res = glResourcesRef.current;
    if (!res.meshVao || !res.vbo || !res.nbo || !res.ibo || !res.wireVao || !res.wireIbo) return;

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
        const wire = buildWireframeIndices(asset.geometry.indices, asset.topology?.faces);
        res.wire = wire;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.wireIbo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wire.wire, gl.DYNAMIC_DRAW);
      }
      dirtyRef.current = 'NONE';
    }

    const engine = previewEngineRef.current;
    const model = engine?.sceneGraph.getWorldMatrix(engine.entityId) ?? Mat4Utils.create();
    const mvp = Mat4Utils.create();
    Mat4Utils.multiply(vp, model, mvp);

    // Draw mesh
    gl.useProgram(meshProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, 'u_mvp'), false, mvp);
    gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, 'u_model'), false, model);
    gl.uniform3f(gl.getUniformLocation(meshProgram, 'u_lightDir'), 0.5, -1.0, 0.5);
    gl.uniform3f(gl.getUniformLocation(meshProgram, 'u_color'), 0.8, 0.8, 0.8);
    gl.uniform1i(gl.getUniformLocation(meshProgram, 'u_renderMode'), renderModeRef.current);
    gl.bindVertexArray(res.meshVao);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    const idxType =
      asset.geometry.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    gl.drawElements(gl.TRIANGLES, asset.geometry.indices.length, idxType, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // Wireframe overlay
    if (showWireframeRef.current && res.wire) {
      gl.useProgram(lineProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, 'u_mvp'), false, mvp);
      gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.9, 0.9, 0.9, 0.25);
      gl.bindVertexArray(res.wireVao);
      gl.drawElements(
        gl.LINES,
        res.wire.wire.length,
        res.wire.useUint32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        0
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
        const picked = engine.selectionSystem.pickMeshComponent(
          engine.entityId,
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
            const id = picked.edgeId.sort((a, b) => a - b).join('-');
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _tick = selectionTick;
  const isSelected = useMemo(() => {
    const engine = previewEngineRef.current;
    return !!engine && engine.selectionSystem.selectedIndices.size > 0;
  }, [selectionTick]);

  const handlePieAction = (action: string) => {
    if (action === 'tool_select') setTool('SELECT');
    if (action === 'tool_move') setTool('MOVE');
    if (action === 'tool_rotate') setTool('ROTATE');
    if (action === 'tool_scale') setTool('SCALE');

    if (action === 'toggle_grid') setShowGrid(v => !v);
    if (action === 'toggle_wire') setShowWireframe(v => !v);
    if (action === 'reset_cam' || action === 'focus') focusCamera();

    if (action === 'duplicate') resetTransform();
    if (action === 'delete') {
      resetTransform();
      focusCamera();
    }
    setPieMenu(null);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'z' || e.key === 'Z') {
      setShowWireframe(v => !v);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#151515] select-none text-xs w-full">
      <AssetViewport3D
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
        toolbarExtra={
          <>
            <div
              className="bg-black/40 backdrop-blur border border-white/5 rounded-md flex items-center px-2 py-1 text-[10px] text-text-secondary min-w-[100px] justify-between cursor-pointer hover:bg-white/5"
              onClick={() => setRenderMode(p => (p + 1) % RENDER_MODE_ITEMS.length)}
              title="Cycle Shading Mode"
            >
              <div className="flex items-center gap-2">
                <Icon name={renderModeItem.icon as any} size={12} className="text-accent" />
                <span className="font-semibold text-white/90">{renderModeItem.label}</span>
              </div>
              <Icon name="ChevronRight" size={10} className="text-text-secondary" />
            </div>

            <div className="bg-black/40 backdrop-blur border border-white/5 rounded-md flex p-1 text-text-secondary">
              <button
                className={`p-1 hover:text-white rounded hover:bg-white/10 ${
                  showWireframe ? 'text-accent' : ''
                }`}
                onClick={() => setShowWireframe(v => !v)}
                title="Toggle Wireframe (Z)"
              >
                <Icon name="Codepen" size={14} />
              </button>
            </div>
          </>
        }
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
                setMeshComponentMode(m);
                setPieMenu(null);
              }}
              onAction={handlePieAction}
              onClose={() => setPieMenu(null)}
            />,
            document.body
          )
        }
      />
    </div>
  );
};
