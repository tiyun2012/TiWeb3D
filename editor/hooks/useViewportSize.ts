import { RefObject, useLayoutEffect, useRef, useState } from 'react';

export type ViewportSize = {
    cssWidth: number;
    cssHeight: number;
    dpr: number;
    pixelWidth: number;
    pixelHeight: number;
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Observes an element's size and returns CSS size + an optimized devicePixelRatio (capped).
 *
 * Why: many viewports in this editor render into <canvas>. If we only size the canvas in CSS
 * pixels, the result is blurry on HiDPI screens. If we always use full DPR (e.g. 3), the GPU
 * cost can explode. This hook caps DPR (default 2) and exposes both CSS and pixel sizes.
 */
export function useViewportSize(
    containerRef: RefObject<HTMLElement>,
    opts?: { dprCap?: number }
): ViewportSize {
    const dprCap = opts?.dprCap ?? 2;

    const [size, setSize] = useState<ViewportSize>(() => ({
        cssWidth: 1,
        cssHeight: 1,
        dpr: 1,
        pixelWidth: 1,
        pixelHeight: 1,
    }));

    const rafRef = useRef<number>(0);
    const mqRef = useRef<MediaQueryList | null>(null);

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const compute = () => {
            const rect = el.getBoundingClientRect();
            const cssWidth = Math.max(1, rect.width);
            const cssHeight = Math.max(1, rect.height);

            const rawDpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
            const dpr = clamp(rawDpr, 1, dprCap);

            const pixelWidth = Math.max(1, Math.floor(cssWidth * dpr));
            const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr));

            setSize(prev => {
                if (
                    prev.cssWidth === cssWidth &&
                    prev.cssHeight === cssHeight &&
                    prev.dpr === dpr &&
                    prev.pixelWidth === pixelWidth &&
                    prev.pixelHeight === pixelHeight
                ) return prev;

                return { cssWidth, cssHeight, dpr, pixelWidth, pixelHeight };
            });
        };

        const schedule = () => {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(compute);
        };

        // Element resize
        const ro = new ResizeObserver(schedule);
        ro.observe(el);

        // Window resize (also catches many DPR changes)
        window.addEventListener('resize', schedule);

        // DPR change detection (e.g. dragging between monitors)
        const bindDprListener = () => {
            try {
                if (mqRef.current) mqRef.current.removeEventListener('change', schedule);
                mqRef.current = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
                mqRef.current.addEventListener('change', schedule);
            } catch {
                // matchMedia might not exist in some environments; ignore
            }
        };

        bindDprListener();
        compute();

        return () => {
            cancelAnimationFrame(rafRef.current);
            ro.disconnect();
            window.removeEventListener('resize', schedule);
            if (mqRef.current) mqRef.current.removeEventListener('change', schedule);
        };
    }, [containerRef, dprCap]);

    return size;
}

/**
 * Resize a canvas to match the provided ViewportSize.
 * Returns true if a resize happened.
 */
export function resizeCanvasToViewport(canvas: HTMLCanvasElement, vp: ViewportSize): boolean {
    if (canvas.width === vp.pixelWidth && canvas.height === vp.pixelHeight) return false;
    canvas.width = vp.pixelWidth;
    canvas.height = vp.pixelHeight;
    return true;
}
