
import { AnimationClip, SkeletalMeshAsset, AnimationTrack } from '@/types';
import { Mat4Utils, QuatUtils } from '../math';
import { assetManager } from '../AssetManager';
import { DebugRenderer, getBoneRestDirectionWorld, getMatrixUnitAxes, getSkeletonJointRadius } from '../renderers/DebugRenderer';
import { engineInstance } from '../engine';
import { AnimationEvaluator } from '../animation/AnimationEvaluator';

export class AnimationSystem {
    
    evaluateTrack(track: AnimationTrack, time: number): Float32Array {
        return AnimationEvaluator.evaluateTrack(track, time);
    }

    update(dt: number, time: number, meshSystem: any, ecs: any, sceneGraph: any, debugRenderer?: DebugRenderer, selectedIndices?: Set<number>, meshComponentMode?: string) {
        // Iterate entities with Mesh components that have Skeletal Assets
        const store = ecs.store;
        const selectedBoneIndex = meshSystem.selectedBoneIndex;

        for (let i = 0; i < ecs.count; i++) {
            if (!store.isActive[i]) continue;
            
            const meshIntId = store.meshType[i];
            const uuid = assetManager.meshIntToUuid.get(meshIntId);
            if (!uuid) continue;
            
            const asset = assetManager.getAsset(uuid);
            if (!asset || asset.type !== 'SKELETAL_MESH') continue;
            
            const skelAsset = asset as SkeletalMeshAsset;
            if (skelAsset.skeleton.bones.length === 0) continue;
            
            const entityId = store.ids[i];
            
            // Retrieve spawned bone entities for this mesh
            const boneIds = engineInstance.skeletonMap.get(entityId);
            if (!boneIds) continue; 

            // Determine active clip
            const animIndex = store.animationIndex[i] || 0;
            const clip = skelAsset.animations[animIndex];
            const isPlaying = engineInstance.timeline.isPlaying;
            const localTime = clip ? time % clip.duration : 0;
            
            const boneMatrices = new Float32Array(skelAsset.skeleton.bones.length * 16);
            
            skelAsset.skeleton.bones.forEach((bone, bIdx) => {
                const boneEntityId = boneIds[bIdx];
                if (!boneEntityId) return;

                // --- 1. Apply Animation to Entity Transforms (If Playing) ---
                if (isPlaying && clip) {
                    const safeName = bone.name.replace(':', '_').replace('.', '_'); 
                    // Optimization: Map tracks once, not every frame
                    const posTrack = clip.tracks.find(t => t.name === safeName && t.type === 'position');
                    const rotTrack = clip.tracks.find(t => t.name === safeName && t.type === 'rotation');
                    const sclTrack = clip.tracks.find(t => t.name === safeName && t.type === 'scale');

                    const bIdxECS = ecs.idToIndex.get(boneEntityId);
                    if (bIdxECS !== undefined) {
                        if (posTrack) {
                            const p = this.evaluateTrack(posTrack, localTime);
                            ecs.store.setPosition(bIdxECS, p[0], p[1], p[2]);
                        }
                        if (rotTrack) {
                            const r = this.evaluateTrack(rotTrack, localTime);
                            const q = { x: r[0], y: r[1], z: r[2], w: r[3] };
                            const euler = QuatUtils.toEuler(q, { x: 0, y: 0, z: 0 });
                            ecs.store.setRotation(bIdxECS, euler.x, euler.y, euler.z);
                        }
                        if (sclTrack) {
                            const s = this.evaluateTrack(sclTrack, localTime);
                            ecs.store.setScale(bIdxECS, s[0], s[1], s[2]);
                        }
                        sceneGraph.setDirty(boneEntityId);
                    }
                }

                // --- 2. Read Back World Matrix for Skinning ---
                const worldMat = sceneGraph.getWorldMatrix(boneEntityId);
                if (worldMat) {
                    const skinM = Mat4Utils.create();
                    // Skin Matrix = World * InverseBindPose
                    Mat4Utils.multiply(worldMat, bone.inverseBindPose, skinM);
                    boneMatrices.set(skinM, bIdx * 16);

                    // --- Debug Draw ---
                    if (debugRenderer && selectedIndices) {
                        const bPos = { x: worldMat[12], y: worldMat[13], z: worldMat[14] };
                        const boneEcsIdx = ecs?.idToIndex?.get(boneEntityId);
                        const isBoneSelected = (boneEcsIdx !== undefined && selectedIndices && typeof selectedIndices.has === 'function') ? selectedIndices.has(boneEcsIdx) : false;
                        
                        if (isBoneSelected || meshComponentMode !== 'OBJECT') {
                             const isRoot = bone.parentIndex === -1;
                             const radius = getSkeletonJointRadius(isRoot, 10, 1.0, isBoneSelected ? 'selected' : 'normal');
                             const color = isBoneSelected ? { r: 1.0, g: 0.72, b: 0.1 } : isRoot ? { r: 0.18, g: 0.82, b: 0.45 } : { r: 0.35, g: 0.75, b: 1.0 };
                             debugRenderer.drawWireSphere(bPos, radius, color, 12);
                             if (bone.parentIndex !== -1) {
                                 const pId = boneIds[bone.parentIndex];
                                 const pMat = sceneGraph.getWorldMatrix(pId);
                                 if (pMat) {
                                     const pPos = { x: pMat[12], y: pMat[13], z: pMat[14] };
                                     const parentAxes = getMatrixUnitAxes(pMat);
                                     const liveDirection = {
                                         x: bPos.x - pPos.x,
                                         y: bPos.y - pPos.y,
                                         z: bPos.z - pPos.z,
                                     };
                                     const restDirection = getBoneRestDirectionWorld(bone.bindPose, parentAxes, liveDirection);
                                     const parentBone = skelAsset.skeleton.bones[bone.parentIndex];
                                     const parentRadius = getSkeletonJointRadius(
                                         parentBone?.parentIndex === -1,
                                         10,
                                         1.0,
                                         'normal'
                                     );
                                     const childRadius = getSkeletonJointRadius(
                                         bone.parentIndex === -1,
                                         10,
                                         1.0,
                                         'normal'
                                     );
                                     debugRenderer.drawBoneOctahedron(
                                         pPos,
                                         bPos,
                                         { r: 0.9, g: 0.92, b: 0.96 },
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
                }
            });
            
            meshSystem.uploadBoneMatrices(boneMatrices);
        }
    }
}
