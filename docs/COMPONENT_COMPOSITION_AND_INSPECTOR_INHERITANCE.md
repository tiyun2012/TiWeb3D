# Component Composition and Inspector Inheritance

TiWeb3D deliberately separates **runtime/entity inheritance** from **editable-data inheritance**.

Do not create a `TransformObject -> Camera -> CustomCamera` class tree. Scene entities use ECS composition, while reusable inspector data may use schema inheritance.

## 1. Runtime inheritance = component composition

Runtime component relationships are registered in:

```text
engine/components/ComponentDefinitionRegistry.ts
```

A component can declare required/base components:

```ts
componentDefinitionRegistry.register({
  type: ComponentType.CAMERA,
  requires: [ComponentType.TRANSFORM],
  provides: ['CAMERA'],
});
```

Adding Camera therefore resolves:

```text
Camera
  requires Transform
       ↓
install Transform first if missing
       ↓
install Camera
```

The same rule is used for Mesh, Light, Physics, Particle System, and editor spatial helpers.

### Why this is better than class inheritance

A Scene Camera is not a subclass instance. It is an entity with independent capabilities:

```text
Camera Entity
├── Transform
└── Camera
```

A Light is:

```text
Light Entity
├── Transform
└── Light
```

If Transform later gains a new spatial feature, all entities that compose Transform receive that feature without changing Camera/Light/Mesh data layouts.

## 2. Default structural components

Definitions may set:

```ts
defaultOnEntity: true
```

Transform currently uses this flag, so newly-created entities receive Transform through the registry rather than a hardcoded `createEntity()` special case.

This creates one source of truth for the structural entity contract.

## 3. Dependency repair when loading old scenes

When a scene is deserialized, existing components are passed back through the registry install contract.

Example future change:

```text
Old project:
CustomProbe

New engine:
CustomProbe requires Transform
```

Loading the old project resolves the missing dependency automatically rather than leaving an invalid entity.

This is the intended meaning of "push down" for ECS structure.

## 4. Removal protection

A required/base component must not disappear while another installed component depends on it.

```ts
componentDefinitionRegistry.canRemove(
  ComponentType.TRANSFORM,
  entityComponentTypes,
);
```

Transform is currently structural and non-removable. Other future base components may be removable only when no installed dependent remains.

The Inspector uses the same rule to decide whether to show the component remove action.

## 5. Capabilities instead of concrete type checks

Definitions can expose semantic traits:

```ts
provides: ['SPATIAL']
provides: ['CAMERA']
provides: ['RENDERABLE']
```

Query them through ECS/API:

```ts
engine.ecs.hasCapability(entityId, 'SPATIAL');
engineApi.hasComponentCapability(entityId, 'CAMERA');
```

Use capabilities when a system cares about behavior rather than a specific component type.

For example, a future editor command that works for any spatial entity should query `SPATIAL`, not enumerate Camera + Light + Mesh + Particle System.

## 6. Inspector/data inheritance = schema extension

Runtime component composition and Inspector schema inheritance solve different problems.

Reusable editable data schemas may extend another schema:

```ts
inspectorRegistry.register<CameraComponentData>({
  id: 'CameraComponent',
  title: 'Camera',
  extends: [
    {
      schemaId: 'CameraSettings',
      enabledWhen: ({ value }) => value.configSource !== 'PRESET',
    },
  ],
  sections: [
    // Camera-component-only fields such as Source and Control Mode
  ],
});
```

`CameraSettings` owns Projection, FOV, Near/Far, rendering, and post-process fields. `CameraComponent` owns only the additional Scene-instance fields.

Therefore adding a future field to `CameraSettings` automatically exposes it in both:

```text
Camera Preset Inspector
        and
Scene Camera Inspector
```

without copying the field definition.

## 7. Schema merge rules

`InspectorRegistry.get()` returns the resolved schema.

Resolution rules:

1. parent schemas resolve first;
2. inherited sections keep their ordering;
3. sections with the same `id` merge;
4. a derived/local field with the same `path` overrides the inherited field;
5. inheritance-level `visibleWhen` and `enabledWhen` gates wrap the parent's own field gates;
6. inheritance cycles throw immediately.

This supports future patterns such as:

```text
BaseEmitterSettings
        ↓
ParticleEmitterSettings
        ↓
GPUEmitterSettings
```

without duplicating common Inspector definitions.

## 8. Stable API

UI/features that should avoid direct ECS singleton access can use:

```ts
engineApi.commands.components.add(entityId, ComponentType.CAMERA);
engineApi.commands.components.remove(entityId, ComponentType.CAMERA);
engineApi.hasComponentCapability(entityId, 'SPATIAL');
```

`add()` automatically installs requirements.

## 9. Adding a future spatial component

For a new built-in SoA component, the intended sequence is:

1. Add the `ComponentType` and storage/mask/proxy representation.
2. Register its composition contract:

```ts
componentDefinitionRegistry.register({
  type: ComponentType.REFLECTION_PROBE,
  requires: [ComponentType.TRANSFORM],
  provides: ['REFLECTION_PROBE'],
});
```

3. Register its module/system.
4. Register an Inspector schema, extending another schema only when the **data contract** really inherits those fields.

Do not copy Transform fields into the new component. Reuse the Transform component.

## 10. Rules to preserve

- Scene-space position/rotation/scale belong to Transform, not Camera/Light/Mesh.
- Camera Preset assets do not receive Transform; they are reusable configuration assets, not Scene entities.
- `requires` describes same-entity runtime composition.
- Inspector `extends` describes editable-data/schema inheritance.
- Do not use JavaScript/TypeScript class inheritance for ECS entity capabilities.
- Do not remove required components behind the registry's back by mutating component masks directly.
- Prefer semantic capabilities when code does not need to know the concrete component type.
