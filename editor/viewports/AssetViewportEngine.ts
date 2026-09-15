import { IEngine, MeshComponentMode, SoftSelectionConnectivity, SoftSelectionFalloff, Vector3 } from '@/types';
import { SoAEntitySystem } from '@/engine/ecs/EntitySystem';
import { SceneGraph } from '@/engine/SceneGraph';
import { SelectionSystem } from '@/engine/systems/SelectionSystem';
import { assetManager } from '@/engine/AssetManager';
import { COMPONENT_MASKS } from '@/engine/constants';
import { StaticMeshAsset } from '@/types';
import { EngineAPI } from '@/engine/api/EngineAPI';
import { createEngineAPI } from '@/engine/api/createEngineAPI';
import { MeshDeformationSession } from '@/engine/mesh-editing/MeshDeformationSession';
import type { SoftSelectionMode, SoftSelectionSettings } from '@/engine/mesh-editing/SoftSelection';
import { finalizeStaticMeshTopologyAfterGeometryEdit } from '@/engine/mesh-editing/StaticMeshShells';

type GizmoRendererFacade = {
    renderGizmos: (
        vp: Float32Array,
        pos: { x: number; y: number; z: number },
        scale: number,
        hoverAxis: any,
        activeAxis: any
    ) => void;
};

/**
 * Minimal engine-like wrapper used by "asset" viewports (StaticMesh, etc)
 * so they can reuse standard editor tools (selection + gizmo) without
 * touching the main scene engine instance.
 */
export class AssetViewportEngine implements IEngine {
    isPlaying = false;

    // --- Core engine-like state (enough for SelectionSystem + GizmoSystem) ---
    ecs = new SoAEntitySystem();
    sceneGraph = new SceneGraph();
    selectionSystem: SelectionSystem;
    api: EngineAPI;

    // Camera / viewport (set by the hosting viewport each frame)
    currentViewProj: Float32Array | null = null;
    currentCameraPos: Vector3 = { x: 0, y: 0, z: 0 };
    currentWidth = 1;
    currentHeight = 1;

    // Tooling mode
    meshComponentMode: MeshComponentMode = 'OBJECT';

    // SelectionSystem expects these
    softSelectionEnabled = false;
    softSelectionRadius = 1.0;
    softSelectionMode: SoftSelectionMode = 'FIXED';
    softSelectionFalloff: SoftSelectionFalloff = 'VOLUME';
    softSelectionSurfaceBlend = 0.5;
    softSelectionConnectivity: SoftSelectionConnectivity = 'NONE';
    softSelectionHeatmapVisible = true;
    softSelectionWeights: Float32Array | null = null;
    /** Monotonic render invalidation for the asset viewport heatmap buffer. */
    softSelectionRevision = 0;

    // GizmoSystem expects renderer facade
    renderer: GizmoRendererFacade = {
        renderGizmos: () => {
            /* set via setRenderer */
        },
    };

    // Local entity holding the preview mesh
    private previewEntityId: string | null = null;

    // Deformation (vertex drag)
    private vertexSnapshot: Float32Array | null = null;
    private activeDeformationEntity: string | null = null;
    private currentDeformationDelta: Vector3 = { x: 0, y: 0, z: 0 };
    private meshDeformationSession = new MeshDeformationSession();

    constructor(
        private onNotifyUI?: () => void,
        private onGeometryUpdated?: (assetId: string) => void,
        private onGeometryFinalized?: (assetId: string) => void,
    ) {
        this.sceneGraph.setContext(this.ecs);
        this.selectionSystem = new SelectionSystem(this);
        this.api = createEngineAPI(this);
    }

    setRenderer(renderer: GizmoRendererFacade) {
        this.renderer = renderer;
    }

    setViewport(vp: Float32Array, cameraPos: Vector3, cssWidth: number, cssHeight: number) {
        this.currentViewProj = vp;
        this.currentCameraPos = cameraPos;
        this.currentWidth = cssWidth;
        this.currentHeight = cssHeight;
    }

    /** Ensure a single preview mesh entity exists and points at the given mesh asset. */
    setPreviewMesh(meshAssetId: string, options: { select?: boolean } = {}): string {
        const meshIntId = assetManager.getMeshID(meshAssetId);

        if (!this.previewEntityId) {
            this.previewEntityId = this.ecs.createEntity('PreviewMesh');
            this.sceneGraph.registerEntity(this.previewEntityId);
            // Ensure default transform exists (EntitySystem already assigns TRANSFORM)
            const idx = this.ecs.idToIndex.get(this.previewEntityId)!;
            this.ecs.store.componentMask[idx] |= COMPONENT_MASKS.MESH;
            this.ecs.store.meshType[idx] = meshIntId;
        } else {
            const idx = this.ecs.idToIndex.get(this.previewEntityId)!;
            this.ecs.store.componentMask[idx] |= COMPONENT_MASKS.MESH;
            this.ecs.store.meshType[idx] = meshIntId;
        }

        // Selection is host-owned. Static Mesh Editor opens with no actionable
        // selection so the gizmo cannot appear at the origin before the user
        // chooses an object, Mesh Shell, or component scope.
        if (options.select !== false) this.selectionSystem.setSelected([this.previewEntityId]);
        return this.previewEntityId;
    }

    getPreviewEntityId(): string | null {
        return this.previewEntityId;
    }

    get entityId(): string | null {
        return this.previewEntityId;
    }

    resetPreviewTransform() {
        if (!this.previewEntityId) return;
        const idx = this.ecs.idToIndex.get(this.previewEntityId);
        if (idx == null) return;
        this.ecs.store.setPosition(idx, 0, 0, 0);
        this.ecs.store.setScale(idx, 1, 1, 1);
        this.ecs.store.setRotation(idx, 0, 0, 0);
        this.sceneGraph.setDirty(this.previewEntityId);
        this.syncTransforms(false);
    }

    // --- IEngine required ---
    loadSceneFromAsset(_sceneAssetId: string) {
        // Not used in asset viewports.
    }

    // --- SelectionSystem hooks ---
    recalculateSoftSelection() {
        const context = this.getSoftSelectionContext();
        if (!context || !this.softSelectionEnabled || this.meshComponentMode === 'OBJECT') {
            this.publishSoftSelectionWeights(null);
            this.meshDeformationSession.clear();
            this.vertexSnapshot = null;
            this.activeDeformationEntity = null;
            this.currentDeformationDelta = { x: 0, y: 0, z: 0 };
            return;
        }

        const result = this.meshDeformationSession.updateSettings(
            { vertices: context.asset.geometry.vertices, indices: context.asset.geometry.indices, topology: context.asset.topology },
            context.selectedVertices,
            this.getSoftSelectionSettings(context.localRadius),
        );
        this.publishSoftSelectionWeights(result.weights);
        this.vertexSnapshot = this.meshDeformationSession.baseline;
        this.currentDeformationDelta = this.meshDeformationSession.currentDelta;

        if (result.geometryChanged) {
            this.recomputeNormals(context.asset);
            this.updateMeshBounds(context.asset);
            this.onGeometryUpdated?.(context.assetId);
        }
        this.notifyUI();
    }

    // --- GizmoSystem hooks ---
    syncTransforms(notify = true) {
        this.sceneGraph.update();
        if (notify) this.notifyUI();
    }

    notifyUI() {
        this.onNotifyUI?.();
    }

    pushUndoState() {
        // Asset viewports currently rely on the main editor history.
    }

    startVertexDrag(entityId: string) {
        const context = this.getSoftSelectionContext(entityId);
        if (!context || context.selectedVertices.size === 0) return;

        this.publishSoftSelectionWeights(this.meshDeformationSession.begin(
            { vertices: context.asset.geometry.vertices, indices: context.asset.geometry.indices, topology: context.asset.topology },
            context.selectedVertices,
            this.getSoftSelectionSettings(context.localRadius),
        ));
        this.vertexSnapshot = this.meshDeformationSession.baseline;
        this.activeDeformationEntity = entityId;
        this.currentDeformationDelta = { x: 0, y: 0, z: 0 };
        this.notifyUI();
    }

    updateVertexDrag(entityId: string, delta: Vector3) {
        if (!this.meshDeformationSession.hasOperation || this.activeDeformationEntity !== entityId) {
            this.startVertexDrag(entityId);
        }
        const context = this.getSoftSelectionContext(entityId);
        if (!context || !this.meshDeformationSession.hasOperation) return;

        const result = this.meshDeformationSession.update(
            { vertices: context.asset.geometry.vertices, indices: context.asset.geometry.indices, topology: context.asset.topology },
            delta,
            this.getSoftSelectionSettings(context.localRadius),
        );
        this.publishSoftSelectionWeights(result.weights);
        this.vertexSnapshot = this.meshDeformationSession.baseline;
        this.currentDeformationDelta = this.meshDeformationSession.currentDelta;

        if (result.geometryChanged) {
            this.recomputeNormals(context.asset);
            this.updateMeshBounds(context.asset);
            this.onGeometryUpdated?.(context.assetId);
        }
        // Rendering consumes geometry/softSelectionRevision directly and the
        // preview event refreshes Scene GPU geometry. Selection did not change,
        // so avoid a React UI invalidation on every pointer sample.
    }

    endVertexDrag() {
        this.meshDeformationSession.end();
        if (!this.activeDeformationEntity) return;
        const context = this.getSoftSelectionContext(this.activeDeformationEntity);
        if (!context) return;
        finalizeStaticMeshTopologyAfterGeometryEdit(context.asset);
        this.onGeometryFinalized?.(context.assetId);
    }

    clearDeformation() {
        this.meshDeformationSession.clear();
        this.vertexSnapshot = null;
        this.activeDeformationEntity = null;
        this.currentDeformationDelta = { x: 0, y: 0, z: 0 };
    }

    private publishSoftSelectionWeights(weights: Float32Array | null) {
        this.softSelectionWeights = weights;
        this.softSelectionRevision += 1;
    }

    private getSoftSelectionContext(entityId?: string | null) {
        const resolvedEntityId = entityId ?? this.activeDeformationEntity ?? this.previewEntityId;
        if (!resolvedEntityId) return null;
        const idx = this.ecs.idToIndex.get(resolvedEntityId);
        if (idx == null) return null;
        const assetId = assetManager.getMeshUUID(this.ecs.store.meshType[idx]);
        if (!assetId) return null;
        const asset = assetManager.getAsset(assetId) as StaticMeshAsset;
        if (!asset || asset.type !== 'MESH' || !asset.geometry?.vertices || !asset.geometry.indices) return null;

        const scale = Math.max(
            Math.abs(this.ecs.store.scaleX[idx]),
            Math.abs(this.ecs.store.scaleY[idx]),
            Math.abs(this.ecs.store.scaleZ[idx]),
            1e-6,
        );
        return {
            entityId: resolvedEntityId,
            assetId,
            asset,
            selectedVertices: this.selectionSystem.getSelectionAsVertices(),
            localRadius: this.softSelectionRadius / scale,
        };
    }

    private getSoftSelectionSettings(localRadius: number): SoftSelectionSettings {
        return {
            enabled: this.softSelectionEnabled && this.meshComponentMode !== 'OBJECT',
            radius: localRadius,
            mode: this.softSelectionMode,
            falloff: this.softSelectionFalloff,
            surfaceBlend: this.softSelectionSurfaceBlend,
            connectivity: this.softSelectionConnectivity,
        };
    }

    // --- Helpers ---
    private recomputeNormals(asset: StaticMeshAsset) {
        const verts = asset.geometry.vertices;
        const inds = asset.geometry.indices;
        if (!verts || !inds) return;

        const normals = new Float32Array(verts.length);
        for (let i = 0; i < inds.length; i += 3) {
            const i0 = inds[i] * 3;
            const i1 = inds[i + 1] * 3;
            const i2 = inds[i + 2] * 3;

            const ax = verts[i1] - verts[i0];
            const ay = verts[i1 + 1] - verts[i0 + 1];
            const az = verts[i1 + 2] - verts[i0 + 2];
            const bx = verts[i2] - verts[i0];
            const by = verts[i2 + 1] - verts[i0 + 1];
            const bz = verts[i2 + 2] - verts[i0 + 2];

            const nx = ay * bz - az * by;
            const ny = az * bx - ax * bz;
            const nz = ax * by - ay * bx;

            normals[i0] += nx;
            normals[i0 + 1] += ny;
            normals[i0 + 2] += nz;
            normals[i1] += nx;
            normals[i1 + 1] += ny;
            normals[i1 + 2] += nz;
            normals[i2] += nx;
            normals[i2 + 1] += ny;
            normals[i2 + 2] += nz;
        }

        for (let i = 0; i < normals.length; i += 3) {
            const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
            const len = Math.hypot(nx, ny, nz) || 1.0;
            normals[i] = nx / len;
            normals[i + 1] = ny / len;
            normals[i + 2] = nz / len;
        }

        asset.geometry.normals = normals;
    }

    private updateMeshBounds(asset: StaticMeshAsset) {
        const v = asset.geometry.vertices;
        if (!v || v.length < 3) return;

        let minX = v[0], minY = v[1], minZ = v[2];
        let maxX = v[0], maxY = v[1], maxZ = v[2];
        for (let i = 0; i < v.length; i += 3) {
            const x = v[i], y = v[i + 1], z = v[i + 2];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }
        asset.geometry.aabb = { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
        if (asset.topology) {
            asset.topology.bvh = undefined;
        }
    }
}
