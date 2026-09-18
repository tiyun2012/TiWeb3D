# Mesh Component Rendering Flow

## Purpose

This document is the developer-level map for mesh component visualization in TiWeb3D. It explains how polygon edges, vertex points, selected components, wireframe previews, depth state, and screen-space sizing are expected to flow through the engine and editor.

Use this document when changing any of the following:

- Static Mesh Editor Object / Vertex / Edge / Face modes
- Scene viewport component visualization
- Skeleton Editor associated-mesh wireframe
- mesh selection colors or vertex size preferences
- topology/wireframe extraction
- selected-edge or selected-face rendering
- vertex hover/selection point rendering
- HiDPI / device-pixel-ratio behavior

The goal is **one visual contract with viewport-specific render backends**, not one custom implementation per editor.

---

## 1. High-level architecture

```text
StaticMeshAsset
├── geometry.vertices
├── geometry.indices
└── topology.faces (authoritative when present)
        │
        ├─────────────── polygon-edge identity ───────────────┐
        │                                                     │
        v                                                     v
engine/MeshEdgeGeometry.ts                         SelectionSystem
├── meshEdgeKey(a,b)                               ├── vertexIds
├── unique polygon edges                          ├── edgeIds (same keys)
├── selected edge buffers                         └── faceIds
└── selected face boundary keys
        │
        ├─────────────────────────────────────────────────────┐
        │                                                     │
        v                                                     v
Asset viewport rendering                              Scene rendering
StaticMeshEditor / SkeletonEditor                     CoreModules MeshModule
├── MeshEdgeOverlay                                   ├── DebugRenderer lines
├── MeshFaceOverlay                                   ├── face/component highlight primitives
├── MeshVertexOverlay                                 └── DebugRenderer points
└── MeshComponentVisualStyle                          └── MeshComponentVisualStyle
        │                                                     │
        └──────────────── shared visual rules ────────────────┘
```

The two viewport families intentionally have different GPU plumbing:

- **Asset editors** own compact WebGL overlay VAOs/IBOs because they render directly inside `AssetViewport3D`.
- **Scene view** already has `DebugRenderer`, so it uses that renderer instead of creating a second overlay system.

What must be shared is the **meaning** of the geometry and visual style: edge identity, topology source, point sizes, colors, selection state, and depth expectations.

---

## 2. Source-of-truth rules

### 2.1 Polygon topology wins over triangle soup

When `asset.topology.faces` exists, it is the authored polygon topology and is authoritative for visible mesh edges.

```text
logical quad topology
0 -------- 1
|          |
|          |
3 -------- 2
```

The GPU may still store the quad as two triangles:

```text
0 -------- 1
| \        |
|   \      |
3 -------- 2
```

The internal diagonal is **not** an authored polygon edge and must not appear in topology/wireframe rendering when logical faces are available.

Therefore:

```text
topology.faces exists
    -> extract face boundaries
    -> deduplicate undirected edges

no topology.faces
    -> fall back to triangle indices
    -> triangulation diagonals are unavoidable
```

Never implement a new wireframe by walking triangle indices directly unless the asset truly has no logical topology.

### 2.2 One canonical edge identity

Every undirected mesh edge uses:

```ts
meshEdgeKey(a, b)
```

from `engine/MeshEdgeGeometry.ts`.

The result is independent of direction:

```text
meshEdgeKey(4, 9) == "4-9"
meshEdgeKey(9, 4) == "4-9"
```

Selection, topology, face-boundary collection, scene rendering, and asset rendering must all use this same key. Do not recreate keys with local sorting or string logic.

---

## 3. Shared modules and responsibilities

### `engine/MeshEdgeGeometry.ts`

Owns **what an edge is**.

Use it for:

- `meshEdgeKey(a, b)`
- `forEachUniqueMeshEdge(...)`
- `buildMeshEdgeIndices(...)`
- `buildMeshEdgeIndicesFromKeys(...)`
- `collectFaceEdgeKeys(...)`
- common edge colors (`MESH_EDGE_COLORS`)

It must not know about React, viewport layout, or editor mode UI.

### `editor/viewports/MeshEdgeOverlay.ts`

Owns the asset-viewport GPU pass for indexed polygon lines.

Responsibilities:

- reuse the host mesh position VBO
- own only edge VAO/IBO state
- draw topology cage / wireframe / selected boundaries
- use `LEQUAL`
- disable depth writes during overlay drawing
- protect WebGL2 `ELEMENT_ARRAY_BUFFER` VAO state

It does **not** extract topology. Feed it indices produced by `MeshEdgeGeometry`.

### `engine/MeshFaceGeometry.ts`

Owns **which render triangles belong to logical face ids** for filled hover/selection feedback.

Responsibilities:

- map `SelectionSystem.subSelection.faceIds` through `topology.triangleToFaceIndex`
- preserve logical quad/ngon identity even though the GPU renders triangles
- provide a triangle-soup fallback only when no logical mapping exists
- own the shared soft selected/hovered face-fill colors

### `editor/viewports/MeshFaceOverlay.ts`

Owns the asset-viewport GPU pass for translucent logical-face fills.

Responsibilities:

- reuse the host mesh position VBO
- own only a compact triangle IBO for selected/hovered logical faces
- depth-test against the shaded mesh so back-side faces do not show through
- use a small negative polygon offset plus `LEQUAL`/no depth writes to avoid z-fighting
- remain visualization-only; picking/topology are unchanged

### `editor/viewports/MeshVertexOverlay.ts`

Owns the asset-viewport GPU point pass.

Responsibilities:

- reuse the host mesh position VBO
- draw all vertices via `POINTS`
- maintain a compact selected-vertex index buffer
- redraw selected and hovered vertices at highlight size/color
- use `LEQUAL` and no depth writes

Do not create a new vertex VBO per editor just to draw points.

### `engine/MeshComponentVisualStyle.ts`

Owns screen-space vertex marker sizing.

Responsibilities:

- convert `uiConfig.vertexSize` into base / selected / hovered marker sizes
- interpret those sizes as **CSS-pixel intent**
- convert CSS-pixel intent to framebuffer pixels using the viewport pixel ratio

This module exists specifically to keep Scene and Edit viewports visually consistent.

---

## 4. Static Mesh Editor render flow

`StaticMeshEditor` renders component visualization in a deliberate order.

```text
1. shaded mesh triangles
2. dim topology cage / object wireframe
3. selected/hovered Face fill (Face mode only)
4. selected Edge or Face boundary overlay
5. base vertex points (Vertex mode)
6. selected vertex points
7. hovered vertex point
```

The order matters.

### 4.1 Shaded mesh

The triangle surface is rendered first and populates depth.

A small polygon offset is used for the filled surface so line overlays can remain stable on the front surface.

### 4.2 Topology cage

```text
Object mode:
    show topology only when Wireframe toggle is ON

Vertex / Edge / Face mode:
    always show a dim topology cage
```

Component edit modes should never appear as an unstructured shaded blob; the cage communicates editable topology.

### 4.3 Face fill feedback

Face mode uses a translucent filled pass in addition to the boundary edges:

```text
hovered face  -> soft amber surface tint
selected face -> stronger amber/yellow surface tint
```

The fill is built from `topology.triangleToFaceIndex`, so a logical quad is highlighted as one face even though it contains two render triangles. If the hovered face is already selected, the hover fill is suppressed so the surface does not become artificially over-bright.

The fill is deliberately subtle. Boundary edges remain the strongest precision cue. The pass must not change picking, topology, materials, geometry, or asset history.

### 4.4 Selected edge / selected face boundary

Edge mode reads:

```ts
selectionSystem.subSelection.edgeIds
```

Face mode converts selected logical faces into boundary edge keys via:

```ts
collectFaceEdgeKeys(asset.topology?.faces, selection.faceIds)
```

Both then use the same selected edge overlay and the same canonical edge identity.

### 4.5 Vertex points

Vertex mode draws:

```text
base vertices     -> normal vertex color / normal size
selected vertices -> selected color / larger size
hovered vertex    -> hover color / larger size
```

This is visualization only. Picking remains a `SelectionSystem` responsibility.

---

## 5. Scene viewport flow

The Scene viewport uses the same **data contract** but a different renderer.

`engine/modules/CoreModules.tsx` uses:

- `forEachUniqueMeshEdge(...)` for polygon edges
- `collectFaceEdgeKeys(...)` for selected face boundaries
- `meshEdgeKey(...)` indirectly through the shared edge utilities
- `getMeshVertexPointSizes(...)` for vertex marker size
- `getViewportPixelRatio(...)` for HiDPI conversion

Then it sends primitives to `DebugRenderer`.

This distinction is important:

```text
Shared contract != identical renderer class
```

Do not force Scene view through `MeshVertexOverlay` merely for code symmetry. The Scene renderer already batches debug primitives efficiently. Reuse the **geometry/style rules**, not necessarily the same WebGL object owner.

---

## 6. Skeleton Editor associated-mesh wireframe

Skeleton Editor does not expose Vertex/Edge/Face editing for the associated mesh, but its Wireframe display must still follow the shared polygon-edge source.

For wireframe-only display:

```text
1. draw mesh triangles with color writes disabled
2. keep depth writes enabled
3. use polygon offset on the depth prepass
4. restore color writes
5. draw shared polygon edges
```

This is a hidden-line wireframe pass.

Without the depth prepass, back-side edges show through the mesh. Without polygon offset, front-side edges may z-fight with the depth surface.

---

## 7. Depth-state contract

Component overlays are co-planar with the mesh. Normal opaque `LESS` + depth writes is therefore unsafe for stacked overlays.

The required overlay state is:

```ts
gl.depthFunc(gl.LEQUAL);
gl.depthMask(false);
```

Why:

- `LEQUAL` allows an edge/point exactly on the visible surface depth to render.
- `depthMask(false)` prevents the dim cage/base points from writing a new depth value that blocks a selected/highlight pass drawn immediately afterward.

After the overlay pass, restore the normal state:

```ts
gl.depthMask(true);
gl.depthFunc(gl.LESS);
```

### Regression symptom

If selected edges disappear while the dim topology cage remains visible, first inspect depth state. A base overlay writing depth at the same surface position can cause the highlight pass to fail.

---

## 8. Vertex marker sizing: CSS pixels vs framebuffer pixels

Vertex dots are editor UI markers, not physical world-space geometry.

Therefore their apparent size should remain stable while the camera zooms.

### Required rule

```text
uiConfig.vertexSize
        ↓
CSS-pixel visual size
        ↓
getMeshVertexPointSizes(...)
        ↓
viewport framebuffer/CSS ratio
        ↓
physical gl_PointSize
```

`gl_PointSize` is measured in framebuffer pixels. On HiDPI displays, one CSS pixel may correspond to 1.25, 1.5, 2, or more framebuffer pixels.

Example with default `vertexSize = 1`:

```text
base visual size     = 3 CSS px
selected / hovered   = 4.5 CSS px
```

At DPR 2:

```text
base gl_PointSize     = 6 framebuffer px -> 3 CSS px on screen
selected gl_PointSize = 9 framebuffer px -> 4.5 CSS px on screen
```

At DPR 1.5:

```text
base gl_PointSize     = 4.5 framebuffer px -> 3 CSS px on screen
selected gl_PointSize = 6.75 framebuffer px -> 4.5 CSS px on screen
```

### Expected zoom behavior

```text
camera zoom changes mesh apparent size
vertex marker screen size stays approximately constant
```

This is intentional. A vertex marker is a selectable editor control and should remain readable/clickable at distance.

### Never do this

```ts
// Scene
pointSize = 3;

// Edit viewport
pointSize = 10;
```

or:

```ts
pointSize = worldRadius * cameraDistance;
```

Both reintroduce inconsistent visual semantics.

---

## 9. Mode behavior matrix

| Mode / viewport | Shaded surface | Topology edges | Selected edge/face | Vertex points |
| --- | --- | --- | --- | --- |
| Static Mesh / Object | Yes | Wireframe toggle only | N/A | No |
| Static Mesh / Vertex | Yes | Dim cage | N/A | Base + selected + hovered |
| Static Mesh / Edge | Yes | Dim cage | Selected edge pass | No |
| Static Mesh / Face | Yes + soft selected/hovered face fill | Dim cage | Selected/hovered face boundary pass | No |
| Scene / Object selection | Normal scene render | Selection/object edge visualization as configured | Object selection color | No |
| Scene / Vertex | Normal scene render | Dim unique topology edges | N/A | Base + selected/hovered |
| Scene / Edge | Normal scene render | Dim unique topology edges | Selected edge color | No |
| Scene / Face | Normal scene render | Dim unique topology edges | Selected face boundaries | No |
| Skeleton associated mesh / shaded | Ghost/shaded mesh | No | N/A | No |
| Skeleton associated mesh / wireframe | Depth prepass only | Shared hidden-line edges | N/A | No |

---

## 10. Selection-to-render data flow

Selection rendering should be reactive to selection state without rebuilding unrelated geometry.

```text
SelectionSystem
├── subSelection.vertexIds
├── subSelection.edgeIds
├── subSelection.faceIds
└── hoveredVertex
        │
        v
viewport selection revision/tick
        │
        ├── Edge mode -> rebuild selected edge index buffer only
        ├── Face mode -> rebuild logical-face fill IBO + collect boundary keys
        └── Vertex mode -> update selected vertex index buffer only
```

The complete topology cage should not be regenerated every frame just because selection changed.

Likewise, point positions should continue to use the mesh's existing position VBO rather than duplicating vertex data.

---

## 11. Common regressions and where to look

### Symptom: shared edges are brighter/thicker than boundary edges

Likely cause:

- adjacent faces are both drawing the same edge

Check:

- use `forEachUniqueMeshEdge(...)` or `buildMeshEdgeIndices(...)`
- do not draw every face edge directly

### Symptom: triangulation diagonal appears inside a quad/ngon

Likely cause:

- renderer used triangle indices instead of logical topology

Check:

- prefer `asset.topology.faces`
- triangle indices are fallback only

### Symptom: Vertex mode can select vertices but shows no dots

Likely cause:

- picking exists but the vertex visualization pass is missing

Check:

- asset viewport: `MeshVertexOverlay`
- Scene viewport: `DebugRenderer` vertex point pass

### Symptom: selected edge/face boundary disappears behind dim cage

Likely cause:

- the base cage wrote depth, or overlay uses `LESS`

Check:

```text
LEQUAL + depthMask(false)
```

for component overlays.

### Symptom: vertex dots are much larger in Edit mode than Scene mode

Likely cause:

- one viewport hardcoded `gl_PointSize`
- one viewport forgot DPR conversion

Check:

- both use `getMeshVertexPointSizes(...)`
- both use `getViewportPixelRatio(...)`

### Symptom: vertex dots change size when camera zoom changes

Likely cause:

- markers were treated as world-space geometry

Expected behavior:

- vertex marker size is screen-space and stays approximately constant

### Symptom: wireframe shows back-side edges through the object

Likely cause:

- wireframe-only mode has no depth prepass

Check:

- hidden-line depth prepass before edge overlay

### Symptom: updating one edge overlay corrupts triangle rendering

Likely cause:

- WebGL2 `ELEMENT_ARRAY_BUFFER` changed while the wrong VAO was bound

Check:

- bind the overlay's own VAO before updating its edge IBO

### Symptom: line thickness differs by browser/device

Likely cause:

- code depends on `gl.lineWidth(...)`

Rule:

- WebGL line width is commonly clamped to 1 px
- implement future thick edges as expanded screen-space geometry instead

---

## 12. Adding a new mesh-based editor

Before writing new rendering code:

1. Reuse `AssetViewport3D` for the host viewport.
2. Use `buildMeshEdgeIndices(...)` for authored polygon edges.
3. Use `MeshEdgeOverlay` for asset-viewport line drawing.
4. If Vertex mode exists, reuse `MeshVertexOverlay`.
5. Use `meshEdgeKey(...)` for all edge selection identities.
6. Use `collectFaceEdgeKeys(...)` for face-boundary highlights.
7. Use `getMeshVertexPointSizes(...)` and `getViewportPixelRatio(...)` for vertex markers.
8. Draw component overlays with `LEQUAL` and depth writes disabled.
9. Use a depth prepass for wireframe-only hidden-line views.
10. Do not create editor-specific edge extraction, point-size constants, or duplicate position buffers.

---

## 13. Regression checklist

Run these manually after changing mesh component rendering.

### Topology

- [ ] Quad/ngon topology does not show internal triangulation diagonals.
- [ ] Shared edges have the same brightness as boundary edges.
- [ ] Wireframe remains correct for assets that have no `topology.faces` (triangle fallback).

### Vertex mode

- [ ] Vertices are visible when Vertex mode is active.
- [ ] Selected vertex is visibly larger/highlighted.
- [ ] Hovered vertex is visibly highlighted.
- [ ] Hidden/back-side vertices remain depth-occluded as intended.
- [ ] Scene and Static Mesh Editor vertex dots have the same apparent size.
- [ ] Point size remains stable while zooming.
- [ ] Point size remains visually stable at DPR 1, 1.25, 1.5, and 2.

### Edge / Face mode

- [ ] Dim topology cage remains visible.
- [ ] Selected edges render over the dim cage.
- [ ] Selected face boundaries use the same edge identity/color as Edge mode.
- [ ] Highlight does not disappear due to depth equality.

### Skeleton associated mesh

- [ ] Shaded associated mesh still renders normally.
- [ ] Wireframe mode uses authored polygon edges.
- [ ] Back-side wireframe edges are hidden.
- [ ] Front-side edges do not z-fight.

### Preferences

- [ ] Changing `Preferences -> Vertex Size` affects Scene and Static Mesh Editor consistently.
- [ ] No viewport introduces independent hardcoded point sizes.

---

## 14. Key files

```text
engine/MeshEdgeGeometry.ts
    canonical edge identity and edge extraction

engine/MeshComponentVisualStyle.ts
    shared CSS-pixel / DPR vertex marker sizing

editor/viewports/MeshEdgeOverlay.ts
    asset-viewport edge GPU pass

editor/viewports/MeshVertexOverlay.ts
    asset-viewport vertex point GPU pass

editor/components/StaticMeshEditor.tsx
    Object / Vertex / Edge / Face render orchestration

engine/modules/CoreModules.tsx
    Scene viewport mesh-component visualization through DebugRenderer

editor/components/SkeletonEditor.tsx
    associated-mesh shaded/wireframe orchestration

docs/MESH_EDGE_RENDERING.md
    lower-level edge rendering contract
```

---

## 15. Design principle

The reusable boundary is:

```text
shared topology + identity + visual semantics
                     |
                     v
          viewport-specific renderer
```

Do not duplicate the rules just because two viewports use different drawing backends.

If Scene view and an asset editor disagree visually, first look for a duplicated rule (edge extraction, point-size constant, color, depth state, or DPR handling) and move that rule back into the shared contract rather than adding another viewport-specific correction.

---

## 16. Surface shading / color-output dependency

Component overlays sit on top of the shared surface pipeline. Before changing shaded mesh appearance, render modes, viewport background, or direct-preview color output, read [`SHARED_VIEWPORT_MESH_SHADING.md`](./SHARED_VIEWPORT_MESH_SHADING.md).

`MeshEdgeGeometry` / `MeshVertexOverlay` define component visualization; `MeshSurfaceContract` defines the mesh surface and linear-to-display contract underneath them. Keep these responsibilities separate.

### Symptom: Face mode only highlights the outline and does not feel interactive

Likely cause:

- the logical-face fill overlay is missing or stale

Check:

- `MeshFaceGeometry.buildMeshFaceTriangleIndices(...)` uses `triangleToFaceIndex`
- `MeshFaceOverlay` is updated on selection/hover revision changes
- selected fill is stronger than hover fill, but both remain translucent
- hovered fill is suppressed when that same face is already selected


---

## Static Mesh normal overlays

`engine/MeshNormalGeometry.ts` owns CPU generation of optional normal-debug line geometry:

- `buildFaceNormalLines()` emits one center-to-normal line per **logical polygon face**.
- `buildVertexNormalLines()` emits one line per stored mesh vertex normal.

`editor/viewports/MeshNormalOverlay.ts` owns the dynamic GL_LINES pass. It has its own compact VBO because normal
endpoints are derived positions rather than existing mesh vertices. It uses the shared asset viewport line shader,
`LEQUAL`, and disabled depth writes so the overlay tests against the shaded surface without affecting later passes.

When enabled, the Static Mesh render order extends to:

```text
1. shaded mesh triangles
2. dim topology cage / object wireframe
3. selected/hovered Face fill (optional)
4. selected Edge or Face boundary overlay
5. vertex component points
6. face/vertex normal debug lines (optional)
```

Normal debug overlays are presentation state only. Do not add them to selection, topology, asset history, or
persisted mesh geometry.
