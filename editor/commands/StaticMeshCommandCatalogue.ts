import { editorCommandRegistry, type EditorCommandContext } from './EditorCommandRegistry';
import type { MeshComponentMode } from '@/types';
import type { SoftSelectionMode } from '@/engine/mesh-editing/SoftSelection';

const componentCount = (context: EditorCommandContext) => {
  switch (context.meshComponentMode) {
    case 'VERTEX': return context.selectionCounts.vertices;
    case 'EDGE': return context.selectionCounts.edges;
    case 'FACE': return context.selectionCounts.faces;
    default: return 0;
  }
};

const loopSeedRequired = (mode: MeshComponentMode) => mode === 'EDGE' ? 1 : 2;
const loopLabel = (mode: MeshComponentMode) => mode === 'VERTEX'
  ? 'Vertex Loop'
  : mode === 'EDGE'
    ? 'Edge Loop'
    : mode === 'FACE'
      ? 'Face Loop'
      : 'Loop Select';

const registerTool = (id: string, label: string, icon: string, tool: 'SELECT' | 'MOVE' | 'ROTATE' | 'SCALE') => {
  editorCommandRegistry.register({
    id,
    label,
    icon,
    category: 'TOOLS',
    enabled: context => Boolean(context.services.setTool),
    execute: context => context.services.setTool?.(tool),
  });
};

registerTool('editor.tool.select', 'Select', 'MousePointer2', 'SELECT');
registerTool('editor.tool.move', 'Move', 'Move', 'MOVE');
registerTool('editor.tool.rotate', 'Rotate', 'RotateCw', 'ROTATE');
registerTool('editor.tool.scale', 'Scale', 'Maximize', 'SCALE');

editorCommandRegistry.register({
  id: 'viewport.focus',
  label: 'Focus',
  icon: 'Scan',
  category: 'VIEW',
  requiredCapabilities: ['VIEW_FOCUS'],
  enabled: context => Boolean(context.services.focus),
  execute: context => context.services.focus?.(),
});
editorCommandRegistry.register({
  id: 'viewport.resetCamera',
  label: 'Reset Cam',
  icon: 'Camera',
  category: 'VIEW',
  requiredCapabilities: ['VIEW_RESET'],
  enabled: context => Boolean(context.services.resetCamera),
  execute: context => context.services.resetCamera?.(),
});
editorCommandRegistry.register({
  id: 'viewport.toggleGrid',
  label: 'Grid',
  icon: 'Grid',
  category: 'VIEW',
  requiredCapabilities: ['VIEW_GRID'],
  enabled: context => Boolean(context.services.toggleGrid),
  execute: context => context.services.toggleGrid?.(),
});
editorCommandRegistry.register({
  id: 'staticMesh.toggleWireframe',
  label: 'Wireframe',
  icon: 'Codepen',
  category: 'VIEW',
  requiredCapabilities: ['MESH_WIREFRAME'],
  enabled: context => Boolean(context.services.toggleWireframe),
  execute: context => context.services.toggleWireframe?.(),
});

editorCommandRegistry.register({
  id: 'selection.duplicate',
  label: 'Duplicate',
  icon: 'Copy',
  category: 'ACTIONS',
  requiredCapabilities: ['OBJECT_EDIT'],
  enabled: context => Boolean(context.services.duplicateSelection),
  execute: context => context.services.duplicateSelection?.(),
});
editorCommandRegistry.register({
  id: 'selection.delete',
  label: 'Delete',
  icon: 'Trash2',
  category: 'ACTIONS',
  requiredCapabilities: ['OBJECT_EDIT'],
  enabled: context => Boolean(context.services.deleteSelection),
  execute: context => context.services.deleteSelection?.(),
});

editorCommandRegistry.register({
  id: 'staticMesh.selectLoop',
  label: context => loopLabel(context.meshComponentMode),
  icon: 'RefreshCw',
  category: 'ACTIONS',
  requiredCapabilities: ['STATIC_MESH_COMPONENT_EDIT'],
  visible: context => context.meshComponentMode !== 'OBJECT',
  enabled: context => Boolean(context.services.selectLoop)
    && componentCount(context) >= loopSeedRequired(context.meshComponentMode),
  description: context => {
    const required = loopSeedRequired(context.meshComponentMode);
    return componentCount(context) >= required
      ? `Extend the current ${context.meshComponentMode.toLowerCase()} selection as a loop.`
      : `Select at least ${required} ${context.meshComponentMode.toLowerCase()}${required > 1 ? 's' : ''} first.`;
  },
  execute: context => context.services.selectLoop?.(context.meshComponentMode),
});

const registerSoftMode = (id: string, mode: SoftSelectionMode, label: string, icon: string, description: string) => {
  editorCommandRegistry.register({
    id,
    label,
    icon,
    description,
    category: 'DEFORMATION',
    requiredCapabilities: ['STATIC_MESH_COMPONENT_EDIT'],
    visible: context => context.meshComponentMode !== 'OBJECT',
    enabled: context => Boolean(context.services.configureSoftSelection),
    execute: context => {
      context.services.configureSoftSelection?.({ enabled: true, mode });
      context.services.setTool?.('MOVE');
    },
  });
};

editorCommandRegistry.register({
  id: 'staticMesh.softSelection.toggle',
  label: 'Soft Selection',
  icon: 'Target',
  category: 'DEFORMATION',
  requiredCapabilities: ['STATIC_MESH_COMPONENT_EDIT'],
  visible: context => context.meshComponentMode !== 'OBJECT',
  enabled: context => Boolean(context.services.configureSoftSelection),
  execute: context => context.services.configureSoftSelection?.({ enabled: !context.softSelection?.enabled }),
});
registerSoftMode('staticMesh.softTransform.fixed', 'FIXED', 'Fixed Soft Transform', 'Target', 'Lock influence when the gizmo drag begins.');
registerSoftMode('staticMesh.softTransform.live', 'LIVE_FALLOFF', 'Live Falloff Transform', 'RefreshCw', 'Rebuild the same move when radius or falloff changes.');
registerSoftMode('staticMesh.sculpt.slide', 'SLIDE', 'Slide Sculpt', 'Move', 'Continuously affect only vertices inside the live radius.');
editorCommandRegistry.register({
  id: 'staticMesh.softSelection.toggleHeatmap',
  label: 'Heatmap',
  icon: 'Flame',
  category: 'DEFORMATION',
  requiredCapabilities: ['STATIC_MESH_COMPONENT_EDIT'],
  visible: context => context.meshComponentMode !== 'OBJECT',
  enabled: context => Boolean(context.services.configureSoftSelection),
  execute: context => context.services.configureSoftSelection?.({ heatmapVisible: !context.softSelection?.heatmapVisible }),
});

const topology = (id: string, label: string, icon: string, command: 'EXTRUDE' | 'BEVEL' | 'WELD' | 'CONNECT' | 'DELETE_FACE', mode: MeshComponentMode) => {
  editorCommandRegistry.register({
    id,
    label,
    icon,
    category: 'ACTIONS',
    requiredCapabilities: ['STATIC_MESH_COMPONENT_EDIT'],
    visible: context => context.meshComponentMode === mode,
    enabled: context => Boolean(context.services.topologyCommand),
    execute: context => context.services.topologyCommand?.(command),
  });
};
topology('staticMesh.extrude', 'Extrude', 'ArrowUpSquare', 'EXTRUDE', 'FACE');
topology('staticMesh.deleteFace', 'Del Face', 'Trash', 'DELETE_FACE', 'FACE');
topology('staticMesh.bevel', 'Bevel', 'Ungroup', 'BEVEL', 'EDGE');
topology('staticMesh.weld', 'Weld', 'Merge', 'WELD', 'VERTEX');
topology('staticMesh.connect', 'Connect', 'GitCommit', 'CONNECT', 'VERTEX');

export const STATIC_MESH_PIE_COMMANDS = {
  TOOLS: ['editor.tool.select', 'editor.tool.move', 'editor.tool.rotate', 'editor.tool.scale'],
  VIEW: ['viewport.toggleGrid', 'staticMesh.toggleWireframe', 'viewport.resetCamera'],
  OBJECT: ['viewport.focus', 'selection.duplicate', 'selection.delete'],
  FACE: ['staticMesh.extrude', 'staticMesh.selectLoop', 'staticMesh.deleteFace'],
  EDGE: ['staticMesh.bevel', 'staticMesh.selectLoop'],
  VERTEX: ['staticMesh.weld', 'staticMesh.connect', 'staticMesh.selectLoop'],
} as const;

export const STATIC_MESH_DOCK_COMMANDS = [
  'staticMesh.softSelection.toggle',
  'staticMesh.softTransform.fixed',
  'staticMesh.softTransform.live',
  'staticMesh.sculpt.slide',
  'staticMesh.selectLoop',
  'staticMesh.softSelection.toggleHeatmap',
] as const;
