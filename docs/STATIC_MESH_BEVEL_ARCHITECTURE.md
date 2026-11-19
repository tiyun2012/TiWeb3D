# Static Mesh Bevel Architecture

## Why the previous batch bevel failed

The old normal-mesh `bevelEdges()` decomposed vertex-disjoint selections into repeated single-edge mutations and only used the joint planner when selected edges shared an endpoint. That is unsafe in two ways: connected edges double-solve their common corner, while repeated bevel commands on the newly generated disjoint rails independently consume the same reconstructed n-gon neighborhoods and quickly hit short-edge failures.

Blender treats the **entire selected edge set** as one bevel graph whether the selected components touch each other or not. Ti3D now does the same for closed-manifold one-rings and the common one-gap open terminal fan: geometry planning and overlap limiting happen before the first topology mutation.

## Blender source model

The implementation direction is based on Blender's current `source/blender/bmesh/tools/bmesh_bevel.cc`:

- `EdgeHalf` stores one end of an incident edge and links incident edges in cyclic order around a bevel vertex.
- `BevVert` owns the complete local edge fan plus `selcount`, the number of beveled edges at that vertex.
- `BoundVert` is one vertex on the cyclic boundary that replaces the original corner.
- `VMesh` describes how that boundary is filled.
- `bevel_vert_construct()` gathers incident topology and orders edges by shared faces before geometry is built.
- `build_boundary()` solves one circular corner boundary; it treats one selected edge as a terminal special case and multiple selected edges jointly.
- `offset_meet()` computes junctions from intersections of offset edge lines rather than assuming that every neighbor can simply be shortened by the same world distance.
- `build_vmesh()` creates the actual corner vertices/interior only after the boundary is known.
- `bevel_build_edge_polygons()` creates strips along selected edges from the already-solved endpoint boundaries.
- `bevel_limit_offset()` computes a global safe offset before final geometry generation when overlap limiting is enabled.

Source: <https://github.com/blender/blender/blob/main/source/blender/bmesh/tools/bmesh_bevel.cc>

## Ti3D implementation

`engine/mesh-editing/MeshBevelKernel.ts` is the topology/geometry planning layer for joint bevels. `segments = 1` keeps the exact sharp-chamfer path that the earlier robustness work stabilized; `segments > 1` adds sampled profile rows on top of the same solved corner boundaries. The kernel does not assign final numeric mesh IDs and does not mutate the asset.

```text
LogicalMesh selection
      |
      v
transient Construction adapter
      |
      v
buildJointBevelPlan()
  - topology index
  - cyclic vertex stars or one-gap face-chain stars
  - selected-edge classification
  - local corner-plane offset intersections
  - reflex/out-of-segment fallbacks
  - shared corner boundaries
  - profile sampling when segments > 1
  - face-boundary collision validation
  - overlap scale / bounded width search
      |
      v
applyJointBevelPlan()
  - materialize planned points
  - reconstruct original faces once
  - create `segments` bevel strip faces per selected edge
  - orient/create corner caps
  - compact vertices
  - rebuild LogicalMesh / half-edges / shells
```

The separation is intentional. Geometry planning must be complete before the first face is rewritten so connected selections cannot become dependent on mutation order or post-compaction numeric IDs.

## Segments and profile

Ti3D now treats `segments` as a first-class bevel parameter rather than as a presentation-only subdivision. The public normal-mesh APIs default to `segments = 1`, which is deliberately routed through the already-tested one-segment geometry. For `segments = N`, each selected source edge produces `N` strip faces and `N + 1` longitudinal profile rails.

The profile parameter is normalized to `0..1` and defaults to `0.5`. The implementation follows Blender's superellipse convention closely enough to keep the same important landmarks:

- `profile = 0.5` -> circular quarter profile (`r = 2`);
- `profile = 0.25` -> straight/chamfer profile (`r = 1`);
- profile only changes geometry when `segments > 1`;
- profile samples include both boundary endpoints, so a `segments = 5` edge has six profile rows.

For each endpoint of a selected edge, the kernel first solves the same two outer one-segment boundary points as before. It then finds a profile middle point on the original selected edge and maps normalized superellipse samples through the `start -> middle -> end` local parallelogram, matching Blender's `set_profile_params()` / unit-square profile-map architecture. Samples are redistributed by approximate arc length so segment spacing stays useful for editing instead of clustering strongly near one end.

The generated profile arc must be owned by existing topology rather than blindly capped. If an original reconstructed face owns that side of the corner, its replacement boundary is expanded with the intermediate samples. Otherwise the samples expand the local corner/VMesh boundary. This keeps the new strip grid watertight and preserves the rule that original faces are reconstructed once.

The current multi-segment corner interior is intentionally a **staging implementation**: the expanded corner boundary is emitted as one valid n-gon patch. This is manifold and gives us a stable subdivision/profile API, but it is not yet Blender's final `M_ADJ` / Grid Fill VMesh interior. A later milestone can replace that interior fill without changing the public `segments`/`profile` contract or the already-stable `segments = 1` path.

## Current boundary construction

For each touched vertex, the planner orders the original logical face fan before computing geometry. A manifold interior vertex becomes a cyclic star. A boundary/recess endpoint may instead become one **open face chain** with exactly two boundary ends and one missing-face gap. This matches Blender's `bevel_vert_construct()` ordering: selected edges must still have exactly two incident faces, but the touched vertex can include one-face boundary edges, and Blender prefers one of those boundary edges as the start of the ordered chain. Multiple disconnected gaps/branching fans remain unsupported, consistent with Blender's own TODO around the multi-gap case.

An open one-ring is currently accepted when the touched endpoint has `selcount == 1`. The selected edge must be an interior member of the face chain (there is a real incident face on each side), while the chain's first/last unselected edges are the boundary edges. The terminal boundary is solved along the ordered chain and, when it has three or more points, closed by one new boundary edge across the clipped source corner. A simple two-point terminal is the no-cap case. Multi-selected open-fan miters are intentionally deferred to the general VMesh/miter milestone rather than being silently treated as a cyclic fan.

For a face sector between two selected edges, the corner point is the intersection of those two selected-edge offset lines in a **local corner plane** formed by the two incident boundary directions. The logical face/Newell normal is used to orient that local plane, not as the geometric offset plane for every corner. This mirrors Blender's `offset_meet()` behavior for non-planar faces and avoids skewed intersections on warped n-gons. Blender also switches back to the face normal when the two directions are nearly straight (roughly the 10-degree small-angle region), where a cross-product corner plane is numerically unstable; the Ti3D kernel follows that stabilization rule.

For an ordinary sector between a selected and unselected edge, the selected offset line is intersected with the zero-offset unselected boundary. The resulting on-edge point is shared by every face that uses that unselected edge at the corner. There is one important terminal exception: when those two boundary directions are nearly parallel/straight (Blender's approximately 2-degree epsilon branch), the mathematical lines do not provide a useful meet. Collapsing the result back to the original split vertex would taper the bevel strip to zero. Instead the planner keeps a perpendicular/angle-bisector terminal point at the requested offset distance. That point is intentionally **off the zero-offset neighbor edge** and its exact 3D position must survive into face reconstruction; it must not later be reduced to a scalar distance and projected back onto the neighbor rail.

Reflex corners are classified from the signed local turn. Outside the near-straight terminal exception, a zero-offset/unselected neighbor is treated as a **finite segment**, not an infinite ray: if the mathematical offset meet lies before the corner or beyond the far endpoint, the boundary point is clamped to the nearer endpoint. This matches Blender's `offset_meet()` rule for a zero-offset edge and is important on short, obtuse, reflex, and warped neighborhoods. The unclamped longitudinal distance is still retained for overlap limiting so a far-out mathematical meet can reduce the bevel width even though the emitted boundary point stays on the real edge. When two selected sides compete for one unselected edge, one valid side is preserved if the other cannot produce an interior meet; if neither has a usable interior meet, the planner slides on the rail and lets selection-wide collision limiting determine the final width.

The original face corner is then replaced according to its local pair:

```text
selected + selected     -> selected-pair intersection
selected + unselected   -> shared point on unselected edge
                            (near-straight terminal: perpendicular boundary point)
unselected + selected   -> shared point on unselected edge
                            (near-straight terminal: perpendicular boundary point)
unselected + unselected -> two shared on-edge points
```

Walking those sectors produces the corner boundary. A two-point boundary is a weld/no-cap case. Three or more points create one polygon corner patch. This is the one-segment analogue of Blender's VMesh boundary/polygon mode.

### Boundary equivalence and topology-safe welding

VMesh boundary **roles are not guaranteed to be distinct mesh vertices**. Difficult corners can make two independently computed roles land on the same source-corner position—for example when both zero-offset meets clamp to the same endpoint. Blender represents equivalent/collapsed VMesh entries with the same `BMVert`; leaving two coincident vertices instead produces a zero-width strip, a bow-tie n-gon, or an apparent crack.

The joint kernel therefore canonicalizes near-coincident generated boundary points **only within the same original source vertex / local `BevVert` analogue**. It does not run a global positional `remove doubles`: coincident vertices from different source topology or different Mesh Shells must remain independent. `applyJointBevelPlan()` then compacts consecutive canonical IDs. If one endpoint of a nominal four-corner one-segment strip collapses, the strip is emitted as a valid triangle rather than manufacturing a second vertex at the same position.

The weld tolerance is scale-aware and deliberately very small; source-topology identity remains the primary guard.

## Edge strips

Only after every touched vertex has a final boundary does the planner construct selected-edge strips. A manifold selected edge has one outer rail in each of its two incident original faces. With `segments = 1`, one strip joins those rails between the two endpoint corner solutions. With `segments = N`, the endpoint profile rows define `N + 1` longitudinal rails and the materializer emits one quad/compact polygon between each adjacent pair, for exactly `N` strip faces per source edge.

This order is essential: corner solving is authoritative; edge strips consume corner results rather than independently inventing endpoint offsets.

## Overlap clamping

The planner tracks how far corner boundary points consume each original edge from both endpoints. For a selected edge, **only positive longitudinal progress toward the opposite endpoint counts as consumption**. A valid boundary point may project behind its original endpoint when adjacent face edges flare outward or meet at a strongly obtuse corner; Blender permits that geometry and does not classify the negative projection itself as an inversion. If the positive consumption from both ends would exceed the safe fraction of an edge length, the planner computes a reduction scale, resolves the **entire** network again, and repeats until no edge asks for another reduction. This iterative coupling matters because shrinking for one short edge can expose a different neighboring constraint.

Irregular, concave, and warped n-gons need an additional guard because a valid-looking edge-consumption ratio can still rebuild a collapsed, inverted, or self-intersecting face. Before mutation the kernel reconstructs every affected logical face in memory, projects it using the original face orientation, and validates consecutive spacing, signed area, and simple-polygon intersections. A width-dependent collision is fed back into the planner; with Clamp Overlap enabled, the planner performs a bounded search for the largest valid width instead of committing broken topology.

Public batch results distinguish:

- `requestedWidth`: caller's requested world width;
- `width`: effective width actually used;
- `clamped`: whether overlap limiting reduced it;
- `cornerFaceIds`: generated corner patch logical face IDs.

`clampOverlap` defaults to `true`; `false` changes overlap from a reduction into an atomic validation error.

## Compatibility path

The existing semantic/single-edge implementation remains important for unsupported boundary/non-manifold arrangements and Construction Loop propagation. Normal `bevelEdges()` now **tries the joint network kernel for single, disconnected, and connected selections alike**. The joint kernel handles closed stars, Blender's `edgecount == 2` terminal special case, and one-gap open terminal face chains. The API falls back to the legacy solver only when the joint kernel explicitly reports unsupported endpoint topology *and* the selected edges are vertex-disjoint. Connected selections are never decomposed into repeated single-edge mutations.

This matters especially after a bevel: the editor selects the new longitudinal rails, which are usually disconnected but share reconstructed 5/7/11+ sided source faces. Their width must be clamped as one selection-level solve.

The joint terminal path mirrors Blender's `build_boundary_terminal_edge()` special case for `selcount == 1 && edgecount == 2`. When both selected faces meet the same lone unbeveled neighbor at one endpoint, the endpoint is **not** rejected and the two bevel rails are **not** collapsed onto one point. Instead the implementation creates:

```text
face-side offset point A
          \
           terminal triangle -- artificial point on lone unbeveled edge
          /
face-side offset point B
```

For this degree-2 terminal, the two profile-side offsets deliberately use each incident **face normal**, matching Blender's `offset_in_plane()`. The general warped n-gon meet path uses a local corner plane, but substituting that local plane here can collapse both terminal sides onto the artificial leg and erase the terminal triangle.

This lets the two ends of the same selected edge have independent valence, including total incident-edge counts `2 -> 3` and ordinary closed-manifold `3 -> 4`. The joint kernel keeps `selcount` independent per touched vertex, so a shared selected edge can likewise connect a `selcount=2` corner to a `selcount=3` corner.

Do not extend the open-fan path to multiple selected edges or multiple face-chain gaps by simply wrapping indices. Those cases need explicit gap-aware VMesh/miter construction.

## Tested cases

`npm run test:mesh-construction` covers the connected network cases that previously failed or were rejected:

- a single selected edge whose endpoints have different total incident-edge counts (`2 -> 3`), including Blender's terminal triangle at the degree-2 end;
- a single closed-manifold edge whose endpoints have different valence (`3 -> 4`);
- a shared selected edge whose endpoint `selcount` differs (`2 -> 3`);
- two adjacent selected cube edges sharing one vertex;
- three selected edges meeting at one cube corner (triangular corner patch);
- connected selection through a valence-4 endpoint fan;
- complete four-edge cube loop;
- all 12 cube edges at once (8 triangular corner patches);
- a single source edge with `segments = 5`, `profile = 0.5` (5 strip faces / 6 profile rails), including Undo/Redo;
- a four-edge connected cube loop with `segments = 3`, verifying that profile subdivision preserves joint corner ownership and manifold pairing;
- all 12 cube edges with `segments = 3`, producing 36 edge-strip faces plus 8 shared corner patches while remaining one closed shell;
- oversized three-edge corner with network-wide overlap clamping;
- the same oversized case with `clampOverlap: false`, verifying atomic rejection/rollback;
- repeated bevel of the generated longitudinal rails across reconstructed 5-, 7-, and 11+-vertex n-gons, including network-wide clamping;
- a strongly warped/non-planar corner where the old whole-face-plane solver inverted across a neighboring edge;
- a straight/near-collinear `selcount == 1` terminal split where the offset boundary must stay perpendicular instead of collapsing back to the source vertex;
- a manifold selected edge whose endpoints sit on open one-ring face chains, including a richer endpoint with an extra unselected face and a generated terminal polygon patch;
- a collapsed endpoint where two boundary roles clamp to the same source position; the roles weld to one mesh vertex and the edge strip becomes a triangle with no coincident duplicate vertices.
- existing single-edge, high-valence single-edge, and vertex-disjoint Edge Ring bevel regressions.

The closed cases assert one Mesh Shell and paired half-edges after the operation.


## Reconstructed n-gons and triangulation

Blender's `bev_rebuild_polygon()` walks every loop of an affected original face, substitutes the complete bevel boundary for each touched vertex, and then recreates the face with all accumulated vertices through `bev_create_ngon()`. It does not assume the source face remains a quad. Repeated bevels therefore naturally create larger n-gons.

Ti3D follows the same topology rule: `replaceConstructionFaceBoundaryInState()` preserves the complete ordered logical boundary regardless of vertex count. The render compiler now triangulates that boundary separately:

- convex n-gons keep the stable rotating triangle-fan path (including collinear Split Edge points);
- concave simple n-gons use dominant-plane projection plus ear clipping;
- invalid/self-intersecting boundaries reject atomically instead of producing crossing render triangles.

Logical face identity remains the n-gon boundary. Render triangles are only its compiled representation and must never be treated as authored topology.

## Next milestones toward Blender-level behavior

1. **Multi-selected open fans / multiple gaps.** One-gap `selcount == 1` face chains are implemented. Generalize the VMesh boundary and miter logic without pretending missing face sectors are cyclic.
2. **Full segmented VMesh interior.** Edge profiles and expanded corner boundaries are implemented. Replace the current manifold n-gon corner fill with Blender-style indexed `M_ADJ` / Grid Fill geometry so high-valence segmented corners get structured interior topology.
3. **Miter modes.** Add explicit sharp/patch/arc outer and inner miter decisions rather than a single polygon junction rule.
4. **Full inner/outer reflex miter behavior.** Local reflex classification and zero-offset endpoint fallback are implemented; port Blender's remaining edges-between projection and explicit inner/outer miter policy for multi-edge concave fans.
5. **Per-edge widths/weights.** Move from one network width to left/right edge-half offsets.
6. **Custom loop data.** Interpolate UVs, normals, colors, seams, sharp flags, and material attribution from representative faces.
7. **Stronger collision limiting for sampled profiles.** The planner validates rebuilt faces and longitudinal profile consumption; extend this toward Blender's broader geometry-collision tests between independent curved profile components.

The critical invariant across all milestones is unchanged: **analyze and solve the entire selected vertex/edge network before mutating topology.**
