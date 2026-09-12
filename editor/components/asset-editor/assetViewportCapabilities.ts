import { AssetType, MeshComponentMode, ToolType } from '@/types';

export type AssetViewportActionId =
  | 'tool.select'
  | 'tool.move'
  | 'tool.rotate'
  | 'tool.scale'
  | 'view.grid'
  | 'view.focus'
  | 'view.autoRotate'
  | 'panel.hierarchy'
  | 'panel.inspector'
  | 'mesh.object'
  | 'mesh.vertex'
  | 'mesh.edge'
  | 'mesh.face'
  | 'mesh.shading'
  | 'mesh.wireframe'
  | 'skeleton.joints'
  | 'skeleton.meshOverlay'
  | 'skeleton.wireframeOverlay';


export interface AssetViewportToolbarAction {
  id: AssetViewportActionId;
  label: string;
  icon: string;
  active?: boolean;
  className?: string;
  group?: string;
  onTrigger: () => void;
}

export interface AssetViewportCapabilities {
  assetType: AssetType;
  actions: ReadonlySet<AssetViewportActionId>;
  tools: readonly ToolType[];
  meshModes: readonly MeshComponentMode[];
  hasHierarchy: boolean;
  hasInspector: boolean;
}

const BASE_ACTIONS: AssetViewportActionId[] = [
  'tool.select',
  'tool.move',
  'tool.rotate',
  'tool.scale',
  'view.grid',
  'view.focus',
  'view.autoRotate',
  'panel.hierarchy',
  'panel.inspector',
];

const MESH_ACTIONS: AssetViewportActionId[] = [
  ...BASE_ACTIONS,
  'mesh.object',
  'mesh.vertex',
  'mesh.edge',
  'mesh.face',
  'mesh.shading',
  'mesh.wireframe',
];

const CAPABILITY_TABLE: Partial<Record<AssetType, AssetViewportCapabilities>> = {
  MESH: {
    assetType: 'MESH',
    actions: new Set(MESH_ACTIONS),
    tools: ['SELECT', 'MOVE', 'ROTATE', 'SCALE'],
    meshModes: ['OBJECT', 'VERTEX', 'EDGE', 'FACE'],
    hasHierarchy: true,
    hasInspector: true,
  },
  SKELETAL_MESH: {
    assetType: 'SKELETAL_MESH',
    actions: new Set([
      ...MESH_ACTIONS,
      'skeleton.joints',
      'skeleton.meshOverlay',
      'skeleton.wireframeOverlay',
    ]),
    tools: ['SELECT', 'MOVE', 'ROTATE', 'SCALE'],
    meshModes: ['OBJECT', 'VERTEX', 'EDGE', 'FACE'],
    hasHierarchy: true,
    hasInspector: true,
  },
  SKELETON: {
    assetType: 'SKELETON',
    actions: new Set([
      ...BASE_ACTIONS,
      'skeleton.joints',
      'skeleton.meshOverlay',
      'skeleton.wireframeOverlay',
    ]),
    tools: ['SELECT', 'MOVE', 'ROTATE', 'SCALE'],
    meshModes: [],
    hasHierarchy: true,
    hasInspector: true,
  },
};

const FALLBACK_CAPABILITIES: AssetViewportCapabilities = {
  assetType: 'MESH',
  actions: new Set(BASE_ACTIONS),
  tools: ['SELECT', 'MOVE', 'ROTATE', 'SCALE'],
  meshModes: [],
  hasHierarchy: true,
  hasInspector: true,
};

export function getAssetViewportCapabilities(assetType?: AssetType | null): AssetViewportCapabilities {
  if (!assetType) return FALLBACK_CAPABILITIES;
  return CAPABILITY_TABLE[assetType] ?? {
    ...FALLBACK_CAPABILITIES,
    assetType,
    actions: new Set(['panel.hierarchy', 'panel.inspector']),
    tools: [],
    meshModes: [],
  };
}

export function assetViewportAllows(
  assetType: AssetType | null | undefined,
  action: AssetViewportActionId,
): boolean {
  return getAssetViewportCapabilities(assetType).actions.has(action);
}

export function toolActionId(tool: ToolType): AssetViewportActionId {
  if (tool === 'MOVE') return 'tool.move';
  if (tool === 'ROTATE') return 'tool.rotate';
  if (tool === 'SCALE') return 'tool.scale';
  return 'tool.select';
}

export function meshModeActionId(mode: MeshComponentMode): AssetViewportActionId {
  if (mode === 'VERTEX') return 'mesh.vertex';
  if (mode === 'EDGE') return 'mesh.edge';
  if (mode === 'FACE') return 'mesh.face';
  return 'mesh.object';
}
