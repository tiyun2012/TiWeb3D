# Selection Policy and Marquee Routing

Selection gestures are owned by the active viewport. Before click or marquee work is
performed, the viewport resolves a `SelectionPolicy` containing:

- editor context (`SCENE`, `STATIC_MESH_EDITOR`, future skeletal/UV contexts),
- selection domain (`OBJECT`, `VERTEX`, `EDGE`, `FACE`),
- resolved target (`OBJECTS` or one concrete `MESH_COMPONENTS` entity),
- whether marquee selection is available.

The gesture layer must not infer a different domain after this point. In particular,
a component-mode miss must never fall through to object selection.

## Current policies

### Static Mesh Editor

- `OBJECT` -> the local preview scene object domain.
- `VERTEX` / `EDGE` / `FACE` -> the single preview mesh entity.

### Scene View

- `OBJECT` -> Scene entities.
- `VERTEX` / `EDGE` / `FACE` -> only when exactly one selected entity resolves to an
  editable Static Mesh. Otherwise component marquee is unavailable and object picking
  is not used as a fallback.

## Gesture lifecycle

1. LMB press resolves and captures the policy.
2. Gizmo capture has priority.
3. Movement below the marquee threshold remains a pending click.
4. Movement at/above the threshold becomes a marquee in the captured domain.
5. Mouse-up verifies that the current policy still matches the captured policy.
6. The marquee is dispatched to object or mesh-component rectangle selection.

Shift preserves the existing editor convention and toggles marquee hits.

The same policy also protects Scene RMB component workflows: opening a component-mode
pie menu must not silently switch the object selection.

## Future contexts

Skeletal source-mesh editing, bone selection, and UV selection should add policies or
selection domains rather than adding viewport-specific branches to rectangle-selection
algorithms.

## Verification matrix

1. **Static Mesh / Object**: drag a rectangle around the preview object; it should use
   object selection. Dragging empty space should not create component selection.
2. **Static Mesh / Vertex, Edge, Face**: drag starting directly on mesh geometry and
   from empty space. Both should become component marquee after the threshold. Shift-drag
   toggles hits. A simple miss click preserves the existing component selection.
3. **Scene / Object**: a drag starting over an object must still become Scene object
   marquee instead of being committed immediately as a click.
4. **Scene / Component**: select exactly one Static Mesh, enter Vertex/Edge/Face mode,
   then marquee. The object selection must remain that same mesh even when the gesture
   crosses or starts over another Scene object.
5. **Invalid Scene component context**: with zero objects, multiple objects, or a
   non-Static-Mesh object selected, component marquee is unavailable and must not fall
   back to object selection.
6. **RMB in Scene component mode**: open the pie menu over empty space/another object;
   it must not change the object selection.
7. **Gizmo priority**: dragging an active gizmo handle must transform, never start a
   marquee.
8. **Viewport isolation**: Static Mesh Editor marquee must not alter Scene selection,
   and Scene marquee must not alter Static Mesh Editor component selection.
