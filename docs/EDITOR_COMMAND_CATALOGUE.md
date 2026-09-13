# Editor Command Catalogue

## Purpose

Editor commands are registered once and projected into UI surfaces (Pie Menu, Static Mesh Tool Dock, future command palette/hotkeys) instead of embedding modeling logic in React handlers.

The registry lives in `editor/commands/EditorCommandRegistry.ts`. Built-in Static Mesh commands are registered by `editor/commands/StaticMeshCommandCatalogue.ts` and imported once during application bootstrap.

## Command flow

```text
UI surface / script / future AI agent
        |
        v
editorCommandRegistry.execute(commandId, context)
        |
        v
capability + enabled checks
        |
        v
context service adapter
        |
        v
shared engine / mesh-editing implementation
```

A command definition owns stable identity and UI metadata (`id`, label, icon, category, description) plus capability/enable rules. It does not know whether it is displayed in Scene View or a Static Mesh asset editor.

## Static Mesh target capability

`engine/mesh-editing/StaticMeshEditTarget.ts` resolves whether a host provides editable Static Mesh geometry.

- Static Mesh Editor: a `MESH` asset resolves directly to an asset-scoped target.
- Scene View: exactly one selected entity must own a Mesh component whose referenced asset type is `MESH`.
- Skeletal Mesh: **not automatically editable** through Static Mesh commands. A future Skeletal Mesh editor must explicitly expose an "Edit Source Mesh" adapter/capability.

This avoids accidental modification of skinned/source geometry just because a Skeletal Mesh contains vertex data.

## Current command IDs

Stable command IDs currently include:

- `editor.tool.select`
- `editor.tool.move`
- `editor.tool.rotate`
- `editor.tool.scale`
- `viewport.focus`
- `viewport.resetCamera`
- `viewport.toggleGrid`
- `staticMesh.toggleWireframe`
- `selection.duplicate`
- `selection.delete`
- `staticMesh.selectLoop`
- `staticMesh.softSelection.toggle`
- `staticMesh.softTransform.fixed`
- `staticMesh.softTransform.live`
- `staticMesh.sculpt.slide`
- `staticMesh.softSelection.toggleHeatmap`
- topology placeholders/commands such as `staticMesh.extrude`, `staticMesh.bevel`, `staticMesh.weld`, `staticMesh.connect`, `staticMesh.deleteFace`

## UI reuse

`PieMenu` resolves its Tool/View/Action entries from the catalogue when an `EditorCommandContext` is supplied. `StaticMeshToolDock` resolves its deformation and loop controls from the same definitions. Therefore labels, capability checks, and enabled state have one source of truth.

Scene View and Static Mesh Editor create different service adapters but execute the same command IDs. Static Mesh Editor routes component selection to its local `AssetViewportEngine`; Scene View routes to the main engine.

## API / agent use

The registry intentionally exposes:

```ts
editorCommandRegistry.get(id)
editorCommandRegistry.list()
editorCommandRegistry.listAvailable(context)
editorCommandRegistry.execute(id, context)
```

Future command palettes, scripts, plugins, and AI agents should invoke stable command IDs rather than simulate mouse/keyboard interaction.

## Extension rule

When adding a new modeling operation:

1. Implement the domain operation behind a mesh-editing/tool API.
2. Register one command ID with capability and enabled rules.
3. Add that command ID to any desired catalogue layout (Pie Menu, dock, command palette).
4. Do **not** implement separate Scene and Static Mesh Editor mutations.


## Command reuse vs transient state

The command catalogue shares **behavior and command identity**, not transient viewport state. Each host context owns its active tool/component mode/soft-selection configuration and passes those values through its `EditorCommandContext`.

For example, `staticMesh.softTransform.live` is the same command ID in Scene and Static Mesh Editor, but executing it in the asset editor only changes that editor's local session. It must not put Scene into component-edit mode or enable Scene's heatmap. This separation is required for future Skeletal Mesh/source-mesh adapters as well.
