import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { AssetEditorTemplate } from './asset-editor/AssetEditorTemplate';
import { AssetViewport3D, type AssetViewportRenderArgs, type CameraState } from './AssetViewport3D';
import { AutoInspector } from './inspector/AutoInspector';
import { InspectorComponentCard } from './inspector/InspectorComponentCard';
import { Icon } from './Icon';
import { ViewportIconButton, ViewportToolbarGroup } from './viewport/ViewportTemplate';
import { assetManager } from '@/engine/AssetManager';
import { eventBus } from '@/engine/EventBus';
import { buildCameraPreviewLines } from '@/engine/camera/CameraPreviewGeometry';
import { getAssetViewportProfileId, resolveViewportProfile } from '@/editor/viewports/ViewportProfileResolver';
import type { CameraPresetAsset, CameraSettings, Vector3 } from '@/types';
import { cameraStateFromWorldPose, getCameraEye, getCameraForward, getCameraUp } from '@/editor/viewports/viewportCamera';

interface PreviewGlResources {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
}

type CameraPresetPreviewMode = 'THROUGH_CAMERA' | 'INSPECT_CAMERA';

const THROUGH_CAMERA_STATE: CameraState = {
  theta: Math.PI / 2,
  phi: 1.25,
  radius: 3,
  target: { x: 0, y: 0, z: -3 },
  orthoScale: 1,
};

const INSPECT_CAMERA_STATE: CameraState = {
  theta: 0.7,
  phi: 1.08,
  radius: 5.3,
  target: { x: 0, y: 0, z: -1.15 },
  orthoScale: 1,
};

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

interface CameraPreviewTransform {
  position: Vector3;
  rotation: Vector3;
  scale: Vector3;
}

const cameraStateToPreviewTransform = (camera: CameraState): CameraPreviewTransform => {
  const eye = getCameraEye(camera);
  const up = getCameraUp(camera);
  const eyeVec = new THREE.Vector3(eye.x, eye.y, eye.z);
  const targetVec = new THREE.Vector3(camera.target.x, camera.target.y, camera.target.z);
  const upVec = new THREE.Vector3(up.x, up.y, up.z);
  const rotationMatrix = new THREE.Matrix4().lookAt(eyeVec, targetVec, upVec);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotationMatrix).normalize();
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: { ...eye },
    rotation: { x: euler.x, y: euler.y, z: euler.z },
    scale: { x: 1, y: 1, z: 1 },
  };
};

const applyPreviewTransform = (
  camera: CameraState,
  current: CameraPreviewTransform,
  path: string,
  value: unknown,
): CameraState => {
  const next = { ...current, [path]: value } as CameraPreviewTransform;
  const position = next.position;

  if (path === 'position') {
    const forward = getCameraForward(camera);
    return {
      ...camera,
      target: {
        x: position.x + forward.x * camera.radius,
        y: position.y + forward.y * camera.radius,
        z: position.z + forward.z * camera.radius,
      },
    };
  }

  if (path === 'rotation') {
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(next.rotation.x, next.rotation.y, next.rotation.z, 'XYZ'),
    );
    const forwardVec = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion).normalize();
    const upVec = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion).normalize();
    const resolved = cameraStateFromWorldPose(
      position,
      { x: forwardVec.x, y: forwardVec.y, z: forwardVec.z },
      { x: upVec.x, y: upVec.y, z: upVec.z },
      camera.radius,
    );
    resolved.orthoScale = camera.orthoScale ?? 1;
    return resolved;
  }

  return camera;
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
 * - Through Camera binds the preset lens to a normal navigable viewport camera.
 * - Inspect Camera uses a second normal orbit viewport and displays the preset frustum.
 *
 * Both preview poses are editor state and are never serialized into the CameraPreset asset.
 * A Camera Preset owns lens/render configuration, while a Scene Camera entity owns Transform.
 */
export const CameraPresetEditor: React.FC<CameraPresetEditorProps> = ({ assetId }) => {
  const [, setRevision] = useState(0);
  const [gridOverride, setGridOverride] = useState<boolean | null>(null);
  const [previewMode, setPreviewMode] = useState<CameraPresetPreviewMode>('THROUGH_CAMERA');
  const [throughCamera, setThroughCamera] = useState<CameraState>(THROUGH_CAMERA_STATE);
  const [inspectCamera, setInspectCamera] = useState<CameraState>(INSPECT_CAMERA_STATE);
  const glResourcesRef = useRef<PreviewGlResources | null>(null);
  const asset = getCameraPreset(assetId);

  useEffect(() => eventBus.on('ASSET_UPDATED', () => {
    // The Camera Preset can reference a Viewport Profile asset, so profile edits
    // must refresh an already-open Camera editor too.
    setRevision(value => value + 1);
  }), []);

  const viewportProfileId = getAssetViewportProfileId(asset);
  const viewportProfile = resolveViewportProfile(viewportProfileId);
  const effectiveShowGrid = gridOverride ?? viewportProfile.overlays.grid;

  useEffect(() => {
    // Switching profiles returns to the new profile's authored grid preference.
    setGridOverride(null);
  }, [viewportProfileId]);

  const switchPreviewMode = (mode: CameraPresetPreviewMode) => {
    // Keep a separate transient pose for each preview. Switching modes must not
    // destroy the user's orbit/pan/zoom position in the other mode.
    setPreviewMode(mode);
  };

  const previewCamera = previewMode === 'THROUGH_CAMERA' ? throughCamera : inspectCamera;
  const setPreviewCamera = previewMode === 'THROUGH_CAMERA' ? setThroughCamera : setInspectCamera;
  const previewTransform = useMemo(() => cameraStateToPreviewTransform(throughCamera), [throughCamera]);

  const updatePreviewTransform = (path: string, value: unknown) => {
    setThroughCamera(current => applyPreviewTransform(current, cameraStateToPreviewTransform(current), path, value));
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

    // Through Camera means exactly that: render the world from the bound lens.
    // Do not draw lens guides/frustum geometry back into the camera's own image.
    if (previewMode !== 'INSPECT_CAMERA' || !viewportProfile.overlays.helpers) return;

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
  }, [assetId, previewMode, viewportProfile.overlays.helpers]);

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

  const updateEditorSetting = (path: string, value: unknown) => {
    if (path !== 'viewportProfileId') return;
    const current = getCameraPreset(assetId);
    if (!current) return;
    assetManager.updateAsset(assetId, {
      editor: {
        ...(current.editor ?? {}),
        viewportProfileId: String(value || '') || undefined,
      },
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
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 space-y-3">
        <InspectorComponentCard title="Transform" icon="Move" badge="Preview">
          <AutoInspector
            schemaId="CameraPreviewTransform"
            value={previewTransform}
            scope="viewport"
            onChange={updatePreviewTransform}
          />
          <div className="mt-2 text-[9px] text-text-secondary leading-relaxed">
            Editor-only preview pose. Scene Camera instances receive a real Transform component; this pose is never saved into the Camera Preset asset.
          </div>
        </InspectorComponentCard>

        <InspectorComponentCard title="Camera" icon="Camera">
          <AutoInspector
            schemaId="CameraSettings"
            value={asset.data}
            scope="asset"
            onChange={updateSetting}
          />
        </InspectorComponentCard>

        <InspectorComponentCard title="Editor Viewport" icon="Monitor" badge="Editor Only">
          <AutoInspector
            schemaId="CameraPresetEditorSettings"
            value={{ viewportProfileId: viewportProfileId ?? '' }}
            scope="asset"
            onChange={updateEditorSetting}
          />
        </InspectorComponentCard>
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
        navigationEnabled
        viewportProfile={viewportProfile}
        backgroundColor={previewMode === 'THROUGH_CAMERA' ? throughBackground : undefined}
        fitCamera={previewMode === 'INSPECT_CAMERA'
          ? { radius: 5.3, target: { x: 0, y: 0, z: -1.15 }, orthoScale: 1 }
          : { radius: 3, target: { x: 0, y: 0, z: -3 }, orthoScale: 1 }}
        showGrid={effectiveShowGrid}
        onToggleGrid={() => setGridOverride(value => !(value ?? viewportProfile.overlays.grid))}
        headerExtra={previewToolbar}
        stats={[
          { label: 'Preview', value: previewMode === 'THROUGH_CAMERA' ? 'Through' : 'Inspect', color: 'text-emerald-300' },
          { label: 'Viewport', value: viewportProfileId ? 'Profile' : 'Default', color: 'text-indigo-300' },
          { label: 'Projection', value: projectionStat, color: 'text-sky-300' },
          { label: 'Clip', value: `${asset.data.near} → ${asset.data.far}`, color: 'text-text-secondary' },
        ]}
        shortcutsLegend={previewMode === 'THROUGH_CAMERA'
          ? 'Alt+LMB Orbit • Alt+MMB Pan • Alt+RMB Zoom • Wheel Zoom • F Reset • preset lens, temporary pose'
          : 'Alt+LMB Orbit • Alt+MMB Pan • Alt+RMB Zoom • Wheel Zoom • F Focus'}
        onInitGl={handleInitGl}
        onCleanupGl={handleCleanupGl}
        onRender={handleRender}
      />
    </AssetEditorTemplate>
  );
};
