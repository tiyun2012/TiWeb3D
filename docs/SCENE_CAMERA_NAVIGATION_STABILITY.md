# Scene Camera Navigation Stability

## Purpose

When a Scene viewport is bound to a live Camera entity, the viewport and the Camera Transform must not become competing controllers. The viewport owns the active interaction gesture; the Camera Transform is the committed scene state.

This document records the stability rules for **View Through Camera** navigation and the distinction between a live Scene Camera Transform and a Camera Preset's editor-only preview Transform.

## Ownership model

```text
Viewport input gesture
    |
    v
shared viewportCamera controller
    |
    +--> viewport CameraState (immediate render pose)
    |
    +--> Scene Camera Transform (live scene state)

External Inspector/Gizmo edit
    |
    v
Scene Camera Transform
    |
    v
viewport resync (only when viewport is not actively driving a gesture)
```

During Alt+orbit/pan/zoom the Scene viewport is the active driver. The gesture remains in viewport-local CameraState and is committed to Transform only at mouse-up / wheel-idle. Engine UI notifications must not convert that self-commit back into CameraState while the commit guard is active.


## Gesture transaction and React publication

A Scene viewport is much heavier than a Camera Preset preview. Pointer devices may produce more camera samples than React can render, so publishing every mouse event with `setCamera()` creates a visible queue that can continue after mouse-up.

The bound-camera path therefore uses two rates:

```text
pointer samples
      |
      v
cameraRef.current          <- always latest
      |
      +--> render/UI publication (max once per requestAnimationFrame)
      |
      +--> mouse-up / wheel-idle
               |
               v
       flush final CameraState
               |
               v
       write Camera Transform once
               |
               v
       notifyUI once while self-resync guard is active
```

Do not move `boundCameraNavigationActiveRef.current = false` before `notifyUI()`. `notifyUI()` is synchronous; releasing the guard first makes the viewport consume its own Transform commit as though it were an external Inspector/Gizmo edit.

This transaction also means Camera children/other Transform consumers observe the committed pose at the gesture boundary rather than forcing the whole SceneGraph to chase every pointer sample.

## Do not full-update the SceneGraph per mouse move

`SceneCameraViewportBinding.writeSceneCameraViewportState()` may mark the Camera branch dirty, but it must not call a whole-scene `sceneGraph.update()` after every pointer sample.

`SceneGraph.getWorldMatrix()` already resolves the required parent chain when a parent transform is needed. The normal engine/render update loop resolves the dirty Camera branch afterwards.

This avoids O(scene-size) work at pointer frequency.

## Stable roll transport

A fixed world-space `up` vector is not a valid orbit representation.

If Camera forward changes while the old `up` is retained, the pair becomes inconsistent and can produce roll flips/corkscrew behavior. Bound Scene Cameras therefore store:

- orbit direction as `theta` / `phi`,
- focal target/radius,
- roll as one signed scalar around the **live forward axis**.

`getCameraUp()` reconstructs the up vector from a stable Y-up canonical frame and transports roll around the current forward direction.

```text
forward(theta, phi)
      |
canonical Y-up frame
      |
rotate around forward by roll
      |
live camera up
```

This preserves authored roll without keeping a stale world-space up vector during orbit.

## UI commit policy

- Drag navigation updates the viewport and Camera Transform continuously.
- `notifyUI()` is emitted once when the drag finishes.
- Wheel navigation batches UI refresh until wheel input has been idle briefly.
- While navigation owns the Camera, Transform-to-viewport subscription callbacks are ignored.
- The viewport stores the last known **bound Camera world matrix**. Broad engine UI notifications (selection, tool state, asset refreshes) do not rebuild `CameraState` unless that world matrix actually changed.
- After a viewport-owned camera commit, refresh the stored world-matrix snapshot before `notifyUI()` so the next unrelated notification cannot replay the same Transform back into the viewport.
- Inspector/gizmo edits and parent Transform edits made outside viewport navigation still resync the viewport immediately because they change the bound Camera world matrix.
- Entity selection is not a Transform operation and must not force `SceneGraph.update()` merely to publish selection state.

## Camera Preset Transform component

A Camera Preset is reusable lens/render configuration and still does **not** own a Scene Transform. Its editor nevertheless displays a component-like:

```text
Transform [Preview]
Camera
Editor Viewport [Editor Only]
```

`Transform [Preview]` is temporary editor pose data. It lets developers/users understand that a live Camera instance is spatial and lets the Through Camera preview be positioned numerically. It is not serialized into the Camera Preset asset.

A placed Scene Camera remains:

```text
Entity
|- Transform        (real scene component)
`- Camera           (can reference Camera Preset)
```

## Regression checklist

1. Enter View Through on an unparented Camera and orbit continuously for several seconds: no visible stutter or sudden roll flips.
2. Pan continuously: Camera Transform position updates and the rendered view follows exactly.
3. Wheel zoom: render updates immediately, Inspector refresh is batched rather than emitted per wheel packet.
4. Rotate a Camera from Inspector while View Through is active but no viewport gesture is active: viewport follows the Transform.
5. Test a Camera parented under a transformed parent: local Transform conversion remains correct.
6. Test an authored rolled Camera, then orbit: roll is transported around live forward instead of using a stale world-space up vector.
7. Open a Camera Preset: Inspector visibly contains Transform [Preview], Camera, and Editor Viewport; changing Preview Transform changes only preview pose and does not mutate Camera Preset runtime settings.
8. While View Through is active, select several unrelated entities: the rendered camera view, focal target, and Camera Transform remain unchanged.
9. Edit the bound Camera Transform or any of its parents from Inspector/gizmo: the viewport resyncs exactly once to the new world pose.

10. While View Through is active, single-click visible scene objects: the bound Camera must not intercept the pick ray, while other cameras and scene entities remain selectable.
11. Verify a tiny 3–4 px pointer wobble still resolves as a click; larger drags continue to perform marquee selection.
