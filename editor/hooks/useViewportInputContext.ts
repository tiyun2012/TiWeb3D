import { useEffect, type RefObject } from 'react';
import { viewportInputRouter } from '@/editor/input/ViewportInputRouter';

/**
 * Registers a viewport with the shared input router and claims keyboard context
 * whenever the pointer enters or presses inside that viewport.
 */
export function useViewportInputContext<T extends HTMLElement>(
  viewportId: string,
  elementRef: RefObject<T>,
  options: { fallback?: boolean } = {},
) {
  useEffect(() => viewportInputRouter.register(viewportId, options.fallback ?? false), [viewportId, options.fallback]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    element.dataset.viewportInputId = viewportId;
    const activate = () => viewportInputRouter.activate(viewportId);
    element.addEventListener('pointerenter', activate);
    element.addEventListener('pointerdown', activate, { capture: true });

    return () => {
      element.removeEventListener('pointerenter', activate);
      element.removeEventListener('pointerdown', activate, { capture: true });
      if (element.dataset.viewportInputId === viewportId) delete element.dataset.viewportInputId;
    };
  }, [elementRef, viewportId]);
}
