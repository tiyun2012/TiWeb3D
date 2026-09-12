import React, { useEffect, useRef, useState } from 'react';
import { useViewportSize } from '@/editor/hooks/useViewportSize';
import { AssetViewportEngine } from '@/editor/viewports/AssetViewportEngine';
import { GizmoSystem } from '@/engine/GizmoSystem';
import { GizmoRenderer } from '@/engine/renderers/GizmoRenderer';
import { Mat4Utils } from '@/engine/math';
import { AssetType, CameraSettings, ToolType } from '@/types';
import {
  ASSET_MESH_SURFACE_FS,
  ASSET_MESH_SURFACE_VS,
  DISPLAY_TRANSFER_GLSL,
  VIEWPORT_BACKGROUND_DISPLAY_COLOR,
  VIEWPORT_WEBGL_CONTEXT_ATTRIBUTES,
} from '@/engine/renderers/MeshSurfaceContract';
import { Icon } from './Icon';
import {
  ViewportHud,
  ViewportIconButton,
  ViewportTemplate,
  ViewportToolbarGroup,
} from './viewport/ViewportTemplate';
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
import {
  AssetViewportToolbarAction,
  assetViewportAllows,
  toolActionId,
} from './asset-editor/assetViewportCapabilities';

export type { CameraState } from '@/editor/viewports/viewportCamera';

export const MESH_VS = ASSET_MESH_SURFACE_VS;
export const MESH_FS = ASSET_MESH_SURFACE_FS;

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
${DISPLAY_TRANSFER_GLSL}
uniform bool u_isPoint;
out vec4 outColor;
void main() { 
  if (u_isPoint) {
    vec2 coord = gl_PointCoord - vec2(0.5);
    if (length(coord) > 0.5) discard;
  }
  outColor = vec4(linearToDisplay(u_color.rgb), u_color.a); 
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
  assetType?: AssetType;
  tool: ToolType;
  setTool: (tool: ToolType) => void;
  allowedTools?: readonly ToolType[];
  camera?: CameraState;
  onCameraChange?: (camera: CameraState) => void;
  defaultCamera?: CameraState;
  /** Optional lens/projection override. View transform still comes from the editor orbit camera. */
  projectionSettings?: Pick<CameraSettings, 'projection' | 'fov' | 'orthoSize' | 'near' | 'far'>;
  /** Disable orbit/pan/zoom when the host wants a locked camera preview. */
  navigationEnabled?: boolean;
  /** Optional direct-to-canvas clear color in display space. */
  backgroundColor?: readonly [number, number, number, number];
  fitCamera?: { radius: number; target: { x: number; y: number; z: number } } | null;
  showGrid?: boolean;
  onToggleGrid?: () => void;
  stats?: Array<{ label: string; value: string | number; color?: string }>;
  selectionBadge?: { text: string; active: boolean };
  toolbarActions?: readonly AssetViewportToolbarAction[];
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
  assetType,
  tool,
  setTool,
  allowedTools,
  camera: controlledCamera,
  onCameraChange,
  defaultCamera = { theta: 0.6, phi: 1.2, radius: 3.5, target: { x: 0, y: 0.5, z: 0 } },
  projectionSettings,
  navigationEnabled = true,
  backgroundColor,
  fitCamera,
  showGrid = true,
  onToggleGrid,
  stats = [],
  selectionBadge,
  toolbarActions = [],
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

  const backgroundColorRef = useRef(backgroundColor);
  useEffect(() => {
    backgroundColorRef.current = backgroundColor;
  }, [backgroundColor]);

  const projectionSettingsRef = useRef(projectionSettings);
  useEffect(() => {
    projectionSettingsRef.current = projectionSettings;
  }, [projectionSettings]);

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
    mode: CameraDragMode;
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

      const activateTool = (nextTool: ToolType) => {
        const allowedByHost = !allowedTools || allowedTools.includes(nextTool);
        if (allowedByHost && assetViewportAllows(assetType, toolActionId(nextTool))) setTool(nextTool);
      };

      if (e.key === 'q' || e.key === 'Q') activateTool('SELECT');
      if (e.key === 'w' || e.key === 'W') activateTool('MOVE');
      if (e.key === 'e' || e.key === 'E') activateTool('ROTATE');
      if (e.key === 'r' || e.key === 'R') activateTool('SCALE');

      if ((e.key === 'g' || e.key === 'G') && assetViewportAllows(assetType, 'view.grid')) {
        if (onToggleGrid) onToggleGrid();
      }

      if (navigationEnabled && (e.key === 'f' || e.key === 'F') && assetViewportAllows(assetType, 'view.focus')) {
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
  }, [assetType, allowedTools, setTool, onToggleGrid, fitCamera, defaultCamera, onCustomKeyDown, navigationEnabled]);

  // Main WebGL Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { ...VIEWPORT_WEBGL_CONTEXT_ATTRIBUTES });
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
    gl.clearColor(...(backgroundColorRef.current ?? VIEWPORT_BACKGROUND_DISPLAY_COLOR));

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

      // Auto-rotate without mutating a controlled camera object supplied by the parent.
      let cam = cameraRef.current;
      if (autoRotateRef.current) {
        cam = { ...cam, theta: cam.theta + 0.005, target: { ...cam.target } };
        cameraRef.current = cam;
        const now = performance.now();
        if (now - lastAutoRotateSyncRef.current > 200) {
          lastAutoRotateSyncRef.current = now;
          updateCamera(cam);
        }
      }

      const eye = getCameraEye(cam);

      const aspect = canvas.width / canvas.height;
      const lens = projectionSettingsRef.current;
      if (lens?.projection === 'ORTHOGRAPHIC') {
        const halfHeight = Math.max(0.0005, lens.orthoSize * 0.5);
        const halfWidth = halfHeight * aspect;
        Mat4Utils.orthographic(
          -halfWidth,
          halfWidth,
          -halfHeight,
          halfHeight,
          Math.max(0.0001, lens.near),
          Math.max(lens.near + 0.0001, lens.far),
          proj,
        );
      } else {
        const fov = lens?.fov ?? 45;
        const near = Math.max(0.0001, lens?.near ?? 0.1);
        const far = Math.max(near + 0.0001, lens?.far ?? 1000);
        Mat4Utils.perspective((fov * Math.PI) / 180, aspect, near, far, proj);
      }
      Mat4Utils.lookAt(eye, cam.target, { x: 0, y: 1, z: 0 }, view);
      Mat4Utils.multiply(proj, view, vp);

      // Sync viewport to local engine
      const eng = engineRef.current;
      if (eng) {
        eng.setViewport(vp, eye, Math.max(1, vs.cssWidth), Math.max(1, vs.cssHeight));
        eng.sceneGraph.update();
      }

      gl.clearColor(...(backgroundColorRef.current ?? VIEWPORT_BACKGROUND_DISPLAY_COLOR));
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
    if (navigationEnabled && e.altKey) {
      e.preventDefault();
      let mode: 'ORBIT' | 'PAN' | 'ZOOM' = 'ORBIT';
      if (e.button === 1) mode = 'PAN';
      if (e.button === 2) mode = 'ZOOM';
      setDragState({
        isDragging: true,
        startX: e.clientX,
        startY: e.clientY,
        mode,
        startCamera: cloneCamera(cameraRef.current),
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
        updateCamera(orbitCamera(ds.startCamera, dx, dy));
      } else if (ds.mode === 'ZOOM') {
        updateCamera(dragZoomCamera(ds.startCamera, dx, dy, { minRadius: 0.2 }));
      } else if (ds.mode === 'PAN') {
        updateCamera(panCamera(ds.startCamera, dx, dy));
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
    if (navigationEnabled) {
      updateCamera(p => wheelZoomCamera(p, e.deltaY, { minRadius: 0.2, sensitivity: 0.005 }));
    }
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
    if (!navigationEnabled) return;
    if (fitCamera) {
      updateCamera(p => ({ ...p, radius: fitCamera.radius, target: { ...fitCamera.target } }));
    } else {
      updateCamera(p => ({ ...p, radius: defaultCamera.radius, target: { ...defaultCamera.target } }));
    }
  };

  const toolAllowed = (candidate: ToolType) =>
    (!allowedTools || allowedTools.includes(candidate)) &&
    assetViewportAllows(assetType, toolActionId(candidate));

  const toolbarActionGroups = toolbarActions.reduce<Record<string, AssetViewportToolbarAction[]>>(
    (groups, action) => {
      if (!assetViewportAllows(assetType, action.id)) return groups;
      const group = action.group || 'asset';
      (groups[group] ||= []).push(action);
      return groups;
    },
    {},
  );

  return (
    <ViewportTemplate
      containerRef={containerRef}
      canvasRef={canvasRef}
      className={`text-xs ${dragState ? 'cursor-grabbing' : 'cursor-default'}`}
      containerProps={{
        onMouseDown: handleMouseDown,
        onWheel: handleWheel,
        onContextMenu: handleContextMenu,
      }}
      toolbarLeft={
        <>
          <ViewportToolbarGroup>
            {toolAllowed('SELECT') && (
              <ViewportIconButton label="Select (Q)" active={tool === 'SELECT'} onClick={() => setTool('SELECT')}>
                <Icon name="MousePointer2" size={14} />
              </ViewportIconButton>
            )}
            {toolAllowed('MOVE') && (
              <ViewportIconButton label="Move (W)" active={tool === 'MOVE'} onClick={() => setTool('MOVE')}>
                <Icon name="Move" size={14} />
              </ViewportIconButton>
            )}
            {toolAllowed('ROTATE') && (
              <ViewportIconButton label="Rotate (E)" active={tool === 'ROTATE'} onClick={() => setTool('ROTATE')}>
                <Icon name="RotateCw" size={14} />
              </ViewportIconButton>
            )}
            {toolAllowed('SCALE') && (
              <ViewportIconButton label="Scale (R)" active={tool === 'SCALE'} onClick={() => setTool('SCALE')}>
                <Icon name="Maximize" size={14} />
              </ViewportIconButton>
            )}
          </ViewportToolbarGroup>

          {Object.entries(toolbarActionGroups).map(([group, actions]) => (
            <ViewportToolbarGroup key={group}>
              {actions.map(action => (
                <ViewportIconButton
                  key={action.id}
                  label={action.label}
                  active={action.active}
                  className={action.className}
                  onClick={action.onTrigger}
                >
                  <Icon name={action.icon as any} size={14} />
                </ViewportIconButton>
              ))}
            </ViewportToolbarGroup>
          ))}

          {toolbarExtra}

          {(assetViewportAllows(assetType, 'view.grid') || assetViewportAllows(assetType, 'view.focus')) && (
            <ViewportToolbarGroup>
              {assetViewportAllows(assetType, 'view.grid') && (
                <ViewportIconButton
                  label="Toggle Grid (G)"
                  active={showGrid}
                  onClick={() => onToggleGrid?.()}
                >
                  <Icon name="Grid" size={14} />
                </ViewportIconButton>
              )}
              {assetViewportAllows(assetType, 'view.focus') && (
                <ViewportIconButton
                  label="Reset / Focus View (F)"
                  onClick={() => {
                    handleFocus();
                    onResetView?.();
                  }}
                >
                  <Icon name="Home" size={14} />
                </ViewportIconButton>
              )}
            </ViewportToolbarGroup>
          )}
        </>
      }
      toolbarRight={
        <>
          {headerExtra}

          {assetViewportAllows(assetType, 'view.autoRotate') && (
            <ViewportIconButton
              label="Auto Rotate"
              onClick={() => setAutoRotate(v => !v)}
              className={`p-2 border border-white/5 bg-black/40 backdrop-blur ${
                autoRotate
                  ? 'text-emerald-400 bg-emerald-500/10'
                  : 'text-text-secondary hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon name="RotateCw" size={14} />
            </ViewportIconButton>
          )}
        </>
      }
      hudBottomLeft={
        (stats.length > 0 || selectionBadge) ? (
          <ViewportHud className="flex-row items-center gap-2 font-mono">
            {stats.map((item, idx) => (
              <React.Fragment key={item.label}>
                {idx > 0 && <span className="opacity-25">•</span>}
                <span className="flex items-center gap-1">
                  <span className={item.color || 'text-accent'}>{item.value}</span>
                  <span>{item.label}</span>
                </span>
              </React.Fragment>
            ))}
            {selectionBadge && (
              <>
                {stats.length > 0 && <span className="opacity-25">•</span>}
                <span className={selectionBadge.active ? 'text-emerald-400' : 'text-text-secondary'}>
                  {selectionBadge.text}
                </span>
              </>
            )}
          </ViewportHud>
        ) : undefined
      }
      hudBottomRight={
        <ViewportHud className="items-end">
          <span>Tool: {tool}</span>
          <span>
            Cam: {camera.target.x.toFixed(1)}, {camera.target.y.toFixed(1)}, {camera.target.z.toFixed(1)}
          </span>
          <span className="opacity-80">{shortcutsLegend}</span>
        </ViewportHud>
      }
      overlayChildren={overlayChildren}
    />
  );

};
