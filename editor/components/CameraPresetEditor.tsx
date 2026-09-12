import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AssetEditorTemplate } from './asset-editor/AssetEditorTemplate';
import { AssetViewport3D, AssetViewportRenderArgs } from './AssetViewport3D';
import { AutoInspector } from './inspector/AutoInspector';
import { Icon } from './Icon';
import { assetManager } from '@/engine/AssetManager';
import { eventBus } from '@/engine/EventBus';
import { buildCameraPreviewLines } from '@/engine/camera/CameraPreviewGeometry';
import type { CameraPresetAsset, CameraSettings } from '@/types';

interface PreviewGlResources {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
}

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
 * Camera presets contain reusable projection/render settings, not a Scene
 * transform, so the viewport shows a canonical camera/frustum at the origin.
 * The right-hand inspector is the same CameraSettings schema used elsewhere.
 */
export const CameraPresetEditor: React.FC<CameraPresetEditorProps> = ({ assetId }) => {
  const [, setRevision] = useState(0);
  const [showGrid, setShowGrid] = useState(true);
  const glResourcesRef = useRef<PreviewGlResources | null>(null);
  const asset = getCameraPreset(assetId);

  useEffect(() => eventBus.on('ASSET_UPDATED', payload => {
    if (payload?.id === assetId) setRevision(value => value + 1);
  }), [assetId]);

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
    const lines = buildCameraPreviewLines(current.data);

    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, 'u_mvp'), false, vp);
    gl.uniform1f(gl.getUniformLocation(lineProgram, 'u_pointSize'), 0);
    gl.uniform1i(gl.getUniformLocation(lineProgram, 'u_isPoint'), 0);
    gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.2, 0.72, 1.0, 1.0);

    gl.bindVertexArray(resources.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, lines, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINES, 0, lines.length / 3);
    gl.bindVertexArray(null);
  }, [assetId]);

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
          <div className="text-[9px] text-text-secondary truncate">Reusable preset</div>
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
        defaultCamera={{ theta: 0.7, phi: 1.08, radius: 5.3, target: { x: 0, y: 0, z: -1.15 } }}
        fitCamera={{ radius: 5.3, target: { x: 0, y: 0, z: -1.15 } }}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid(value => !value)}
        stats={[
          { label: 'Projection', value: projectionStat, color: 'text-sky-300' },
          { label: 'Clip', value: `${asset.data.near} → ${asset.data.far}`, color: 'text-text-secondary' },
        ]}
        shortcutsLegend="Alt+LMB Orbit • Alt+MMB Pan • Alt+RMB Zoom • F Focus"
        onInitGl={handleInitGl}
        onCleanupGl={handleCleanupGl}
        onRender={handleRender}
      />
    </AssetEditorTemplate>
  );
};
