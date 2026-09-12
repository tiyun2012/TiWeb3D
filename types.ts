export enum ComponentType {
    TRANSFORM = 'TRANSFORM',
    MESH = 'MESH',
    LIGHT = 'LIGHT',
    PARTICLE_SYSTEM = 'PARTICLE_SYSTEM',
    CAMERA = 'CAMERA',
    PHYSICS = 'PHYSICS',
    SCRIPT = 'SCRIPT',
    VIRTUAL_PIVOT = 'VIRTUAL_PIVOT'
}

export interface Entity {
    id: string;
    name: string;
    [key: string]: any;
}

export type ToolType = 'SELECT' | 'MOVE' | 'ROTATE' | 'SCALE';
export type TransformSpace = 'World' | 'Local';
export type SelectionType = 'ENTITY' | 'ASSET' | 'VERTEX' | 'EDGE' | 'FACE' | 'NODE';
export type MeshComponentMode = 'OBJECT' | 'VERTEX' | 'EDGE' | 'FACE';
export type SimulationMode = 'STOPPED' | 'SIMULATE' | 'GAME';
export type SoftSelectionFalloff = 'VOLUME' | 'SURFACE';
export type RotationOrder = 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';

export type AssetType =
    | 'FOLDER'
    | 'MATERIAL'
    | 'MESH'
    | 'SKELETAL_MESH'
    | 'SKELETON'
    | 'TEXTURE'
    | 'SCRIPT'
    | 'RIG'
    | 'SCENE'
    | 'CAMERA_PRESET'
    | 'POST_PROCESS_PROFILE'
    | 'PHYSICS_MATERIAL';

export interface GraphNode {
    id: string;
    type: string;
    data?: any;
    [key: string]: any;
}

export interface GraphConnection {
    id: string;
    fromNode: string;
    fromPin: string;
    toNode: string;
    toPin: string;
    // Legacy aliases retained for serialized graphs created by older builds.
    source?: string;
    target?: string;
    [key: string]: any;
}

export interface ModuleContext {
    ecs: any;
    sceneGraph?: any;
    engine?: any;
    scene?: any;
    gl?: WebGL2RenderingContext;
    [key: string]: any;
}

export interface IGameSystem {
    id: string;
    order?: number;
    init?: (ctx: ModuleContext | any) => void;
    update?: (dt: number, ctx: ModuleContext | any) => void;
    render?: (gl: WebGL2RenderingContext, viewProj: Float32Array, ctx: ModuleContext | any) => void;
    onEntityDestroyed?: (id: string, ctx: ModuleContext | any) => void;
    onComponentAdded?: (id: string, compType: ComponentType | string, ctx: ModuleContext | any) => void;
    onComponentRemoved?: (id: string, compType: ComponentType | string, ctx: ModuleContext | any) => void;
    [key: string]: any;
}

export interface EngineModule {
    id: string;
    name?: string;
    icon?: string;
    order: number;
    system?: IGameSystem;
    InspectorComponent?: any;
    onRegister?: (ctx: ModuleContext | any) => void;
    onUpdate?: (dt: number, ctx: ModuleContext | any) => void;
    onRender?: (gl: WebGL2RenderingContext, viewProj: Float32Array, ctx: ModuleContext | any) => void;
    [key: string]: any;
}

export interface InspectorProps {
    component: any;
    onUpdate: (key: string, value: any) => void;
    onStartUpdate: () => void;
    onCommit: () => void;
    [key: string]: any;
}

export interface Asset {
    id: string;
    type: AssetType;
    name: string;
    path?: string;
    isProtected?: boolean;
    data?: any;
    [key: string]: any;
}

export interface MeshGeometry {
    vertices: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    colors?: Float32Array;
    indices: Uint16Array | Uint32Array;
    jointIndices?: Float32Array | null;
    jointWeights?: Float32Array | null;
    aabb?: any;
    [key: string]: any;
}

export interface SkeletalMeshGeometry extends MeshGeometry {
    jointIndices: Float32Array;
    jointWeights: Float32Array;
}

export interface HalfEdge {
    id: number;
    vertex: number;
    pair: number;
    next: number;
    prev: number;
    face: number;
    edgeKey: string;
}

export interface MeshTopology {
    halfEdges: HalfEdge[];
    vertices: Array<{ edge: number }>;
    faces: Array<{ edge: number }>;
    edgeKeyToHalfEdge: Map<string, number>;
}

export interface LogicalMesh {
    faces: number[][];
    triangleToFaceIndex: Int32Array;
    vertexToFaces: Map<number, number[]>;
    siblings?: Map<number, number[]>;
    graph?: MeshTopology;
    bvh?: any;
}

export interface StaticMeshAsset extends Asset {
    type: 'MESH' | 'SKELETAL_MESH';
    topology: LogicalMesh;
    geometry: MeshGeometry;
    /** Optional asset-default material. Empty/undefined uses built-in Standard Lambert. */
    materialId?: string;
}

export interface SkeletalMeshAsset extends StaticMeshAsset {
    type: 'SKELETAL_MESH';
    geometry: SkeletalMeshGeometry;
    skeleton: { bones: BoneData[] };
    skeletonAssetId?: string;
    animations: AnimationClip[];
}

export interface SkeletonAsset extends Asset {
    type: 'SKELETON';
    bones?: BoneData[];
    skeleton: { bones: BoneData[] };
    animations?: AnimationClip[];
}

export interface BoneData {
    name: string;
    parentIndex: number;
    bindPose: Float32Array;
    inverseBindPose: Float32Array;
    visual?: {
        shape?: string;
        size?: number;
        color?: Vector3;
        [key: string]: any;
    };
    [key: string]: any;
}

export interface FolderAsset extends Asset {
    type: 'FOLDER';
    path: string;
}

export interface TextureAsset extends Asset {
    type: 'TEXTURE';
    source: string;
    layerIndex: number;
}

export interface MaterialAsset extends Asset {
    type: 'MATERIAL';
    data: {
        nodes: GraphNode[];
        connections: GraphConnection[];
        glsl: string;
        [key: string]: any;
    };
}

export interface PhysicsMaterialAsset extends Asset {
    type: 'PHYSICS_MATERIAL';
    data: {
        staticFriction: number;
        dynamicFriction: number;
        bounciness: number;
        density: number;
        [key: string]: any;
    };
}

export interface ScriptAsset extends Asset {
    type: 'SCRIPT';
    data: {
        nodes: GraphNode[];
        connections: GraphConnection[];
        [key: string]: any;
    };
}

export interface RigAsset extends Asset {
    type: 'RIG';
    data: {
        nodes: GraphNode[];
        connections: GraphConnection[];
        [key: string]: any;
    };
}

export interface AnimationClip {
    name: string;
    duration: number;
    tracks: AnimationTrack[];
    [key: string]: any;
}

export interface AnimationTrack {
    name: string;
    type: 'position' | 'rotation' | 'scale';
    times: Float32Array;
    values: Float32Array;
    target?: string;
    path?: string;
    keyframes?: any[];
    [key: string]: any;
}

export interface TimelineState {
    currentTime: number;
    isPlaying: boolean;
    duration: number;
    playbackSpeed: number;
    isLooping: boolean;
    [key: string]: any;
}

export interface IEngine {
    isPlaying: boolean;
    skeletonMap?: Map<string, string[]>;
    [key: string]: any;
}

export interface PerformanceMetrics {
    fps: number;
    frameTime: number;
    drawCalls: number;
    entityCount: number;
    [key: string]: any;
}

export interface Vector3 {
    x: number;
    y: number;
    z: number;
}

export interface UIConfiguration {
    selectionEdgeHighlight?: boolean;
    selectionEdgeColor?: string;
    vertexColor?: string;
    vertexSize?: number;
    [key: string]: any;
}

export interface GridConfiguration {
    [key: string]: any;
}

export interface SnapSettings {
    [key: string]: any;
}


export type CameraProjection = 'PERSPECTIVE' | 'ORTHOGRAPHIC';
export type CameraClearMode = 'COLOR' | 'SKY' | 'NONE';

export interface CameraSettings {
    projection: CameraProjection;
    fov: number;
    orthoSize: number;
    near: number;
    far: number;
    clearMode: CameraClearMode;
    clearColor: string;
    renderLayerMask: number;
    postProcessEnabled: boolean;
    postProcessProfileId?: string;
}

export interface CameraComponentData extends CameraSettings {
    presetId?: string;
}

export type PostProcessStage = 'PRE_GLOBAL' | 'GLOBAL' | 'POST_GLOBAL' | 'OVERLAY';
export type PostProcessEffectType =
    | 'BLOOM'
    | 'EXPOSURE'
    | 'TONE_MAPPING'
    | 'COLOR_GRADING'
    | 'VIGNETTE'
    | 'CHROMATIC_ABERRATION'
    | 'OUTLINE'
    | 'GLOW';

export interface PostProcessEffectConfig {
    id: string;
    type: PostProcessEffectType;
    enabled: boolean;
    stage: PostProcessStage;
    order: number;
    targetMask?: string;
    params: Record<string, unknown>;
}

export interface PostProcessProfileAsset extends Asset {
    type: 'POST_PROCESS_PROFILE';
    data: {
        enabled: boolean;
        effects: PostProcessEffectConfig[];
    };
}

export interface CameraPresetAsset extends Asset {
    type: 'CAMERA_PRESET';
    data: CameraSettings;
}

export interface SceneAsset extends Asset {
    type: 'SCENE';
    data: {
        json: string;
        postProcessProfileId?: string;
        [key: string]: any;
    };
}

