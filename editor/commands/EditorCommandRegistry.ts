import type { MeshComponentMode, SoftSelectionConnectivity, SoftSelectionFalloff, ToolType } from '@/types';
import type { SoftSelectionMode } from '@/engine/mesh-editing/SoftSelection';
import type { StaticMeshEditTarget } from '@/engine/mesh-editing/StaticMeshEditTarget';

export type EditorCommandCapability =
  | 'VIEW_FOCUS'
  | 'VIEW_RESET'
  | 'VIEW_GRID'
  | 'MESH_WIREFRAME'
  | 'OBJECT_EDIT'
  | 'STATIC_MESH_EDIT'
  | 'STATIC_MESH_COMPONENT_EDIT';

export interface MeshSelectionCounts {
  object: number;
  vertices: number;
  edges: number;
  faces: number;
}

export interface EditorCommandServices {
  setTool?: (tool: ToolType) => void;
  setComponentMode?: (mode: MeshComponentMode) => void;
  focus?: () => void;
  resetCamera?: () => void;
  toggleGrid?: () => void;
  toggleWireframe?: () => void;
  duplicateSelection?: () => void;
  deleteSelection?: () => void;
  selectLoop?: (mode: MeshComponentMode) => void;
  expandSelection?: (mode: MeshComponentMode) => void;
  shrinkSelection?: (mode: MeshComponentMode) => void;
  selectRing?: (mode: MeshComponentMode) => void;
  topologyCommand?: (command: 'EXTRUDE' | 'BEVEL' | 'WELD' | 'CONNECT' | 'DELETE_FACE') => void;
  configureSoftSelection?: (settings: Partial<{
    enabled: boolean;
    radius: number;
    mode: SoftSelectionMode;
    /** Preferred semantic name for Volume / Surface / Hybrid. */
    distanceMetric: SoftSelectionFalloff;
    /** Legacy alias retained for existing callers. */
    falloff: SoftSelectionFalloff;
    surfaceBlend: number;
    connectivity: SoftSelectionConnectivity;
    heatmapVisible: boolean;
  }>) => void;
}

export interface EditorCommandContext {
  capabilities: ReadonlySet<EditorCommandCapability>;
  meshComponentMode: MeshComponentMode;
  selectionCounts: MeshSelectionCounts;
  staticMeshTarget?: StaticMeshEditTarget | null;
  softSelection?: {
    enabled: boolean;
    radius: number;
    mode: SoftSelectionMode;
    /** Preferred semantic name for Volume / Surface / Hybrid. */
    distanceMetric: SoftSelectionFalloff;
    /** Legacy alias retained for existing callers. */
    falloff: SoftSelectionFalloff;
    surfaceBlend: number;
    connectivity: SoftSelectionConnectivity;
    heatmapVisible: boolean;
  };
  services: EditorCommandServices;
}

export type EditorCommandCategory = 'SELECTION' | 'ACTIONS' | 'TOOLS' | 'VIEW' | 'DEFORMATION';

export interface EditorCommandDefinition {
  id: string;
  label: string | ((context: EditorCommandContext) => string);
  icon: string;
  category: EditorCommandCategory;
  requiredCapabilities?: EditorCommandCapability[];
  visible?: (context: EditorCommandContext) => boolean;
  enabled?: (context: EditorCommandContext) => boolean;
  execute: (context: EditorCommandContext) => void;
  description?: string | ((context: EditorCommandContext) => string);
}

export interface ResolvedEditorCommand extends Omit<EditorCommandDefinition, 'label' | 'description'> {
  label: string;
  description?: string;
  isEnabled: boolean;
}

class EditorCommandRegistry {
  private readonly commands = new Map<string, EditorCommandDefinition>();

  register(definition: EditorCommandDefinition) {
    this.commands.set(definition.id, definition);
    return definition;
  }

  get(id: string) {
    return this.commands.get(id);
  }

  list() {
    return Array.from(this.commands.values());
  }

  listAvailable(context: EditorCommandContext) {
    return this.list().map(command => this.resolve(command.id, context)).filter((command): command is ResolvedEditorCommand => Boolean(command));
  }

  resolve(id: string, context: EditorCommandContext): ResolvedEditorCommand | null {
    const definition = this.commands.get(id);
    if (!definition) return null;
    if (definition.requiredCapabilities?.some(capability => !context.capabilities.has(capability))) return null;
    if (definition.visible && !definition.visible(context)) return null;
    return {
      ...definition,
      label: typeof definition.label === 'function' ? definition.label(context) : definition.label,
      description: typeof definition.description === 'function' ? definition.description(context) : definition.description,
      isEnabled: definition.enabled ? definition.enabled(context) : true,
    };
  }

  execute(id: string, context: EditorCommandContext): boolean {
    const command = this.resolve(id, context);
    if (!command || !command.isEnabled) return false;
    command.execute(context);
    return true;
  }
}

export const editorCommandRegistry = new EditorCommandRegistry();
