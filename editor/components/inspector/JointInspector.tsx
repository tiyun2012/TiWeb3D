import React, { useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { SkeletonAsset, SkeletalMeshAsset } from '@/types';
import { assetManager } from '@/engine/AssetManager';
import { AssetViewportEngine } from '@/editor/viewports/AssetViewportEngine';
import { Icon } from '../Icon';
import { DraggableNumber } from '../ui/InputControls';

export interface JointInspectorProps {
  asset: SkeletonAsset | SkeletalMeshAsset;
  jointIndex: number;
  engine?: AssetViewportEngine | null;
  boneEntities?: string[];
  revision?: number;
  onUpdate: () => void;
  onFocus?: () => void;
  onAddChild?: () => void;
  onDelete?: () => void;
  className?: string;
}

export const JointInspector: React.FC<JointInspectorProps> = ({
  asset,
  jointIndex,
  engine,
  boneEntities = [],
  revision = 0,
  onUpdate,
  onFocus,
  onAddChild,
  onDelete,
  className = ''
}) => {
  const bones = asset.skeleton?.bones || [];
  const bone = bones[jointIndex];

  const [name, setName] = useState('');

  // Sync name from bone
  useEffect(() => {
    if (bone) {
      setName(bone.name || `Joint_${jointIndex}`);
    }
  }, [bone, jointIndex]);

  // Decompose local transform from bone.bindPose
  const localTransform = useMemo(() => {
    if (!bone || !bone.bindPose) {
      return {
        pos: { x: 0, y: 0, z: 0 },
        rotDeg: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }
      };
    }
    const m = new THREE.Matrix4().fromArray(bone.bindPose);
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(p, q, s);
    const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    const radToDeg = 180 / Math.PI;

    return {
      pos: { x: p.x, y: p.y, z: p.z },
      rotDeg: { x: e.x * radToDeg, y: e.y * radToDeg, z: e.z * radToDeg },
      scale: { x: s.x, y: s.y, z: s.z }
    };
  }, [bone, bone?.bindPose, revision]);

  // Prevent circular parenting by finding all descendant indices of current joint
  const descendantIndices = useMemo(() => {
    const desc = new Set<number>();
    const stack = [jointIndex];
    while (stack.length > 0) {
      const parent = stack.pop()!;
      bones.forEach((b: any, idx: number) => {
        if (b.parentIndex === parent && !desc.has(idx)) {
          desc.add(idx);
          stack.push(idx);
        }
      });
    }
    return desc;
  }, [bones, jointIndex]);

  if (!bone) {
    return (
      <div className="p-4 text-xs text-text-secondary italic text-center">
        No joint selected.
      </div>
    );
  }

  // Handle renaming
  const handleCommitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === bone.name) return;

    bone.name = trimmed;
    const entityId = boneEntities[jointIndex];
    if (engine && entityId) {
      engine.ecs.setName(entityId, trimmed);
    }
    assetManager.updateAsset(asset.id, {
      skeleton: { ...asset.skeleton, bones }
    });
    onUpdate();
  };

  // Handle transform changes
  const applyTransform = (
    newPos: { x: number; y: number; z: number },
    newRotDeg: { x: number; y: number; z: number },
    newScale: { x: number; y: number; z: number }
  ) => {
    const degToRad = Math.PI / 180;
    const p = new THREE.Vector3(newPos.x, newPos.y, newPos.z);
    const e = new THREE.Euler(
      newRotDeg.x * degToRad,
      newRotDeg.y * degToRad,
      newRotDeg.z * degToRad,
      'YXZ'
    );
    const q = new THREE.Quaternion().setFromEuler(e);
    const s = new THREE.Vector3(newScale.x, newScale.y, newScale.z);

    const m = new THREE.Matrix4().compose(p, q, s);
    m.toArray(bone.bindPose);

    const entityId = boneEntities[jointIndex];
    if (engine && entityId) {
      if (engine.api?.commands?.transform) {
        engine.api.commands.transform.setPosition(entityId, p.x, p.y, p.z);
        engine.api.commands.transform.setRotation(entityId, e.x, e.y, e.z);
        engine.api.commands.transform.setScale(entityId, s.x, s.y, s.z);
      } else {
        const idx = engine.ecs.idToIndex?.get(entityId) ?? (engine.ecs.getEntityIndex ? engine.ecs.getEntityIndex(entityId) : undefined);
        if (idx !== undefined) {
          engine.ecs.store.setPosition(idx, p.x, p.y, p.z);
          engine.ecs.store.setRotation(idx, e.x, e.y, e.z);
          engine.ecs.store.setScale(idx, s.x, s.y, s.z);
          engine.sceneGraph.setDirty(entityId);
          engine.syncTransforms(true);
        }
      }

      const worldMat = engine.sceneGraph.getWorldMatrix(entityId);
      if (worldMat) {
        const inv = new THREE.Matrix4().fromArray(worldMat).invert();
        inv.toArray(bone.inverseBindPose);
      }
      engine.notifyUI();
    }

    assetManager.updateAsset(asset.id, {
      skeleton: { ...asset.skeleton, bones }
    });
    onUpdate();
  };

  // Handle reparenting
  const handleParentChange = (newParentIdx: number) => {
    if (newParentIdx === bone.parentIndex) return;
    bone.parentIndex = newParentIdx;

    const childId = boneEntities[jointIndex];
    if (engine && childId) {
      engine.sceneGraph.detach(childId);
      if (newParentIdx >= 0 && boneEntities[newParentIdx]) {
        engine.sceneGraph.attach(childId, boneEntities[newParentIdx]);
      }
      engine.syncTransforms(false);
      engine.notifyUI();
    }

    assetManager.updateAsset(asset.id, {
      skeleton: { ...asset.skeleton, bones }
    });
    onUpdate();
  };

  // Reset transform
  const handleResetTransform = () => {
    applyTransform({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
  };

  const isRoot = bone.parentIndex < 0;

  return (
    <div className={`p-3 bg-[#1e1e20] rounded-md border border-white/10 space-y-3 ${className}`}>
      {/* Joint Title & Name */}
      <div className="space-y-1.5 pb-2 border-b border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-accent font-semibold text-xs">
            <Icon name="Bone" size={14} />
            <span>Joint #{jointIndex}</span>
            {isRoot && (
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                ROOT
              </span>
            )}
          </div>
          {onFocus && (
            <button
              type="button"
              className="p-1 text-text-secondary hover:text-white rounded hover:bg-white/10 transition-colors"
              onClick={onFocus}
              title="Focus camera on this joint"
              aria-label="Focus camera on this joint"
            >
              <Icon name="Crosshair" size={13} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-[10px] text-text-secondary font-medium w-12">Name</label>
          <input
            type="text"
            className="flex-1 bg-black/30 border border-white/10 focus:border-accent rounded px-2 py-1 text-xs text-text-primary outline-none transition-colors"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') handleCommitName();
            }}
            onBlur={handleCommitName}
            title="Joint Name"
            aria-label="Joint Name"
          />
        </div>
      </div>

      {/* Parent Hierarchy Selector */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <label className="text-[10px] uppercase font-bold text-text-secondary tracking-wider opacity-70">
            Parent Joint
          </label>
          {bone.parentIndex >= 0 && (
            <span className="text-[10px] text-text-secondary truncate max-w-[120px]">
              {bones[bone.parentIndex]?.name || `Joint_${bone.parentIndex}`}
            </span>
          )}
        </div>
        <select
          className="w-full bg-black/30 border border-white/10 focus:border-accent text-text-primary text-xs rounded px-2 py-1.5 outline-none cursor-pointer transition-colors"
          value={bone.parentIndex}
          onChange={e => handleParentChange(parseInt(e.target.value, 10))}
          title="Select parent joint"
          aria-label="Select parent joint"
        >
          <option value="-1">None (Root Joint)</option>
          {bones.map((b: any, i: number) => {
            if (i === jointIndex || descendantIndices.has(i)) {
              return null; // Prevent cycles
            }
            return (
              <option key={i} value={i}>
                #{i} {b.name || `Joint_${i}`}
              </option>
            );
          })}
        </select>
      </div>

      {/* Local Transform: Position, Rotation, Scale */}
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-bold text-text-secondary tracking-wider opacity-70">
            Local Transform
          </span>
          <button
            type="button"
            className="text-[10px] text-text-secondary hover:text-white underline opacity-70 hover:opacity-100 transition-opacity"
            onClick={handleResetTransform}
            title="Reset joint position, rotation, and scale"
            aria-label="Reset joint position, rotation, and scale"
          >
            Reset
          </button>
        </div>

        {/* Position */}
        <div className="space-y-1">
          <span className="text-[10px] text-text-secondary font-medium">Position</span>
          <div className="grid grid-cols-3 gap-1">
            <DraggableNumber
              label="X"
              value={localTransform.pos.x}
              onChange={v =>
                applyTransform(
                  { ...localTransform.pos, x: v },
                  localTransform.rotDeg,
                  localTransform.scale
                )
              }
              color="text-red-400"
              step={0.05}
            />
            <DraggableNumber
              label="Y"
              value={localTransform.pos.y}
              onChange={v =>
                applyTransform(
                  { ...localTransform.pos, y: v },
                  localTransform.rotDeg,
                  localTransform.scale
                )
              }
              color="text-green-400"
              step={0.05}
            />
            <DraggableNumber
              label="Z"
              value={localTransform.pos.z}
              onChange={v =>
                applyTransform(
                  { ...localTransform.pos, z: v },
                  localTransform.rotDeg,
                  localTransform.scale
                )
              }
              color="text-blue-400"
              step={0.05}
            />
          </div>
        </div>

        {/* Rotation (deg) */}
        <div className="space-y-1">
          <span className="text-[10px] text-text-secondary font-medium">Rotation (Deg)</span>
          <div className="grid grid-cols-3 gap-1">
            <DraggableNumber
              label="X"
              value={localTransform.rotDeg.x}
              onChange={v =>
                applyTransform(
                  localTransform.pos,
                  { ...localTransform.rotDeg, x: v },
                  localTransform.scale
                )
              }
              color="text-red-400"
              step={1}
            />
            <DraggableNumber
              label="Y"
              value={localTransform.rotDeg.y}
              onChange={v =>
                applyTransform(
                  localTransform.pos,
                  { ...localTransform.rotDeg, y: v },
                  localTransform.scale
                )
              }
              color="text-green-400"
              step={1}
            />
            <DraggableNumber
              label="Z"
              value={localTransform.rotDeg.z}
              onChange={v =>
                applyTransform(
                  localTransform.pos,
                  { ...localTransform.rotDeg, z: v },
                  localTransform.scale
                )
              }
              color="text-blue-400"
              step={1}
            />
          </div>
        </div>

        {/* Scale */}
        <div className="space-y-1">
          <span className="text-[10px] text-text-secondary font-medium">Scale</span>
          <div className="grid grid-cols-3 gap-1">
            <DraggableNumber
              label="X"
              value={localTransform.scale.x}
              onChange={v =>
                applyTransform(
                  localTransform.pos,
                  localTransform.rotDeg,
                  { ...localTransform.scale, x: v }
                )
              }
              color="text-red-400"
              step={0.05}
            />
            <DraggableNumber
              label="Y"
              value={localTransform.scale.y}
              onChange={v =>
                applyTransform(
                  localTransform.pos,
                  localTransform.rotDeg,
                  { ...localTransform.scale, y: v }
                )
              }
              color="text-green-400"
              step={0.05}
            />
            <DraggableNumber
              label="Z"
              value={localTransform.scale.z}
              onChange={v =>
                applyTransform(
                  localTransform.pos,
                  localTransform.rotDeg,
                  { ...localTransform.scale, z: v }
                )
              }
              color="text-blue-400"
              step={0.05}
            />
          </div>
        </div>
      </div>

      {/* Quick Action Buttons */}
      <div className="pt-2 border-t border-white/5 flex items-center gap-1.5">
        {onAddChild && (
          <button
            type="button"
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 bg-accent/20 hover:bg-accent/30 text-accent border border-accent/40 rounded text-xs transition-colors"
            onClick={onAddChild}
            title="Add a new child joint attached to this joint"
            aria-label="Add child joint"
          >
            <Icon name="Plus" size={12} />
            <span>Add Child</span>
          </button>
        )}
        {bones.length > 1 && onDelete && (
          <button
            type="button"
            className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded text-xs transition-colors"
            onClick={onDelete}
            title="Delete this joint"
            aria-label="Delete joint"
          >
            <Icon name="Trash2" size={13} />
          </button>
        )}
      </div>
    </div>
  );
};
