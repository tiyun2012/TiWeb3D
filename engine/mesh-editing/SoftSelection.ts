import type { LogicalMesh, SoftSelectionConnectivity, SoftSelectionFalloff } from '@/types';
import {
    computeConnectedVertexMask,
    computeFaceAwareSurfaceDistances,
} from './MeshConnectivity';

/**
 * Deformation policy for proportional Static Mesh transforms.
 *
 * FIXED        - keep a stable selection/reference geometry across gizmo drags; explicit influence-setting changes recompute weights from that reference.
 * LIVE_FALLOFF - keep the transform baseline/delta, but allow influence settings
 *                to recompose the same transform.
 * SLIDE        - evaluate influence from current deformed positions every gizmo
 *                update and accumulate only incremental movement.
 */
export type SoftSelectionMode = 'FIXED' | 'LIVE_FALLOFF' | 'SLIDE';

export interface SoftSelectionSettings {
    enabled: boolean;
    radius: number;
    mode: SoftSelectionMode;
    /** Distance metric. Kept under the legacy falloff field for API compatibility. */
    falloff: SoftSelectionFalloff;
    /** 0 = pure Volume, 1 = pure Surface. Used only when falloff === HYBRID. */
    surfaceBlend: number;
    /** Optional topology mask applied after distance weights are solved. */
    connectivity: SoftSelectionConnectivity;
}

export interface SoftSelectionSolveInput {
    indices: Uint16Array | Uint32Array;
    vertices: Float32Array;
    topology?: LogicalMesh;
    selectedVertices: ReadonlySet<number>;
    radius: number;
    falloff: SoftSelectionFalloff;
    surfaceBlend?: number;
    connectivity?: SoftSelectionConnectivity;
    reuse?: Float32Array | null;
}

const smoothStepWeight = (normalizedDistance: number) => {
    const t = Math.max(0, Math.min(1, 1 - normalizedDistance));
    return t * t * (3 - 2 * t);
};

const selectionCenter = (
    vertices: Float32Array,
    selectedVertices: ReadonlySet<number>,
): { x: number; y: number; z: number } | null => {
    let x = 0;
    let y = 0;
    let z = 0;
    let count = 0;
    selectedVertices.forEach(vertexId => {
        const offset = vertexId * 3;
        if (offset < 0 || offset + 2 >= vertices.length) return;
        x += vertices[offset];
        y += vertices[offset + 1];
        z += vertices[offset + 2];
        count += 1;
    });
    return count > 0 ? { x: x / count, y: y / count, z: z / count } : null;
};

const volumeWeightAt = (
    vertices: Float32Array,
    vertexId: number,
    center: { x: number; y: number; z: number },
    radius: number,
) => {
    const offset = vertexId * 3;
    const dx = vertices[offset] - center.x;
    const dy = vertices[offset + 1] - center.y;
    const dz = vertices[offset + 2] - center.z;
    const distance = Math.hypot(dx, dy, dz);
    return distance <= radius ? smoothStepWeight(distance / radius) : 0;
};

/**
 * Pure geometry -> influence weights solver shared by Scene and asset viewports.
 *
 * Distance and connectivity are intentionally orthogonal:
 * - VOLUME: Euclidean radius from the current selection center.
 * - SURFACE: face-aware geodesic approximation over logical mesh topology.
 * - HYBRID: blends the resulting Volume and Surface weights.
 * - SAME_ISLAND / FLOOD_WITHIN_RADIUS: optional topology masks layered on top.
 */
export function computeSoftSelectionWeights(input: SoftSelectionSolveInput): Float32Array {
    const {
        vertices,
        topology,
        selectedVertices,
        radius,
        falloff,
        surfaceBlend = 0.5,
        connectivity = 'NONE',
        reuse = null,
    } = input;

    const vertexCount = Math.floor(vertices.length / 3);
    const weights = reuse && reuse.length === vertexCount
        ? reuse
        : new Float32Array(vertexCount);
    weights.fill(0);
    if (selectedVertices.size === 0) return weights;

    const center = selectionCenter(vertices, selectedVertices);
    if (!center) return weights;
    const safeRadius = Math.max(radius, 1e-6);
    const clampedSurfaceBlend = Math.max(0, Math.min(1, surfaceBlend));

    const needsSurface = (falloff === 'SURFACE' || falloff === 'HYBRID') && Boolean(topology);
    const surfaceDistances = needsSurface && topology
        ? computeFaceAwareSurfaceDistances(topology, vertices, selectedVertices, safeRadius).distances
        : null;

    let connectivityMask: Uint8Array | null = null;
    if (topology && connectivity !== 'NONE') {
        connectivityMask = computeConnectedVertexMask(topology, vertices, selectedVertices, {
            mode: connectivity,
            radius: safeRadius,
            center,
        });
    }

    for (let vertexId = 0; vertexId < vertexCount; vertexId += 1) {
        // Source vertices are always full strength and are always valid seeds for
        // topology constraints, even when a broad multi-selection center lies far
        // from an individual source.
        if (selectedVertices.has(vertexId)) {
            weights[vertexId] = 1;
            continue;
        }
        if (connectivityMask && connectivityMask[vertexId] === 0) continue;

        const volumeWeight = volumeWeightAt(vertices, vertexId, center, safeRadius);
        let surfaceWeight = 0;
        if (surfaceDistances) {
            const distance = surfaceDistances[vertexId];
            if (Number.isFinite(distance) && distance <= safeRadius) {
                surfaceWeight = smoothStepWeight(distance / safeRadius);
            }
        }

        if (falloff === 'SURFACE' && surfaceDistances) {
            weights[vertexId] = surfaceWeight;
        } else if (falloff === 'HYBRID' && surfaceDistances) {
            weights[vertexId] = volumeWeight * (1 - clampedSurfaceBlend)
                + surfaceWeight * clampedSurfaceBlend;
        } else {
            // Missing topology intentionally degrades Surface/Hybrid to Volume so
            // imported/incomplete meshes remain editable instead of going blank.
            weights[vertexId] = volumeWeight;
        }
    }

    return weights;
}
