
import { SoAEntitySystem } from './ecs/EntitySystem';
import { SceneGraph } from './SceneGraph';
import { PhysicsSystem } from './systems/PhysicsSystem';
import { HistorySystem } from './systems/HistorySystem';
import { ParticleSystem } from './systems/ParticleSystem';
import { AnimationSystem } from './systems/AnimationSystem';
import { SelectionSystem } from './systems/SelectionSystem';
import { WebGLRenderer, PostProcessConfig } from './renderers/WebGLRenderer';
import { DebugRenderer } from './renderers/DebugRenderer';
import { TimelineState, ComponentType, MeshComponentMode, SimulationMode, PerformanceMetrics, Vector3, SoftSelectionFalloff, UIConfiguration, GridConfiguration, SnapSettings, StaticMeshAsset, SkeletalMeshAsset, SkeletonAsset, SceneAsset, CameraComponentData, CameraSettings, PostProcessProfileAsset, ResolvedCameraState } from '@/types';
import { assetManager } from './AssetManager';
import { consoleService } from './Console';
import { GizmoSystem } from './GizmoSystem';
import { controlRigSystem } from './systems/ControlRigSystem';
import { registerCoreModules } from './modules/CoreModules';
import { moduleManager } from './ModuleManager'; 
import { Mat4Utils, Vec3Utils, MathUtils } from './math';
import { skeletonTool } from './tools/SkeletonTool';
import { DEFAULT_UI_CONFIG, DEFAULT_GRID_CONFIG, DEFAULT_SNAP_CONFIG } from '@/editor/state/EditorContext';
import { eventBus } from './EventBus';
import { MESH_TYPES, COMPONENT_MASKS } from './constants';
import { MeshTopologyUtils } from './MeshTopologyUtils';
import { resolvePostProcessProfile } from './postprocess/PostProcessProfile';
import { CameraResolver } from './camera/CameraResolver';
import { compileShader } from './ShaderCompiler'; 
import * as THREE from 'three'; 

export type SoftSelectionMode = 'FIXED' | 'DYNAMIC';

export class Engine {
    // Systems
    ecs: SoAEntitySystem;
    sceneGraph: SceneGraph;
    physicsSystem: PhysicsSystem;
    historySystem: HistorySystem;
    particleSystem: ParticleSystem;
    animationSystem: AnimationSystem;
    selectionSystem: SelectionSystem;
    gizmoSystem: GizmoSystem;
    renderer: WebGLRenderer;
    debugRenderer: DebugRenderer;
    cameraResolver: CameraResolver;

    // State
    isPlaying: boolean = false;
    simulationMode: SimulationMode = 'STOPPED';
    renderMode: number = 0;
    meshComponentMode: MeshComponentMode = 'OBJECT';
    
    // Scene Management
    currentSceneAssetId: string | null = null;

    // Soft Selection
    softSelectionEnabled: boolean = false;
    softSelectionRadius: number = 2.0;
    softSelectionMode: SoftSelectionMode = 'FIXED';
    softSelectionFalloff: SoftSelectionFalloff = 'VOLUME';
    softSelectionHeatmapVisible: boolean = true;
    softSelectionWeights: Map<number, Float32Array> = new Map(); // MeshID -> Weights

    // Deformation
    vertexSnapshot: Float32Array | null = null;
    currentDeformationDelta: Vector3 = { x: 0, y: 0, z: 0 };
    activeDeformationEntity: string | null = null;

    // Timeline
    timeline: TimelineState = {
        currentTime: 0,
        duration: 30,
        isPlaying: false,
        playbackSpeed: 1.0,
        isLooping: true
    };

    // Config
    uiConfig: UIConfiguration = DEFAULT_UI_CONFIG;
    metrics: PerformanceMetrics = { fps: 0, frameTime: 0, drawCalls: 0, triangleCount: 0, entityCount: 0 };

    // Runtime
    currentViewProj: Float32Array | null = null;
    currentCameraPos: Vector3 = { x: 0, y: 0, z: 0 };
    currentWidth: number = 0;
    currentHeight: number = 0;
    
    private listeners: (() => void)[] = [];
    private accumulator: number = 0;
    private fixedTimeStep: number = 1 / 60;
    private maxFrameTime: number = 0.1;
    
    // Skeleton Mapping: EntityID (Mesh) -> Array of Bone Entity IDs
    skeletonMap: Map<string, string[]> = new Map();
    // Skeleton Entity Mapping: EntityID (Root Bone Entity) -> Skeleton Asset ID (for rig-only skeletons)
    public skeletonEntityAssetMap: Map<string, string> = new Map();

    // Editor specifics
    isInputDown: boolean = false;
    currentShaderSource: string = '';
    pendingTextureUploads: Array<{layerIndex: number, image: HTMLImageElement}> = [];

    // Loop
    private rafId: number = 0;
    private lastTime: number = 0;

    constructor() {
        this.ecs = new SoAEntitySystem();
        this.sceneGraph = new SceneGraph();
        this.sceneGraph.setContext(this.ecs);
        this.physicsSystem = new PhysicsSystem();
        this.historySystem = new HistorySystem();
        this.particleSystem = new ParticleSystem();
        this.animationSystem = new AnimationSystem();
        this.selectionSystem = new SelectionSystem(this);
        this.renderer = new WebGLRenderer();
        this.debugRenderer = new DebugRenderer();
        this.cameraResolver = new CameraResolver();
        this.gizmoSystem = new GizmoSystem(this as any);
        
        registerCoreModules(this.physicsSystem, this.particleSystem, this.animationSystem);
        
        this.initEventListeners();
    }

    private initEventListeners() {
        eventBus.on('ASSET_CREATED', (asset: any) => {
             const a = assetManager.getAsset(asset.id);
             if (a && (a.type === 'MESH' || a.type === 'SKELETAL_MESH')) {
                 this.registerAssetWithGPU(a as StaticMeshAsset | SkeletalMeshAsset);
             }
        });

        eventBus.on('ASSET_UPDATED', (asset: any) => {
             const a = assetManager.getAsset(asset.id);
             if (a) {
                 if (a.type === 'MESH' || a.type === 'SKELETAL_MESH') {
                     this.notifyMeshChanged(a.id);
                 } else if (a.type === 'MATERIAL') {
                     this.compileGraph(a.data.nodes, a.data.connections, a.id);
                 } else if (a.type === 'SKELETON') {
                     this.syncSkeletonEntities(a.id);
                 } else if (a.type === 'CAMERA_PRESET' || a.type === 'POST_PROCESS_PROFILE' || a.type === 'VIEWPORT_PROFILE') {
                     // Resolved cameras/profiles read assets by reference, so edits become live immediately.
                     this.notifyUI();
                 }
             }
        });

        eventBus.on('TEXTURE_LOADED', (payload: any) => {
            const { layerIndex, image } = payload;
            if (this.renderer.gl) {
                this.meshSystem.uploadTexture(layerIndex, image);
            } else {
                this.pendingTextureUploads.push({ layerIndex, image });
            }
        });
    }

    startSystem() {
        if (this.rafId) return;
        this.lastTime = performance.now();
        const loop = (time: number) => {
            const dt = (time - this.lastTime) / 1000;
            this.lastTime = time;
            this.tick(dt);
            this.rafId = requestAnimationFrame(loop);
        };
        this.rafId = requestAnimationFrame(loop);
    }

    stopSystem() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
    }

    // ... (rest of the file remains unchanged until tick)

    get meshSystem() { return this.renderer.meshSystem; }
    get hoveredVertex() { return this.selectionSystem.hoveredVertex; }

    setSelected(ids: string[]) {
        this.selectionSystem.setSelected(ids);
        this.updateSkeletonToolActive(ids);
        this.syncTransforms(false);
        this.notifyUI();
    }

    private updateSkeletonToolActive(ids: string[]) {
        if (!ids || ids.length === 0) {
            skeletonTool.setActive(null, null);
            return;
        }

        // Check if selection is a standalone skeleton
        for (const id of ids) {
            const assetId = this.skeletonEntityAssetMap.get(id);
            if (assetId) {
                skeletonTool.setActive(assetId, id);
                return;
            }
        }

        // Check if selection is a skeletal mesh or one of its bones
        let entityId: string | null = null;
        
        // Is direct selection a skeletal mesh?
        for (const id of ids) {
             const idx = this.ecs.idToIndex.get(id);
             if (idx !== undefined && (this.ecs.store.componentMask[idx] & COMPONENT_MASKS.MESH)) {
                 const meshIntId = this.ecs.store.meshType[idx];
                 const uuid = assetManager.meshIntToUuid.get(meshIntId);
                 const asset = uuid ? assetManager.getAsset(uuid) : null;
                 if (asset && asset.type === 'SKELETAL_MESH') {
                     entityId = id;
                     break;
                 }
             }
        }

        // Or is it a bone of a skeletal mesh?
        if (!entityId) {
            for (const id of ids) {
                // Find which mesh this bone belongs to
                for (const [meshId, bones] of this.skeletonMap.entries()) {
                    if (bones.includes(id)) {
                        entityId = meshId;
                        break;
                    }
                }
                if (entityId) break;
            }
        }

        if (!entityId) {
             skeletonTool.setActive(null, null);
             return;
        }

        // If it's a standalone skeleton entity we already handled it above.
        // So this must be a mesh-based one or its bones.
        const assetId = this.skeletonEntityAssetMap.get(entityId);
        if (assetId) {
             skeletonTool.setActive(assetId, entityId);
             return;
        }
        
        // Skeletal Mesh Asset lookup
        const idx = this.ecs.idToIndex.get(entityId);
        if (idx === undefined) {
             skeletonTool.setActive(null, null);
             return;
        }
        const meshIntId = this.ecs.store.meshType[idx];
        const uuid = assetManager.meshIntToUuid.get(meshIntId);
        const asset = uuid ? assetManager.getAsset(uuid) : null;
        
        if (asset && asset.type === 'SKELETAL_MESH') {
             const skelAsset = asset as SkeletalMeshAsset;
             const skelId = skelAsset.skeletonAssetId || uuid;
             skeletonTool.setActive(skelId ?? null, entityId);
        } else {
             skeletonTool.setActive(null, null);
        }
    }

    selectEntityAt(mx: number, my: number, w: number, h: number) {
        return this.selectionSystem.selectEntityAt(mx, my, w, h);
    }
    
    selectEntitiesInRect(
        x: number,
        y: number,
        w: number,
        h: number,
        viewportWidth: number = this.currentWidth,
        viewportHeight: number = this.currentHeight,
    ) {
        return this.selectionSystem.selectEntitiesInRect(x, y, w, h, viewportWidth, viewportHeight);
    }

    highlightVertexAt(mx: number, my: number, w: number, h: number) {
        this.selectionSystem.highlightVertexAt(mx, my, w, h);
    }

    selectVerticesInBrush(mx: number, my: number, w: number, h: number, add: boolean) {
        this.selectionSystem.selectVerticesInBrush(mx, my, w, h, add);
    }

    selectLoop(mode: MeshComponentMode) {
        this.selectionSystem.selectLoop(mode);
    }
    
    getSelectionAsVertices() {
        return this.selectionSystem.getSelectionAsVertices();
    }

    subscribe(cb: () => void) {
        this.listeners.push(cb);
        return () => {
            this.listeners = this.listeners.filter(l => l !== cb);
        };
    }

    notifyUI() {
        this.listeners.forEach(cb => cb());
    }

    pushUndoState() {
        this.historySystem.pushState(this.ecs);
    }

    registerAssetWithGPU(asset: any) {
        if (asset.type === 'MESH' || asset.type === 'SKELETAL_MESH') {
            const id = assetManager.getMeshID(asset.id);
            if (id > 0) {
                this.meshSystem.registerMesh(id, asset.geometry);
            }
        }
    }

    notifyMeshChanged(assetId: string) {
        const id = assetManager.getMeshID(assetId);
        if (id > 0) {
            if (this.softSelectionWeights.has(id)) {
                this.softSelectionWeights.delete(id);
            }
            const asset = assetManager.getAsset(assetId);
            if (asset && (asset.type === 'MESH' || asset.type === 'SKELETAL_MESH')) {
                this.updateMeshBounds(asset as StaticMeshAsset | SkeletalMeshAsset);
                this.registerAssetWithGPU(asset);
            }
        }
    }

    notifyMeshGeometryChanged(entityId: string) {
        const idx = this.ecs.idToIndex.get(entityId);
        if (idx === undefined) return;
        const meshIntId = this.ecs.store.meshType[idx];
        const uuid = assetManager.meshIntToUuid.get(meshIntId);
        if (!uuid) return;
        const asset = assetManager.getAsset(uuid);
        
        if (asset && (asset.type === 'MESH' || asset.type === 'SKELETAL_MESH')) {
            const meshAsset = asset as StaticMeshAsset | SkeletalMeshAsset;
            if (!meshAsset.geometry) return;
            this.updateMeshBounds(meshAsset);
            this.registerAssetWithGPU(meshAsset);
        }
    }

    notifyMeshGeometryFinalized(entityId: string) {
        const idx = this.ecs.idToIndex.get(entityId);
        if (idx === undefined) return;
        const meshIntId = this.ecs.store.meshType[idx];
        const uuid = assetManager.meshIntToUuid.get(meshIntId);
        if (!uuid) return;
        const asset = assetManager.getAsset(uuid);
        
        if (asset && (asset.type === 'MESH' || asset.type === 'SKELETAL_MESH')) {
             eventBus.emit('ASSET_UPDATED', { id: asset.id, type: asset.type });
        }
    }

    flushPendingTextures() {
        if (this.renderer.gl && this.pendingTextureUploads.length !== 0) {
            for(const p of this.pendingTextureUploads) {
                this.meshSystem.uploadTexture(p.layerIndex, p.image);
            }
            this.pendingTextureUploads = [];
        }
    }

    initGL(canvas: HTMLCanvasElement) {
        this.renderer.init(canvas);
        this.renderer.initGizmo();
        this.debugRenderer.init(this.renderer.gl!);
        
        this.flushPendingTextures();
        
        if (this.renderer.gl) {
            moduleManager.init({
                engine: this,
                ecs: this.ecs,
                scene: this.sceneGraph,
                gl: this.renderer.gl
            });
        }

        // Upload all existing meshes
        assetManager.getAssetsByType('MESH').forEach(a => this.registerAssetWithGPU(a));
        assetManager.getAssetsByType('SKELETAL_MESH').forEach(a => this.registerAssetWithGPU(a));
        
        this.recompileAllMaterials();

        if (this.ecs.count === 0) {
            this.createDefaultScene();
        }
    }

    setGridConfig(config: GridConfiguration) {
        this.renderer.showGrid = config.visible;
        this.renderer.gridOpacity = config.opacity;
        this.renderer.gridSize = config.size;
        this.renderer.gridSubdivisions = config.subdivisions;
        this.renderer.gridFadeDistance = config.fadeDistance;
        this.renderer.gridExcludePP = config.excludeFromPostProcess;
        if (config.color) {
            const hex = config.color;
            const r = parseInt(hex.slice(1,3), 16)/255;
            const g = parseInt(hex.slice(3,5), 16)/255;
            const b = parseInt(hex.slice(5,7), 16)/255;
            this.renderer.gridColor = [r, g, b];
        }
        this.notifyUI();
    }

    setUiConfig(config: UIConfiguration) {
        this.uiConfig = config;
        this.notifyUI();
    }

    recompileAllMaterials() {
        const mats = assetManager.getAssetsByType('MATERIAL');
        mats.forEach(m => {
            if (m.type === 'MATERIAL') {
                this.compileGraph(m.data.nodes, m.data.connections, m.id);
            }
        });
    }

    compileGraph(nodes: any[], connections: any[], assetId: string) {
        const asset = assetManager.getAsset(assetId);
        if (asset && asset.type === 'MATERIAL') {
            const result = compileShader(nodes, connections);
            if (typeof result !== 'string') {
                const matIntId = assetManager.getMaterialID(assetId);
                if (matIntId > 0) {
                    this.meshSystem.updateMaterial(matIntId, result);
                    this.currentShaderSource = result.fs;
                }
            } else {
                consoleService.error(`Shader Compile Error: ${result}`);
            }
        } else if (asset && (asset.type === 'SCRIPT' || asset.type === 'RIG')) {
            assetManager.saveScript(assetId, nodes, connections);
        }
    }

    executeAssetGraph(entityId: string, assetId: string) {
        // Logic to run scripts/rigs
    }

    createEntityFromAsset(assetId: string, pos: {x:number, y:number, z:number}) {
        let asset = assetManager.getAsset(assetId);
        
        if (!asset && assetId.startsWith('SM_')) {
            const primName = assetId.replace('SM_', '');
            const meshes = assetManager.getAssetsByType('MESH');
            asset = meshes.find(a => a.name === `SM_${primName}`);
        }

        if (!asset) {
            consoleService.warn(`[Engine] Could not find asset: ${assetId}`);
            return null;
        }

        const id = this.ecs.createEntity(asset.name);
        this.sceneGraph.registerEntity(id);

        const idx = this.ecs.idToIndex.get(id);
        
        if (idx !== undefined) {
            this.ecs.store.setPosition(idx, pos.x, pos.y, pos.z);
            
            if (asset.type === 'MESH') {
                this.ecs.addComponent(id, ComponentType.MESH);
                this.ecs.store.meshType[idx] = assetManager.getMeshID(asset.id);
                if (this.ecs.store.materialIndex[idx] === 0) this.ecs.store.materialIndex[idx] = 1; 
            } 
            else if (asset.type === 'SKELETAL_MESH') {
                this.ecs.addComponent(id, ComponentType.MESH);
                this.ecs.store.meshType[idx] = assetManager.getMeshID(asset.id);
                if (this.ecs.store.materialIndex[idx] === 0) this.ecs.store.materialIndex[idx] = 1; 
                
                // --- SKELETON SPAWNING ---
                const skelAsset = asset as SkeletalMeshAsset;
                const bones = skelAsset.skeleton.bones;
                const boneEntityIds: string[] = new Array(bones.length);

                bones.forEach((bone, bIdx) => {
                    const boneId = this.ecs.createEntity(bone.name);
                    const bEcsIdx = this.ecs.idToIndex.get(boneId)!;
                    
                    // Register first to ensure SceneNode exists before attachment
                    boneEntityIds[bIdx] = boneId;
                    this.sceneGraph.registerEntity(boneId);

                    if (bone.parentIndex !== -1) {
                        const parentId = boneEntityIds[bone.parentIndex];
                        if (parentId) this.sceneGraph.attach(boneId, parentId);
                    } else {
                        // Root bone attaches to Mesh Entity
                        this.sceneGraph.attach(boneId, id);
                    }
                    
                    // Initialize local transform from bindPose
                    if (bone.bindPose && bEcsIdx !== undefined) {
                        const m = new THREE.Matrix4().fromArray(bone.bindPose);
                        const p = new THREE.Vector3();
                        const q = new THREE.Quaternion();
                        const s = new THREE.Vector3();
                        m.decompose(p, q, s);
                        const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
                        this.ecs.store.setPosition(bEcsIdx, p.x, p.y, p.z);
                        this.ecs.store.setRotation(bEcsIdx, euler.x, euler.y, euler.z);
                        this.ecs.store.setScale(bEcsIdx, s.x, s.y, s.z);
                    }

                    // Add VirtualPivot to visualize joints
                    this.ecs.addComponent(boneId, ComponentType.VIRTUAL_PIVOT);
                    this.ecs.store.vpLength[bEcsIdx] = 0.2;
                });
                
                this.skeletonMap.set(id, boneEntityIds);
                this.syncTransforms(false);
            }

            else if (asset.type === 'SKELETON') {
                const skelAsset = asset as SkeletonAsset;
                const bones = skelAsset.skeleton?.bones || [];
                const boneEntityIds: string[] = new Array(bones.length);

                bones.forEach((bone, bIdx) => {
                    // Create bone entities
                    const boneId = this.ecs.createEntity(bone.name || `Bone_${bIdx}`);
                    const bEcsIdx = this.ecs.idToIndex.get(boneId)!;
                    
                    // Register first to ensure SceneNode exists before attachment
                    boneEntityIds[bIdx] = boneId;
                    this.sceneGraph.registerEntity(boneId);

                    if (bone.parentIndex !== -1) {
                        const parentId = boneEntityIds[bone.parentIndex];
                        if (parentId) this.sceneGraph.attach(boneId, parentId);
                    } else {
                        // Root bone attaches to the Skeleton container entity (id)
                        this.sceneGraph.attach(boneId, id);
                    }

                    // Initialize local transform from bindPose
                    if (bone.bindPose && bEcsIdx !== undefined) {
                        const m = new THREE.Matrix4().fromArray(bone.bindPose);
                        const p = new THREE.Vector3();
                        const q = new THREE.Quaternion();
                        const s = new THREE.Vector3();
                        m.decompose(p, q, s);
                        const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
                        this.ecs.store.setPosition(bEcsIdx, p.x, p.y, p.z);
                        this.ecs.store.setRotation(bEcsIdx, euler.x, euler.y, euler.z);
                        this.ecs.store.setScale(bEcsIdx, s.x, s.y, s.z);
                    }

                    // Use VirtualPivot so joints can be selected/visualized similar to skeletal meshes
                    this.ecs.addComponent(boneId, ComponentType.VIRTUAL_PIVOT);
                    this.ecs.store.vpLength[bEcsIdx] = 0.2;
                });

                // Store mapping for this skeleton container entity
                this.skeletonMap.set(id, boneEntityIds);
                this.skeletonEntityAssetMap.set(id, skelAsset.id);
                this.syncTransforms(false);
            }
            
            this.notifyUI();
            this.pushUndoState();
        }
        return id;
    }

    createCameraFromPreset(assetId: string, pos: {x:number, y:number, z:number}) {
        const asset = assetManager.getAsset(assetId);
        if (!asset || asset.type !== 'CAMERA_PRESET') return null;

        this.pushUndoState();
        const id = this.ecs.createEntity(asset.name);
        this.ecs.addComponent(id, ComponentType.CAMERA);
        this.sceneGraph.registerEntity(id);

        const entity = this.ecs.createProxy(id, this.sceneGraph);
        if (entity?.components?.[ComponentType.TRANSFORM]) {
            entity.components[ComponentType.TRANSFORM].position = pos;
        }
        const camera = entity?.components?.[ComponentType.CAMERA];
        if (camera) {
            camera.presetId = asset.id;
            camera.configSource = 'PRESET';
            camera.controlMode = 'MANUAL';
        }

        this.syncTransforms(true);
        this.notifyUI();
        consoleService.info(`Created camera from preset: ${asset.name}`);
        return id;
    }

    deleteEntity(id: string, sceneGraph: SceneGraph) {
        this.pushUndoState();
        
        // Cleanup skeleton maps
        if (this.skeletonEntityAssetMap.has(id)) {
            this.skeletonEntityAssetMap.delete(id);
        }
        if (this.skeletonMap.has(id)) {
            // Delete bones
            const bones = this.skeletonMap.get(id)!;
            bones.forEach(bId => this.ecs.deleteEntity(bId, sceneGraph));
            this.skeletonMap.delete(id);
        }

        this.cameraResolver.clearEntity(id);
        this.ecs.deleteEntity(id, sceneGraph);
        this.notifyUI();
    }

    syncSkeletonEntities(assetId: string) {
        const asset = assetManager.getAsset(assetId) as SkeletonAsset | undefined;
        if (!asset || asset.type !== 'SKELETON') return;
        const bones = asset.skeleton?.bones || [];

        this.skeletonEntityAssetMap.forEach((mappedAssetId, containerId) => {
            if (mappedAssetId !== assetId) return;
            const liveBoneIds = this.skeletonMap.get(containerId) || [];

            if (liveBoneIds.length === bones.length) {
                bones.forEach((bone, bIdx) => {
                    const boneId = liveBoneIds[bIdx];
                    const bEcsIdx = this.ecs.idToIndex.get(boneId);
                    if (bEcsIdx !== undefined && bone.bindPose) {
                        const m = new THREE.Matrix4().fromArray(bone.bindPose);
                        const p = new THREE.Vector3();
                        const q = new THREE.Quaternion();
                        const s = new THREE.Vector3();
                        m.decompose(p, q, s);
                        const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
                        this.ecs.store.setPosition(bEcsIdx, p.x, p.y, p.z);
                        this.ecs.store.setRotation(bEcsIdx, euler.x, euler.y, euler.z);
                        this.ecs.store.setScale(bEcsIdx, s.x, s.y, s.z);
                    }
                });
            } else {
                liveBoneIds.forEach(bId => {
                    this.ecs.deleteEntity(bId, this.sceneGraph);
                });

                const newBoneIds: string[] = new Array(bones.length);
                bones.forEach((bone, bIdx) => {
                    const boneId = this.ecs.createEntity(bone.name || `Bone_${bIdx}`);
                    const bEcsIdx = this.ecs.idToIndex.get(boneId)!;
                    newBoneIds[bIdx] = boneId;
                    this.sceneGraph.registerEntity(boneId);

                    if (bone.parentIndex !== -1) {
                        const parentId = newBoneIds[bone.parentIndex];
                        if (parentId) this.sceneGraph.attach(boneId, parentId);
                    } else {
                        this.sceneGraph.attach(boneId, containerId);
                    }

                    if (bone.bindPose && bEcsIdx !== undefined) {
                        const m = new THREE.Matrix4().fromArray(bone.bindPose);
                        const p = new THREE.Vector3();
                        const q = new THREE.Quaternion();
                        const s = new THREE.Vector3();
                        m.decompose(p, q, s);
                        const euler = new THREE.Euler().setFromQuaternion(q, 'YXZ');
                        this.ecs.store.setPosition(bEcsIdx, p.x, p.y, p.z);
                        this.ecs.store.setRotation(bEcsIdx, euler.x, euler.y, euler.z);
                        this.ecs.store.setScale(bEcsIdx, s.x, s.y, s.z);
                    }

                    this.ecs.addComponent(boneId, ComponentType.VIRTUAL_PIVOT);
                    this.ecs.store.vpLength[bEcsIdx] = 0.2;
                });

                this.skeletonMap.set(containerId, newBoneIds);
            }
        });

        this.syncTransforms(false);
        this.notifyUI();
    }

    duplicateEntity(id: string) {
        const idx = this.ecs.idToIndex.get(id);
        if (idx === undefined) return;
        
        this.pushUndoState();
        
        const name = this.ecs.store.names[idx] + " (Copy)";
        const newId = this.ecs.createEntity(name);
        const newIdx = this.ecs.idToIndex.get(newId)!;
        
        const store = this.ecs.store;
        
        // Copy component mask
        store.componentMask[newIdx] = store.componentMask[idx];
        
        // Copy Transform
        store.posX[newIdx] = store.posX[idx];
        store.posY[newIdx] = store.posY[idx];
        store.posZ[newIdx] = store.posZ[idx];
        store.rotX[newIdx] = store.rotX[idx];
        store.rotY[newIdx] = store.rotY[idx];
        store.rotZ[newIdx] = store.rotZ[idx];
        store.scaleX[newIdx] = store.scaleX[idx];
        store.scaleY[newIdx] = store.scaleY[idx];
        store.scaleZ[newIdx] = store.scaleZ[idx];
        
        // Copy Mesh props
        store.meshType[newIdx] = store.meshType[idx];
        store.materialIndex[newIdx] = store.materialIndex[idx];
        // Copy Camera props
        store.cameraProjection[newIdx] = store.cameraProjection[idx];
        store.cameraFov[newIdx] = store.cameraFov[idx];
        store.cameraOrthoSize[newIdx] = store.cameraOrthoSize[idx];
        store.cameraNear[newIdx] = store.cameraNear[idx];
        store.cameraFar[newIdx] = store.cameraFar[idx];
        store.cameraClearMode[newIdx] = store.cameraClearMode[idx];
        store.cameraClearR[newIdx] = store.cameraClearR[idx];
        store.cameraClearG[newIdx] = store.cameraClearG[idx];
        store.cameraClearB[newIdx] = store.cameraClearB[idx];
        store.cameraRenderLayerMask[newIdx] = store.cameraRenderLayerMask[idx];
        store.cameraPostProcessEnabled[newIdx] = store.cameraPostProcessEnabled[idx];
        store.cameraPostProcessProfileId[newIdx] = store.cameraPostProcessProfileId[idx];
        store.cameraPresetId[newIdx] = store.cameraPresetId[idx];
        store.cameraConfigSource[newIdx] = store.cameraConfigSource[idx];
        store.cameraControlMode[newIdx] = store.cameraControlMode[idx];
        
        this.sceneGraph.registerEntity(newId);
        this.notifyUI();
        consoleService.info(`Duplicated entity: ${id} -> ${newId}`);
    }

    saveScene() {
        return this.ecs.serialize();
    }

    loadScene(json: string) {
        this.cameraResolver.clearAll();
        // Clear existing Selection to prevent index errors
        this.setSelected([]);
        this.sceneGraph.clear(); // Ensure clean state before loading
        this.ecs.deserialize(json, this.sceneGraph);
        this.notifyUI();
    }

    loadSceneFromAsset(assetId: string) {
        const asset = assetManager.getAsset(assetId);
        if (asset && asset.type === 'SCENE') {
            this.loadScene((asset as SceneAsset).data.json);
            this.currentSceneAssetId = assetId;
            consoleService.success(`Loaded Scene: ${asset.name}`);
        }
    }

    saveCurrentScene() {
        const json = this.saveScene();
        if (this.currentSceneAssetId) {
            const asset = assetManager.getAsset(this.currentSceneAssetId) as SceneAsset;
            if (asset) {
                asset.data.json = json;
                eventBus.emit('ASSET_UPDATED', { id: asset.id, type: 'SCENE' });
                consoleService.success(`Saved Scene: ${asset.name}`);
            }
        } else {
            // Create new scene asset
            const asset = assetManager.createScene("Untitled Scene", json);
            this.currentSceneAssetId = asset.id;
            consoleService.success(`Created & Saved: ${asset.name}`);
        }
    }

    getResolvedCamera(cameraEntityId: string): ResolvedCameraState | null {
        const entity = this.ecs.createProxy(cameraEntityId, this.sceneGraph);
        const camera = (entity?.components?.[ComponentType.CAMERA] as CameraComponentData | undefined) ?? null;
        return camera ? this.cameraResolver.resolve(cameraEntityId, camera) : null;
    }

    setCameraRuntimeOverride(cameraEntityId: string, override: Partial<CameraSettings> | null) {
        this.cameraResolver.setRuntimeOverride(cameraEntityId, override);
        this.notifyUI();
    }

    setCameraCinematicOverride(cameraEntityId: string, override: Partial<CameraSettings> | null) {
        this.cameraResolver.setCinematicOverride(cameraEntityId, override);
        this.notifyUI();
    }

    clearCameraDriverOverrides(cameraEntityId: string) {
        this.cameraResolver.clearEntity(cameraEntityId);
        this.notifyUI();
    }

    getResolvedPostProcessProfile(cameraEntityId?: string, viewportProfileId?: string): PostProcessProfileAsset | null {
        const resolvedCamera = cameraEntityId ? this.getResolvedCamera(cameraEntityId) : null;

        const sceneAsset = this.currentSceneAssetId
            ? assetManager.getAsset(this.currentSceneAssetId) as SceneAsset | undefined
            : undefined;

        return resolvePostProcessProfile({
            viewportProfileId,
            camera: resolvedCamera?.settings ?? null,
            sceneProfileId: sceneAsset?.type === 'SCENE' ? sceneAsset.data.postProcessProfileId : '',
        });
    }

    getPostProcessConfig() {
        return this.renderer.ppConfig;
    }

    setPostProcessConfig(config: PostProcessConfig) {
        this.renderer.ppConfig = config;
        this.renderer.recompilePostProcess();
        this.notifyUI();
    }

    setRenderMode(mode: number) {
        this.renderer.renderMode = mode;
        this.notifyUI();
    }

    toggleGrid() {
        this.renderer.showGrid = !this.renderer.showGrid;
        this.notifyUI();
    }

    syncTransforms(notify: boolean = true) {
        this.sceneGraph.update();
        if(notify) this.notifyUI();
    }

    createDefaultScene() {
        // Check if "Default Scene" exists in assets
        const scenes = assetManager.getAssetsByType('SCENE');
        const defaultScene = scenes.find(s => s.name === 'Default Scene');
        
        if (defaultScene) {
            this.loadSceneFromAsset(defaultScene.id);
            return;
        }

        // --- Create Default Content Programmatically ---
        const mat = assetManager.getAssetsByType('MATERIAL').find(m => m.name === 'Standard');
        
        const cubeId = this.createEntityFromAsset('SM_Cube', { x: -1.5, y: 0, z: 0 });
        if (cubeId && mat) {
            const idx = this.ecs.idToIndex.get(cubeId);
            if (idx !== undefined) {
                this.ecs.store.materialIndex[idx] = assetManager.getMaterialID(mat.id);
                this.ecs.store.effectIndex[idx] = 101; // Hologram
                this.ecs.store.names[idx] = "Holo Cube";
            }
        }

        const sphereId = this.createEntityFromAsset('SM_Sphere', { x: 1.5, y: 0, z: 0 });
        if (sphereId && mat) {
             const idx = this.ecs.idToIndex.get(sphereId);
             if (idx !== undefined) {
                 this.ecs.store.materialIndex[idx] = assetManager.getMaterialID(mat.id);
             }
        }

        // Particle System
        const psId = this.ecs.createEntity('Campfire Particles');
        this.ecs.addComponent(psId, ComponentType.TRANSFORM);
        this.ecs.addComponent(psId, ComponentType.PARTICLE_SYSTEM);
        const psIdx = this.ecs.idToIndex.get(psId)!;
        this.ecs.store.setPosition(psIdx, 0, 0, 0);
        this.sceneGraph.registerEntity(psId);

        // Light
        const lightId = this.ecs.createEntity('Directional Light');
        this.ecs.addComponent(lightId, ComponentType.LIGHT);
        const lIdx = this.ecs.idToIndex.get(lightId)!;
        this.ecs.store.setPosition(lIdx, 5, 10, 5);
        this.ecs.store.setRotation(lIdx, -0.785, 0.785, 0);
        this.sceneGraph.registerEntity(lightId);

        // Virtual Pivot
        const vpId = this.ecs.createEntity('Virtual Pivot');
        this.ecs.addComponent(vpId, ComponentType.VIRTUAL_PIVOT);
        const vpIdx = this.ecs.idToIndex.get(vpId)!;
        this.ecs.store.setPosition(vpIdx, 0, 2, 0);
        this.sceneGraph.registerEntity(vpId);

        // --- Save as "Default Scene" Asset ---
        const json = this.saveScene();
        const asset = assetManager.createScene("Default Scene", json);
        this.currentSceneAssetId = asset.id;

        consoleService.success("Default Scene Created & Saved");
    }

    resize(width: number, height: number, dpr: number = (typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1)) {
        // Keep picking + UI math in CSS pixels (width/height), but render in physical pixels (HiDPI).
        const safeDpr = Math.max(1, Math.min(dpr, 2));
        const pixelW = Math.max(1, Math.floor(width * safeDpr));
        const pixelH = Math.max(1, Math.floor(height * safeDpr));
        this.renderer.resize(pixelW, pixelH);
    }

    start(mode: SimulationMode = 'GAME') {
        this.isPlaying = true;
        this.simulationMode = mode;
        this.timeline.isPlaying = true;
        this.notifyUI();
        consoleService.info(mode === 'GAME' ? "Game Started" : "Simulation Started");
    }

    pause() {
        this.timeline.isPlaying = false;
        this.notifyUI();
        consoleService.info("Paused");
    }

    stop() {
        this.isPlaying = false;
        this.simulationMode = 'STOPPED';
        this.timeline.isPlaying = false;
        this.timeline.currentTime = 0;
        this.notifyUI();
        consoleService.info("Stopped");
    }

    setTimelineTime(time: number) {
        this.timeline.currentTime = Math.max(0, Math.min(time, this.timeline.duration));
        this.notifyUI();
    }

    createVirtualPivot(name: string = "Virtual Pivot") {
        const id = this.ecs.createEntity(name);
        this.ecs.addComponent(id, ComponentType.VIRTUAL_PIVOT);
        this.sceneGraph.registerEntity(id);
        this.pushUndoState();
        this.notifyUI();
        consoleService.info(`Created helper: ${name}`);
        return id;
    }

    paintSkinWeights(entityId: string, worldHit: Vector3, boneIndex: number, weight: number, mode: 'ADD' | 'REPLACE' | 'SMOOTH' | 'REMOVE', radius: number) {
        const idx = this.ecs.idToIndex.get(entityId);
        if (idx === undefined) return;
        const meshIntId = this.ecs.store.meshType[idx];
        const uuid = assetManager.meshIntToUuid.get(meshIntId);
        if (!uuid) return;
        const asset = assetManager.getAsset(uuid);
        if (!asset || asset.type !== 'SKELETAL_MESH') return;
        const skelAsset = asset as SkeletalMeshAsset;

        const verts = skelAsset.geometry.vertices;
        const indices = skelAsset.geometry.jointIndices;
        const weights = skelAsset.geometry.jointWeights;

        const worldMat = this.sceneGraph.getWorldMatrix(entityId);
        if (!worldMat) return;

        const vertexCount = verts.length / 3;
        let modified = false;
        
        // Optimization: Use selected vertices if available
        const selection = this.selectionSystem.getSelectionAsVertices();
        const useSelection = selection.size > 0;

        const influences = [];
        let avgWeight = 0;

        for (let i = 0; i < vertexCount; i++) {
            if (useSelection && !selection.has(i)) continue;

            const vx = verts[i*3];
            const vy = verts[i*3+1];
            const vz = verts[i*3+2];

            // Transform to world
            const wx = worldMat[0]*vx + worldMat[4]*vy + worldMat[8]*vz + worldMat[12];
            const wy = worldMat[1]*vx + worldMat[5]*vy + worldMat[9]*vz + worldMat[13];
            const wz = worldMat[2]*vx + worldMat[6]*vy + worldMat[10]*vz + worldMat[14];

            const dist = Math.sqrt((wx - worldHit.x)**2 + (wy - worldHit.y)**2 + (wz - worldHit.z)**2);
            
            if (dist <= radius) {
                const falloff = Math.pow(1.0 - (dist / radius), 2);
                const influence = weight * falloff;
                
                influences.push({ idx: i, dist, strength: influence });

                if (mode === 'SMOOTH') {
                    // Accumulate current weight for smoothing
                     for (let k=0; k<4; k++) {
                         if (indices[i*4+k] === boneIndex) {
                             avgWeight += weights[i*4+k];
                         }
                     }
                }
            }
        }

        const smoothTarget = influences.length > 0 ? avgWeight / influences.length : 0;

        for (const { idx, strength } of influences) {
            // Find slot for boneIndex
            let slot = -1;
            let emptySlot = -1;
            
            for(let k=0; k<4; k++) {
                if (indices[idx*4+k] === boneIndex) slot = k;
                if (weights[idx*4+k] === 0) emptySlot = k;
            }

            if (slot === -1 && emptySlot !== -1) {
                slot = emptySlot;
                indices[idx*4+slot] = boneIndex;
            } else if (slot === -1) {
                // Steal lowest weight slot
                let minW = 2.0;
                let minSlot = 0;
                for(let k=0; k<4; k++) {
                    if (weights[idx*4+k] < minW) {
                        minW = weights[idx*4+k];
                        minSlot = k;
                    }
                }
                slot = minSlot;
                indices[idx*4+slot] = boneIndex;
                weights[idx*4+slot] = 0;
            }

            const currentW = weights[idx*4+slot];
            let newW = currentW;

            if (mode === 'ADD') newW = Math.min(1.0, currentW + strength * 0.1);
            else if (mode === 'REPLACE') newW = MathUtils.lerp(currentW, weight, 0.5);
            else if (mode === 'REMOVE') newW = Math.max(0.0, currentW - strength * 0.1);
            else if (mode === 'SMOOTH') newW = MathUtils.lerp(currentW, smoothTarget, strength * 0.5);

            weights[idx*4+slot] = newW;

            // Normalize
            let total = 0;
            for(let k=0; k<4; k++) total += weights[idx*4+k];
            
            if (total > 0) {
                const norm = 1.0 / total;
                for(let k=0; k<4; k++) weights[idx*4+k] *= norm;
            } else {
                 weights[idx*4] = 1.0;
            }
            
            modified = true;
        }

        if (modified) {
            eventBus.emit('ASSET_UPDATED', { id: skelAsset.id, type: skelAsset.type });
        }
    }

    floodSkinWeights(entityId: string, boneIndex: number, value: number) {
        const idx = this.ecs.idToIndex.get(entityId);
        if (idx === undefined) return;
        const meshIntId = this.ecs.store.meshType[idx];
        const uuid = assetManager.meshIntToUuid.get(meshIntId);
        if (!uuid) return;
        const asset = assetManager.getAsset(uuid) as SkeletalMeshAsset;
        if (!asset || asset.type !== 'SKELETAL_MESH') return;

        const vertexCount = asset.geometry.vertices.length / 3;
        const selection = this.selectionSystem.getSelectionAsVertices();
        const useSelection = selection.size > 0;

        for(let i=0; i<vertexCount; i++) {
            if (useSelection && !selection.has(i)) continue;

            let slot = -1;
            for(let k=0; k<4; k++) {
                if (asset.geometry.jointIndices[i*4+k] === boneIndex) slot = k;
            }
            if (slot === -1) {
                 let minW = 2.0; let minSlot = 0;
                 for(let k=0; k<4; k++) {
                     if (asset.geometry.jointWeights[i*4+k] < minW) { minW = asset.geometry.jointWeights[i*4+k]; minSlot = k; }
                 }
                 slot = minSlot;
                 asset.geometry.jointIndices[i*4+slot] = boneIndex;
            }
            asset.geometry.jointWeights[i*4+slot] = value;
            
            let total = 0;
            for(let k=0; k<4; k++) total += asset.geometry.jointWeights[i*4+k];
            if(total>0) {
                const norm = 1.0/total;
                for(let k=0; k<4; k++) asset.geometry.jointWeights[i*4+k] *= norm;
            }
        }
        eventBus.emit('ASSET_UPDATED', { id: asset.id, type: asset.type });
        consoleService.success("Flooded Skin Weights");
    }

    pruneSkinWeights(entityId: string, threshold: number) {
         const idx = this.ecs.idToIndex.get(entityId);
        if (idx === undefined) return;
        const meshIntId = this.ecs.store.meshType[idx];
        const uuid = assetManager.meshIntToUuid.get(meshIntId);
        if (!uuid) return;
        const asset = assetManager.getAsset(uuid) as SkeletalMeshAsset;
        if (!asset || asset.type !== 'SKELETAL_MESH') return;
        
        const vertexCount = asset.geometry.vertices.length / 3;
        const selection = this.selectionSystem.getSelectionAsVertices();
        const useSelection = selection.size > 0;
        
        let pruned = 0;

        for(let i=0; i<vertexCount; i++) {
            if (useSelection && !selection.has(i)) continue;
            
            for(let k=0; k<4; k++) {
                if (asset.geometry.jointWeights[i*4+k] < threshold) {
                    asset.geometry.jointWeights[i*4+k] = 0;
                    asset.geometry.jointIndices[i*4+k] = 0; 
                    pruned++;
                }
            }
            let total = 0;
            for(let k=0; k<4; k++) total += asset.geometry.jointWeights[i*4+k];
            if(total>0) {
                const norm = 1.0/total;
                for(let k=0; k<4; k++) asset.geometry.jointWeights[i*4+k] *= norm;
            }
        }
        eventBus.emit('ASSET_UPDATED', { id: asset.id, type: asset.type });
        consoleService.info(`Pruned ${pruned} small weights (<${threshold})`);
    }

    updateVertexColor(entityId: string, vertexIndex: number, color: {r: number, g: number, b: number}) {
        const idx = this.ecs.idToIndex.get(entityId);
        if (idx === undefined) return;
        const meshIntId = this.ecs.store.meshType[idx];
        const assetUuid = assetManager.meshIntToUuid.get(meshIntId);
        if (!assetUuid) return;
        const asset = assetManager.getAsset(assetUuid) as StaticMeshAsset;
        if (!asset || !asset.geometry.colors) return;
        
        asset.geometry.colors[vertexIndex*3] = color.r;
        asset.geometry.colors[vertexIndex*3+1] = color.g;
        asset.geometry.colors[vertexIndex*3+2] = color.b;
        
        this.registerAssetWithGPU(asset);
    }

    recalculateSoftSelection(trigger: boolean = true) {
        if (!this.softSelectionEnabled || this.meshComponentMode === 'OBJECT') {
            this.softSelectionWeights.forEach((w, meshId) => {
                w.fill(0);
                this.meshSystem.updateSoftSelectionBuffer(meshId, w);
            });
            this.softSelectionWeights.clear();
            return;
        }

        if (this.selectionSystem.selectedIndices.size === 0) return;
        const idx = Array.from(this.selectionSystem.selectedIndices)[0];
        const meshType = this.ecs.store.meshType[idx];
        const uuid = assetManager.meshIntToUuid.get(meshType);
        if (!uuid) return;
        const asset = assetManager.getAsset(uuid) as StaticMeshAsset;
        if (!asset) return;

        const vertices = this.softSelectionMode === 'FIXED' && this.vertexSnapshot ? this.vertexSnapshot : asset.geometry.vertices;
        const vertexCount = vertices.length / 3;
        
        const sx = this.ecs.store.scaleX[idx];
        const sy = this.ecs.store.scaleY[idx];
        const sz = this.ecs.store.scaleZ[idx];
        const scale = Math.max(sx, Math.max(sy, sz)) || 1.0;
        
        const localRadius = this.softSelectionRadius / scale;
        const selectedVerts = this.selectionSystem.getSelectionAsVertices();
        
        let weights: Float32Array;

        if (this.softSelectionFalloff === 'SURFACE') {
            weights = MeshTopologyUtils.computeSurfaceWeights(asset.geometry.indices, vertices, selectedVerts, localRadius, vertexCount);
        } else {
            weights = this.softSelectionWeights.get(meshType) || new Float32Array(vertexCount);
            if (weights.length !== vertexCount) weights = new Float32Array(vertexCount);
            
            const centroid = { x: 0, y: 0, z: 0 };
            const selArray = Array.from(selectedVerts);
            if (selArray.length > 0) {
                for(const s of selArray) {
                    centroid.x += vertices[s*3];
                    centroid.y += vertices[s*3+1];
                    centroid.z += vertices[s*3+2];
                }
                const invLen = 1.0 / selArray.length;
                centroid.x *= invLen; centroid.y *= invLen; centroid.z *= invLen;
                
                for(let i=0; i<vertexCount; i++) {
                    if (selectedVerts.has(i)) {
                        weights[i] = 1.0;
                        continue;
                    }
                    const px = vertices[i*3], py = vertices[i*3+1], pz = vertices[i*3+2];
                    const dist = Math.sqrt((px-centroid.x)**2 + (py-centroid.y)**2 + (pz-centroid.z)**2);
                    
                    if (dist <= localRadius) {
                        const t = 1.0 - (dist / localRadius);
                        weights[i] = t*t*(3 - 2*t);
                    } else {
                        weights[i] = 0.0;
                    }
                }
            } else {
                weights.fill(0);
            }
        }

        this.softSelectionWeights.set(meshType, weights);
        this.meshSystem.updateSoftSelectionBuffer(meshType, weights);
        
        if (trigger && this.vertexSnapshot && this.activeDeformationEntity && this.softSelectionMode === 'FIXED') {
            this.applyDeformation(this.activeDeformationEntity);
        }
    }

    startVertexDrag(entityId: string) {
        const idx = this.ecs.idToIndex.get(entityId);
        if (idx === undefined) return;
        const meshType = this.ecs.store.meshType[idx];
        const uuid = assetManager.meshIntToUuid.get(meshType);
        if (!uuid) return;
        const asset = assetManager.getAsset(uuid) as StaticMeshAsset;
        
        if (asset) {
            this.vertexSnapshot = new Float32Array(asset.geometry.vertices);
            this.activeDeformationEntity = entityId;
            this.currentDeformationDelta = { x: 0, y: 0, z: 0 };
            
            this.recalculateSoftSelection(false);
        }
    }

    updateVertexDrag(entityId: string, deltaLocal: Vector3) {
        if (!this.vertexSnapshot || this.activeDeformationEntity !== entityId) {
            this.startVertexDrag(entityId);
        }
        
        if (this.softSelectionEnabled && this.softSelectionMode === 'DYNAMIC') {
            const incrementalDelta = Vec3Utils.subtract(deltaLocal, this.currentDeformationDelta, {x:0,y:0,z:0});
            this.applyIncrementalDeformation(entityId, incrementalDelta);
        } else {
            this.currentDeformationDelta = deltaLocal;
            this.applyDeformation(entityId);
        }
        this.currentDeformationDelta = deltaLocal;
    }

    applyIncrementalDeformation(entityId: string, delta: Vector3) {
         const idx = this.ecs.idToIndex.get(entityId);
        if (idx === undefined) return;
        const meshType = this.ecs.store.meshType[idx];
        const uuid = assetManager.meshIntToUuid.get(meshType);
        const asset = assetManager.getAsset(uuid!) as StaticMeshAsset;
        if (!asset) return;

        const verts = asset.geometry.vertices;
        const weights = this.softSelectionWeights.get(meshType);
        const selected = this.selectionSystem.getSelectionAsVertices();
        
        if (this.softSelectionEnabled && weights) {
            for(let i=0; i<weights.length; i++) {
                const w = weights[i];
                if (w > 1e-4) {
                    verts[i*3] += delta.x * w;
                    verts[i*3+1] += delta.y * w;
                    verts[i*3+2] += delta.z * w;
                }
            }
        } else {
             for(const i of selected) {
                verts[i*3] += delta.x;
                verts[i*3+1] += delta.y;
                verts[i*3+2] += delta.z;
             }
        }
        this.notifyMeshGeometryChanged(entityId);
    }

    applyDeformation(entityId: string) {
        const idx = this.ecs.idToIndex.get(entityId);
        if (idx === undefined) return;
        const meshType = this.ecs.store.meshType[idx];
        const uuid = assetManager.meshIntToUuid.get(meshType);
        const asset = assetManager.getAsset(uuid!) as StaticMeshAsset;
        if (!asset || !this.vertexSnapshot) return;

        const verts = asset.geometry.vertices;
        const snapshot = this.vertexSnapshot;
        const weights = this.softSelectionWeights.get(meshType);
        const delta = this.currentDeformationDelta;
        const selected = this.selectionSystem.getSelectionAsVertices();

        if (this.softSelectionEnabled && weights) {
            for(let i=0; i<weights.length; i++) {
                const w = weights[i];
                if (w > 0.001) {
                    verts[i*3] = snapshot[i*3] + delta.x * w;
                    verts[i*3+1] = snapshot[i*3+1] + delta.y * w;
                    verts[i*3+2] = snapshot[i*3+2] + delta.z * w;
                } else {
                     verts[i*3] = snapshot[i*3];
                     verts[i*3+1] = snapshot[i*3+1];
                     verts[i*3+2] = snapshot[i*3+2];
                }
            }
        } else {
            verts.set(snapshot);
            for(const i of selected) {
                verts[i*3] += delta.x;
                verts[i*3+1] += delta.y;
                verts[i*3+2] += delta.z;
            }
        }
        
        this.notifyMeshGeometryChanged(entityId);
    }

    updateMeshBounds(asset: StaticMeshAsset | SkeletalMeshAsset) {
        const v = asset.geometry.vertices;
        let minX=Infinity, minY=Infinity, minZ=Infinity;
        let maxX=-Infinity, maxY=-Infinity, maxZ=-Infinity;
        
        for(let i=0; i<v.length; i+=3) {
            const x = v[i], y = v[i+1], z = v[i+2];
            if(x<minX) minX=x; if(x>maxX) maxX=x;
            if(y<minY) minY=y; if(y>maxY) maxY=y;
            if(z<minZ) minZ=z; if(z>maxZ) maxZ=z;
        }
        asset.geometry.aabb = { min: {x:minX, y:minY, z:minZ}, max: {x:maxX, y:maxY, z:maxZ} };
        
        if (asset.topology) {
            asset.topology.bvh = undefined;
        }
    }

    endVertexDrag() {
        if (this.activeDeformationEntity) {
            this.notifyMeshGeometryFinalized(this.activeDeformationEntity);
        }
    }

    clearDeformation() {
        this.vertexSnapshot = null;
        this.activeDeformationEntity = null;
        this.currentDeformationDelta = { x: 0, y: 0, z: 0 };
    }

    extrudeFaces() { consoleService.warn("Extrude Faces: Not implemented"); }
    bevelEdges() { consoleService.warn("Bevel Edges: Not implemented"); }
    weldVertices() { consoleService.warn("Weld Vertices: Not implemented"); }
    connectComponents() { consoleService.warn("Connect Components: Not implemented"); }
    deleteSelectedFaces() { consoleService.warn("Delete Selected Faces: Not implemented"); }

    tick(dt: number) {
        const now = performance.now();
        const delta = Math.min(dt, this.maxFrameTime);
        
        if (dt > 0) {
            this.accumulator += delta;
        }

        moduleManager.update(delta);

        while (this.accumulator >= this.fixedTimeStep) {
            this.fixedUpdate(this.fixedTimeStep);
            this.accumulator -= this.fixedTimeStep;
        }

        this.sceneGraph.update();
        controlRigSystem.update(delta);

        if (this.currentViewProj && !this.isPlaying) {
             this.debugRenderer.begin();
             skeletonTool.update();
        }

        if (this.currentViewProj) {
            const softSelData = {
                enabled: this.softSelectionEnabled && this.meshComponentMode !== 'OBJECT',
                center: { x: 0, y: 0, z: 0 },
                radius: this.softSelectionRadius,
                heatmapVisible: this.softSelectionHeatmapVisible
            };

            if (softSelData.enabled && this.selectionSystem.selectedIndices.size > 0) {
                const idx = Array.from(this.selectionSystem.selectedIndices)[0];
                const entityId = this.ecs.store.ids[idx];
                const worldMat = this.sceneGraph.getWorldMatrix(entityId);
                const meshIntId = this.ecs.store.meshType[idx];
                const uuid = assetManager.meshIntToUuid.get(meshIntId);
                const asset = uuid ? assetManager.getAsset(uuid) : null;
                const verts = this.softSelectionMode === 'FIXED' && this.vertexSnapshot ? this.vertexSnapshot : (asset as StaticMeshAsset)?.geometry.vertices;
                const selected = this.selectionSystem.getSelectionAsVertices();
                
                if (verts && selected.size > 0 && worldMat) {
                    const firstSel = Array.from(selected)[0];
                    const lx = verts[firstSel*3], ly = verts[firstSel*3+1], lz = verts[firstSel*3+2];
                    const wx = worldMat[0]*lx + worldMat[4]*ly + worldMat[8]*lz + worldMat[12];
                    const wy = worldMat[1]*lx + worldMat[5]*ly + worldMat[9]*lz + worldMat[13];
                    const wz = worldMat[2]*lx + worldMat[6]*ly + worldMat[10]*lz + worldMat[14];
                    softSelData.center = { x: wx, y: wy, z: wz };
                } else if (worldMat) {
                     softSelData.center = { x: worldMat[12], y: worldMat[13], z: worldMat[14] };
                }
            }

            this.renderer.render(
                this.ecs.store, 
                this.ecs.count, 
                this.selectionSystem.selectedIndices,
                this.currentViewProj, 
                this.currentWidth, 
                this.currentHeight, 
                this.currentCameraPos,
                softSelData,
                this.isPlaying && this.simulationMode === 'GAME' ? undefined : this.debugRenderer,
                this.particleSystem
            );
        }

        const frameEnd = performance.now();
        this.metrics.frameTime = frameEnd - now;
        if (dt > 1e-4) this.metrics.fps = 1 / dt;
        
        this.gizmoSystem.render();
        
        this.metrics.drawCalls = this.renderer.drawCalls;
        this.metrics.triangleCount = this.renderer.triangleCount;
        this.metrics.entityCount = this.ecs.count;
    }

    fixedUpdate(dt: number) {
        if (this.timeline.isPlaying) {
            this.timeline.currentTime += dt * this.timeline.playbackSpeed;
            if (this.timeline.currentTime >= this.timeline.duration) {
                if (this.timeline.isLooping) {
                    this.timeline.currentTime = 0;
                } else {
                    this.timeline.currentTime = this.timeline.duration;
                    this.timeline.isPlaying = false;
                    this.isPlaying = false;
                    this.simulationMode = 'STOPPED';
                    this.notifyUI();
                }
            }
        }
        
        const store = this.ecs.store;
        for(let i=0; i<this.ecs.count; i++) {
            if (store.isActive[i]) {
                const entityId = store.ids[i];
                const rigIndex = store.rigIndex[i];
                if (rigIndex > 0) {
                     const uuid = assetManager.getRigUUID(rigIndex);
                     if (uuid) this.executeAssetGraph(entityId, uuid);
                }
            }
        }
    }

    updateCamera(vp: Float32Array, pos: Vector3, width: number, height: number) {
        this.currentViewProj = vp;
        this.currentCameraPos = pos;
        this.currentWidth = width;
        this.currentHeight = height;
    }
}

export const engineInstance = new Engine();
