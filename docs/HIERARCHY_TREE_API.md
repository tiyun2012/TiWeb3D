# Shared Hierarchy & Inline Renaming API

## 1. Architectural Motivation

In the Ti3D Engine Editor, multiple viewports and panels present hierarchical object structures (such as Scene entities, Skeleton joint bones, and project assets). Previously, tree row implementations were duplicated independently across panels, leading to inconsistent behaviors:
- Missing inline renaming support in secondary panels (e.g. skeleton joints were not directly editable inline).
- Divergent keyboard handling (some panels did not isolate keystrokes, accidentally triggering viewport tools like `W`, `E`, `R`, or `Delete` while typing names).
- Inconsistent double-click, F2 shortcut, and accessibility (`title`/`aria-label`) support.
- Redundant memory allocation and unmemoized tree row renders.

To solve this, a unified, well-documented, and reusable API was introduced:
1. **`HierarchyTreeItem`** (`editor/components/HierarchyTreeItem.tsx`): The shared, memoized UI component representing an object in a tree.
2. **`useInlineRename`** (`editor/hooks/useInlineRename.ts`): The shared state hook managing inline renaming lifecycles.

---

## 2. Component Contract: `HierarchyTreeItem`

`HierarchyTreeItem` provides the standardized row template for all hierarchical views.

```typescript
export interface HierarchyTreeItemProps {
  id: string;
  name: string;
  depth?: number;             // Indentation level (default: 0)
  indentStep?: number;        // Pixels per depth level (default: 14)

  // Expand / Collapse
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: (e: React.MouseEvent) => void;

  // Object Type Icon & Badges
  icon?: keyof typeof Lucide | string;
  iconColor?: string;
  iconNode?: React.ReactNode;
  badge?: React.ReactNode;

  // Selection & Context
  isSelected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;

  // Inline Renaming
  isRenaming?: boolean;
  renameValue?: string;
  onRenameChange?: (value: string) => void;
  onRenameSubmit?: () => void;
  onRenameCancel?: () => void;
  onStartRename?: () => void;
  canRename?: boolean;        // Default: true

  // Drag and Drop (Optional)
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: React.DragEvent<HTMLDivElement>) => void;

  // Slots
  trailingActions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}
```

### Key Behaviors:
- **Automatic Focus & Selection:** When `isRenaming` becomes `true`, the text input automatically focuses and selects its contents for fast replacement.
- **Hotkey Isolation:** All input keydown events call `e.stopPropagation()`, ensuring editor shortcuts (`W`, `E`, `R`, `Q`, `F`, `Space`, `Delete`) never fire while editing text.
- **Unified Key Actions:**
  - `Enter`: Commits the rename (`onRenameSubmit`).
  - `Escape`: Discards changes and exits rename mode (`onRenameCancel`).
  - `Blur`: Automatically submits the trimmed new value.
- **Double-Click Renaming:** Double-clicking the label automatically calls `onStartRename`.
- **Selection Event Isolation:** All selection triggers (`onPointerDown` and `onClick`) invoke `e.stopPropagation()` to prevent selection events from bubbling to ancestor containers that clear selections on background click.
- **Container Deselect Guarding:** Any container hosting tree items that clears selections on background click must verify `if (e.target === e.currentTarget)` so child clicks never trigger inadvertent deselection upon mouse release.
- **Mathematical Nesting:** Indentation uses `depth * indentStep + 8px`, ensuring optical alignment across deep hierarchies.
- **Performance:** Wrapped in `React.memo` to prevent re-rendering untouched tree branches.

---

## 3. State Hook Contract: `useInlineRename`

```typescript
export interface InlineRenameState {
  renamingId: string | null;
  renameValue: string;
  startRename: (id: string, initialName: string) => void;
  cancelRename: () => void;
  setRenameValue: (val: string) => void;
  submitRename: (onCommit: (id: string, newName: string) => void) => void;
  isRenaming: (id: string) => boolean;
}
```

### Usage Pattern:

```tsx
import { useInlineRename } from '@/editor/hooks/useInlineRename';
import { HierarchyTreeItem } from '@/editor/components/HierarchyTreeItem';

export const MyTreePanel: React.FC = () => {
  const {
    renamingId,
    renameValue,
    startRename,
    cancelRename,
    setRenameValue,
    submitRename,
  } = useInlineRename();

  const handleRenameSubmit = useCallback(() => {
    submitRename((id, newName) => {
      // Commit change to your model/ECS/Asset
      myStore.renameItem(id, newName);
    });
  }, [submitRename]);

  return (
    <div>
      {items.map(item => (
        <HierarchyTreeItem
          key={item.id}
          id={item.id}
          name={item.name}
          icon={item.typeIcon}
          isRenaming={renamingId === item.id}
          renameValue={renameValue}
          onRenameChange={setRenameValue}
          onRenameSubmit={handleRenameSubmit}
          onRenameCancel={cancelRename}
          onStartRename={() => startRename(item.id, item.name)}
        />
      ))}
    </div>
  );
};
```

---

## 4. Current Implementations

1. **`HierarchyPanel.tsx` (Main Scene Viewport):**
   - Represents all live scene entities.
   - Icons mapped dynamically according to attached components (`Sun` for Light, `Bone` for Virtual Pivot, `Video` for Camera, `Box` for Meshes).
   - Supports drag-and-drop reparenting via `SceneGraph`.
   - Unified renaming updates both `entity.name` and the ECS SoA array `engineInstance.ecs.store.names[idx]`.

2. **`SkeletonHierarchy.tsx` (Skeleton Editor Viewport):**
   - Represents skeletal joints in a hierarchical bone tree.
   - Uses `HierarchyTreeItem` with `"Bone"` icons and emerald accent coloring.
   - Enables inline renaming on double-click, context menu "Rename Joint", and `F2` shortcut.
   - Commits changes to `asset.skeleton.bones[bIdx].name` and triggers asset manager persistence and UI notification.

3. **`ProjectPanel.tsx` (Asset Browser):**
   - Enforces key event isolation and accessible labels on asset renaming inputs.

## Static Mesh: Mesh Shell hierarchy

`MeshAssetHierarchy` uses the shared `HierarchyTreeItem` rows for Static Mesh composition parts.
`Geometry` contains two related branches: `Mesh Shells` for topology-detected connected components and `Components`
for asset-wide Vertex / Edge / Face mode entry. Saved Mesh Shell metadata may supply names/provenance, but it is not
the source of truth for Mesh Shell count or membership.

Selecting a Mesh Shell row sets the hierarchy section to `SHELL`, but the transform implementation intentionally
uses the existing `VERTEX` component domain with every vertex owned by that Mesh Shell selected. This keeps Mesh Shell
as a hierarchy/authoring scope rather than inventing a fourth component mode, while ensuring the gizmo transforms only
the selected Mesh Shell instead of the whole Static Mesh.

`Shift+click` on Mesh Shell rows toggles membership in a multi-shell selection. The selected component IDs are always the
union of the active Mesh Shell set. Because `HierarchyTreeItem.onSelect` receives the original React mouse event, modifier
semantics belong in the hierarchy controller and must be forwarded to the shared selection API rather than reimplemented
inside `HierarchyTreeItem`.

Mesh Shell membership is resolved through the shared logical connectivity contract (`LogicalMesh.faces` plus
**explicit authored/imported** `siblings`). Current positions never invent connectivity. The built-in 24-vertex Cube
has six independent quads and no authored sibling groups, so it appears as **6 Mesh Shells**. A seam-split imported
mesh may still be one Mesh Shell when the source format explicitly identifies those render vertices as one logical
vertex. Append never creates cross-part sibling groups from spatial overlap.

The editable child rows under a Mesh Shell are active selection presets:

```text
Mesh Shell 1 · AppendedMesh
├─ Vertices   -> switch to VERTEX mode + select every Mesh Shell vertex
├─ Edges      -> switch to EDGE mode   + select every Mesh Shell edge
└─ Faces      -> switch to FACE mode   + select every Mesh Shell face
```

These actions must use the same public component-mode and selection APIs as the viewport. The hierarchy
must not mutate `SelectionSystem.subSelection` directly. `getStaticMeshShellComponentSelection()` resolves
the existing global component IDs for a Mesh Shell; `engine.api.commands.mesh.setComponentMode(...)` switches
mode and `engine.api.commands.selection.setMeshComponents(...)` replaces that mode's selection.

`Triangles` remain Mesh Shell metadata/Inspector information because there is no Triangle `MeshComponentMode`.
Do not add a clickable Triangles hierarchy row until the editor has a real triangle component mode.

`Components -> All Vertices / All Edges / All Faces` is the asset-wide selection entry point. Choosing one of
those rows clears the active Mesh Shell scope, switches component mode, and selects every component of that type. The
component toolbar/pie menu remains mode-only and does not imply select-all. Likewise, once viewport picking, marquee,
loop/ring, expand, or shrink changes a Mesh Shell-wide selection, the Mesh Shell selection scope is released so the
hierarchy never claims that the full shell is still selected. A plain component-mode LMB miss is also a real selection
change: it clears the active component set and Mesh Shell scope. `Shift+LMB` on empty space does not clear the scope.

Static Mesh preview creation does not imply an object selection. Asset/Geometry rows explicitly select the whole preview
object; component and Mesh Shell rows install the preview entity only as the component edit target. With no actionable
object/component selection, the gizmo must remain hidden.

`AssetManager.updateAsset()` currently mutates an asset object in place. Hierarchy/Inspector memoization must
therefore not rely on `[asset]` alone. Asset editors pass a reactive `assetRevision` into these views and include it
in asset-derived memo dependencies. Without this explicit invalidation, append succeeds in the engine/viewport
while the hierarchy remains stuck on the pre-append Mesh Shell/component counts.

