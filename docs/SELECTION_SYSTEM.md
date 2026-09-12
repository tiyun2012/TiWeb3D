# Selection System

## Scope

Scene selection has two separate paths and they should not be conflated:

- **Click picking** uses a screen ray. Meshes first pass a local-space AABB broad phase and then use the mesh BVH/triangle raycast when logical topology is available.
- **Rectangle (marquee) selection** is screen-space. Meshes use their projected AABB only as a cheap broad phase, then refine candidates against projected mesh triangles before accepting the hit. Non-mesh helpers use their projected origin. Marquee selection does **not** use the raycast BVH.

## Viewport input contract

`SceneView` owns marquee gesture state. Object-mode presses cache the click raycast instead of committing it immediately; once movement crosses the drag threshold the same press becomes a marquee even if it began over selectable geometry. Mouse movement and mouse-up are observed globally so a drag can leave the viewport through any edge or corner without losing the gesture. The current pointer is clamped back to the live viewport CSS bounds before finalizing the selection.

Do not finalize marquee selection only from the viewport element's local `onMouseUp`: a pointer released a few pixels outside the element will not deliver that event. The global mouse-up path is the single commit path.

The live `getBoundingClientRect()` width/height must be passed to `SelectionSystem.selectEntitiesInRect(...)`. Picking coordinates and projected bounds are CSS-pixel values; do not mix them with the canvas physical HiDPI dimensions.

Shared viewport toolbar chrome stops `mousedown` propagation. Toolbar presses must never simultaneously start a scene pick/marquee behind the overlay. A marquee that started on the canvas may still finish while the pointer is over the toolbar because finalization is global.


## Marquee mesh precision

A projected 3D AABB is deliberately **not** the final mesh hit test. In perspective projection, AABB corners may project outside the visible silhouette because those corners are not points on a curved or concave mesh. A sphere is the canonical failure case: its box corner can extend the projected broad-phase rectangle into visible empty screen space, causing a marquee with an air gap to select the sphere.

After the AABB broad phase overlaps, `SelectionSystem` projects the mesh's logical faces (or triangle index buffer when logical faces are unavailable) and tests actual 2D triangle/rectangle overlap. The rectangle is accepted when a projected triangle vertex is inside it, a rectangle corner is inside a triangle, or their edges intersect. If an asset has no usable triangle data, the AABB remains a deliberate fallback so malformed/incomplete assets are not made impossible to select.

Do not replace this refinement with a raycast-BVH test. A single ray cannot represent a 2D marquee area, and the existing BVH is designed for local-space ray/component queries. If marquee performance becomes an issue on very dense meshes, add a separate screen/frustum-aware BVH traversal as an optimization while preserving the projected-triangle result semantics.

## Mesh click picking and BVH

The mesh ray is transformed into local space and normalized before AABB/BVH tests. Therefore the local AABB intersection distance is **not comparable** to the world-space `closestDist`. Do not use local `aabbT` to prune against a world-space hit distance; run the precise local BVH test after an AABB hit, transform the hit position back to world space, and compare distances only in world space.

Meshes without logical topology fall back to their geometry AABB for object-level picking. This keeps imported/procedural assets selectable while topology is absent or still being generated.

`RayUtils.intersectAABB` uses a parallel-safe slab implementation and returns an entry distance of `0` when the ray starts inside a node. Avoid direct `0 / 0` slab divisions because axis-aligned rays exactly on an AABB boundary can otherwise produce `NaN`, and do not return the box exit distance for inside rays because BVH distance pruning can then discard a node that contains a nearer triangle.

## Component selection coordinate spaces

`pickMeshComponent` returns its hit position in world space after the local BVH raycast. Any later comparison must intentionally convert values into the same space. Vertex hover projects the candidate vertex into screen space and uses a fixed pixel threshold, so hover does not change with camera distance, entity translation, or object scale.

Brush selection queries the topology/BVH in mesh-local space. Convert the world hit back through the inverse world matrix before passing the center to the local sphere query, and derive the local radius from the entity scale. Negative scales must use absolute magnitudes and zero/near-zero scale must be guarded.

## Regression checklist

1. Start a marquee near the center, drag out through each of the four viewport corners, release outside, and confirm it commits.
2. Repeat while releasing over the top-left and top-right viewport toolbars.
3. Verify toolbar clicks do not change scene selection.
4. Select uniformly and non-uniformly scaled meshes by click.
5. Verify an asset with an AABB but no logical topology remains object-selectable.
6. Test exact axis-aligned rays against AABB faces/edges (parallel boundary hit and parallel outside miss).
7. Resize the viewport, immediately marquee near the right/bottom edges, and confirm screen-space selection still lines up with the visible rectangle.
8. Place a narrow marquee beside a sphere/curved mesh with a visible pixel gap; confirm the mesh is not selected until the rectangle actually touches its rendered geometric silhouette.

## Click versus marquee gesture ownership

Object-mode left mouse selection uses a deferred press gesture. `selectEntityAt()` may raycast a mesh, light, joint, or bone on mouse-down, but that hit is only cached as a pending click. The selection is not committed until mouse-up.

If the pointer moves at least 4 CSS pixels from the press position, the pending click is discarded and the gesture becomes a marquee selection starting at the original press point. This is required even when the press begins over selectable projected geometry. Without the deferred gesture, mesh silhouettes and bone hit corridors become narrow dead zones where a rectangle can never start because raycast selection returns first.

The BVH remains responsible for mesh click/component raycasts; it does not own marquee gesture activation. Rectangle selection uses projected AABB broad phase plus projected mesh-triangle refinement after the UI gesture has already been classified as a marquee.
