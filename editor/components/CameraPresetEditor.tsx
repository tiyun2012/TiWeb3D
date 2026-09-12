import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AssetEditorTemplate } from './asset-editor/AssetEditorTemplate';
import { AssetViewport3D, type AssetViewportRenderArgs, type CameraState } from './AssetViewport3D';
import { AutoInspector } from './inspector/AutoInspector';
import { Icon } from './Icon';
import { ViewportIconButton, ViewportToolbarGroup } from './viewport/ViewportTemplate';
import { assetManager } from '@/engine/AssetManager';
import { eventBus } from '@/engine/EventBus';
import { buildCameraPreviewLines } from '@/engine/camera/CameraPreviewGeometry';
import type { CameraPresetAsset, CameraSettings } from '@/types';

interface PreviewGlResources {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
}

type CameraPresetPreviewMode = 'THROUGH_CAMERA' | 'INSPECT_CAMERA';

const THROUGH_CAMERA_STATE: CameraState = {
  theta: Math.PI / 2,
  phi: Math.PI / 2,
  radius: 3,
  target: { x: 0, y: 0, z: -3 },
};

const INSPECT_CAMERA_STATE: CameraState = {
  theta: 0.7,
  phi: 1.08,
  radius: 5.3,
  target: { x: 0, y: 0, z: -1.15 },
};

const buildLensPreviewLines = () => {
  const values: number[] = [];
  const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    values.push(ax, ay, az, bx, by, bz);
  };

  // Equal-size reference frames at different depths make Perspective vs
  // Orthographic behavior immediately visible while looking through the preset.
  for (const z of [-2, -4, -7]) {
    const half = 0.85;
    line(-half, -half, z, half, -half, z);
    line(half, -half, z, half, half, z);
    line(half, half, z, -half, half, z);
    line(-half, half, z, -half, -half, z);
    line(-0.12, 0, z, 0.12, 0, z);
    line(0, -0.12, z, 0, 0.12, z);
  }

  // Forward guide and a simple horizon/reference cross.
  line(0, 0, -0.25, 0, 0, -8);
  line(-3, 0, -5, 3, 0, -5);
  line(0, -2, -5, 0, 2, -5);
  return new Float32Array(values);
};

const LENS_PREVIEW_LINES = buildLensPreviewLines();

const hexToDisplayColor = (hex: string): readonly [number, number, number, number] | undefined => {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return undefined;
  const raw = Number.parseInt(match[1], 16);
  return [
    ((raw >> 16) & 255) / 255,
    ((raw >> 8) & 255) / 255,
    (raw & 255) / 255,
    1,
  ];
};

export interface CameraPresetEditorProps {
  assetId: string;
}

const getCameraPreset = (assetId: string) => {
  const asset = assetManager.getAsset(assetId);
  return asset?.type === 'CAMERA_PRESET' ? asset as CameraPresetAsset : null;
};

/**
 * Camera Preset editor.
 *
 * A preset owns lens/render configuration but no Scene transform, therefore:
 * - Through Camera uses a canonical fixed transform with the preset projection.
 * - Inspect Camera uses the normal orbit viewport and displays the preset frustum.
 *
 * Preview mode is editor state and is never serialized into the CameraPreset asset.
 */
export const CameraPresetEditor: React.FC<CameraPresetEditorProps> = ({ assetId }) => {
  const [, setRevision] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const [previewMode, setPreviewMode] = useState<CameraPresetPreviewMode>('THROUGH_CAMERA');
  const [previewCamera, setPreviewCamera] = useState<CameraState>(THROUGH_CAMERA_STATE);
  const glResourcesRef = useRef<PreviewGlResources | null>(null);
  const asset = getCameraPreset(assetId);

  useEffect(() => eventBus.on('ASSET_UPDATED', payload => {
    if (payload?.id === assetId) setRevision(value => value + 1);
  }), [assetId]);

  const switchPreviewMode = (mode: CameraPresetPreviewMode) => {
    setPreviewMode(mode);
    setPreviewCamera(mode === 'THROUGH_CAMERA' ? THROUGH_CAMERA_STATE : INSPECT_CAMERA_STATE);
  };

  const handleInitGl = useCallback((gl: WebGL2RenderingContext) => {
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    if (!vao || !vbo) {
      if (vao) gl.deleteVertexArray(vao);
      if (vbo) gl.deleteBuffer(vbo);
      throw new Error('Failed to create Camera Preset preview buffers.');
    }

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    glResourcesRef.current = { vao, vbo };
  }, []);

  const handleCleanupGl = useCallback((gl: WebGL2RenderingContext) => {
    const resources = glResourcesRef.current;
    if (!resources) return;
    gl.deleteVertexArray(resources.vao);
    gl.deleteBuffer(resources.vbo);
    glResourcesRef.current = null;
  }, []);

  const handleRender = useCallback((args: AssetViewportRenderArgs) => {
    const current = getCameraPreset(assetId);
    const resources = glResourcesRef.current;
    if (!current || !resources) return;

    const { gl, vp, lineProgram } = args;
    const lines = previewMode === 'INSPECT_CAMERA'
      ? buildCameraPreviewLines(current.data)
      : LENS_PREVIEW_LINES;

    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, 'u_mvp'), false, vp);
    gl.uniform1f(gl.getUniformLocation(lineProgram, 'u_pointSize'), 0);
    gl.uniform1i(gl.getUniformLocation(lineProgram, 'u_isPoint'), 0);
    if (previewMode === 'INSPECT_CAMERA') {
      gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.2, 0.72, 1.0, 1.0);
    } else {
      gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.42, 0.7, 0.92, 0.82);
    }

    gl.bindVertexArray(resources.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, lines, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, lines.length / 3);
    gl.bindVertexArray(null);
  }, [assetId, previewMode]);

  if (!asset) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#151515] text-xs text-red-300">
        Camera Preset asset not found.
      </div>
    );
  }

  const updateSetting = (path: string, value: unknown) => {
    const current = getCameraPreset(assetId);
    if (!current) return;
    assetManager.updateAsset(assetId, {
      data: {
        ...current.data,
        [path]: value,
      } as CameraSettings,
    });
  };

  const inspector = (
    <div className="h-full flex flex-col bg-[#181818]">
      <div className="h-10 px-3 border-b border-white/10 flex items-center gap-2 shrink-0">
        <Icon name="Camera" size={14} className="text-sky-400" />
        <div className="min-w-0">
          <div className="text-[10px] font-semibold text-white truncate">Camera Settings</div>
          <div className="text-[9px] text-text-secondary truncate">Reusable preset • no Scene transform</div>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3">
        <AutoInspector
          schemaId="CameraSettings"
          value={asset.data}
          scope="asset"
          onChange={updateSetting}
        />
      </div>
    </div>
  );

  const projectionStat = asset.data.projection === 'PERSPECTIVE'
    ? `${asset.data.fov.toFixed(0)}° FOV`
    : `${asset.data.orthoSize.toFixed(1)} Ortho`;

  const throughBackground = asset.data.clearMode === 'COLOR'
    ? hexToDisplayColor(asset.data.clearColor)
    : undefined;

  const previewToolbar = (
    <ViewportToolbarGroup>
      <ViewportIconButton
        label="Through Camera"
        active={previewMode === 'THROUGH_CAMERA'}
        onClick={() => switchPreviewMode('THROUGH_CAMERA')}
      >
        <Icon name="Eye" size={14} />
      </ViewportIconButton>
      <ViewportIconButton
        label="Inspect Camera Frustum"
        active={previewMode === 'INSPECT_CAMERA'}
        onClick={() => switchPreviewMode('INSPECT_CAMERA')}
      >
        <Icon name="Camera" size={14} />
      </ViewportIconButton>
    </ViewportToolbarGroup>
  );

  return (
    <AssetEditorTemplate
      assetType="CAMERA_PRESET"
      assetName={asset.name}
      hierarchy={null}
      inspector={inspector}
      defaultHierarchyVisible={false}
      inspectorWidth={320}
    >
      <AssetViewport3D
        assetType="CAMERA_PRESET"
        tool="SELECT"
        setTool={() => undefined}
        allowedTools={[]}
        camera={previewCamera}
        onCameraChange={setPreviewCamera}
        defaultCamera={previewMode === 'THROUGH_CAMERA' ? THROUGH_CAMERA_STATE : INSPECT_CAMERA_STATE}
        projectionSettings={previewMode === 'THROUGH_CAMERA' ? asset.data : undefined}
        navigationEnabled={previewMode === 'INSPECT_CAMERA'}
        backgroundColor={previewMode === 'THROUGH_CAMERA' ? throughBackground : undefined}
        fitCamera={previewMode === 'INSPECT_CAMERA' ? { radius: 5.3, target: { x: 0, y: 0, z: -1.15 } } : null}
        showGrid={previewMode === 'INSPECT_CAMERA' ? showGrid : false}
        onToggleGrid={() => setShowGrid(value => !value)}
        headerExtra={previewToolbar}
        stats={[
          { label: 'Preview', value: previewMode === 'THROUGH_CAMERA' ? 'Through' : 'Inspect', color: 'text-emerald-300' },
          { label: 'Projection', value: projectionStat, color: 'text-sky-300' },
          { label: 'Clip', value: `${asset.data.near} → ${asset.data.far}`, color: 'text-text-secondary' },
        ]}
        shortcutsLegend={previewMode === 'THROUGH_CAMERA'
          ? 'Preset lens preview • switch to Inspect for orbit controls'
          : 'Alt+LMB Orbit • Alt+MMB Pan • Alt+RMB Zoom • F Focus'}
        onInitGl={handleInitGl}
        onCleanupGl={handleCleanupGl}
        onRender={handleRender}
      />
    </AssetEditorTemplate>
  );
};
