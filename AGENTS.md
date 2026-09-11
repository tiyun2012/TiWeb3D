# Agent Instructions & Project Conventions

## Core Standing Directives
1. **Always Update Documentation**:
   - Whenever you implement a new feature, refactor existing systems, or add shared architectural components, you **MUST** update the documentation in `/docs/` and `/avoidIssues.txt`.
   - Keep design decisions, component contracts, and architecture diagrams current so future development maintains full alignment.

2. **Inherit From Existing Implementations for Consistency**:
   - Always check what has already been built before creating new components or systems.
   - Do not re-implement boilerplate logic (such as camera math, WebGL contexts, HiDPI canvas handling, ground grid, gizmo pipelines, or toolbars).
   - All 3D asset editors (e.g., `StaticMeshEditor`, `SkeletonEditor`, and any future asset editors) **must inherit from `AssetViewport3D`** (`editor/components/AssetViewport3D.tsx`).
   - Preserve existing features and user flows during refactoring; avoid regressions.

3. **Adhere to `avoidIssues.txt`**:
   - Review `/avoidIssues.txt` before refactoring or implementing features to avoid regressions in rendering, UI accessibility, strict typing, or ECS source-of-truth syncing.
