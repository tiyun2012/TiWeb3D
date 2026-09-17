/**
 * Minimal asset-window lifecycle helpers kept free of React so editor-window
 * cleanup can be regression-tested without mounting the UI.
 */
export interface AssetBoundEditorWindow {
  assetId?: string;
}

export function removeWindowsForDeletedAsset<TWindow extends AssetBoundEditorWindow>(
  windows: Record<string, TWindow>,
  assetId: string,
): Record<string, TWindow> {
  let changed = false;
  const next: Record<string, TWindow> = {};

  for (const [id, window] of Object.entries(windows)) {
    if (window.assetId === assetId) {
      changed = true;
      continue;
    }
    next[id] = window;
  }

  return changed ? next : windows;
}
