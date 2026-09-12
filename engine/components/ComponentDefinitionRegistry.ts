import { ComponentType } from '@/types';

/**
 * A capability is a semantic trait provided by one or more components.
 * Keep capabilities descriptive rather than using class inheritance checks.
 */
export type ComponentCapability =
  | 'SPATIAL'
  | 'RENDERABLE'
  | 'CAMERA'
  | 'LIGHT'
  | 'PHYSICS'
  | 'PARTICLE_SOURCE'
  | 'SCRIPTING'
  | 'EDITOR_HELPER'
  | string;

export interface ComponentDefinition {
  type: ComponentType;
  /** Components that must exist on the same entity before this component is installed. */
  requires?: readonly ComponentType[];
  /** Semantic traits that systems/editor code may query without hardcoding concrete component types. */
  provides?: readonly ComponentCapability[];
  /** Automatically installed on every newly-created entity. */
  defaultOnEntity?: boolean;
  /** False for structural components such as Transform. */
  removable?: boolean;
}

export interface ComponentRemovalCheck {
  allowed: boolean;
  blockers: ComponentType[];
  reason?: string;
}

class ComponentDefinitionRegistryService {
  private definitions = new Map<ComponentType, ComponentDefinition>();

  register(definition: ComponentDefinition) {
    this.definitions.set(definition.type, {
      ...definition,
      requires: [...(definition.requires ?? [])],
      provides: [...(definition.provides ?? [])],
      removable: definition.removable ?? true,
    });
    return definition;
  }

  get(type: ComponentType) {
    return this.definitions.get(type);
  }

  has(type: ComponentType | string): type is ComponentType {
    return this.definitions.has(type as ComponentType);
  }

  getAll() {
    return Array.from(this.definitions.values());
  }

  getDefaultComponents() {
    return this.getAll().filter(definition => definition.defaultOnEntity).map(definition => definition.type);
  }

  /**
   * Returns dependency-first installation order, ending with `type` itself.
   * Throws on a dependency cycle so malformed component registrations fail loudly.
   */
  getInstallOrder(type: ComponentType): ComponentType[] {
    const ordered: ComponentType[] = [];
    const visiting = new Set<ComponentType>();
    const visited = new Set<ComponentType>();

    const visit = (current: ComponentType) => {
      if (visited.has(current)) return;
      if (visiting.has(current)) {
        throw new Error(`Component dependency cycle detected at ${current}`);
      }

      visiting.add(current);
      const definition = this.definitions.get(current);
      for (const required of definition?.requires ?? []) visit(required);
      visiting.delete(current);
      visited.add(current);
      ordered.push(current);
    };

    visit(type);
    return ordered;
  }

  /** All registered components that directly or transitively depend on `type`. */
  getDependents(type: ComponentType): ComponentType[] {
    return this.getAll()
      .filter(definition => definition.type !== type && this.dependsOn(definition.type, type))
      .map(definition => definition.type);
  }

  dependsOn(type: ComponentType, requiredType: ComponentType): boolean {
    const visited = new Set<ComponentType>();
    const visit = (current: ComponentType): boolean => {
      if (visited.has(current)) return false;
      visited.add(current);
      const definition = this.definitions.get(current);
      for (const required of definition?.requires ?? []) {
        if (required === requiredType || visit(required)) return true;
      }
      return false;
    };
    return visit(type);
  }

  canRemove(type: ComponentType, presentComponents: Iterable<ComponentType>): ComponentRemovalCheck {
    const definition = this.definitions.get(type);
    if (definition?.removable === false) {
      return {
        allowed: false,
        blockers: [],
        reason: `${type} is a structural component and cannot be removed.`,
      };
    }

    const present = new Set(presentComponents);
    const blockers = this.getDependents(type).filter(dependent => present.has(dependent));
    if (blockers.length > 0) {
      return {
        allowed: false,
        blockers,
        reason: `${type} is required by ${blockers.join(', ')}.`,
      };
    }

    return { allowed: true, blockers: [] };
  }

  getCapabilities(presentComponents: Iterable<ComponentType>): Set<ComponentCapability> {
    const capabilities = new Set<ComponentCapability>();
    for (const type of presentComponents) {
      for (const capability of this.definitions.get(type)?.provides ?? []) {
        capabilities.add(capability);
      }
    }
    return capabilities;
  }

  hasCapability(presentComponents: Iterable<ComponentType>, capability: ComponentCapability) {
    return this.getCapabilities(presentComponents).has(capability);
  }
}

export const componentDefinitionRegistry = new ComponentDefinitionRegistryService();

// Built-in composition contract. Spatial behavior is inherited by composition:
// adding Camera/Light/Mesh/etc. guarantees Transform exists on the same entity.
componentDefinitionRegistry.register({
  type: ComponentType.TRANSFORM,
  defaultOnEntity: true,
  removable: false,
  provides: ['SPATIAL'],
});
componentDefinitionRegistry.register({ type: ComponentType.MESH, requires: [ComponentType.TRANSFORM], provides: ['RENDERABLE'] });
componentDefinitionRegistry.register({ type: ComponentType.LIGHT, requires: [ComponentType.TRANSFORM], provides: ['LIGHT'] });
componentDefinitionRegistry.register({ type: ComponentType.PARTICLE_SYSTEM, requires: [ComponentType.TRANSFORM], provides: ['PARTICLE_SOURCE', 'RENDERABLE'] });
componentDefinitionRegistry.register({ type: ComponentType.CAMERA, requires: [ComponentType.TRANSFORM], provides: ['CAMERA'] });
componentDefinitionRegistry.register({ type: ComponentType.PHYSICS, requires: [ComponentType.TRANSFORM], provides: ['PHYSICS'] });
componentDefinitionRegistry.register({ type: ComponentType.VIRTUAL_PIVOT, requires: [ComponentType.TRANSFORM], provides: ['EDITOR_HELPER'] });
componentDefinitionRegistry.register({ type: ComponentType.SCRIPT, provides: ['SCRIPTING'] });
