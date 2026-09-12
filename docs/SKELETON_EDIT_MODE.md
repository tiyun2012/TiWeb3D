# Skeleton Edit Mode / Confirmed Pose Workflow

## Purpose

Skeleton editing is transactional. The normal Skeleton workspace is a **saved-pose view**: users may select joints, inspect them, navigate the camera, and change display overlays, but the confirmed skeleton structure and bind pose are read-only.

A skeleton can only be modified after entering **Edit Skeleton** mode. Edit mode operates on a private `BoneData[]` draft owned by `SkeletonEditor`; the `AssetManager` copy remains the last confirmed pose until the user presses **Confirm**.

## User flow

```text
Saved Pose / View Mode
        |
        | Edit Skeleton
        v
Private Draft / Edit Mode
   |        |        |
   | Reset  | Cancel | Confirm
   |        |        |
   |        |        +--> clone draft -> AssetManager.updateAsset -> Saved Pose
   |        +-----------> discard draft ---------------------------> Saved Pose
   +--------------------> replace draft from saved pose (stay Edit)
```

### Saved Pose / View Mode

- Uses `assetManager.getAsset(assetId).skeleton.bones` as the source of truth.
- Only the Select tool is available.
- Transform gizmos are not connected to the viewport.
- Joint transform fields, rename, reparent, add-child, add-root, and delete operations are disabled.
- Selection, hierarchy expansion, focus, camera navigation, grid, mesh overlay, wireframe overlay, and display settings remain usable.
- Entering this mode after Cancel always rebuilds the preview engine from the last confirmed skeleton.

### Edit Skeleton mode

- `SkeletonEditor` deep-clones the confirmed `BoneData[]` into `editBonesRef`.
- The editor/hierarchy/inspector render against an `editorAsset` whose skeleton points at this draft.
- Move/Rotate/Scale gizmos are enabled.
- Hierarchy structure changes and inspector changes mutate only the draft.
- Gizmo movement updates the draft bind pose/inverse bind pose live for visual feedback, but **does not emit `ASSET_UPDATED`**.
- The header displays whether the draft is clean or unsaved.

### Reset

- Replaces the current draft with a fresh clone of the confirmed skeleton.
- Keeps Edit mode active.
- Clears the dirty state.
- Rebuilds preview entities from the confirmed pose.

### Cancel

- Discards `editBonesRef`.
- Does not call `AssetManager.updateAsset`.
- Returns to Select-only Saved Pose mode.
- Rebuilds the preview from the confirmed skeleton, so all unconfirmed transforms/renames/reparenting/add/delete operations disappear.

### Confirm

- Clones the draft again before committing so the editor draft is not retained by reference.
- Calls `assetManager.updateAsset(...)` once for the completed edit transaction.
- Clears the draft and dirty state.
- Returns to Saved Pose mode, now showing the newly confirmed pose.

## Component contracts

### `SkeletonEditor`

Owns the edit transaction:

- `isEditMode`
- `editDirty`
- `editBonesRef`
- `beginSkeletonEdit()`
- `resetSkeletonDraft()`
- `cancelSkeletonEdit()`
- `confirmSkeletonEdit()`

Only `confirmSkeletonEdit()` may persist a draft to `AssetManager`.

### `AssetViewport3D`

Supports host-scoped `allowedTools`. The Skeleton editor passes:

```ts
isEditMode
  ? ['SELECT', 'MOVE', 'ROTATE', 'SCALE']
  : ['SELECT']
```

This filters both toolbar buttons and Q/W/E/R keyboard activation. The Skeleton editor also passes `gizmoSystem={null}` outside Edit mode so a hidden transform path cannot remain active.

### `JointInspector`

Accepts:

- `editable`
- `onSkeletonChange`

When `editable=false`, transform/name/parent/reset controls are read-only. When `onSkeletonChange` is provided, changes are delegated to the editor draft instead of calling `AssetManager` directly.

### `SkeletonHierarchy`

Accepts:

- `editable`
- `onSkeletonChange(bones, { structural })`

Selection/expand remain available in Saved Pose mode. Rename, F2, context-menu structural edits, add, and delete require `editable=true`.

## Why this is required

Previously the Skeleton editor wrote `bindPose` directly into the live asset during gizmo movement and then broadcast asset updates. That created two problems:

1. there was no meaningful Cancel/Confirm boundary—the "saved" pose was already changed while dragging;
2. high-frequency global `ASSET_UPDATED` events could create expensive React/engine feedback loops.

The private-draft model solves both. Mouse movement is local editor state; persistence is a deliberate user action.

## Regression checklist

Before merging Skeleton editor changes, verify:

1. Open Skeleton workspace: status says **Saved Pose** and only Select is available.
2. W/E/R in Saved Pose mode do not enable transform tools.
3. Joint transform fields, rename, parent selection, add/delete are disabled in Saved Pose mode.
4. Enter Edit Skeleton, move a child joint, then Cancel: the joint returns exactly to its previously confirmed pose.
5. Enter Edit Skeleton, rename/reparent/add/delete joints, then Cancel: hierarchy returns exactly to the confirmed hierarchy.
6. Enter Edit Skeleton, modify the skeleton, press Reset: confirmed pose returns while Edit mode remains active.
7. Enter Edit Skeleton, modify and Confirm: leave Edit mode and the new pose remains after reopening the editor.
8. During gizmo drag, no per-mousemove `ASSET_UPDATED` feedback loop appears in the console.
9. Switching away/unmounting an unconfirmed Skeleton editor cannot mutate the `AssetManager` skeleton because the draft is private.
