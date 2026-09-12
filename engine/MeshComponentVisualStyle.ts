export interface MeshVertexPointSizes {
  base: number;
  selected: number;
  hovered: number;
}

/**
 * Vertex marker sizes are authored in CSS pixels so Scene and asset viewports
 * have the same apparent size regardless of device pixel ratio.
 */
export function getMeshVertexPointSizes(
  vertexSize: number | undefined,
  pixelRatio: number = 1,
): MeshVertexPointSizes {
  const safeVertexSize = Number.isFinite(vertexSize) ? Math.max(0.1, vertexSize as number) : 1.0;
  const safePixelRatio = Number.isFinite(pixelRatio) ? Math.max(0.5, Math.min(pixelRatio, 4)) : 1;
  const baseCssPx = Math.max(3.0, safeVertexSize * 3.0);
  const base = baseCssPx * safePixelRatio;
  return {
    base,
    selected: base * 1.5,
    hovered: base * 1.5,
  };
}

export function getViewportPixelRatio(pixelWidth: number, cssWidth: number): number {
  if (!Number.isFinite(pixelWidth) || !Number.isFinite(cssWidth) || cssWidth <= 0) return 1;
  return Math.max(0.5, Math.min(pixelWidth / cssWidth, 4));
}
