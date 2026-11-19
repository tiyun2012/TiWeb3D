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

For a terminal endpoint (`selcount == 1`, ordinary `edgecount >= 3` case), Blender may then move the profile plane through the two boundary points and the original source vertex. Ti3D mirrors that step: intermediate profile samples are projected **along the selected-edge direction** onto that terminal plane. This matters on slanted/skewed geometry. Without it, the outer rails can be correct while the interior segment rows bow out of the endpoint face, producing a visibly different result from Blender even though the strip remains manifold.

The generated profile arc must be owned by existing topology rather than blindly capped. A real corner VMesh (`POLY`, `TRI_FAN`, or `ADJ`) owns its sampled profile arc; an `M_NONE` corner has no separate vertex patch, so a closed opposite reconstructed source face may own that arc instead. **VMesh ownership is explicit in the bevel plan** and is semantic, not just `boundary.length < 3`. In particular, adding `segments > 1` can turn a two-point terminal profile into many sampled points without changing `M_NONE` into a cap.

This is critical on an open box/hole rim. A `selcount == 1` open terminal with only two effective boundary vertices stays `meshKind = NONE`; its intermediate profile samples simply form part of the intentional open boundary, so no diagonal/top cap is introduced across the missing-face gap. A closed `M_NONE` terminal instead lets the opposite reconstructed source face consume the profile arc, preserving manifold closure without a separate corner polygon.

A terminal with **three** effective boundary vertices is different. Blender classifies that case as `M_TRI_FAN`: the third boundary vertex is a persistent fan apex, and when `segments > 1` every adjacent pair of profile samples forms its own triangle with that apex. Ti3D records this as `meshKind = TRI_FAN` plus `fanPointKey` and materializes separate logical triangle faces. Do not replace this with one n-gon cap: render triangulation is not authored topology, and the radial fan edges are required for later selection/editing and to match Blender's result.

There is a broader Blender **two-profile weld** case that must be classified before `POLY`/`ADJ`. If exactly two selected edges meet at a source vertex and the effective pre-subdivision VMesh boundary has exactly two `BoundVert` roles (`selcount == 2 && vm.count == 2` in Blender), the corner is `M_NONE` regardless of the angle between those two selected edges. The two independently sampled profile rows are orientation-matched, reconciled (midpoint when their local profile planes differ), and canonicalized to the same generated topology vertices. No corner face is authored. A straight/opposite selected-chain split is only one special geometry inside this more general weld rule; an ordinary 90-degree face-loop corner on a box is also a two-boundary weld. Treating that 90-degree case as `POLY` works accidentally for `segments = 1`, but `segments > 1` turns the sampled rows into a false cap with the small pole/triangle structures seen in the editor screenshots.

General closed segmented corners now have a **structured `M_ADJ` VMesh baseline** only after the `M_NONE` weld cases are excluded. When `segments > 1`, two or more selected sectors meet at a closed corner, and the effective boundary still requires a real corner surface (three or more effective boundary roles after weld/classification), the planner promotes the one-segment `POLY` corner to `ADJ`. Profile rows are carried through a canonical `(boundary sector, ring, segment)` grid instead of being dumped into one n-gon cap. This removes pole-style authored diagonals while preserving the already-correct terminal `M_NONE`, two-profile `M_NONE` weld, and `M_TRI_FAN` cases.

The topology/indexing and odd/even center rules follow Blender's `mesh_vert_canon()` / `bevel_build_rings()` structure. Ti3D currently places the interior stations with a stable Coons interpolation from the solved profile boundary and a profile-fullness center target; Blender goes further with cubic subdivision plus pipe/special-triangle branches. Treat the current geometry placement as the **baseline ADJ implementation**, not the final pixel-identical Blender interpolation.

## General segmented VMesh (`M_ADJ`) implementation

This section is the implemented contract for the common closed-manifold segmented corner path and the extension boundary for future Blender parity work.

### Why `M_ADJ` is required

Once `segments > 1`, a general corner cannot be represented faithfully by taking all sampled boundary points and triangulating one cap polygon. That strategy may remain manifold, but it creates authored pole vertices and diagonal edges that Blender does not create, changes local edge flow, and can make overlap limiting react to artificial short edges rather than the intended bevel surface.

The required topology is a structured VMesh whose rows continue the sampled edge profiles through the shared vertex. In Blender terminology this is the `M_ADJ` (adjacent-edges) mesh pattern and is built by `bevel_build_rings()` after the boundary and profile samples are known.

Conceptually:

```text
OLD staging fill                         IMPLEMENTED M_ADJ topology

profile samples                          profile samples
p0--p1--p2--p3                           p0--p1--p2--p3
 \   \  | /                              |   |   |   |
  \   \ |/        authored poles         q0--q1--q2--q3
   \   [x]        / diagonals             |   |   |   |
    \  / |                              r0--r1--r2--r3
     apex / n-gon
```

The exact grid shape depends on valence and segment parity, but the invariant is that profile stations remain ordered and are connected by VMesh rows/rings rather than collapsed into one arbitrary triangulated cap.

### Mesh-kind selection policy

Do not choose the corner fill from `segments` alone. First classify the **effective pre-subdivision VMesh boundary roles** after topology-safe collapse/weld:

| Local case | Required mesh kind | Rule |
| --- | --- | --- |
| Two selected edges + exactly two effective boundary roles (`selcount == 2`, `VMesh count == 2`) | `NONE` / weld | Share/reconcile the two profile rows; no corner surface. Angle does not matter. Straight continuation and 90-degree face-loop corners are both instances. |
| True two-boundary terminal / open-rim no-cap (`selcount == 1`) | `NONE` | Profile samples belong to reconstructed faces/open boundary; subdivision must not create a cap. |
| Three-boundary terminal | `TRI_FAN` | One persistent apex + one authored triangle per profile segment. |
| General corner with `segments == 1` | `POLY` | Keep the already-stable one-segment corner patch. |
| General corner with `segments > 1` and two or more beveled sectors requiring a corner surface | `ADJ` | Build a structured segmented VMesh. |
| Future cutoff/custom-profile endpoint | `CUTOFF` (future) | Keep separate from `ADJ`; do not overload `POLY`. |

`M_ADJ` must never be used to paper over unsupported topology. Multi-gap open fans, non-manifold selected edges, or ambiguous face ordering still reject/fall back according to the normal topology policy until they receive an explicit design.

### Planned kernel data model

Extend the plan-level mesh kind without changing the public bevel options:

```ts
type BevelMeshKind = 'NONE' | 'POLY' | 'TRI_FAN' | 'ADJ';

interface BevelCornerPlan {
  sourceVertexId: number;
  meshKind: BevelMeshKind;
  boundary: BevelBoundaryRole[]; // ordered pre-subdivision VMesh boundary
  segments: number;
  profile: number;

  // Present only for ADJ.
  adj?: {
    boundaryRows: string[][];     // profile sample keys arriving from beveled sectors
    rings: string[][];            // generated interior VMesh rows/rings
    faces: string[][];            // authored polygon boundaries, usually quads
    centerPointKey?: string;      // only if parity/topology genuinely requires one
  };
}
```

The actual TypeScript names may differ, but the ownership rules may not: generated VMesh points belong to one source `BevVert`-equivalent corner plan; edge-strip plans consume the corner's boundary/profile points rather than creating independent duplicates.

### Construction algorithm

Implement `ADJ` only after the existing selected-edge network, corner boundary, width clamp, and profile sampling have succeeded.

1. **Keep the current ordered `BevVert` boundary.** Do not infer corner order from render triangles or generated coordinates.
2. **Identify each beveled boundary interval.** Every `BoundVert -> next BoundVert` interval owned by a selected `EdgeHalf` has `segments + 1` profile samples.
3. **Normalize orientation.** All arriving profile rows must run in the same VMesh winding direction. Reverse row indexing when the neighboring edge's natural profile direction is opposite.
4. **Allocate VMesh stations by boundary index and profile index.** Treat `(boundary-sector, profile-station)` as the semantic coordinate system before assigning mesh vertex IDs. This is the analogue of Blender's indexed VMesh storage.
5. **Reuse boundary/profile vertices first.** The outermost stations reference already-planned edge-profile keys. Never duplicate a boundary sample merely because two faces consume it.
6. **Generate interior rings/rows.** Interpolate/construct the interior from corresponding profile stations using the corner boundary geometry, preserving monotone ordering from one beveled sector to the next. The initial implementation should target Blender's common Grid Fill / adjacent-edge pattern, not an arbitrary triangulation.
7. **Handle segment parity explicitly.** Odd/even segment counts may have different center topology. Do not force a center pole for every corner. A center vertex is legal only when the chosen VMesh pattern requires it.
8. **Emit authored faces from the VMesh cells.** Prefer quads where four distinct stations define a valid cell; compact a cell to a triangle only when topology-safe welding collapses two semantic roles. Render triangulation remains a compiler concern.
9. **Reconstruct original faces after the corner ownership is known.** Source n-gons consume the same VMesh boundary keys; they must not recreate competing points along the bevel boundary.
10. **Run plan validation before mutation.** Check duplicate consecutive keys, zero-area cells, reversed orientation, local self-intersection, and source-corner-scoped coincident vertices. If invalid, reduce width through the existing Clamp Overlap loop when width-dependent; otherwise reject atomically.

### Topology invariants for `ADJ`

The implementation is accepted only if all of the following remain true:

- one geometric profile station at a shared corner maps to one logical topology vertex;
- edge strips and corner VMesh share the same boundary vertices;
- no global position-based weld is used;
- no authored diagonal is introduced solely because an n-gon render triangulator needs triangles;
- each closed-manifold generated half-edge has exactly one opposite half-edge;
- intentional open boundaries stay open;
- source Mesh Shell count changes only when the operation semantically splits/joins shells (ordinary bevel must not);
- `segments = 1` remains byte/topology compatible with the current stable path except for unrelated bug fixes;
- `NONE` and `TRI_FAN` decisions are made from effective boundary roles **before** profile subdivision and are not promoted to `ADJ` merely because sampled points increase the point count.

### Regression captured from the September 21 screenshot

The original failing case is frozen as the behavioral target for the ADJ work:

```text
Input:
- already modeled rounded/chamfered solid corner
- one newly selected connected edge/corner network as in the reference screenshot
- width   = 0.25
- segments = 3
- profile  = 0.3
- Clamp Overlap = true

Pre-ADJ symptom (historical):
- operation succeeded but reported a reduced effective width (~0.23685 in the captured run)
- the general corner was filled as a pole/diagonal patch
- vertex mode exposed several interior authored points/diagonals not present in Blender

Implemented topology requirement:
- corner plan selects ADJ
- three profile strips continue through the corner as structured VMesh rows
- no arbitrary pole-style diagonal fan is authored
- no coincident-but-distinct VMesh vertices
- edge strips share boundary vertices with the corner grid
- one Mesh Shell remains
- manifold half-edges remain paired
- Clamp Overlap is driven by real source/profile collisions, not artificial cap diagonals
- Undo/Redo remains one selection-level history step
```

The regression asserts topology, not screenshot pixels. The current focused three-sector `segments=3` case produces **six quads plus one center triangle (7 ADJ faces)**, while the even `segments=4` parity regression produces **12 quads and no center n-gon**. Both remain one shell with paired manifold half-edges. A full cube at `segments=3` produces 56 ADJ corner cells (7 per original corner) in addition to 36 edge strips and 6 reconstructed source faces.

### Implemented baseline and extension order

The current implementation now includes:

1. `ADJ` in the internal corner-plan enum/type.
2. Canonical VMesh indexed storage keyed by boundary sector + ring + segment station.
3. The common closed-manifold multi-selected corner path.
4. Shared perimeter/profile keys between edge strips, reconstructed faces, and VMesh cells.
5. Blender-style parity topology: odd segment counts end in a center n-gon; even counts converge to one shared center vertex.
6. Materialized authored VMesh cells rather than render-only triangulation.
7. Regressions for `segments=3/profile=.3/width=.25`, even `segments=4`, and the full segmented cube, plus all earlier terminal/open/reflex cases.

Next, improve **geometry placement and coverage**, not the basic ADJ ownership model: port Blender's cubic subdivision and special `pipe_adj_vmesh` / `tri_corner_adj_vmesh` behavior, then generalize to concave/inner miters, open multi-selected fans, and custom profiles.

Do **not** mix those geometry refinements with Miter Outer/Inner UI, custom profile widgets, UV interpolation, Harden Normals, or material assignment. Those features should continue to build on the stable VMesh topology contract.

### Blender source anchors for the port

When implementing, start from these concepts in `bmesh_bevel.cc` rather than copying unrelated surrounding code:

- `MeshKind` / `M_ADJ` — distinguishes structured corner filling from `M_NONE`, `M_POLY`, and `M_TRI_FAN`;
- `VMesh` — stores the common segment count and indexed replacement mesh for one beveled vertex;
- `set_profile_params()` / profile coordinates — source of the sampled rows arriving at the VMesh boundary;
- `build_boundary()` — authoritative ordered corner boundary and mesh-kind decision;
- `build_vmesh()` — maps boundary/profile data into the vertex mesh;
- `bevel_build_rings()` — materializes `M_ADJ` as structured rings/cells;
- weld handling around `M_NONE` — preserve the general `selcount == 2 && boundaryCount == 2` profile-row weld, including straight chains and angled face-loop corners.

Source: <https://github.com/blender/blender/blob/main/source/blender/bmesh/tools/bmesh_bevel.cc>

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
- a slanted source edge with `segments = 5` whose interior profile samples must stay in the two terminal endpoint-face planes after profile-plane projection;
- two collinear selected edge halves split by an unrelated loop with `segments = 5`; the middle station shares one profile row, creates no synthetic cap, and remains manifold;
- a four-edge connected cube loop with `segments = 3`, verifying that profile subdivision preserves joint corner ownership and manifold pairing;
- a three-sector closed corner with `segments = 3`, `profile = 0.3`, `width = 0.25`, producing 6 ADJ quads plus one center triangle;
- the same three-sector corner with even `segments = 4`, producing 12 ADJ quads and no center n-gon;
- all 12 cube edges with `segments = 3`, producing 36 edge-strip faces plus 56 ADJ corner cells (7 per original corner) while remaining one closed shell;
- oversized three-edge corner with network-wide overlap clamping;
- the same oversized case with `clampOverlap: false`, verifying atomic rejection/rollback;
- repeated bevel of the generated longitudinal rails across reconstructed 5-, 7-, and 11+-vertex n-gons, including network-wide clamping;
- a strongly warped/non-planar corner where the old whole-face-plane solver inverted across a neighboring edge;
- a straight/near-collinear `selcount == 1` terminal split where the offset boundary must stay perpendicular instead of collapsing back to the source vertex;
- a manifold selected edge whose endpoints sit on open one-ring face chains, including a richer endpoint with an extra unselected face and a generated terminal polygon patch;
- an open-top box rim with one selected vertical edge and `segments = 5`; the two-point terminal remains `M_NONE`, produces five bevel strips, preserves the open rim, and creates **no** synthetic terminal cap;
- a closed four-edge face loop with `width = 0.25`, `segments = 3`, `profile = 0.3`; every loop corner has `selcount = 2` and two effective boundary roles, so all four corners use `M_NONE` profile-row welding, produce **zero corner faces**, and the cube has exactly `6 reconstructed + 12 strips = 18` logical faces;
- a single selected edge whose terminal has three effective boundary vertices with `segments = 3`; the endpoint is `TRI_FAN`, creates three authored fan triangles sharing one apex, and exposes the radial profile edges Blender creates;
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
2. **Refine `M_ADJ` geometry toward Blender cubic subdivision.** The common structured topology is implemented; port Blender's subdivision/interpolation and special pipe/triangle-corner branches so interior station placement matches Blender more closely at high curvature and irregular valence.
3. **Miter modes.** Add explicit sharp/patch/arc outer and inner miter decisions rather than a single polygon junction rule.
4. **Full inner/outer reflex miter behavior.** Local reflex classification and zero-offset endpoint fallback are implemented; port Blender's remaining edges-between projection and explicit inner/outer miter policy for multi-edge concave fans.
5. **Per-edge widths/weights.** Move from one network width to left/right edge-half offsets.
6. **Custom loop data.** Interpolate UVs, normals, colors, seams, sharp flags, and material attribution from representative faces.
7. **Stronger collision limiting for sampled profiles.** The planner validates rebuilt faces and longitudinal profile consumption; extend this toward Blender's broader geometry-collision tests between independent curved profile components.

The critical invariant across all milestones is unchanged: **analyze and solve the entire selected vertex/edge network before mutating topology.**
