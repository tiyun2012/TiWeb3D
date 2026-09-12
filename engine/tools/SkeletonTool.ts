
import { engineInstance } from '../engine';
import { assetManager } from '../AssetManager';
import { SkeletonAsset, SkeletalMeshAsset } from '@/types';
import { DebugRenderer, getMatrixUnitAxes, getSkeletonJointRadius, SkeletonVisualAxes, transformLocalDirectionByAxes } from '../renderers/DebugRenderer';
import * as THREE from 'three';

export interface SkeletonToolOptions {
    enabled: boolean;
    drawJoints: boolean;
    drawBones: boolean;
    drawAxes: boolean; 

    /** Joint size in screen pixels or scale. */
    jointRadius: number;

    /** Multiplier applied to the root joint size. */
    rootScale: number;

    /** Default bone line color (used when a bone has no visual.color). */
    boneColor: { r: number; g: number; b: number };

    /** Default root joint color (used when root has no visual.color). */
    rootColor: { r: number; g: number; b: number };

    /** Default standard joint color. */
    jointColor?: { r: number; g: number; b: number };

    /** Debug point outline thickness (0..1). */
    border: number;
}

const DEFAULT_OPTIONS: SkeletonToolOptions = {
    enabled: true,
    drawJoints: true,
    drawBones: true,
    drawAxes: false, // Default off
    jointRadius: 10,
    rootScale: 1.6,
    boneColor: { r: 0.82, g: 0.88, b: 0.95 }, // Soft off-white, matching SkeletonEditor
    rootColor: { r: 0.15, g: 0.85, b: 0.5 }, // Emerald green, matching SkeletonEditor
    jointColor: { r: 0.45, g: 0.75, b: 0.98 }, // Sky-blue, matching SkeletonEditor
    border: 0.2
};

export class SkeletonTool {
    private options: SkeletonToolOptions = { ...DEFAULT_OPTIONS };
    // Visual rest directions are intentionally cached separately from bindPose. SkeletonEditor
    // writes bindPose during live translation; using it directly would rotate/twist the bone base
    // as the child moves. The cache is rebuilt only when the asset bone count changes.
    private visualRestDirections = new Map<string, Array<[number, number, number]>>();

    private getVisualRestDirections(assetId: string, bones: any[]): Array<[number, number, number]> {
        const cached = this.visualRestDirections.get(assetId);
        if (cached && cached.length === bones.length) return cached;
        const next = bones.map((bone) => [
            bone.bindPose?.[12] ?? 0,
            bone.bindPose?.[13] ?? 1,
            bone.bindPose?.[14] ?? 0,
        ] as [number, number, number]);
        this.visualRestDirections.set(assetId, next);
        return next;
    }

    setActive(assetId: string | null, entityId: string | null) {
        // No-op
    }

    setActiveAsset(assetId: string | null) {
        // No-op
    }

    setOptions(partial: Partial<SkeletonToolOptions>) {
        this.options = { ...this.options, ...partial };
    }

    getOptions(): SkeletonToolOptions {
        return this.options;
    }

    update() {
        if (!this.options.enabled) return;

        const debug = engineInstance.debugRenderer;
        if (!debug) return;

        // 1. Draw Standalone Skeletons (Rig-only entities)
        engineInstance.skeletonEntityAssetMap.forEach((assetId, entityId) => {
            this.drawSkeleton(assetId, entityId, debug, true);
        });

        // 2. Draw Skeletal Meshes
        engineInstance.skeletonMap.forEach((_, entityId) => {
            if (engineInstance.skeletonEntityAssetMap.has(entityId)) return;

            const idx = engineInstance.ecs.idToIndex.get(entityId);
            if (idx !== undefined && engineInstance.ecs.store.isActive[idx]) {
                const meshIntId = engineInstance.ecs.store.meshType[idx];
                const assetId = assetManager.meshIntToUuid.get(meshIntId);
                if (assetId) {
                    this.drawSkeleton(assetId, entityId, debug, false);
                }
            }
        });
    }

    private drawSkeleton(assetId: string, entityId: string, debug: DebugRenderer, isStandalone: boolean) {
        const asset = assetManager.getAsset(assetId) as (SkeletonAsset | SkeletalMeshAsset | undefined);
        if (!asset) return;

        const skeleton = (asset as any).skeleton as { bones: any[] } | undefined;
        if (!skeleton || !Array.isArray(skeleton.bones)) return;

        const worldMat = engineInstance.sceneGraph.getWorldMatrix(entityId);
        if (!worldMat) return;

        // Manual matrix multiplication helper for points
        const transform = (x: number, y: number, z: number) => ({
            x: worldMat[0] * x + worldMat[4] * y + worldMat[8] * z + worldMat[12],
            y: worldMat[1] * x + worldMat[5] * y + worldMat[9] * z + worldMat[13],
            z: worldMat[2] * x + worldMat[6] * y + worldMat[10] * z + worldMat[14]
        });

        // Manual matrix rotation helper (ignores translation) for axes
        const rotate = (x: number, y: number, z: number) => ({
            x: worldMat[0] * x + worldMat[4] * y + worldMat[8] * z,
            y: worldMat[1] * x + worldMat[5] * y + worldMat[9] * z,
            z: worldMat[2] * x + worldMat[6] * y + worldMat[10] * z
        });

        const bones = skeleton.bones;
        const visualRestDirections = this.getVisualRestDirections(assetId, bones);
        const liveBoneIds = engineInstance.skeletonMap.get(entityId);

        for (let i = 0; i < bones.length; i++) {
            const bone = bones[i];
            const p = (bone as any).parentIndex;
            const isRoot = p === -1 || p === undefined || p === null;

            let pos = { x: 0, y: 0, z: 0 };
            let rx = { x: 1, y: 0, z: 0 };
            let ry = { x: 0, y: 1, z: 0 };
            let rz = { x: 0, y: 0, z: 1 };
            
            let usedLiveEntity = false;
            const liveBoneId = liveBoneIds ? liveBoneIds[i] : undefined;
            
            if (liveBoneId) {
                // Self-heal: If entity exists in scene but local position is (0,0,0) while bindPose has offset, sync it
                if (bone.bindPose) {
                    const bIdx = engineInstance.ecs.idToIndex.get(liveBoneId);
                    if (bIdx !== undefined) {
                        const lx = engineInstance.ecs.store.posX[bIdx];
                        const ly = engineInstance.ecs.store.posY[bIdx];
                        const lz = engineInstance.ecs.store.posZ[bIdx];
                        const bx = bone.bindPose[12], by = bone.bindPose[13], bz = bone.bindPose[14];
                        if (lx === 0 && ly === 0 && lz === 0 && (bx !== 0 || by !== 0 || bz !== 0)) {
                            const m = new THREE.Matrix4().fromArray(bone.bindPose);
                            const pVec = new THREE.Vector3();
                            const qVec = new THREE.Quaternion();
                            const sVec = new THREE.Vector3();
                            m.decompose(pVec, qVec, sVec);
                            const euler = new THREE.Euler().setFromQuaternion(qVec, 'YXZ');
                            engineInstance.ecs.store.setPosition(bIdx, pVec.x, pVec.y, pVec.z);
                            engineInstance.ecs.store.setRotation(bIdx, euler.x, euler.y, euler.z);
                            engineInstance.ecs.store.setScale(bIdx, sVec.x, sVec.y, sVec.z);
                            engineInstance.syncTransforms(false);
                        }
                    }
                }

                const liveWm = engineInstance.sceneGraph.getWorldMatrix(liveBoneId);
                if (liveWm) {
                    pos = { x: liveWm[12], y: liveWm[13], z: liveWm[14] };
                    
                    const lx = Math.sqrt(liveWm[0]**2 + liveWm[1]**2 + liveWm[2]**2) || 1;
                    rx = { x: liveWm[0]/lx, y: liveWm[1]/lx, z: liveWm[2]/lx };
                    
                    const ly = Math.sqrt(liveWm[4]**2 + liveWm[5]**2 + liveWm[6]**2) || 1;
                    ry = { x: liveWm[4]/ly, y: liveWm[5]/ly, z: liveWm[6]/ly };
                    
                    const lz = Math.sqrt(liveWm[8]**2 + liveWm[9]**2 + liveWm[10]**2) || 1;
                    rz = { x: liveWm[8]/lz, y: liveWm[9]/lz, z: liveWm[10]/lz };

                    usedLiveEntity = true;
                }
            }

            // Fallback: If no entity found (or detached), calculate from BindPose + Parent Mesh
            if (!usedLiveEntity) {
                const bx = bone.bindPose ? bone.bindPose[12] : 0;
                const by = bone.bindPose ? bone.bindPose[13] : 0;
                const bz = bone.bindPose ? bone.bindPose[14] : 0;
                pos = transform(bx, by, bz);

                if (bone.bindPose) {
                    const brx = { x: bone.bindPose[0], y: bone.bindPose[1], z: bone.bindPose[2] };
                    const bry = { x: bone.bindPose[4], y: bone.bindPose[5], z: bone.bindPose[6] };
                    const brz = { x: bone.bindPose[8], y: bone.bindPose[9], z: bone.bindPose[10] };

                    rx = rotate(brx.x, brx.y, brx.z);
                    ry = rotate(bry.x, bry.y, bry.z);
                    rz = rotate(brz.x, brz.y, brz.z);
                }
            }

            const boneEcsIdx = liveBoneId ? engineInstance.ecs.idToIndex.get(liveBoneId) : undefined;
            const isSelected = boneEcsIdx !== undefined && engineInstance.selectionSystem?.selectedIndices
                ? engineInstance.selectionSystem.selectedIndices.has(boneEcsIdx)
                : false;

            // Joint radius calculation identical to SkeletonEditor. Bone width uses the
            // normal structural radius so selection highlighting never changes bone thickness.
            const radiusScale = this.options.jointRadius / 10;
            const rootScaleFactor = isRoot ? this.options.rootScale : 1.0;
            const radius = getSkeletonJointRadius(
                isRoot,
                this.options.jointRadius,
                this.options.rootScale,
                isSelected ? 'selected' : 'normal'
            );

            let color = isSelected
                ? { r: 0.98, g: 0.65, b: 0.12 }
                : isRoot
                ? (this.options.rootColor || { r: 0.15, g: 0.85, b: 0.5 })
                : (bone.visual?.color
                    ? {
                        r: bone.visual.color.x ?? bone.visual.color[0] ?? 0.45,
                        g: bone.visual.color.y ?? bone.visual.color[1] ?? 0.75,
                        b: bone.visual.color.z ?? bone.visual.color[2] ?? 0.98
                      }
                    : (this.options.jointColor || { r: 0.45, g: 0.75, b: 0.98 }));

            // 1. Draw joint wireframe sphere
            if (this.options.drawJoints) {
                debug.drawWireSphere(pos, radius, color, 12, rx, ry, rz);
            }

            // 2. Draw joint axes (only when drawAxes is explicitly enabled, matching SkeletonEditor)
            if (this.options.drawAxes) {
                const axisScale = (isSelected ? 0.22 : 0.16) * radiusScale * rootScaleFactor;
                debug.drawAxis(pos, rx, ry, rz, axisScale);
            }

            // 3. Draw surface-anchored bone: live direction with parent-local no-twist roll
            if (this.options.drawBones) {
                let pPos = { x: 0, y: 0, z: 0 };
                let parentAxes: SkeletonVisualAxes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
                let parentIsRoot = false;
                let shouldDraw = false;
                let isParentSelected = false;

                // Prefer the live SceneGraph parent so edited/reparented rigs render from the
                // actual hierarchy. The cross-section frame comes from that parent's local axes.
                if (liveBoneId) {
                    const sgParentId = engineInstance.sceneGraph.getParentId(liveBoneId);
                    if (sgParentId) {
                        const parentIdx = engineInstance.ecs?.idToIndex?.get(sgParentId);
                        if (parentIdx !== undefined && engineInstance.ecs.store.isActive[parentIdx]) {
                            const mask = engineInstance.ecs.store.componentMask[parentIdx];
                            if ((mask & 32) !== 0) {
                                const pWm = engineInstance.sceneGraph.getWorldMatrix(sgParentId);
                                if (pWm) {
                                    pPos = { x: pWm[12], y: pWm[13], z: pWm[14] };
                                    parentAxes = getMatrixUnitAxes(pWm);
                                    shouldDraw = true;
                                    const liveParentBoneIndex = liveBoneIds?.indexOf(sgParentId) ?? -1;
                                    if (liveParentBoneIndex >= 0) {
                                        parentIsRoot = bones[liveParentBoneIndex]?.parentIndex === -1;
                                    }
                                    if (engineInstance.selectionSystem?.selectedIndices?.has(parentIdx)) {
                                        isParentSelected = true;
                                    }
                                }
                            }
                        }
                    }
                }

                // Fallback to the asset hierarchy if there is no live scene parent.
                if (!shouldDraw && !isRoot && typeof p === 'number' && p >= 0 && p < bones.length) {
                    parentIsRoot = bones[p]?.parentIndex === -1;
                    if (liveBoneIds && liveBoneIds[p]) {
                        const pLiveId = liveBoneIds[p];
                        const pWm = engineInstance.sceneGraph.getWorldMatrix(pLiveId);
                        if (pWm) {
                            pPos = { x: pWm[12], y: pWm[13], z: pWm[14] };
                            parentAxes = getMatrixUnitAxes(pWm);
                            shouldDraw = true;
                            const pIdx = engineInstance.ecs?.idToIndex?.get(pLiveId);
                            if (pIdx !== undefined && engineInstance.selectionSystem?.selectedIndices?.has(pIdx)) {
                                isParentSelected = true;
                            }
                        }
                    }

                    if (!shouldDraw) {
                        const parent = bones[p];
                        if (parent?.bindPose) {
                            pPos = transform(parent.bindPose[12], parent.bindPose[13], parent.bindPose[14]);
                            parentAxes = {
                                x: (() => { const v = rotate(parent.bindPose[0], parent.bindPose[1], parent.bindPose[2]); const l = Math.hypot(v.x, v.y, v.z) || 1; return [v.x/l, v.y/l, v.z/l] as [number, number, number]; })(),
                                y: (() => { const v = rotate(parent.bindPose[4], parent.bindPose[5], parent.bindPose[6]); const l = Math.hypot(v.x, v.y, v.z) || 1; return [v.x/l, v.y/l, v.z/l] as [number, number, number]; })(),
                                z: (() => { const v = rotate(parent.bindPose[8], parent.bindPose[9], parent.bindPose[10]); const l = Math.hypot(v.x, v.y, v.z) || 1; return [v.x/l, v.y/l, v.z/l] as [number, number, number]; })(),
                            };
                            shouldDraw = true;
                        }
                    }
                }

                if (shouldDraw) {
                    const boneColor = isParentSelected
                        ? { r: 0.98, g: 0.65, b: 0.12 }
                        : this.options.boneColor;
                    const liveDirection = { x: pos.x - pPos.x, y: pos.y - pPos.y, z: pos.z - pPos.z };
                    const restDirection = transformLocalDirectionByAxes(
                        visualRestDirections[i],
                        parentAxes,
                        liveDirection
                    );
                    const parentRadius = getSkeletonJointRadius(
                        parentIsRoot,
                        this.options.jointRadius,
                        this.options.rootScale,
                        'normal'
                    );
                    const childRadius = getSkeletonJointRadius(
                        isRoot,
                        this.options.jointRadius,
                        this.options.rootScale,
                        'normal'
                    );
                    debug.drawBoneOctahedron(pPos, pos, boneColor, {
                        parentRadius,
                        childRadius,
                        parentXAxis: parentAxes.x,
                        parentYAxis: parentAxes.y,
                        parentZAxis: parentAxes.z,
                        restDirection,
                    });
                }
            }
        }
    }
}

export const skeletonTool = new SkeletonTool();
