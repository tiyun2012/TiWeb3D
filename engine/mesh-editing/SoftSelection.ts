import type { SoftSelectionFalloff } from '@/types';
import { MeshTopologyUtils } from '@/engine/MeshTopologyUtils';

/**
 * Deformation policy for proportional Static Mesh transforms.
 *
 * FIXED        - capture weights at transform begin and keep them locked.
 * LIVE_FALLOFF - keep the transform baseline/delta, but allow radius/falloff
 *                changes to recompose the same transform.
 * SLIDE        - evaluate influence from the current deformed positions every
 *                gizmo update and accumulate only the incremental movement.
 */
export type SoftSelectionMode = 'FIXED' | 'LIVE_FALLOFF' | 'SLIDE';

export interface SoftSelectionSettings {
    enabled: boolean;
    radius: number;
    mode: SoftSelectionMode;
    falloff: SoftSelectionFalloff;
}

export interface SoftSelectionSolveInput {
    indices: Uint16Array | Uint32Array;
    vertices: Float32Array;
    selectedVertices: ReadonlySet<number>;
    radius: number;
    falloff: SoftSelectionFalloff;
    reuse?: Float32Array | null;
}

const smoothStepWeight = (normalizedDistance: number) => {
    const t = Math.max(0, Math.min(1, 1 - normalizedDistance));
    return t * t * (3 - 2 * t);
};

/** Pure geometry -> weights solver shared by Scene and asset viewports. */
export function computeSoftSelectionWeights(input: SoftSelectionSolveInput): Float32Array {
    const {
        indices,
        vertices,
        selectedVertices,
        radius,
        falloff,
        reuse = null,
    } = input;

    const vertexCount = Math.floor(vertices.length / 3);
    if (falloff === 'SURFACE') {
        return MeshTopologyUtils.computeSurfaceWeights(
            indices,
            vertices,
            new Set(selectedVertices),
            Math.max(radius, 1e-6),
            vertexCount,
        );
    }

    let weights = reuse && reuse.length === vertexCount
        ? reuse
        : new Float32Array(vertexCount);
    weights.fill(0);
    if (selectedVertices.size === 0) return weights;

    let cx = 0;
    let cy = 0;
    let cz = 0;
    let count = 0;
    selectedVertices.forEach(vertexId => {
        const offset = vertexId * 3;
        if (offset + 2 >= vertices.length) return;
        cx += vertices[offset];
        cy += vertices[offset + 1];
        cz += vertices[offset + 2];
        count += 1;
    });
    if (count === 0) return weights;

    cx /= count;
    cy /= count;
    cz /= count;
    const safeRadius = Math.max(radius, 1e-6);

    for (let vertexId = 0; vertexId < vertexCount; vertexId += 1) {
        if (selectedVertices.has(vertexId)) {
            weights[vertexId] = 1;
            continue;
        }

        const offset = vertexId * 3;
        const dx = vertices[offset] - cx;
        const dy = vertices[offset + 1] - cy;
        const dz = vertices[offset + 2] - cz;
        const distance = Math.hypot(dx, dy, dz);
        weights[vertexId] = distance <= safeRadius
            ? smoothStepWeight(distance / safeRadius)
            : 0;
    }

    return weights;
}
