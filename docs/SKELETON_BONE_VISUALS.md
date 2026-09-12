# Skeleton Bone Visual Geometry

## Purpose

Bone drawing must stay structurally stable while joints are edited, but it must still point at the live child. The parent joint center is the transform pivot; the visible bone is geometry between the two joint spheres, not a line/primitive that begins at the parent center.

This contract applies to `SkeletonEditor`, `SkeletonTool`, animation/debug playback, and every future skeleton viewport.

## Problems encountered

Two different visual models caused confusing behavior during development.

The original implementation rebuilt the whole bone frame from the live parent-to-child vector and an arbitrary world-up fallback. It also derived width from bone length. Moving a child could therefore make the bone roll/flip and become thicker or thinner.

The first stability fix went too far in the other direction: it kept the parent-side waist in the rest/bind direction while only the child tip moved. That removed twist, but it made part of the bone look pinned in space. When the child moved sideways, the bone did not swing naturally around the parent joint center.

## Current contract

### 1. Parent center is the pivot, not a visible endpoint

For parent center `P`, child center `C`, normalized live direction `F`, parent radius `Rp`, and child radius `Rc`:

```text
baseCenter = P + F * (Rp * baseOffsetScale)
tip        = P + F * (distance(P,C) - Rc)
```

The default `baseOffsetScale` is slightly larger than `1`, so the four-point base ring sits just outside the parent wire sphere. The tapered tip stops at the child sphere surface.

No bone line is emitted from `P`. This avoids the visual artifact where the bone appears to grow from the middle of the joint sphere.

### 2. Bone direction is always live

The visible bone always uses the current `P -> C` direction. Moving a child sideways rotates/sweeps the whole bone around the parent center. Moving it farther away changes the free span but does not change cross-section size.

### 3. Thickness comes only from the parent joint radius

`getSkeletonJointRadius(..., 'normal')` supplies the structural parent radius. The base ring uses:

```text
baseRadius = parentRadius * widthScale
```

It never uses parent-child distance. Selection/hover may enlarge a joint sphere, but the attached bone still uses the normal structural radius so the bone does not pulse when selection state changes.

### 4. Child radius clips the far end

Callers also pass the child's normal structural radius. The visual tip ends at the near surface of the child sphere instead of penetrating to its center.

If the two joint spheres overlap or leave no positive free span, the bone body is omitted rather than inverted.

### 5. Roll is stable: rest frame -> shortest-arc swing -> live frame

The bone must follow the live child direction without corkscrew twisting around its own axis.

The renderer first builds an authored roll frame from:

- the parent's local/world `X`, `Y`, `Z` axes; and
- the child's stable rest/bind direction.

It then applies the **shortest rotation** that maps the rest direction to the live parent-to-child direction. The same rotation is applied to the rest cross-section axis. This swings the bone as one coherent shape around the parent pivot without choosing an arbitrary world-up vector each frame.

The exact 180-degree case uses the authored rest-up axis as a deterministic fallback, avoiding an arbitrary flip.

### 6. SkeletonEditor and SkeletonTool keep stable rest directions

`SkeletonEditor` writes bind/local data while editing, so it snapshots each child's authored local direction when the preview skeleton is built. `SkeletonTool` also caches visual rest directions per asset. These values are roll references only; they no longer pin the visible base direction.

Animation playback can use the stored bind direction because animated position tracks move the live entities without rewriting the skeleton asset bind pose.

## Resulting shape

Conceptually:

```text
 parent joint                                     child joint
      ( )                                              ( )
       O  pivot                                         O
        \\  base ring                                 /
         [<>]==========================================>
          ^                                            ^
          starts outside parent sphere                 stops at child sphere surface
```

The base ring rotates around the parent center as the child moves, but its radius remains fixed from the parent joint radius.

## Shared implementation

`engine/renderers/DebugRenderer.ts` owns the shared geometry contract:

- `getSkeletonJointRadius`
- `getMatrixUnitAxes`
- `transformLocalDirectionByAxes`
- `getBoneRestDirectionWorld`
- `generateBoneOctahedronLines`
- `DebugRenderer.drawBoneOctahedron`

Despite the legacy `Octahedron` function name, the current wire shape is a surface-anchored four-point base tapered to the child surface. Keep one shared implementation rather than duplicating bone math in editors/tools.

## Regression checklist

1. **Parent surface start:** no visible bone segment begins at the parent joint center.
2. **Child surface end:** the tapered tip stops at the child sphere rather than continuing to its center.
3. **Orbit test:** drag the child in a large circle around its parent. The whole bone must swing around the parent center.
4. **No corkscrew test:** during that orbit, the four-point cross-section must not arbitrarily spin/flip around the bone axis.
5. **Length test:** drag the child farther/closer along one direction. Base thickness must remain unchanged.
6. **Parent rotation:** rotate the parent. The authored roll frame must rotate with the parent local frame.
7. **Selection state:** select/deselect parent or child. Sphere highlight size may change; bone thickness must not.
8. **Root scale:** a root parent with non-default Root Scale must produce a matching structural bone base.
9. **Short bone:** if joint spheres overlap, do not invert the tapered body.
10. **Animation:** animated child translation must swing the same surface-anchored shape as editor manipulation.

## Design rule

A bone visual is **a live-direction, parent-pivoted, surface-to-surface connection with parent-radius thickness and transported local roll**.
