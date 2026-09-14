import type { LogicalMesh, Vector3 } from '@/types';
import {
    computeSoftSelectionWeights,
    type SoftSelectionMode,
    type SoftSelectionSettings,
} from './SoftSelection';

export interface MeshDeformationGeometry {
    vertices: Float32Array;
    indices: Uint16Array | Uint32Array;
    topology?: LogicalMesh;
}

export interface MeshDeformationUpdateResult {
    weights: Float32Array;
    geometryChanged: boolean;
}

const copyDelta = (delta: Vector3): Vector3 => ({ x: delta.x, y: delta.y, z: delta.z });

const hardSelectionWeights = (
    vertexCount: number,
    selectedVertices: ReadonlySet<number>,
    reuse?: Float32Array | null,
) => {
    const weights = reuse && reuse.length === vertexCount
        ? reuse
        : new Float32Array(vertexCount);
    weights.fill(0);
    selectedVertices.forEach(vertexId => {
        if (vertexId >= 0 && vertexId < vertexCount) weights[vertexId] = 1;
    });
    return weights;
};

/**
 * Transactional component deformation shared by Scene and Static Mesh Editor.
 * Geometry is always reproducible from an operation baseline, except SLIDE
 * which intentionally stores an accumulated per-vertex displacement history.
 */
export class MeshDeformationSession {
    private basePositions: Float32Array | null = null;
    private accumulatedOffsets: Float32Array | null = null;
    private operationWeights: Float32Array | null = null;
    private displayWeights: Float32Array | null = null;

    // FIXED influence belongs to the current component selection, not to one
    // gizmo drag. A drag may start/end many times while these weights remain
    // identical. Selection changes call clear(), which invalidates this cache.
    private fixedSelectionWeights: Float32Array | null = null;
    private fixedSelectionVertices = new Set<number>();
    private fixedSelectionVertexCount = 0;
    /** Stable geometry used only to evaluate FIXED influence. It survives gizmo drags. */
    private fixedReferencePositions: Float32Array | null = null;
    /** Settings that produced fixedSelectionWeights. Geometry movement is intentionally excluded. */
    private fixedSettingsKey = '';

    private selectedAtBegin = new Set<number>();
    private totalDelta: Vector3 = { x: 0, y: 0, z: 0 };
    private modeAtBegin: SoftSelectionMode | null = null;
    private dragging = false;

    get hasOperation() {
        return this.basePositions !== null && this.modeAtBegin !== null;
    }

    get activeMode() {
        return this.modeAtBegin;
    }

    get currentDelta(): Vector3 {
        return copyDelta(this.totalDelta);
    }

    get baseline(): Float32Array | null {
        return this.basePositions;
    }

    get weights(): Float32Array | null {
        return this.displayWeights;
    }

    get isDragging() {
        return this.dragging;
    }

    begin(
        geometry: MeshDeformationGeometry,
        selectedVertices: ReadonlySet<number>,
        settings: SoftSelectionSettings,
    ): Float32Array {
        this.basePositions = new Float32Array(geometry.vertices);
        this.accumulatedOffsets = new Float32Array(geometry.vertices.length);
        this.selectedAtBegin = new Set(selectedVertices);
        this.totalDelta = { x: 0, y: 0, z: 0 };
        this.modeAtBegin = settings.mode;
        this.dragging = true;

        if (settings.mode === 'FIXED') {
            // FIXED is selection-scoped, not drag-scoped. Reuse the exact same
            // influence buffer across every gizmo transaction until selection
            // changes (clear()) or the Fixed tool itself is left.
            this.operationWeights = this.getOrCaptureFixedSelectionWeights(
                geometry,
                this.selectedAtBegin,
                settings,
            );
            this.displayWeights = this.operationWeights;
        } else {
            this.operationWeights = this.solveWeights(
                this.basePositions,
                geometry.indices,
                geometry.topology,
                this.selectedAtBegin,
                settings,
                this.operationWeights,
            );
            this.displayWeights = new Float32Array(this.operationWeights);
        }
        return this.displayWeights;
    }

    update(
        geometry: MeshDeformationGeometry,
        totalDelta: Vector3,
        settings: SoftSelectionSettings,
    ): MeshDeformationUpdateResult {
        if (!this.basePositions || !this.modeAtBegin) {
            return { weights: this.previewWeights(geometry, this.selectedAtBegin, settings), geometryChanged: false };
        }

        // Changing behavior is treated as committing the previous operation.
        // The next gizmo drag starts a new baseline with the newly selected mode.
        if (settings.mode !== this.modeAtBegin) {
            const selected = new Set(this.selectedAtBegin);
            this.clear();
            return { weights: this.previewWeights(geometry, selected, settings), geometryChanged: false };
        }

        if (this.modeAtBegin === 'SLIDE') {
            const incremental = {
                x: totalDelta.x - this.totalDelta.x,
                y: totalDelta.y - this.totalDelta.y,
                z: totalDelta.z - this.totalDelta.z,
            };

            // Slide influence follows the already deformed selection. Vertices that
            // leave the current radius receive zero additional displacement.
            this.operationWeights = this.solveWeights(
                geometry.vertices,
                geometry.indices,
                geometry.topology,
                this.selectedAtBegin,
                settings,
                this.operationWeights,
            );
            this.displayWeights = new Float32Array(this.operationWeights);

            const offsets = this.accumulatedOffsets!;
            for (let vertexId = 0; vertexId < this.operationWeights.length; vertexId += 1) {
                const weight = this.operationWeights[vertexId];
                if (weight <= 1e-5) continue;
                const offset = vertexId * 3;
                offsets[offset] += incremental.x * weight;
                offsets[offset + 1] += incremental.y * weight;
                offsets[offset + 2] += incremental.z * weight;
            }

            for (let i = 0; i < geometry.vertices.length; i += 1) {
                geometry.vertices[i] = this.basePositions[i] + offsets[i];
            }
        } else {
            // FIXED keeps operationWeights captured at begin. LIVE_FALLOFF may
            // replace them from updateSettings(), but both recompose absolutely.
            const weights = this.operationWeights ?? hardSelectionWeights(
                geometry.vertices.length / 3,
                this.selectedAtBegin,
            );
            for (let vertexId = 0; vertexId < weights.length; vertexId += 1) {
                const offset = vertexId * 3;
                const weight = weights[vertexId];
                geometry.vertices[offset] = this.basePositions[offset] + totalDelta.x * weight;
                geometry.vertices[offset + 1] = this.basePositions[offset + 1] + totalDelta.y * weight;
                geometry.vertices[offset + 2] = this.basePositions[offset + 2] + totalDelta.z * weight;
            }
            this.displayWeights = this.modeAtBegin === 'FIXED'
                ? weights
                : new Float32Array(weights);
        }

        this.totalDelta = copyDelta(totalDelta);
        return { weights: this.displayWeights!, geometryChanged: true };
    }

    /**
     * Re-evaluates radius/falloff. LIVE_FALLOFF recomposes the previous gizmo
     * movement immediately, including after mouse-up while selection is unchanged.
     */
    updateSettings(
        geometry: MeshDeformationGeometry,
        selectedVertices: ReadonlySet<number>,
        settings: SoftSelectionSettings,
    ): MeshDeformationUpdateResult {
        if (!this.hasOperation || !this.basePositions || !this.modeAtBegin) {
            return { weights: this.previewWeights(geometry, selectedVertices, settings), geometryChanged: false };
        }

        if (settings.mode !== this.modeAtBegin) {
            this.clear();
            return { weights: this.previewWeights(geometry, selectedVertices, settings), geometryChanged: false };
        }

        if (this.modeAtBegin === 'LIVE_FALLOFF') {
            this.operationWeights = this.solveWeights(
                this.basePositions,
                geometry.indices,
                geometry.topology,
                this.selectedAtBegin,
                settings,
                this.operationWeights,
            );
            for (let vertexId = 0; vertexId < this.operationWeights.length; vertexId += 1) {
                const offset = vertexId * 3;
                const weight = this.operationWeights[vertexId];
                geometry.vertices[offset] = this.basePositions[offset] + this.totalDelta.x * weight;
                geometry.vertices[offset + 1] = this.basePositions[offset + 1] + this.totalDelta.y * weight;
                geometry.vertices[offset + 2] = this.basePositions[offset + 2] + this.totalDelta.z * weight;
            }
            this.displayWeights = new Float32Array(this.operationWeights);
            return { weights: this.displayWeights, geometryChanged: true };
        }

        if (this.modeAtBegin === 'SLIDE') {
            // Radius changes affect the next incremental movement only; they do not
            // rewrite deformation history already accumulated by Slide Sculpt.
            this.displayWeights = this.solveWeights(
                geometry.vertices,
                geometry.indices,
                geometry.topology,
                this.selectedAtBegin,
                settings,
                this.displayWeights,
            );
            return { weights: this.displayWeights, geometryChanged: false };
        }

        // FIXED locks influence against geometry movement, not against user
        // settings. Radius / metric / blend / connectivity changes recompute
        // from the stable selection reference geometry, so the heatmap responds
        // immediately without drifting as the mesh itself is transformed.
        this.operationWeights = this.getOrCaptureFixedSelectionWeights(
            geometry,
            selectedVertices,
            settings,
        );
        this.displayWeights = this.operationWeights;
        return { weights: this.displayWeights, geometryChanged: false };
    }

    end() {
        this.dragging = false;
    }

    clear() {
        this.basePositions = null;
        this.accumulatedOffsets = null;
        this.operationWeights = null;
        this.displayWeights = null;
        this.fixedSelectionWeights = null;
        this.fixedSelectionVertices.clear();
        this.fixedSelectionVertexCount = 0;
        this.fixedReferencePositions = null;
        this.fixedSettingsKey = '';
        this.selectedAtBegin.clear();
        this.totalDelta = { x: 0, y: 0, z: 0 };
        this.modeAtBegin = null;
        this.dragging = false;
    }

    /** Positions used for radius visualization/weight interpretation. */
    referencePositions(current: Float32Array): Float32Array {
        if (this.modeAtBegin === 'FIXED' && this.fixedReferencePositions) {
            return this.fixedReferencePositions;
        }
        if (this.modeAtBegin === 'LIVE_FALLOFF' && this.basePositions) {
            return this.basePositions;
        }
        return current;
    }

    previewWeights(
        geometry: MeshDeformationGeometry,
        selectedVertices: ReadonlySet<number>,
        settings: SoftSelectionSettings,
    ): Float32Array {
        if (settings.mode === 'FIXED') {
            this.displayWeights = this.getOrCaptureFixedSelectionWeights(
                geometry,
                selectedVertices,
                settings,
            );
            return this.displayWeights;
        }

        // Leaving Fixed starts a new influence policy. Do not carry a stale
        // selection-scoped Fixed cache back into a later mode switch.
        this.clearFixedSelectionWeights();
        this.displayWeights = this.solveWeights(
            geometry.vertices,
            geometry.indices,
            geometry.topology,
            selectedVertices,
            settings,
            this.displayWeights,
        );
        return this.displayWeights;
    }

    private fixedSelectionMatches(selectedVertices: ReadonlySet<number>, vertexCount: number) {
        if (!this.fixedSelectionWeights || !this.fixedReferencePositions || this.fixedSelectionVertexCount !== vertexCount) return false;
        if (this.fixedSelectionVertices.size !== selectedVertices.size) return false;
        for (const vertexId of selectedVertices) {
            if (!this.fixedSelectionVertices.has(vertexId)) return false;
        }
        return true;
    }

    private fixedInfluenceSettingsKey(settings: SoftSelectionSettings) {
        // Deliberately excludes mesh positions and gizmo delta. Those must never
        // invalidate FIXED influence. Only explicit influence controls do.
        return [
            settings.enabled ? '1' : '0',
            settings.radius.toFixed(6),
            settings.falloff,
            settings.surfaceBlend.toFixed(6),
            settings.connectivity,
        ].join('|');
    }

    private getOrCaptureFixedSelectionWeights(
        geometry: MeshDeformationGeometry,
        selectedVertices: ReadonlySet<number>,
        settings: SoftSelectionSettings,
    ) {
        const vertexCount = geometry.vertices.length / 3;
        const sameSelection = this.fixedSelectionMatches(selectedVertices, vertexCount);

        // A new component selection starts a new stable influence reference.
        if (!sameSelection) {
            this.fixedSelectionVertices = new Set(selectedVertices);
            this.fixedSelectionVertexCount = vertexCount;
            this.fixedReferencePositions = new Float32Array(geometry.vertices);
            this.fixedSettingsKey = '';
        }

        const settingsKey = this.fixedInfluenceSettingsKey(settings);
        if (this.fixedSelectionWeights && sameSelection && this.fixedSettingsKey === settingsKey) {
            return this.fixedSelectionWeights;
        }

        const referencePositions = this.fixedReferencePositions ?? geometry.vertices;
        this.fixedSelectionWeights = this.solveWeights(
            referencePositions,
            geometry.indices,
            geometry.topology,
            selectedVertices,
            settings,
            this.fixedSelectionWeights,
        );
        this.fixedSettingsKey = settingsKey;
        return this.fixedSelectionWeights;
    }

    private clearFixedSelectionWeights() {
        this.fixedSelectionWeights = null;
        this.fixedSelectionVertices.clear();
        this.fixedSelectionVertexCount = 0;
        this.fixedReferencePositions = null;
        this.fixedSettingsKey = '';
    }

    private solveWeights(
        vertices: Float32Array,
        indices: Uint16Array | Uint32Array,
        topology: LogicalMesh | undefined,
        selectedVertices: ReadonlySet<number>,
        settings: SoftSelectionSettings,
        reuse: Float32Array | null,
    ) {
        if (!settings.enabled) {
            return hardSelectionWeights(vertices.length / 3, selectedVertices, reuse);
        }
        return computeSoftSelectionWeights({
            indices,
            vertices,
            topology,
            selectedVertices,
            radius: settings.radius,
            falloff: settings.falloff,
            surfaceBlend: settings.surfaceBlend,
            connectivity: settings.connectivity,
            reuse,
        });
    }
}
