import { useEffect, useRef, useState } from 'react';
import { viewportInputRouter } from '@/editor/input/ViewportInputRouter';

interface BrushInteractionOptions {
    /** Stable id registered by the viewport input router. */
    viewportId: string;
    /** False when the active context cannot use a soft-selection brush. */
    available?: boolean;
    softSelectionEnabled: boolean;
    softSelectionRadius: number;
    /** Routes continuous/toggle changes through the host's mesh-editing API. */
    configureSoftSelection: (settings: { enabled?: boolean; radius?: number }) => void;
    onBrushAdjustStart?: () => void;
    onBrushAdjustEnd?: () => void;
    minRadius?: number;
    sensitivity?: number;
}

/**
 * Context-aware B shortcut shared by Scene and asset viewports.
 *
 * - B tap toggles soft selection in the active viewport only.
 * - B + LMB drag started inside that viewport changes its local radius.
 * - The hook never reaches into EditorContext; hosts provide their API adapter.
 */
export const useBrushInteraction = ({
    viewportId,
    available = true,
    softSelectionEnabled,
    softSelectionRadius,
    configureSoftSelection,
    onBrushAdjustStart,
    onBrushAdjustEnd,
    minRadius = 0.1,
    sensitivity = 0.05,
}: BrushInteractionOptions) => {
    const [isAdjustingBrush, setIsAdjustingBrush] = useState(false);
    const bKeyRef = useRef(false);
    const dragHappenedRef = useRef(false);
    const brushStartPos = useRef({ x: 0, y: 0, startRadius: 0 });
    const latestRef = useRef({
        available,
        softSelectionEnabled,
        softSelectionRadius,
        configureSoftSelection,
        onBrushAdjustStart,
        onBrushAdjustEnd,
        minRadius,
        sensitivity,
    });

    useEffect(() => {
        latestRef.current = {
            available,
            softSelectionEnabled,
            softSelectionRadius,
            configureSoftSelection,
            onBrushAdjustStart,
            onBrushAdjustEnd,
            minRadius,
            sensitivity,
        };
    }, [
        available,
        softSelectionEnabled,
        softSelectionRadius,
        configureSoftSelection,
        onBrushAdjustStart,
        onBrushAdjustEnd,
        minRadius,
        sensitivity,
    ]);

    // B key ownership follows the active viewport, not whichever component happened
    // to mount the first global listener.
    useEffect(() => {
        const onDown = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() !== 'b' || e.repeat) return;
            if (!viewportInputRouter.isActive(viewportId) || !latestRef.current.available) return;
            const active = document.activeElement;
            if (active?.tagName === 'INPUT' || active?.tagName === 'TEXTAREA') return;
            bKeyRef.current = true;
            dragHappenedRef.current = false;
        };
        const onUp = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() !== 'b' || !bKeyRef.current) return;
            bKeyRef.current = false;
            if (!dragHappenedRef.current) {
                const latest = latestRef.current;
                if (latest.available) latest.configureSoftSelection({ enabled: !latest.softSelectionEnabled });
            }
        };

        window.addEventListener('keydown', onDown);
        window.addEventListener('keyup', onUp);
        return () => {
            window.removeEventListener('keydown', onDown);
            window.removeEventListener('keyup', onUp);
        };
    }, [viewportId]);

    useEffect(() => {
        const handleGlobalMouseMove = (e: MouseEvent) => {
            if (!isAdjustingBrush) return;
            const latest = latestRef.current;
            const dx = e.clientX - brushStartPos.current.x;
            const newRadius = Math.max(latest.minRadius, brushStartPos.current.startRadius + dx * latest.sensitivity);
            latest.configureSoftSelection({ radius: newRadius });
        };

        const handleGlobalMouseUp = () => {
            if (!isAdjustingBrush) return;
            setIsAdjustingBrush(false);
            latestRef.current.onBrushAdjustEnd?.();
        };

        const onWindowMouseDown = (e: MouseEvent) => {
            if (!bKeyRef.current || e.button !== 0) return;
            if (!viewportInputRouter.isActive(viewportId)) return;
            if (!viewportInputRouter.eventBelongsTo(viewportId, e.target)) return;
            const latest = latestRef.current;
            if (!latest.available) return;

            dragHappenedRef.current = true;
            e.preventDefault();
            e.stopPropagation();

            if (!latest.softSelectionEnabled) latest.configureSoftSelection({ enabled: true });
            setIsAdjustingBrush(true);
            latest.onBrushAdjustStart?.();
            brushStartPos.current = { x: e.clientX, y: e.clientY, startRadius: latest.softSelectionRadius };
        };

        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);
        window.addEventListener('mousedown', onWindowMouseDown, { capture: true });
        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
            window.removeEventListener('mousedown', onWindowMouseDown, { capture: true });
        };
    }, [isAdjustingBrush, viewportId]);

    return { isAdjustingBrush, isBrushKeyHeld: bKeyRef };
};
