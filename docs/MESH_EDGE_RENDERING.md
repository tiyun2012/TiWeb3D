# Mesh Edge Rendering Contract

> For the complete Vertex / Edge / Face rendering pipeline, Scene-vs-asset renderer split, render ordering, and HiDPI vertex marker sizing, see [`MESH_COMPONENT_RENDERING_FLOW.md`](./MESH_COMPONENT_RENDERING_FLOW.md).

## Why this exists

Mesh polygon edges were previously produced by several unrelated paths:

- `StaticMeshEditor` built a private wireframe index buffer.
- the main Scene viewport walked every topology face and pushed lines into `DebugRenderer`, which could draw a shared polygon edge twice.
- Skeleton Editor exposed a Wireframe toggle for its associated mesh, but the wireframe path did not actually draw a shared polygon-edge overlay.
- edge selection code recreated canonical edge ids with ad-hoc `sort().join('-')` expressions.

That made wireframe brightness, topology interpretation, and selection-edge identity inconsistent between viewports.

## Shared architecture

### 1. Canonical edge geometry: `engine/MeshEdgeGeometry.ts`

All mesh edge consumers must use this module.

It provides:

- `meshEdgeKey(a, b)` — one canonical undirected edge id (`min-max`).
- `forEachUniqueMeshEdge(...)` — visits each authored edge once.
- `buildMeshEdgeIndices(...)` — builds a typed `Uint16Array` / `Uint32Array` line-index buffer.
- `buildMeshEdgeIndicesFromKeys(...)` — converts an edge-selection set to a GPU index buffer.
- `collectFaceEdgeKeys(...)` — converts selected logical faces into their polygon-edge set.
- `MESH_EDGE_COLORS` — common neutral/dim/selected defaults.

Logical topology faces are authoritative when present. This is important: rendering triangle indices directly can expose triangulation diagonals that are not authored polygon edges. Triangle indices are only the fallback when logical topology is unavailable.

### 2. Reusable asset-viewport GPU overlay: `editor/viewports/MeshEdgeOverlay.ts`

Asset editors share `MeshEdgeOverlay` instead of creating custom edge VAOs/IBOs. The host owns the position VBO; the overlay owns only its edge VAO and index buffer.

The overlay also protects WebGL2 VAO state: `ELEMENT_ARRAY_BUFFER` updates are performed while the overlay VAO is bound, so updating edge selections cannot accidentally replace a mesh VAO's triangle IBO.

### 3. Reusable vertex-point overlay: `editor/viewports/MeshVertexOverlay.ts`

`StaticMeshEditor` also reuses a dedicated point overlay for Vertex mode. The host mesh VBO remains the single position source; base vertices are drawn with `POINTS`, while selected and hovered vertex ids are redrawn as larger highlight points.

Both edge and vertex component overlays use `LEQUAL` depth testing with depth writes disabled. They still respect the shaded mesh depth (so hidden components remain hidden), but one overlay pass cannot block another pass drawn at the same surface depth.

### 4. Current consumers

- `StaticMeshEditor`
  - object wireframe uses the shared authored-edge buffer;
  - Vertex/Edge/Face edit modes always show a dim topology cage;
  - Vertex mode renders visible component points from `MeshVertexOverlay`, with larger selected/hovered points;
  - selected edges are highlighted from `subSelection.edgeIds`;
  - selected faces reuse `collectFaceEdgeKeys(...)` so their polygon boundaries use the same selection color.
- `SkeletonEditor`
  - associated-mesh Wireframe mode uses the same shared edge source;
  - a depth-only triangle prepass plus polygon offset produces a hidden-line wireframe instead of showing back-side edges through the mesh.
- Scene `MeshModule`
  - uses `forEachUniqueMeshEdge(...)` before sending lines to `DebugRenderer`, so shared polygon edges are not drawn twice;
  - Edge and Face modes use the same canonical edge ids and selected color.
- `SelectionSystem`, `SceneView`, `StaticMeshEditor`, and `MeshTopologyUtils`
  - all use `meshEdgeKey(...)`; do not recreate edge-key sorting locally.

## Rendering rules

1. **Topology first.** If `asset.topology.faces` exists, draw polygon boundaries from those faces.
2. **Triangle fallback only.** If topology is absent, triangle indices are accepted as the edge source and triangulation diagonals are expected.
3. **Unique edges only.** Never walk every face and render all face edges without deduplication.
4. **One edge identity.** Selection, half-edge topology, scene overlays, and asset viewports all use `meshEdgeKey`.
5. **Component modes show topology.** Vertex/Edge/Face modes should keep a dim cage visible even if the explicit Wireframe toggle is off.
6. **Selection is a second pass.** Selected Edge/Face boundaries are drawn over the dim cage with `MESH_EDGE_COLORS.selected`. The dim cage must not write depth or it can hide the selected pass at identical depth.
7. **Vertex mode renders points.** Base vertices, selected vertices, and hovered vertices use `MeshVertexOverlay`; do not duplicate point VAOs per editor.
8. **Hidden-line wireframe needs depth.** A wireframe-only preview should write mesh depth first, then draw lines. Use polygon offset on the depth prepass so front edges remain stable instead of z-fighting.
9. **Do not depend on `gl.lineWidth`.** WebGL implementations commonly clamp line width to 1 px. If thicker polygon edges become a requirement, use a screen-space expanded-line renderer rather than per-view `gl.lineWidth` hacks.

## Extension checklist

When adding a new mesh-based viewport:

1. Reuse `AssetViewport3D` for the viewport host.
2. Build edge data with `buildMeshEdgeIndices(...)`.
3. Render asset-viewport edges with `MeshEdgeOverlay`.
4. If the viewport exposes Vertex mode, render component points with `MeshVertexOverlay`.
5. Use `meshEdgeKey(...)` for edge selections and topology lookups.
6. Reuse `MESH_EDGE_COLORS` unless a user-configurable color overrides it.
7. Do not duplicate wireframe extraction or face-edge loops inside the editor.


## Vertex marker size contract

Vertex markers are screen-space UI, not world-space geometry. Scene view and asset edit view must therefore use the same CSS-pixel size policy and convert it to framebuffer pixels using the active viewport pixel ratio.

- `uiConfig.vertexSize` is interpreted as a visual/UI scale.
- `getMeshVertexPointSizes(...)` computes base/selected/hovered sizes.
- `getViewportPixelRatio(...)` converts CSS-pixel intent to WebGL `gl_PointSize`.
- Zooming changes mesh size on screen but must not independently change marker pixel size.
- Scene view and Static Mesh edit view must not hardcode different point sizes.

This prevents HiDPI and zoom-dependent visual mismatches between the main Scene viewport and asset editors.
