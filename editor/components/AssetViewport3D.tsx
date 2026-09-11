import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useViewportSize } from '@/editor/hooks/useViewportSize';
import { AssetViewportEngine } from '@/editor/viewports/AssetViewportEngine';
import { GizmoSystem } from '@/engine/GizmoSystem';
import { GizmoRenderer } from '@/engine/renderers/GizmoRenderer';
import { Mat4Utils, Vec3Utils } from '@/engine/math';
import { ToolType } from '@/types';
import { Icon } from './Icon';

export const MESH_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
uniform mat4 u_mvp;
uniform mat4 u_model;
out vec3 v_normal;
void main() {
  v_normal = normalize(mat3(u_model) * a_normal);
  gl_Position = u_mvp * vec4(a_pos, 1.0);
}`;

export const MESH_FS = `#version 300 es
precision mediump float;
in vec3 v_normal;
uniform vec3 u_lightDir;
uniform vec3 u_color;
uniform int u_renderMode; // 0: Lit, 1: Flat, 2: Normals
out vec4 outColor;
void main() {
  if (u_renderMode == 1) { outColor = vec4(u_color, 1.0); return; }
  vec3 n = normalize(v_normal);
  if (u_renderMode == 2) { outColor = vec4(n * 0.5 + 0.5, 1.0); return; }
  vec3 l = normalize(-u_lightDir);
  float diff = max(dot(n, l), 0.0);
  float hemi = max(0.0, 0.5 + 0.5 * n.y);
  vec3 ambient = vec3(0.1) + vec3(0.1, 0.1, 0.2) * hemi;
  vec3 diffuse = diff * u_color;
  outColor = vec4(ambient + diffuse, 1.0);
}`;

export const LINE_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
uniform mat4 u_mvp;
uniform float u_pointSize;
void main() { 
  gl_Position = u_mvp * vec4(a_pos, 1.0);
  gl_PointSize = u_pointSize > 0.0 ? u_pointSize : 8.0;
}`;

export const LINE_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
uniform bool u_isPoint;
out vec4 outColor;
void main() { 
  if (u_isPoint) {
    vec2 coord = gl_PointCoord - vec2(0.5);
    if (length(coord) > 0.5) discard;
  }
  outColor = u_color; 
}`;

export function compileProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vs || !fs) throw new Error('Failed to allocate shaders');

  gl.shaderSource(vs, vsSrc);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(vs) ?? 'Unknown VS compile error';
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(msg);
  }

  gl.shaderSource(fs, fsSrc);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(fs) ?? 'Unknown FS compile error';
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(msg);
  }

  const p = gl.createProgram();
  if (!p) throw new Error('Failed to allocate program');
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);

  gl.deleteShader(vs);
  gl.deleteShader(fs);

  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const msg = gl.getProgramInfoLog(p) ?? 'Unknown program link error';
    gl.deleteProgram(p);
    throw new Error(msg);
  }
  return p;
}

export type CameraState = {
  theta: number;
  phi: number;
  radius: number;
  target: { x: number; y: number; z: number };
};

export type AssetViewportRenderArgs = {
  gl: WebGL2RenderingContext;
  vp: Float32Array;
  view: Float32Array;
  proj: Float32Array;
  camera: CameraState;
  eye: { x: number; y: number; z: number };
  lineProgram: WebGLProgram;
  meshProgram: WebGLProgram;
  viewportSize: { pixelWidth: number; pixelHeight: number; cssWidth: number; cssHeight: number };
  project: (x: number, y: number, z: number) => { x: number; y: number } | null;
};

export interface AssetViewport3DProps {
  tool: ToolType;
  setTool: (tool: ToolType) => void;
  camera?: CameraState;
  onCameraChange?: (camera: CameraState) => void;
  defaultCamera?: CameraState;
  fitCamera?: { radius: number; target: { x: number; y: number; z: number } } | null;
  showGrid?: boolean;
  onToggleGrid?: () => void;
  stats?: Array<{ label: string; value: string | number; color?: string }>;
  selectionBadge?: { text: string; active: boolean };
  toolbarExtra?: React.ReactNode;
  headerExtra?: React.ReactNode;
  shortcutsLegend?: string;
  overlayChildren?: React.ReactNode;
  engine?: AssetViewportEngine | null;
  gizmoSystem?: GizmoSystem | null;
  onRender?: (args: AssetViewportRenderArgs) => void;
  onInitGl?: (gl: WebGL2RenderingContext) => void;
  onCleanupGl?: (gl: WebGL2RenderingContext) => void;
  onMouseDown?: (e: React.MouseEvent, coords: { x: number; y: number; width: number; height: number }) => void;
  onMouseMove?: (e: MouseEvent, coords: { x: number; y: number; width: number; height: number }) => void;
  onMouseUp?: (e: MouseEvent, coords: { x: number; y: number; width: number; height: number }) => void;
  onWheel?: (e: React.WheelEvent) => void;
  onContextMenu?: (e: React.MouseEvent, coords: { x: number; y: number; clientX: number; clientY: number }) => void;
  onResetView?: () => void;
  onKeyDown?: (e: KeyboardEvent) => void;
}

export const AssetViewport3D: React.FC<AssetViewport3DProps> = ({
  tool,
  setTool,
  camera: controlledCamera,
  onCameraChange,
  defaultCamera = { theta: 0.6, phi: 1.2, radius: 3.5, target: { x: 0, y: 0.5, z: 0 } },
  fitCamera,
  showGrid = true,
  onToggleGrid,
  stats = [],
  selectionBadge,
  toolbarExtra,
  headerExtra,
  shortcutsLegend = 'Alt+LMB Orbit • Alt+MMB Pan • Alt+RMB Zoom • RMB Menu',
  overlayChildren,
  engine,
  gizmoSystem,
  onRender,
  onInitGl,
  onCleanupGl,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onWheel,
  onContextMenu,
  onResetView,
  onKeyDown: onCustomKeyDown,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportSize = useViewportSize(containerRef, { dprCap: 2 });
  const viewportSizeRef = useRef(viewportSize);
  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize]);

  // Internal vs controlled camera
  const [internalCamera, setInternalCamera] = useState<CameraState>(defaultCamera);
  const camera = controlledCamera ?? internalCamera;
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  const updateCamera = (updater: CameraState | ((prev: CameraState) => CameraState)) => {
    if (typeof updater === 'function') {
      const next = updater(cameraRef.current);
      cameraRef.current = next;
      if (onCameraChange) onCameraChange(next);
      else setInternalCamera(next);
    } else {
      cameraRef.current = updater;
      if (onCameraChange) onCameraChange(updater);
      else setInternalCamera(updater);
    }
  };

  const [autoRotate, setAutoRotate] = useState(false);
  const autoRotateRef = useRef(autoRotate);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);
  const lastAutoRotateSyncRef = useRef(0);

  const [dragState, setDragState] = useState<{
    isDragging: boolean;
    startX: number;
    startY: number;
    mode: 'ORBIT' | 'PAN' | 'ZOOM';
    startCamera: CameraState;
  } | null>(null);
  const dragStateRef = useRef(dragState);
  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  const showGridRef = useRef(showGrid);
  useEffect(() => {
    showGridRef.current = showGrid;
  }, [showGrid]);

  const onRenderRef = useRef(onRender);
  useEffect(() => {
    onRenderRef.current = onRender;
  }, [onRender]);

  const gizmoRendererRef = useRef<GizmoRenderer | null>(null);

  const engineRef = useRef(engine);
  useEffect(() => {
    engineRef.current = engine;
    if (engine && gizmoRendererRef.current) {
      engine.setRenderer({
        renderGizmos: (vp, pos, scale, hoverAxis, activeAxis) =>
          gizmoRendererRef.current?.renderGizmos(vp, pos, scale, hoverAxis, activeAxis),
      });
    }
  }, [engine]);

  const gizmoSystemRef = useRef(gizmoSystem);
  useEffect(() => {
    gizmoSystemRef.current = gizmoSystem;
  }, [gizmoSystem]);

  // Keybindings
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;

      if (e.key === 'q' || e.key === 'Q') setTool('SELECT');
      if (e.key === 'w' || e.key === 'W') setTool('MOVE');
      if (e.key === 'e' || e.key === 'E') setTool('ROTATE');
      if (e.key === 'r' || e.key === 'R') setTool('SCALE');

      if (e.key === 'g' || e.key === 'G') {
        if (onToggleGrid) onToggleGrid();
      }

      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        if (fitCamera) {
          updateCamera(p => ({ ...p, radius: fitCamera.radius, target: { ...fitCamera.target } }));
        } else {
          updateCamera(p => ({ ...p, radius: defaultCamera.radius, target: { ...defaultCamera.target } }));
        }
      }

      if (onCustomKeyDown) {
        onCustomKeyDown(e);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setTool, onToggleGrid, fitCamera, defaultCamera, onCustomKeyDown]);

  // Main WebGL Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: true });
    if (!gl) return;

    // Gizmo renderer
    const gizmoRenderer = new GizmoRenderer();
    gizmoRenderer.init(gl);
    gizmoRendererRef.current = gizmoRenderer;
    if (engineRef.current) {
      engineRef.current.setRenderer({
        renderGizmos: (vp, pos, scale, hoverAxis, activeAxis) =>
          gizmoRenderer.renderGizmos(vp, pos, scale, hoverAxis, activeAxis),
      });
    }

    // Programs
    const meshProgram = compileProgram(gl, MESH_VS, MESH_FS);
    const lineProgram = compileProgram(gl, LINE_VS, LINE_FS);

    // Buffers: Grid
    const gridLines: number[] = [];
    const gridSize = 10;
    const step = 1;
    for (let i = -gridSize; i <= gridSize; i += step) {
      gridLines.push(i, 0, -gridSize, i, 0, gridSize);
      gridLines.push(-gridSize, 0, i, gridSize, 0, i);
    }
    const gridVao = gl.createVertexArray();
    const gridVbo = gl.createBuffer();
    if (!gridVao || !gridVbo) throw new Error('Failed to allocate grid buffers');
    gl.bindVertexArray(gridVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gridVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(gridLines), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    // Primary Axis lines (X red, Z blue)
    const axisVao = gl.createVertexArray();
    const axisVbo = gl.createBuffer();
    gl.bindVertexArray(axisVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, axisVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -gridSize, 0, 0, gridSize, 0, 0, // X
        0, 0, -gridSize, 0, 0, gridSize, // Z
      ]),
      gl.STATIC_DRAW
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.12, 0.12, 0.12, 1.0);

    if (onInitGl) onInitGl(gl);

    const proj = Mat4Utils.create();
    const view = Mat4Utils.create();
    const vp = Mat4Utils.create();

    const project = (x: number, y: number, z: number) => {
      const vs = viewportSizeRef.current;
      const width = Math.max(1, vs.cssWidth);
      const height = Math.max(1, vs.cssHeight);
      const px = x * vp[0] + y * vp[4] + z * vp[8] + vp[12];
      const py = x * vp[1] + y * vp[5] + z * vp[9] + vp[13];
      const pw = x * vp[3] + y * vp[7] + z * vp[11] + vp[15];
      if (pw <= 0.001) return null;
      return {
        x: ((px / pw) * 0.5 + 0.5) * width,
        y: (-(py / pw) * 0.5 + 0.5) * height,
      };
    };

    let raf = 0;
    const tick = () => {
      const vs = viewportSizeRef.current;
      const w = Math.max(1, vs.pixelWidth);
      const h = Math.max(1, vs.pixelHeight);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }

      // Auto-rotate
      const cam = cameraRef.current;
      if (autoRotateRef.current) {
        cam.theta += 0.005;
        const now = performance.now();
        if (now - lastAutoRotateSyncRef.current > 200) {
          lastAutoRotateSyncRef.current = now;
          updateCamera({ ...cam, target: { ...cam.target } });
        }
      }

      const eyeX = cam.target.x + cam.radius * Math.sin(cam.phi) * Math.cos(cam.theta);
      const eyeY = cam.target.y + cam.radius * Math.cos(cam.phi);
      const eyeZ = cam.target.z + cam.radius * Math.sin(cam.phi) * Math.sin(cam.theta);
      const eye = { x: eyeX, y: eyeY, z: eyeZ };

      const aspect = canvas.width / canvas.height;
      Mat4Utils.perspective((45 * Math.PI) / 180, aspect, 0.1, 1000.0, proj);
      Mat4Utils.lookAt(eye, cam.target, { x: 0, y: 1, z: 0 }, view);
      Mat4Utils.multiply(proj, view, vp);

      // Sync viewport to local engine
      const eng = engineRef.current;
      if (eng) {
        eng.setViewport(vp, eye, Math.max(1, vs.cssWidth), Math.max(1, vs.cssHeight));
        eng.sceneGraph.update();
      }

      gl.clearColor(0.12, 0.12, 0.12, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

      // Draw standard 3D ground grid
      if (showGridRef.current) {
        gl.useProgram(lineProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, 'u_mvp'), false, vp);
        gl.uniform1f(gl.getUniformLocation(lineProgram, 'u_pointSize'), 0.0);
        gl.uniform1i(gl.getUniformLocation(lineProgram, 'u_isPoint'), 0);

        // Subtle grid lines
        gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.28, 0.28, 0.28, 1.0);
        gl.bindVertexArray(gridVao);
        gl.drawArrays(gl.LINES, 0, gridLines.length / 3);

        // Center X line (Red)
        gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.8, 0.2, 0.2, 0.85);
        gl.bindVertexArray(axisVao);
        gl.drawArrays(gl.LINES, 0, 2);

        // Center Z line (Blue)
        gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.2, 0.45, 0.85, 0.85);
        gl.drawArrays(gl.LINES, 2, 2);
      }

      // Custom user rendering pass
      if (onRenderRef.current) {
        onRenderRef.current({
          gl,
          vp,
          view,
          proj,
          camera: cam,
          eye,
          lineProgram,
          meshProgram,
          viewportSize: vs,
          project,
        });
      }

      // Render gizmos
      const gs = gizmoSystemRef.current;
      if (gs && eng) {
        gs.render();
      }

      gl.bindVertexArray(null);
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      gizmoRendererRef.current = null;
      if (onCleanupGl) onCleanupGl(gl);
      gl.deleteVertexArray(gridVao);
      gl.deleteBuffer(gridVbo);
      if (axisVao) gl.deleteVertexArray(axisVao);
      if (axisVbo) gl.deleteBuffer(axisVbo);
      gl.deleteProgram(meshProgram);
      gl.deleteProgram(lineProgram);
    };
  }, []);

  // --- Mouse & Navigation Handling ---
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    // Camera controls with Alt
    if (e.altKey) {
      e.preventDefault();
      let mode: 'ORBIT' | 'PAN' | 'ZOOM' = 'ORBIT';
      if (e.button === 1) mode = 'PAN';
      if (e.button === 2) mode = 'ZOOM';
      setDragState({
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        mode,
        startCamera: { ...cameraRef.current, target: { ...cameraRef.current.target } },
      });
      return;
    }

    // Try gizmo interaction first if gizmoSystem is provided
    const gs = gizmoSystemRef.current;
    if (gs && e.button === 0) {
      gs.update(0, mx, my, width, height, true, false);
      if (gs.activeAxis) {
        return;
      }
    }

    // Forward to caller
    if (onMouseDown) {
      onMouseDown(e, { x: mx, y: my, width, height });
    }
  };

  const handleGlobalMouseMove = (e: MouseEvent) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    const ds = dragStateRef.current;
    if (ds && ds.isDragging) {
      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      if (ds.mode === 'ORBIT') {
        updateCamera(prev => ({
          ...prev,
          theta: ds.startCamera.theta + dx * 0.01,
          phi: Math.max(0.05, Math.min(Math.PI - 0.05, ds.startCamera.phi - dy * 0.01)),
        }));
      } else if (ds.mode === 'ZOOM') {
        updateCamera(prev => ({
          ...prev,
          radius: Math.max(0.2, ds.startCamera.radius - (dx - dy) * 0.05),
        }));
      } else if (ds.mode === 'PAN') {
        const panSpeed = ds.startCamera.radius * 0.001;
        const eyeX = ds.startCamera.radius * Math.sin(ds.startCamera.phi) * Math.cos(ds.startCamera.theta);
        const eyeY = ds.startCamera.radius * Math.cos(ds.startCamera.phi);
        const eyeZ = ds.startCamera.radius * Math.sin(ds.startCamera.phi) * Math.sin(ds.startCamera.theta);
        const forward = Vec3Utils.normalize(
          Vec3Utils.scale({ x: eyeX, y: eyeY, z: eyeZ }, -1, { x: 0, y: 0, z: 0 }),
          { x: 0, y: 0, z: 0 }
        );
        const right = Vec3Utils.normalize(
          Vec3Utils.cross(forward, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }),
          { x: 0, y: 0, z: 0 }
        );
        const camUp = Vec3Utils.normalize(
          Vec3Utils.cross(right, forward, { x: 0, y: 0, z: 0 }),
          { x: 0, y: 0, z: 0 }
        );
        const moveX = Vec3Utils.scale(right, -dx * panSpeed, { x: 0, y: 0, z: 0 });
        const moveY = Vec3Utils.scale(camUp, dy * panSpeed, { x: 0, y: 0, z: 0 });
        updateCamera(prev => ({
          ...prev,
          target: Vec3Utils.add(
            ds.startCamera.target,
            Vec3Utils.add(moveX, moveY, { x: 0, y: 0, z: 0 }),
            { x: 0, y: 0, z: 0 }
          ),
        }));
      }
      return;
    }

    const gs = gizmoSystemRef.current;
    if (gs) {
      gs.update(0, mx, my, width, height, false, false);
    }

    if (onMouseMove) {
      onMouseMove(e, { x: mx, y: my, width, height });
    }
  };

  const handleGlobalMouseUp = (e: MouseEvent) => {
    if (!containerRef.current) {
      setDragState(null);
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    setDragState(null);

    const gs = gizmoSystemRef.current;
    if (gs) {
      gs.update(0, mx, my, width, height, false, true);
    }

    if (onMouseUp) {
      onMouseUp(e, { x: mx, y: my, width, height });
    }
  };

  useEffect(() => {
    window.addEventListener('mousemove', handleGlobalMouseMove);
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const handleWheel = (e: React.WheelEvent) => {
    updateCamera(p => ({
      ...p,
      radius: Math.max(0.2, p.radius + e.deltaY * 0.005),
    }));
    if (onWheel) onWheel(e);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (onContextMenu) {
      onContextMenu(e, { x: mx, y: my, clientX: e.clientX, clientY: e.clientY });
    }
  };

  const handleFocus = () => {
    if (fitCamera) {
      updateCamera(p => ({ ...p, radius: fitCamera.radius, target: { ...fitCamera.target } }));
    } else {
      updateCamera(p => ({ ...p, radius: defaultCamera.radius, target: { ...defaultCamera.target } }));
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#151515] select-none text-xs w-full">
      <div
        ref={containerRef}
        className={`flex-1 relative overflow-hidden group/viewport ${
          dragState ? 'cursor-grabbing' : 'cursor-default'
        }`}
        onMouseDown={handleMouseDown}
        onWheel={handleWheel}
        onContextMenu={handleContextMenu}
      >
        <canvas ref={canvasRef} className="w-full h-full block relative z-10" />

        {/* Viewport Toolbar */}
        <div className="absolute top-3 left-3 flex items-center gap-2 z-20 pointer-events-auto">
          <div className="bg-black/40 backdrop-blur border border-white/5 rounded-md flex p-1 text-text-secondary">
            <button
              className={`p-1 hover:text-white rounded hover:bg-white/10 ${
                tool === 'SELECT' ? 'text-accent' : ''
              }`}
              onClick={() => setTool('SELECT')}
              title="Select (Q)"
            >
              <Icon name="MousePointer2" size={14} />
            </button>
            <button
              className={`p-1 hover:text-white rounded hover:bg-white/10 ${
                tool === 'MOVE' ? 'text-accent' : ''
              }`}
              onClick={() => setTool('MOVE')}
              title="Move (W)"
            >
              <Icon name="Move" size={14} />
            </button>
            <button
              className={`p-1 hover:text-white rounded hover:bg-white/10 ${
                tool === 'ROTATE' ? 'text-accent' : ''
              }`}
              onClick={() => setTool('ROTATE')}
              title="Rotate (E)"
            >
              <Icon name="RotateCw" size={14} />
            </button>
            <button
              className={`p-1 hover:text-white rounded hover:bg-white/10 ${
                tool === 'SCALE' ? 'text-accent' : ''
              }`}
              onClick={() => setTool('SCALE')}
              title="Scale (R)"
            >
              <Icon name="Maximize" size={14} />
            </button>
          </div>

          {toolbarExtra}

          <div className="bg-black/40 backdrop-blur border border-white/5 rounded-md flex p-1 text-text-secondary">
            <button
              className={`p-1 hover:text-white rounded hover:bg-white/10 ${
                showGrid ? 'text-accent' : ''
              }`}
              onClick={() => {
                if (onToggleGrid) onToggleGrid();
              }}
              title="Toggle Grid (G)"
            >
              <Icon name="Grid" size={14} />
            </button>
            <button
              className="p-1 hover:text-white rounded hover:bg-white/10"
              onClick={() => {
                handleFocus();
                if (onResetView) onResetView();
              }}
              title="Reset / Focus View (F)"
            >
              <Icon name="Home" size={14} />
            </button>
          </div>
        </div>

        {/* Top-Right Stats & Controls */}
        <div className="absolute top-3 right-3 flex items-center gap-2 z-20 pointer-events-auto">
          {(stats.length > 0 || selectionBadge) && (
            <div className="hidden sm:flex items-center gap-3 text-[10px] font-mono text-text-secondary bg-black/40 px-2.5 py-1 rounded backdrop-blur border border-white/5">
              {stats.map((item, idx) => (
                <React.Fragment key={item.label}>
                  {idx > 0 && <div className="h-3 w-px bg-white/10" />}
                  <div className="flex items-center gap-1">
                    <span className={item.color || 'text-accent'}>{item.value}</span>
                    <span>{item.label}</span>
                  </div>
                </React.Fragment>
              ))}
              {selectionBadge && (
                <>
                  <div className="h-3 w-px bg-white/10" />
                  <div className="flex items-center gap-1">
                    <span className={selectionBadge.active ? 'text-emerald-400' : 'text-text-secondary'}>
                      {selectionBadge.text}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {headerExtra}

          <button
            onClick={() => setAutoRotate(v => !v)}
            className={`p-2 rounded-md border border-white/5 bg-black/40 backdrop-blur transition-colors ${
              autoRotate
                ? 'text-emerald-400 bg-emerald-500/10'
                : 'text-text-secondary hover:text-white hover:bg-white/5'
            }`}
            title="Auto Rotate"
          >
            <Icon name="RotateCw" size={14} />
          </button>
        </div>

        {/* Bottom-Right Shortcuts & Camera Helper */}
        <div className="absolute bottom-2 right-2 text-[10px] text-text-secondary bg-black/40 px-2.5 py-1 rounded backdrop-blur border border-white/5 z-20 flex flex-col items-end pointer-events-none">
          <span>Tool: {tool}</span>
          <span>
            Cam: {camera.target.x.toFixed(1)}, {camera.target.y.toFixed(1)}, {camera.target.z.toFixed(1)}
          </span>
          <span className="opacity-80">{shortcutsLegend}</span>
        </div>

        {overlayChildren}
      </div>
    </div>
  );
};
