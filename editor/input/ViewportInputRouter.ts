export const SCENE_VIEWPORT_INPUT_ID = 'scene-main';

/**
 * Tracks which mounted viewport currently owns global keyboard/brush shortcuts.
 *
 * Viewports claim ownership on pointer enter/down. This avoids every mounted
 * Scene/asset viewport responding to the same window-level key event.
 */
class ViewportInputRouter {
  private readonly mounted = new Set<string>();
  private readonly fallbacks = new Set<string>();
  private activeViewportId: string | null = null;

  register(viewportId: string, fallback = false) {
    this.mounted.add(viewportId);
    if (fallback) this.fallbacks.add(viewportId);
    if (!this.activeViewportId && fallback) this.activeViewportId = viewportId;

    return () => {
      this.mounted.delete(viewportId);
      this.fallbacks.delete(viewportId);
      if (this.activeViewportId === viewportId) {
        this.activeViewportId = this.firstMountedFallback() ?? this.mounted.values().next().value ?? null;
      }
    };
  }

  activate(viewportId: string) {
    if (this.mounted.has(viewportId)) this.activeViewportId = viewportId;
  }

  isActive(viewportId: string) {
    return this.activeViewportId === viewportId;
  }

  getActiveViewportId() {
    return this.activeViewportId;
  }

  /** Returns the viewport id stamped on an event target or one of its parents. */
  viewportIdFromTarget(target: EventTarget | null): string | null {
    let element = target instanceof HTMLElement ? target : null;
    while (element) {
      const id = element.dataset.viewportInputId;
      if (id) return id;
      element = element.parentElement;
    }
    return null;
  }

  eventBelongsTo(viewportId: string, target: EventTarget | null) {
    return this.viewportIdFromTarget(target) === viewportId;
  }

  private firstMountedFallback(): string | null {
    for (const id of this.fallbacks) {
      if (this.mounted.has(id)) return id;
    }
    return null;
  }
}

export const viewportInputRouter = new ViewportInputRouter();
