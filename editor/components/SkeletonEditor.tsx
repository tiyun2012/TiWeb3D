import React, { useEffect, useMemo, useRef, useState, useContext, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';

import { BoneData, SkeletalMeshAsset, SkeletonAsset, ToolType } from '@/types';
import { assetManager } from '@/engine/AssetManager';
import { AssetViewportEngine } from '@/editor/viewports/AssetViewportEngine';
import { GizmoSystem } from '@/engine/GizmoSystem';
import { Mat4Utils } from '@/engine/math';
import { buildMeshEdgeIndices, MESH_EDGE_COLORS } from '@/engine/MeshEdgeGeometry';
import {
  applyMeshSurfaceUniforms,
  DEFAULT_MESH_PREVIEW_LIGHT,
  MESH_SURFACE_RENDER_MODE,
} from '@/engine/renderers/MeshSurfaceContract';
import { MeshEdgeOverlay } from '@/editor/viewports/MeshEdgeOverlay';
import { EditorContext, SkeletonVizSettings, DEFAULT_SKELETON_VIZ } from '@/editor/state/EditorContext';

import { Icon } from './Icon';
import { SkeletonHierarchy } from './SkeletonHierarchy';
import { AssetViewport3D, AssetViewportRenderArgs, CameraState } from './AssetViewport3D';
import { AssetEditorTemplate } from './asset-editor/AssetEditorTemplate';
import { AssetViewportToolbarAction } from './asset-editor/assetViewportCapabilities';
import { JointInspector } from './inspector/JointInspector';
import { SkeletonAssetInspector } from './inspector/SkeletonAssetInspector';
import { SkeletonDisplayOptions } from './inspector/SkeletonDisplayOptions';
import {
  generateWireSphereLines,
  generateBoneOctahedronLines,
  generateAxisLines,
  getMatrixUnitAxes,
  getSkeletonJointRadius,
  transformLocalDirectionByAxes
} from '@/engine/renderers/DebugRenderer';

function distToSegment2D(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function cloneBoneData(bone: BoneData): BoneData {
  return {
    ...bone,
    bindPose: new Float32Array(bone.bindPose),
    inverseBindPose: new Float32Array(bone.inverseBindPose),
    visual: bone.visual
      ? {
          ...bone.visual,
          color: bone.visual.color ? { ...bone.visual.color } : undefined,
        }
      : undefined,
  };
}

function cloneBoneList(bones: readonly BoneData[]): BoneData[] {
  return bones.map(cloneBoneData);
}

export interface SkeletonEditorProps {
  assetId: string;
  editorHeaderExtra?: React.ReactNode;
}

export const SkeletonEditor: React.FC<SkeletonEditorProps> = ({ assetId, editorHeaderExtra }) => {
  const [refresh, setRefresh] = useState(0);
  const [tool, setTool] = useState<ToolType>('SELECT');
  const [selectedBoneIndex, setSelectedBoneIndex] = useState<number | null>(null);
  const selectedBoneIndexRef = useRef(selectedBoneIndex);
  selectedBoneIndexRef.current = selectedBoneIndex;
  useEffect(() => {
    selectedBoneIndexRef.current = selectedBoneIndex;
  }, [selectedBoneIndex]);

  const [isEditMode, setIsEditMode] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const editBonesRef = useRef<BoneData[] | null>(null);
  const editAssetIdRef = useRef<string | null>(null);

  // Unified Skeleton Visualization Options (synced with EditorContext or local)
  const editorCtx = useContext(EditorContext);
  const [localDisplayOptions, setLocalDisplayOptions] = useState<SkeletonVizSettings>(DEFAULT_SKELETON_VIZ);
  const displayOptions = editorCtx?.skeletonViz ?? localDisplayOptions;
  const setDisplayOptions = editorCtx?.setSkeletonViz ?? setLocalDisplayOptions;
  const displayOptionsRef = useRef(displayOptions);
  useEffect(() => {
    displayOptionsRef.current = displayOptions;
  }, [displayOptions]);

  const [showGrid, setShowGrid] = useState(true);
  const [showMesh, setShowMesh] = useState(true);
  const [showWireframeMesh, setShowWireframeMesh] = useState(false);

  // Hover state
  const mouseRef = useRef({ x: -100, y: -100 });
  const hoveredBoneIndexRef = useRef<number | null>(null);
  const hoverLabelRef = useRef<HTMLDivElement>(null);

  // Context menu
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    boneIndex: number | null;
  } | null>(null);

  // Resolved Asset
  const currentAsset = useMemo(() => {
    const a = assetManager.getAsset(assetId);
    if (!a) return null;
    if (a.type === 'SKELETON' || a.type === 'SKELETAL_MESH') {
      return a as SkeletonAsset | SkeletalMeshAsset;
    }
    return null;
  }, [assetId, refresh, isEditMode]);

  // Edit mode uses a private draft. The AssetManager remains the source of the
  // last confirmed pose until the user explicitly confirms the edit session.
  const editorAsset = useMemo(() => {
    if (!currentAsset) return null;
    if (!isEditMode || editAssetIdRef.current !== assetId || !editBonesRef.current) return currentAsset;
    return {
      ...currentAsset,
      skeleton: { ...currentAsset.skeleton, bones: editBonesRef.current },
    } as SkeletonAsset | SkeletalMeshAsset;
  }, [currentAsset, assetId, isEditMode, draftRevision]);

  // Associated Skeletal Mesh (if this skeleton is linked to a mesh)
  const associatedMesh = useMemo(() => {
    if (!currentAsset) return null;
    if (currentAsset.type === 'SKELETAL_MESH') return currentAsset as SkeletalMeshAsset;
    const all = assetManager.getAllAssets();
    const found = all.find(
      a =>
        a.type === 'SKELETAL_MESH' &&
        ((a as SkeletalMeshAsset).skeletonAssetId === assetId ||
          (a as SkeletalMeshAsset).skeleton === (currentAsset as SkeletonAsset).skeleton)
    ) as SkeletalMeshAsset | undefined;
    return found || null;
  }, [currentAsset, assetId]);

  // Engine + Gizmo
  const previewEngineRef = useRef<AssetViewportEngine | null>(null);
  const gizmoSystemRef = useRef<GizmoSystem | null>(null);
  const [previewEngine, setPreviewEngine] = useState<AssetViewportEngine | null>(null);
  const [gizmoSystem, setGizmoSystem] = useState<GizmoSystem | null>(null);
  const [transformRevision, setTransformRevision] = useState<number>(0);
  // Live gizmo edits stay local to the private edit draft. ASSET_UPDATED is
  // emitted only by explicit Confirm; mouse movement and mouse-up never persist.
  const skeletonAssetDirtyRef = useRef(false);
  const boneEntitiesRef = useRef<string[]>([]);
  // Snapshot the authored local bone direction when this editor session/rebuild starts.
  // Gizmo translation updates bindPose live, so reading bindPose during the drag would make
  // the visual base rotate with the child and reintroduce the twisting artifact.
  const boneVisualRestDirectionsRef = useRef<Array<[number, number, number]>>([]);

  // Camera Framing
  const fitCamera = useMemo(() => {
    if (!editorAsset || !editorAsset.skeleton?.bones?.length) {
      return { radius: 3.5, target: { x: 0, y: 1.0, z: 0 } };
    }

    if (associatedMesh?.geometry?.aabb) {
      const aabb = associatedMesh.geometry.aabb;
      const size = [aabb.max.x - aabb.min.x, aabb.max.y - aabb.min.y, aabb.max.z - aabb.min.z];
      const maxDim = Math.max(size[0], size[1], size[2]);
      const center = {
        x: (aabb.min.x + aabb.max.x) * 0.5,
        y: (aabb.min.y + aabb.max.y) * 0.5,
        z: (aabb.min.z + aabb.max.z) * 0.5,
      };
      return { radius: Math.max(maxDim * 1.6, 2.0), target: center };
    }

    const bones = editorAsset.skeleton.bones;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const b of bones) {
      if (!b.bindPose) continue;
      const x = b.bindPose[12] || 0;
      const y = b.bindPose[13] || 0;
      const z = b.bindPose[14] || 0;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }

    if (minX === Infinity) {
      return { radius: 3.5, target: { x: 0, y: 1.0, z: 0 } };
    }

    const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0.5);
    const center = {
      x: (minX + maxX) * 0.5,
      y: (minY + maxY) * 0.5,
      z: (minZ + maxZ) * 0.5,
    };
    return { radius: Math.max(maxDim * 2.2, 2.5), target: center };
  }, [editorAsset, associatedMesh]);

  useEffect(() => {
    // Draft edits never cross asset boundaries. Switching assets without confirming
    // discards the draft and therefore returns to the last confirmed pose.
    editBonesRef.current = null;
    editAssetIdRef.current = null;
    setIsEditMode(false);
    setEditDirty(false);
    setSelectedBoneIndex(null);
    setTool('SELECT');
  }, [assetId]);

  const [camera, setCamera] = useState<CameraState>({
    theta: 0.6,
    phi: 1.2,
    radius: fitCamera.radius,
    target: { ...fitCamera.target },
  });

  // Rebuild preview engine & bone entities when asset/edit-session structure changes.
  useEffect(() => {
    const savedAsset = assetManager.getAsset(assetId) as SkeletonAsset | SkeletalMeshAsset | undefined;
    if (!savedAsset || !savedAsset.skeleton?.bones) return;

    const bones = isEditMode && editAssetIdRef.current === assetId && editBonesRef.current
      ? editBonesRef.current
      : savedAsset.skeleton.bones;

    const onNotifyUI = () => {
      // Pose/View mode is intentionally read-only. Selection/UI notifications must
      // never write preview transforms back into the confirmed skeleton.
      if (!isEditMode || editAssetIdRef.current !== assetId || !editBonesRef.current) return;

      const engine = previewEngineRef.current;
      const ids = boneEntitiesRef.current;
      const draftBones = editBonesRef.current;
      if (!engine || !ids.length) return;

      let changed = false;

      draftBones.forEach((b: any, i: number) => {
        const id = ids[i];
        if (!id) return;
        const idx = engine.ecs.idToIndex.get(id);
        if (idx == null) return;

        const px = engine.ecs.store.posX[idx];
        const py = engine.ecs.store.posY[idx];
        const pz = engine.ecs.store.posZ[idx];
        const rx = engine.ecs.store.rotX[idx];
        const ry = engine.ecs.store.rotY[idx];
        const rz = engine.ecs.store.rotZ[idx];
        const sx = engine.ecs.store.scaleX[idx];
        const sy = engine.ecs.store.scaleY[idx];
        const sz = engine.ecs.store.scaleZ[idx];

        const p = new THREE.Vector3(px, py, pz);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
        const s = new THREE.Vector3(sx, sy, sz);
        const m = new THREE.Matrix4().compose(p, q, s);

        let localChanged = false;
        const arr = m.toArray();
        for (let j = 0; j < 16; j++) {
          if (Math.abs(b.bindPose[j] - arr[j]) > 0.0001) {
            b.bindPose[j] = arr[j];
            localChanged = true;
          }
        }

        if (localChanged) {
          changed = true;
          const worldMat = engine.sceneGraph.getWorldMatrix(id);
          if (worldMat) {
            const inv = new THREE.Matrix4().fromArray(worldMat).invert();
            inv.toArray(b.inverseBindPose);
          }
        }
      });

      if (changed) {
        // The draft is private to this SkeletonEditor session. Nothing is written
        // to AssetManager until the user explicitly confirms the edit.
        skeletonAssetDirtyRef.current = true;
        setEditDirty(true);
        setTransformRevision(r => r + 1);
      }
    };

    const engine = new AssetViewportEngine(onNotifyUI);
    engine.meshComponentMode = 'OBJECT';

    boneVisualRestDirectionsRef.current = bones.map((b: any) => [
      b.bindPose?.[12] ?? 0,
      b.bindPose?.[13] ?? 1,
      b.bindPose?.[14] ?? 0,
    ] as [number, number, number]);
    const ids = bones.map((b: any) => engine.ecs.createEntity(b.name || 'Joint'));
    boneEntitiesRef.current = ids;

    ids.forEach(id => engine.sceneGraph.registerEntity(id));

    bones.forEach((b: any, i: number) => {
      const id = ids[i];
      if (b.parentIndex >= 0 && ids[b.parentIndex]) {
        engine.sceneGraph.attach(id, ids[b.parentIndex]);
      }

      const idx = engine.ecs.idToIndex.get(id);
      if (idx != null && b.bindPose) {
        const m = new THREE.Matrix4().fromArray(b.bindPose);
        const p = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const s = new THREE.Vector3();
        m.decompose(p, q, s);

        const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
        engine.ecs.store.setPosition(idx, p.x, p.y, p.z);
        engine.ecs.store.setRotation(idx, euler.x, euler.y, euler.z);
        engine.ecs.store.setScale(idx, s.x, s.y, s.z);
      }
    });

    engine.syncTransforms(false);

    previewEngineRef.current = engine;
    const gs = new GizmoSystem(engine);
    gs.renderInSelectTool = false;
    gs.setTool(tool);
    gizmoSystemRef.current = gs;

    setPreviewEngine(engine);
    setGizmoSystem(gs);

    if (selectedBoneIndex !== null && ids[selectedBoneIndex]) {
      engine.selectionSystem.setSelected([ids[selectedBoneIndex]]);
    }

    return () => {
      previewEngineRef.current = null;
      gizmoSystemRef.current = null;
      setPreviewEngine(null);
      setGizmoSystem(null);
    };
  }, [assetId, refresh, isEditMode]);

  // Sync tool change
  useEffect(() => {
    gizmoSystemRef.current?.setTool(tool);
  }, [tool]);

  const handleSelectBone = useCallback((idx: number | null) => {
    setSelectedBoneIndex(idx);
    selectedBoneIndexRef.current = idx;
    const engine = previewEngineRef.current;
    const ids = boneEntitiesRef.current;
    if (engine && ids) {
      if (idx !== null && ids[idx]) {
        engine.selectionSystem.setSelected([ids[idx]]);
      } else {
        engine.selectionSystem.setSelected([]);
      }
      engine.syncTransforms(false);
      engine.notifyUI();
    }
  }, []);

  // Sync selection change from external sources (only if out of sync)
  useEffect(() => {
    const engine = previewEngineRef.current;
    const ids = boneEntitiesRef.current;
    if (engine && ids) {
      const curSelectedId = Array.from(engine.selectionSystem.selectedEntities)[0] ?? null;
      const targetId = selectedBoneIndex !== null && ids[selectedBoneIndex] ? ids[selectedBoneIndex] : null;
      if (curSelectedId !== targetId) {
        if (targetId) {
          engine.selectionSystem.setSelected([targetId]);
        } else {
          engine.selectionSystem.setSelected([]);
        }
        engine.syncTransforms(false);
        engine.notifyUI();
      }
    }
  }, [selectedBoneIndex]);

  // Buffers for WebGL lines and points
  const glResourcesRef = useRef<{
    boneVao: WebGLVertexArrayObject | null;
    boneVbo: WebGLBuffer | null;
    meshVao: WebGLVertexArrayObject | null;
    meshVbo: WebGLBuffer | null;
    meshNbo: WebGLBuffer | null;
    meshIbo: WebGLBuffer | null;
    meshEdgeOverlay: MeshEdgeOverlay;
  }>({
    boneVao: null,
    boneVbo: null,
    meshVao: null,
    meshVbo: null,
    meshNbo: null,
    meshIbo: null,
    meshEdgeOverlay: new MeshEdgeOverlay(),
  });

  const handleInitGl = (gl: WebGL2RenderingContext) => {
    const boneVao = gl.createVertexArray();
    const boneVbo = gl.createBuffer();
    gl.bindVertexArray(boneVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, boneVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Mesh buffers if geometry exists
    let meshVao: WebGLVertexArrayObject | null = null;
    let meshVbo: WebGLBuffer | null = null;
    let meshNbo: WebGLBuffer | null = null;
    let meshIbo: WebGLBuffer | null = null;

    if (associatedMesh?.geometry) {
      meshVao = gl.createVertexArray();
      meshVbo = gl.createBuffer();
      meshNbo = gl.createBuffer();
      meshIbo = gl.createBuffer();

      gl.bindVertexArray(meshVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, meshVbo);
      gl.bufferData(gl.ARRAY_BUFFER, associatedMesh.geometry.vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, meshNbo);
      gl.bufferData(gl.ARRAY_BUFFER, associatedMesh.geometry.normals, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIbo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, associatedMesh.geometry.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
    }

    const meshEdgeOverlay = new MeshEdgeOverlay();
    if (associatedMesh?.geometry && meshVbo) {
      meshEdgeOverlay.init(
        gl,
        meshVbo,
        buildMeshEdgeIndices(associatedMesh.geometry.indices, associatedMesh.topology?.faces),
        gl.STATIC_DRAW,
      );
    }

    glResourcesRef.current = { boneVao, boneVbo, meshVao, meshVbo, meshNbo, meshIbo, meshEdgeOverlay };
  };

  const handleCleanupGl = (gl: WebGL2RenderingContext) => {
    const res = glResourcesRef.current;
    if (res.boneVao) gl.deleteVertexArray(res.boneVao);
    if (res.boneVbo) gl.deleteBuffer(res.boneVbo);
    if (res.meshVao) gl.deleteVertexArray(res.meshVao);
    if (res.meshVbo) gl.deleteBuffer(res.meshVbo);
    if (res.meshNbo) gl.deleteBuffer(res.meshNbo);
    if (res.meshIbo) gl.deleteBuffer(res.meshIbo);
    res.meshEdgeOverlay.dispose(gl);
  };

  // Accurate, Depth-Aware Joint and Bone Screen Detection
  const findBoneAtScreen = useCallback(
    (screenX: number, screenY: number) => {
      const engine = previewEngineRef.current;
      const asset = editorAsset;
      const bones = asset?.skeleton?.bones;
      const ids = boneEntitiesRef.current;
      if (!engine || !bones || !bones.length || !ids.length) return null;

      const vp = engine.currentViewProj;
      const width = engine.currentWidth;
      const height = engine.currentHeight;
      if (!vp || width <= 0 || height <= 0) return null;

      // Project 3D world coordinate to 2D CSS screen coordinates
      const projectPoint = (x: number, y: number, z: number) => {
        const px = x * vp[0] + y * vp[4] + z * vp[8] + vp[12];
        const py = x * vp[1] + y * vp[5] + z * vp[9] + vp[13];
        const pw = x * vp[3] + y * vp[7] + z * vp[11] + vp[15];
        if (pw <= 0.001) return null; // Behind camera
        return {
          x: ((px / pw) * 0.5 + 0.5) * width,
          y: (-(py / pw) * 0.5 + 0.5) * height,
          depth: pw,
        };
      };

      const jointProjList: Array<{
        index: number;
        name: string;
        proj: { x: number; y: number; depth: number };
        dist: number;
      } | null> = new Array(bones.length).fill(null);

      const hitJoints: Array<{
        index: number;
        name: string;
        depth: number;
        dist: number;
        x: number;
        y: number;
      }> = [];

      const jointHitRadius = 22; // Direct click radius for joint spheres

      for (let i = 0; i < bones.length; i++) {
        const id = ids[i];
        if (!id) continue;
        const worldMat = engine.sceneGraph.getWorldMatrix(id);
        if (!worldMat) continue;

        const jx = worldMat[12];
        const jy = worldMat[13];
        const jz = worldMat[14];

        const proj = projectPoint(jx, jy, jz);
        if (!proj) continue;

        const dist = Math.hypot(proj.x - screenX, proj.y - screenY);
        const name = bones[i].name || `Joint_${i}`;
        jointProjList[i] = { index: i, name, proj, dist };

        if (dist <= jointHitRadius) {
          hitJoints.push({
            index: i,
            name,
            depth: proj.depth,
            dist,
            x: proj.x,
            y: proj.y,
          });
        }
      }

      // PRIORITY 1: Direct Joint Sphere Hit
      // If one or more joints are within the joint hit radius (22px),
      // the joint closest to the camera (smaller depth) wins.
      // If depths are within 0.05, the joint closest to the cursor center in screen space wins.
      if (hitJoints.length > 0) {
        hitJoints.sort((a, b) => {
          const depthDiff = a.depth - b.depth;
          if (Math.abs(depthDiff) > 0.05) {
            return depthDiff;
          }
          return a.dist - b.dist;
        });

        const best = hitJoints[0];
        return {
          index: best.index,
          name: best.name,
          isJoint: true,
          depth: best.depth,
          screenDist: best.dist,
          screenX: best.x,
          screenY: best.y,
        };
      }

      // PRIORITY 2: Connecting Bone Segment Hit
      // Evaluated ONLY when no joint sphere was hit directly.
      const boneHitRadius = 14;
      const hitBones: Array<{
        index: number;
        name: string;
        depth: number;
        dist: number;
        x: number;
        y: number;
      }> = [];

      for (let i = 0; i < bones.length; i++) {
        const b = bones[i];
        if (b.parentIndex >= 0 && b.parentIndex < bones.length) {
          const pItem = jointProjList[b.parentIndex];
          const cItem = jointProjList[i];
          if (pItem && cItem) {
            const px = pItem.proj.x;
            const py = pItem.proj.y;
            const cx = cItem.proj.x;
            const cy = cItem.proj.y;

            const dx = cx - px;
            const dy = cy - py;
            const lenSq = dx * dx + dy * dy;

            let dist = Infinity;
            let t = 0.5;

            if (lenSq < 1e-6) {
              dist = Math.hypot(screenX - px, screenY - py);
            } else {
              t = Math.max(0, Math.min(1, ((screenX - px) * dx + (screenY - py) * dy) / lenSq));
              const projX = px + t * dx;
              const projY = py + t * dy;
              dist = Math.hypot(screenX - projX, screenY - projY);
            }

            if (dist <= boneHitRadius) {
              // Clicking closer to child joint selects child; closer to parent selects parent
              const targetIndex = t >= 0.5 ? i : b.parentIndex;
              const targetBone = bones[targetIndex];
              const avgDepth = (1 - t) * pItem.proj.depth + t * cItem.proj.depth;

              hitBones.push({
                index: targetIndex,
                name: targetBone?.name || `Joint_${targetIndex}`,
                depth: avgDepth,
                dist,
                x: screenX,
                y: screenY,
              });
            }
          }
        }
      }

      if (hitBones.length > 0) {
        hitBones.sort((a, b) => {
          const depthDiff = a.depth - b.depth;
          if (Math.abs(depthDiff) > 0.05) {
            return depthDiff;
          }
          return a.dist - b.dist;
        });

        const best = hitBones[0];
        return {
          index: best.index,
          name: best.name,
          isJoint: false,
          depth: best.depth,
          screenDist: best.dist,
          screenX: best.x,
          screenY: best.y,
        };
      }

      return null;
    },
    [editorAsset]
  );

  // Synchronous hover state & label update with zero latency
  const updateHoverFeedback = useCallback(
    (screenX: number, screenY: number) => {
      const hit = findBoneAtScreen(screenX, screenY);
      hoveredBoneIndexRef.current = hit ? hit.index : null;

      if (hoverLabelRef.current) {
        if (hit) {
          hoverLabelRef.current.style.display = 'block';
          hoverLabelRef.current.style.left = `${screenX + 14}px`;
          hoverLabelRef.current.style.top = `${screenY + 14}px`;
          hoverLabelRef.current.textContent = hit.name;
        } else {
          hoverLabelRef.current.style.display = 'none';
        }
      }
      return hit;
    },
    [findBoneAtScreen]
  );

  // Render Skeleton Pass
  const handleRender = (args: AssetViewportRenderArgs) => {
    const { gl, vp, lineProgram, meshProgram, eye } = args;
    const engine = previewEngineRef.current;
    const asset = editorAsset;
    const bones = asset?.skeleton?.bones || [];
    const ids = boneEntitiesRef.current;
    const curSelected = selectedBoneIndexRef.current;
    const mouse = mouseRef.current;
    const res = glResourcesRef.current;

    // 1. Draw Associated Mesh (if enabled). Both shaded and wireframe views use
    // the same authored polygon-edge source as StaticMeshEditor. Wireframe mode
    // first writes mesh depth with color disabled, then draws only visible edges.
    if (showMesh && associatedMesh?.geometry && res.meshVao && res.meshIbo) {
      const model = Mat4Utils.create();
      const mvp = Mat4Utils.create();
      Mat4Utils.multiply(vp, model, mvp);
      const idxType =
        associatedMesh.geometry.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;

      gl.useProgram(meshProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, 'u_mvp'), false, mvp);
      gl.uniformMatrix4fv(gl.getUniformLocation(meshProgram, 'u_model'), false, model);
      applyMeshSurfaceUniforms(gl, meshProgram, {
        cameraPosition: eye,
        renderMode: MESH_SURFACE_RENDER_MODE.LIT,
        light: DEFAULT_MESH_PREVIEW_LIGHT,
        material: {
          albedo: [0.55, 0.6, 0.65],
          metallic: 0.0,
          smoothness: 0.5,
        },
      });
      gl.bindVertexArray(res.meshVao);

      if (showWireframeMesh) {
        // Hidden-line depth prepass. This prevents back-side polygon edges from
        // showing through the mesh while keeping the wireframe itself reusable.
        gl.colorMask(false, false, false, false);
        gl.depthMask(true);
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1, 1);
        gl.drawElements(gl.TRIANGLES, associatedMesh.geometry.indices.length, idxType, 0);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.colorMask(true, true, true, true);
        res.meshEdgeOverlay.draw(gl, lineProgram, mvp, { ...MESH_EDGE_COLORS.wireframe, a: 0.95 });
      } else {
        // Shaded ghost mesh
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawElements(gl.TRIANGLES, associatedMesh.geometry.indices.length, idxType, 0);
        gl.disable(gl.BLEND);
      }
    }

    if (!engine || !bones.length || !res.boneVao || !res.boneVbo) return;

    // Sync hover state during camera movement/orbiting
    const curHoveredHit = findBoneAtScreen(mouse.x, mouse.y);
    const curHovered = curHoveredHit ? curHoveredHit.index : null;
    hoveredBoneIndexRef.current = curHovered;
    if (hoverLabelRef.current) {
      if (curHoveredHit) {
        hoverLabelRef.current.style.display = 'block';
        hoverLabelRef.current.style.left = `${mouse.x + 14}px`;
        hoverLabelRef.current.style.top = `${mouse.y + 14}px`;
        hoverLabelRef.current.textContent = curHoveredHit.name;
      } else {
        hoverLabelRef.current.style.display = 'none';
      }
    }

    // Collect 3D joint world positions
    const jointWorldPositions: Array<{ x: number; y: number; z: number; index: number; isRoot: boolean; name: string }> = [];

    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      const id = ids[i];
      if (!id) continue;
      const worldMat = engine.sceneGraph.getWorldMatrix(id);
      if (!worldMat) continue;

      jointWorldPositions.push({
        x: worldMat[12],
        y: worldMat[13],
        z: worldMat[14],
        index: i,
        isRoot: b.parentIndex === -1,
        name: b.name || `Joint_${i}`,
      });
    }

    // 2. Generate 3D Bone Octahedrons
    const boneLines: number[] = [];
    const hoveredBoneLines: number[] = [];
    const selectedBoneLines: number[] = [];
    if (displayOptions.enabled && displayOptions.drawBones) {
      for (let i = 0; i < bones.length; i++) {
        const b = bones[i];
        if (b.parentIndex >= 0 && b.parentIndex < ids.length) {
          const pId = ids[b.parentIndex];
          const cId = ids[i];
          const pMat = engine.sceneGraph.getWorldMatrix(pId);
          const cMat = engine.sceneGraph.getWorldMatrix(cId);
          if (pMat && cMat) {
            const isBoneSelected = b.parentIndex === curSelected;
            const isBoneHovered = curHovered !== null && (b.parentIndex === curHovered || i === curHovered);
            const targetLines = isBoneSelected
              ? selectedBoneLines
              : isBoneHovered
              ? hoveredBoneLines
              : boneLines;
            const parentBone = bones[b.parentIndex];
            const parentAxes = getMatrixUnitAxes(pMat);
            const liveDirection: [number, number, number] = [
              cMat[12] - pMat[12],
              cMat[13] - pMat[13],
              cMat[14] - pMat[14],
            ];
            const restDirection = transformLocalDirectionByAxes(
              boneVisualRestDirectionsRef.current[i],
              parentAxes,
              liveDirection
            );
            const parentIsRoot = parentBone?.parentIndex === -1;
            const parentRadius = getSkeletonJointRadius(
              parentIsRoot,
              displayOptions.jointRadius,
              displayOptions.rootScale,
              'normal'
            );
            const childRadius = getSkeletonJointRadius(
              b.parentIndex === -1,
              displayOptions.jointRadius,
              displayOptions.rootScale,
              'normal'
            );

            generateBoneOctahedronLines(
              [pMat[12], pMat[13], pMat[14]],
              [cMat[12], cMat[13], cMat[14]],
              targetLines,
              {
                parentRadius,
                childRadius,
                parentXAxis: parentAxes.x,
                parentYAxis: parentAxes.y,
                parentZAxis: parentAxes.z,
                restDirection,
              }
            );
          }
        }
      }
    }

    gl.useProgram(lineProgram);
    gl.uniformMatrix4fv(gl.getUniformLocation(lineProgram, 'u_mvp'), false, vp);
    gl.uniform1f(gl.getUniformLocation(lineProgram, 'u_pointSize'), 0.0);
    gl.uniform1i(gl.getUniformLocation(lineProgram, 'u_isPoint'), 0);

    // Draw Bone Octahedron lines (Normal)
    if (boneLines.length > 0) {
      gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.82, 0.88, 0.95, 0.95);
      gl.bindVertexArray(res.boneVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.boneVbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(boneLines), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.LINES, 0, boneLines.length / 3);
    }

    // Draw Bone Octahedron lines (Hovered - clear cyan highlight)
    if (hoveredBoneLines.length > 0) {
      gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.22, 0.78, 0.98, 1.0);
      gl.bindVertexArray(res.boneVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.boneVbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(hoveredBoneLines), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.LINES, 0, hoveredBoneLines.length / 3);
    }

    // Draw Bone Octahedron lines (Selected - vibrant amber/gold highlight)
    if (selectedBoneLines.length > 0) {
      gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.98, 0.65, 0.12, 1.0);
      gl.bindVertexArray(res.boneVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.boneVbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(selectedBoneLines), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.LINES, 0, selectedBoneLines.length / 3);
    }

    // 3. Draw 3D Joint Spheres
    gl.clear(gl.DEPTH_BUFFER_BIT);

    if (displayOptions.enabled && displayOptions.drawJoints) {
      for (const j of jointWorldPositions) {
        const sphereLines: number[] = [];
        const isSelected = j.index === curSelected;
        const isHovered = curHovered !== null && j.index === curHovered;
        const radius = getSkeletonJointRadius(
          j.isRoot,
          displayOptions.jointRadius,
          displayOptions.rootScale,
          isSelected ? 'selected' : isHovered ? 'hovered' : 'normal'
        );

        const id = ids[j.index];
        const worldMat = id ? engine.sceneGraph.getWorldMatrix(id) : null;
        let rx: [number, number, number] = [1, 0, 0];
        let ry: [number, number, number] = [0, 1, 0];
        let rz: [number, number, number] = [0, 0, 1];
        if (worldMat) {
          const axes = getMatrixUnitAxes(worldMat);
          rx = axes.x;
          ry = axes.y;
          rz = axes.z;
        }

        generateWireSphereLines([j.x, j.y, j.z], radius, sphereLines, 12, rx, ry, rz);

        if (isSelected) {
          // Accent Amber / Gold for selected joint
          gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.98, 0.65, 0.12, 1.0);
        } else if (isHovered) {
          // Vibrant Cyan highlight for hovered joint
          gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.22, 0.78, 0.98, 1.0);
        } else if (j.isRoot) {
          // Emerald Green for root joint
          gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.15, 0.85, 0.5, 1.0);
        } else {
          // Clean Sky Blue for standard joints
          gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.45, 0.75, 0.98, 0.9);
        }

        gl.bindVertexArray(res.boneVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, res.boneVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(sphereLines), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.LINES, 0, sphereLines.length / 3);
      }
    }

    // 4. Draw Joint Coordinate Axes (RGB)
    if (displayOptions.enabled && displayOptions.drawAxes) {
      const xLines: number[] = [];
      const yLines: number[] = [];
      const zLines: number[] = [];

      for (const j of jointWorldPositions) {
        const id = ids[j.index];
        if (!id) continue;
        const worldMat = engine.sceneGraph.getWorldMatrix(id);
        if (!worldMat) continue;

        const isSelected = j.index === curSelected;
        const radiusScale = displayOptions.jointRadius / 10;
        const rootScaleFactor = j.isRoot ? displayOptions.rootScale : 1.0;
        const axisScale = (isSelected ? 0.22 : 0.16) * radiusScale * rootScaleFactor;

        const lenX = Math.hypot(worldMat[0], worldMat[1], worldMat[2]) || 1;
        const lenY = Math.hypot(worldMat[4], worldMat[5], worldMat[6]) || 1;
        const lenZ = Math.hypot(worldMat[8], worldMat[9], worldMat[10]) || 1;

        const rx: [number, number, number] = [worldMat[0] / lenX, worldMat[1] / lenX, worldMat[2] / lenX];
        const ry: [number, number, number] = [worldMat[4] / lenY, worldMat[5] / lenY, worldMat[6] / lenY];
        const rz: [number, number, number] = [worldMat[8] / lenZ, worldMat[9] / lenZ, worldMat[10] / lenZ];

        generateAxisLines([j.x, j.y, j.z], rx, ry, rz, axisScale, xLines, yLines, zLines);
      }

      if (xLines.length > 0) {
        gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.95, 0.22, 0.22, 1.0);
        gl.bindVertexArray(res.boneVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, res.boneVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(xLines), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.LINES, 0, xLines.length / 3);
      }

      if (yLines.length > 0) {
        gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.22, 0.88, 0.35, 1.0);
        gl.bindVertexArray(res.boneVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, res.boneVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(yLines), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.LINES, 0, yLines.length / 3);
      }

      if (zLines.length > 0) {
        gl.uniform4f(gl.getUniformLocation(lineProgram, 'u_color'), 0.22, 0.55, 0.98, 1.0);
        gl.bindVertexArray(res.boneVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, res.boneVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(zLines), gl.DYNAMIC_DRAW);
        gl.drawArrays(gl.LINES, 0, zLines.length / 3);
      }
    }

    gl.bindVertexArray(null);
  };

  const markDraftChanged = useCallback((bones?: BoneData[], structural = false) => {
    if (!isEditMode) return;
    if (bones) editBonesRef.current = bones;
    skeletonAssetDirtyRef.current = true;
    setEditDirty(true);
    setDraftRevision(r => r + 1);
    if (structural) setRefresh(r => r + 1);
  }, [isEditMode]);

  const beginSkeletonEdit = useCallback(() => {
    if (!currentAsset?.skeleton?.bones) return;
    editBonesRef.current = cloneBoneList(currentAsset.skeleton.bones);
    editAssetIdRef.current = assetId;
    skeletonAssetDirtyRef.current = false;
    setEditDirty(false);
    setTool('SELECT');
    setIsEditMode(true);
    setDraftRevision(r => r + 1);
    setRefresh(r => r + 1);
  }, [currentAsset, assetId]);

  const resetSkeletonDraft = useCallback(() => {
    if (!isEditMode || !currentAsset?.skeleton?.bones) return;
    editBonesRef.current = cloneBoneList(currentAsset.skeleton.bones);
    editAssetIdRef.current = assetId;
    skeletonAssetDirtyRef.current = false;
    setEditDirty(false);
    setTool('SELECT');
    setSelectedBoneIndex(prev => {
      const max = currentAsset.skeleton.bones.length - 1;
      return prev !== null && prev <= max ? prev : null;
    });
    setDraftRevision(r => r + 1);
    setRefresh(r => r + 1);
  }, [isEditMode, currentAsset, assetId]);

  const cancelSkeletonEdit = useCallback(() => {
    // The confirmed AssetManager skeleton was never mutated, so cancellation is
    // simply discarding the draft and rebuilding from the saved pose.
    editBonesRef.current = null;
    editAssetIdRef.current = null;
    skeletonAssetDirtyRef.current = false;
    setEditDirty(false);
    setTool('SELECT');
    setIsEditMode(false);
    setDraftRevision(r => r + 1);
    setRefresh(r => r + 1);
  }, []);

  const confirmSkeletonEdit = useCallback(() => {
    if (!isEditMode || !currentAsset || !editBonesRef.current) return;

    if (editDirty || skeletonAssetDirtyRef.current) {
      const committedBones = cloneBoneList(editBonesRef.current);
      assetManager.updateAsset(currentAsset.id, {
        skeleton: { ...currentAsset.skeleton, bones: committedBones },
      });
    }

    editBonesRef.current = null;
    editAssetIdRef.current = null;
    skeletonAssetDirtyRef.current = false;
    setEditDirty(false);
    setTool('SELECT');
    setIsEditMode(false);
    setDraftRevision(r => r + 1);
    setRefresh(r => r + 1);
  }, [isEditMode, editDirty, currentAsset]);

  // Viewport Mouse Events
  const handleMouseDown = (
    e: React.MouseEvent,
    coords: { x: number; y: number; width: number; height: number }
  ) => {
    // Close context menu if open
    if (contextMenu) setContextMenu(null);

    const engine = previewEngineRef.current;
    if (!engine) return;

    if (e.button === 0 && !e.altKey) {
      // Synchronously find the bone at the exact click position (zero-latency, depth-aware)
      const hit = findBoneAtScreen(coords.x, coords.y);
      if (hit) {
        handleSelectBone(hit.index);
      } else {
        handleSelectBone(null);
      }
    }
  };

  const handleMouseMove = (
    _e: MouseEvent,
    coords: { x: number; y: number; width: number; height: number }
  ) => {
    mouseRef.current.x = coords.x;
    mouseRef.current.y = coords.y;

    // Instant hover detection & tooltip update with zero latency
    updateHoverFeedback(coords.x, coords.y);
  };

  const handleMouseUp = (
    _e: MouseEvent,
    _coords: { x: number; y: number; width: number; height: number }
  ) => {
    // Gizmo mouse-up ends the local draft transform. The draft remains private
    // until Confirm is pressed; leaving edit mode through Cancel discards it.
  };

  const handleContextMenu = (
    e: React.MouseEvent,
    coords: { x: number; y: number; clientX: number; clientY: number }
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // Synchronously check bone under cursor at click time
    const hit = findBoneAtScreen(coords.x, coords.y);
    const targetBoneIndex = hit ? hit.index : selectedBoneIndex;
    if (hit) {
      handleSelectBone(hit.index);
    }

    setContextMenu({
      x: coords.clientX,
      y: coords.clientY,
      boneIndex: targetBoneIndex,
    });
  };

  // Bone Hierarchy Operations
  const handleAddJoint = (parentIndex: number) => {
    if (!isEditMode || !editorAsset) return;
    const bones = [...(editorAsset.skeleton?.bones || [])];

    const identityMatrix = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);

    if (parentIndex >= 0) {
      identityMatrix[13] = 1.0; // Place 1 unit above parent
    }

    const newIndex = bones.length;
    const newBone: BoneData = {
      name: `Joint_${newIndex}`,
      parentIndex,
      bindPose: identityMatrix,
      inverseBindPose: new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, parentIndex >= 0 ? -1.0 : 0, 0, 1,
      ]),
      visual: {
        color: { x: 0, y: 1, z: 0 },
        size: 1.0,
      },
    };

    bones.push(newBone);
    markDraftChanged(bones, true);
    handleSelectBone(newIndex);
  };

  const handleDeleteJoint = (boneIndex: number) => {
    if (!isEditMode || !editorAsset) return;
    const bones = editorAsset.skeleton?.bones;
    if (!bones || bones.length <= 1) return;

    const parentIdx = bones[boneIndex].parentIndex;
    const newBones = bones.filter((_: any, idx: number) => idx !== boneIndex);

    newBones.forEach((b: any) => {
      if (b.parentIndex === boneIndex) {
        b.parentIndex = parentIdx;
      } else if (b.parentIndex > boneIndex) {
        b.parentIndex -= 1;
      }
    });

    markDraftChanged(newBones, true);
    if (selectedBoneIndex === boneIndex) {
      handleSelectBone(null);
    } else if (selectedBoneIndex !== null && selectedBoneIndex > boneIndex) {
      handleSelectBone(selectedBoneIndex - 1);
    }
  };

  const handleFocusJoint = (index: number) => {
    const engine = previewEngineRef.current;
    const id = boneEntitiesRef.current[index];
    if (!engine || !id) return;
    const worldMat = engine.sceneGraph.getWorldMatrix(id);
    if (worldMat) {
      setCamera(c => ({
        ...c,
        target: { x: worldMat[12], y: worldMat[13], z: worldMat[14] },
      }));
    }
  };

  // Close context menu on any outside click
  useEffect(() => {
    const hide = () => setContextMenu(null);
    window.addEventListener('click', hide);
    return () => window.removeEventListener('click', hide);
  }, []);

  if (!editorAsset) {
    return (
      <div className="flex items-center justify-center h-full bg-[#151515] text-text-secondary text-xs">
        <div className="flex flex-col items-center gap-2">
          <Icon name="AlertCircle" size={24} className="text-accent" />
          <span>Skeleton asset could not be loaded.</span>
        </div>
      </div>
    );
  }

  const bones = editorAsset.skeleton?.bones || [];
  const selectedBone = selectedBoneIndex !== null ? bones[selectedBoneIndex] : null;
  const skeletonToolbarActions: AssetViewportToolbarAction[] = associatedMesh
    ? [
        {
          id: 'skeleton.meshOverlay',
          group: 'skeleton-display',
          label: 'Toggle Mesh Overlay',
          icon: 'Box',
          active: showMesh,
          onTrigger: () => setShowMesh(v => !v),
        },
        {
          id: 'skeleton.wireframeOverlay',
          group: 'skeleton-display',
          label: 'Toggle Wireframe Mesh',
          icon: 'Grid',
          active: showWireframeMesh,
          className: showWireframeMesh ? 'text-cyan-400' : undefined,
          onTrigger: () => setShowWireframeMesh(v => !v),
        },
      ]
    : [];

  const skeletonInspector = (
    <div className="h-full flex flex-col bg-[#181818] min-h-0">
      <div className="h-8 px-2.5 border-b border-white/10 bg-black/15 flex items-center gap-2 shrink-0">
        <Icon name="SlidersHorizontal" size={12} className="text-accent" />
        <span className="text-[10px] uppercase tracking-wider font-semibold text-text-secondary">
          {selectedBoneIndex !== null ? 'Joint Inspector' : 'Skeleton Inspector'}
        </span>
      </div>
      <div className="p-3 space-y-3 overflow-y-auto custom-scrollbar">
        {selectedBoneIndex !== null ? (
          <>
            <JointInspector
              asset={editorAsset}
              jointIndex={selectedBoneIndex}
              engine={previewEngine}
              boneEntities={boneEntitiesRef.current}
              revision={transformRevision}
              editable={isEditMode}
              onSkeletonChange={draftBones => markDraftChanged(draftBones, false)}
              onUpdate={() => setTransformRevision(r => r + 1)}
              onFocus={() => handleFocusJoint(selectedBoneIndex)}
              onAddChild={isEditMode ? () => handleAddJoint(selectedBoneIndex) : undefined}
              onDelete={isEditMode ? () => handleDeleteJoint(selectedBoneIndex) : undefined}
            />
            <SkeletonDisplayOptions
              options={displayOptions}
              onChange={setDisplayOptions}
              showMeshOverlay={!!associatedMesh}
              meshOverlayActive={showMesh}
              onToggleMeshOverlay={() => setShowMesh(v => !v)}
              showWireframe={!!associatedMesh}
              wireframeActive={showWireframeMesh}
              onToggleWireframe={() => setShowWireframeMesh(v => !v)}
            />
          </>
        ) : (
          <SkeletonAssetInspector
            asset={editorAsset}
            displayOptions={displayOptions}
            onDisplayOptionsChange={setDisplayOptions}
            associatedMeshName={associatedMesh?.name}
            onAddRootJoint={isEditMode ? () => handleAddJoint(-1) : undefined}
            showMeshOverlay={!!associatedMesh}
            meshOverlayActive={showMesh}
            onToggleMeshOverlay={() => setShowMesh(v => !v)}
            showWireframe={!!associatedMesh}
            wireframeActive={showWireframeMesh}
            onToggleWireframe={() => setShowWireframeMesh(v => !v)}
          />
        )}
      </div>
    </div>
  );

  return (
    <AssetEditorTemplate
      assetType={editorAsset.type}
      assetName={editorAsset.name}
      headerExtra={
        <div className="flex items-center gap-1.5">
          {editorHeaderExtra}
          {!isEditMode ? (
            <>
              <span className="h-6 px-2 rounded flex items-center gap-1.5 border border-white/10 bg-black/20 text-[9px] uppercase font-semibold tracking-wider text-text-secondary">
                <Icon name="Lock" size={10} />
                Saved Pose
              </span>
              <button
                type="button"
                onClick={beginSkeletonEdit}
                className="h-6 px-2.5 rounded flex items-center gap-1.5 border border-accent/40 bg-accent/15 text-accent hover:bg-accent/25 transition-colors text-[9px] uppercase font-semibold tracking-wider"
                title="Create a private skeleton draft and enter edit mode"
                aria-label="Edit skeleton"
              >
                <Icon name="Pencil" size={10} />
                Edit Skeleton
              </button>
            </>
          ) : (
            <>
              <span className={`h-6 px-2 rounded flex items-center gap-1.5 border text-[9px] uppercase font-semibold tracking-wider ${
                editDirty
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              }`}>
                <Icon name="Pencil" size={10} />
                {editDirty ? 'Editing • Unsaved' : 'Editing'}
              </span>
              <button
                type="button"
                onClick={resetSkeletonDraft}
                className="h-6 px-2 rounded flex items-center gap-1.5 border border-white/10 bg-black/20 text-text-secondary hover:text-white hover:bg-white/5 transition-colors text-[9px] uppercase font-semibold tracking-wider"
                title="Reset the edit draft to the last confirmed pose"
                aria-label="Reset skeleton draft"
              >
                <Icon name="Undo2" size={10} />
                Reset
              </button>
              <button
                type="button"
                onClick={cancelSkeletonEdit}
                className="h-6 px-2 rounded flex items-center gap-1.5 border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors text-[9px] uppercase font-semibold tracking-wider"
                title="Discard the draft and return to the last confirmed pose"
                aria-label="Cancel skeleton edit"
              >
                <Icon name="X" size={10} />
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSkeletonEdit}
                className="h-6 px-2.5 rounded flex items-center gap-1.5 border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 transition-colors text-[9px] uppercase font-semibold tracking-wider"
                title="Confirm the draft as the new saved skeleton pose"
                aria-label="Confirm skeleton edit"
              >
                <Icon name="Check" size={10} />
                Confirm
              </button>
            </>
          )}
        </div>
      }
      hierarchy={
        <SkeletonHierarchy
          asset={editorAsset as SkeletonAsset}
          onUpdate={() => setDraftRevision(r => r + 1)}
          editable={isEditMode}
          onSkeletonChange={(draftBones, options) => markDraftChanged(draftBones, !!options?.structural)}
          selectedBoneIndex={selectedBoneIndex}
          onSelectBone={handleSelectBone}
        />
      }
      inspector={skeletonInspector}
      hierarchyWidth={256}
      inspectorWidth={320}
    >
        <AssetViewport3D
          assetType={editorAsset.type}
          tool={tool}
          setTool={nextTool => setTool(isEditMode ? nextTool : 'SELECT')}
          allowedTools={isEditMode ? ['SELECT', 'MOVE', 'ROTATE', 'SCALE'] : ['SELECT']}
          camera={camera}
          onCameraChange={setCamera}
          fitCamera={fitCamera}
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid(v => !v)}
          engine={previewEngine}
          gizmoSystem={isEditMode ? gizmoSystem : null}
          stats={[
            { label: 'Mode', value: isEditMode ? 'EDIT' : 'POSE', color: isEditMode ? 'text-amber-300' : 'text-emerald-400' },
            { label: 'Bones', value: bones.length, color: 'text-accent' },
            { label: 'Mesh', value: associatedMesh ? 'Linked' : 'None', color: associatedMesh ? 'text-emerald-400' : 'text-text-secondary' },
          ]}
          selectionBadge={{
            text: selectedBone ? selectedBone.name : 'No Joint Selected',
            active: selectedBone !== null,
          }}
          toolbarActions={skeletonToolbarActions}
          shortcutsLegend={isEditMode ? "W/E/R Transform • Alt+Mouse Navigate • Confirm or Cancel to leave edit" : "Pose locked • Alt+Mouse Navigate • Click Edit Skeleton to modify"}
          onInitGl={handleInitGl}
          onCleanupGl={handleCleanupGl}
          onRender={handleRender}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onContextMenu={handleContextMenu}
          overlayChildren={
            <>
              {/* Joint Hover Badge */}
              <div
                ref={hoverLabelRef}
                className="absolute pointer-events-none z-50 bg-[#141416]/95 text-accent font-semibold text-[11px] px-2.5 py-1 rounded shadow-2xl border border-accent/40 backdrop-blur whitespace-nowrap transition-transform"
                style={{ display: 'none' }}
              />

              {/* Viewport Context Menu */}
              {contextMenu &&
                createPortal(
                  <div
                    className="fixed z-[99999] bg-[#1c1c1e] border border-white/10 shadow-2xl rounded py-1 min-w-[160px] text-xs text-text-primary backdrop-blur-md"
                    style={{
                      left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 180)),
                      top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 170)),
                    }}
                    onClick={e => e.stopPropagation()}
                  >
                    {contextMenu.boneIndex !== null ? (
                      <>
                        <div className="px-3 py-1 text-[10px] uppercase font-bold text-accent border-b border-white/5 mb-0.5 truncate flex items-center gap-1.5">
                          <Icon name="Bone" size={10} />
                          <span>{bones[contextMenu.boneIndex]?.name || 'Joint'}</span>
                        </div>
                        {isEditMode && (
                          <div
                            className="px-3 py-1.5 hover:bg-accent hover:text-white cursor-pointer flex items-center gap-2"
                            onClick={() => {
                              const bIdx = contextMenu.boneIndex!;
                              setContextMenu(null);
                              handleAddJoint(bIdx);
                            }}
                          >
                            <Icon name="Plus" size={12} />
                            <span>Add Child Joint</span>
                          </div>
                        )}
                        <div
                          className="px-3 py-1.5 hover:bg-white/10 cursor-pointer flex items-center gap-2"
                          onClick={() => {
                            const bIdx = contextMenu.boneIndex!;
                            setContextMenu(null);
                            handleFocusJoint(bIdx);
                          }}
                        >
                          <Icon name="Crosshair" size={12} />
                          <span>Focus Joint</span>
                        </div>
                        {isEditMode && bones.length > 1 && (
                          <div
                            className="px-3 py-1.5 hover:bg-red-500/20 hover:text-red-400 cursor-pointer flex items-center gap-2 text-red-400"
                            onClick={() => {
                              const bIdx = contextMenu.boneIndex!;
                              setContextMenu(null);
                              handleDeleteJoint(bIdx);
                            }}
                          >
                            <Icon name="Trash2" size={12} />
                            <span>Delete Joint</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {isEditMode && (
                          <div
                            className="px-3 py-1.5 hover:bg-accent hover:text-white cursor-pointer flex items-center gap-2"
                            onClick={() => {
                              setContextMenu(null);
                              handleAddJoint(-1);
                            }}
                          >
                            <Icon name="Plus" size={12} />
                            <span>Add Root Joint</span>
                          </div>
                        )}
                        <div
                          className="px-3 py-1.5 hover:bg-white/10 cursor-pointer flex items-center gap-2"
                          onClick={() => {
                            setContextMenu(null);
                            setCamera(c => ({
                              ...c,
                              radius: fitCamera.radius,
                              target: { ...fitCamera.target },
                            }));
                          }}
                        >
                          <Icon name="Home" size={12} />
                          <span>Reset Camera</span>
                        </div>
                      </>
                    )}
                  </div>,
                  document.body
                )}
            </>
          }
        />
    </AssetEditorTemplate>
  );
};
