import type { ViewportProfileSettings } from '@/types';

export const DEFAULT_VIEWPORT_PROFILE_SETTINGS: Readonly<ViewportProfileSettings> = Object.freeze({
  navigation: Object.freeze({
    orbit: true,
    pan: true,
    zoom: true,
    focus: true,
  }),
  overlays: Object.freeze({
    grid: true,
    helpers: true,
    gizmos: true,
  }),
});

export const createDefaultViewportProfileSettings = (): ViewportProfileSettings => ({
  navigation: { ...DEFAULT_VIEWPORT_PROFILE_SETTINGS.navigation },
  overlays: { ...DEFAULT_VIEWPORT_PROFILE_SETTINGS.overlays },
});

/**
 * Keeps partially-authored/older profile assets compatible as new viewport options are added.
 */
export const normalizeViewportProfileSettings = (
  value?: Partial<ViewportProfileSettings> | null,
): ViewportProfileSettings => ({
  navigation: {
    ...DEFAULT_VIEWPORT_PROFILE_SETTINGS.navigation,
    ...(value?.navigation ?? {}),
  },
  overlays: {
    ...DEFAULT_VIEWPORT_PROFILE_SETTINGS.overlays,
    ...(value?.overlays ?? {}),
  },
});
