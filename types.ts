export enum ComponentType {
    TRANSFORM = 'TRANSFORM',
    MESH = 'MESH',
    LIGHT = 'LIGHT',
    PARTICLE_SYSTEM = 'PARTICLE_SYSTEM',
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

export interface GraphNode {
    id: string;
    type: string;
    data?: any;
    [key: string]: any;
}

export interface GraphConnection {
    id: string;
    source: string;
    target: string;
    fromNode?: string;
    fromPin?: string;
    toNode?: string;
    toPin?: string;
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
    type: string;
    name: string;
    data?: any;
    [key: string]: any;
}

export interface StaticMeshAsset extends Asset {
    topology?: any;
    geometry?: any;
}

export interface SkeletalMeshAsset extends StaticMeshAsset {
    skeleton?: any;
    skeletonAssetId?: string;
    animations?: any;
}

export interface SkeletonAsset extends Asset {
    bones?: any;
    skeleton?: any;
}

export interface AnimationClip {
    name: string;
    duration: number;
    tracks: AnimationTrack[];
    [key: string]: any;
}

export interface AnimationTrack {
    target: string;
    path: string;
    keyframes: any[];
    times?: Float32Array;
    values?: Float32Array;
    type?: string;
    name?: string;
    [key: string]: any;
}

export interface TimelineState {
    currentTime: number;
    isPlaying: boolean;
    duration: number;
    playbackSpeed?: number;
    isLooping?: boolean;
    [key: string]: any;
}

export interface IEngine {
    isPlaying: boolean;
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

export interface SceneAsset extends Asset {
    [key: string]: any;
}

