
import { Mat4Utils, RayUtils, Vec3Utils, AABBUtils } from '../math';
import { COMPONENT_MASKS } from '../constants';
import { assetManager } from '../AssetManager';
import { StaticMeshAsset, MeshComponentMode, IEngine } from '@/types';
import { MeshTopologyUtils, MeshPickingResult } from '../MeshTopologyUtils';
import { consoleService } from '../Console';
import { meshEdgeKey } from '../MeshEdgeGeometry';
import { applyMeshComponentSelectionOperation, type MeshComponentSelectionOperation } from '../selection/MeshComponentSelection';
import { areVerticesAdjacent, getEdgeFaces, getSharedFaceEdge, getVertexNeighbors } from '../mesh-editing/MeshConnectivity';


type ScreenPoint = { x: number; y: number };

export type HoveredMeshComponent =
    | { entityId: string; mode: 'VERTEX'; vertexId: number }
    | { entityId: string; mode: 'EDGE'; edgeId: [number, number]; edgeKey: string }
    | { entityId: string; mode: 'FACE'; faceId: number };

const pointToSegmentDistance2D = (point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number => {
    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const lengthSq = abX * abX + abY * abY;
    if (lengthSq <= 1e-8) return Math.hypot(point.x - a.x, point.y - a.y);
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * abX + (point.y - a.y) * abY) / lengthSq));
    const closestX = a.x + abX * t;
    const closestY = a.y + abY * t;
    return Math.hypot(point.x - closestX, point.y - closestY);
};

type ScreenRect = {
    left: number;
    right: number;
    top: number;
    bottom: number;
};

const SCREEN_OVERLAP_EPSILON = 1e-5;

const pointInScreenRect = (point: ScreenPoint, rect: ScreenRect): boolean =>
    point.x >= rect.left - SCREEN_OVERLAP_EPSILON &&
    point.x <= rect.right + SCREEN_OVERLAP_EPSILON &&
    point.y >= rect.top - SCREEN_OVERLAP_EPSILON &&
    point.y <= rect.bottom + SCREEN_OVERLAP_EPSILON;

const orient2D = (a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): number =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

const pointInTriangle2D = (point: ScreenPoint, a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): boolean => {
    const ab = orient2D(a, b, point);
    const bc = orient2D(b, c, point);
    const ca = orient2D(c, a, point);
    const hasNegative = ab < -SCREEN_OVERLAP_EPSILON || bc < -SCREEN_OVERLAP_EPSILON || ca < -SCREEN_OVERLAP_EPSILON;
    const hasPositive = ab > SCREEN_OVERLAP_EPSILON || bc > SCREEN_OVERLAP_EPSILON || ca > SCREEN_OVERLAP_EPSILON;
    return !(hasNegative && hasPositive);
};

const pointOnSegment2D = (point: ScreenPoint, a: ScreenPoint, b: ScreenPoint): boolean =>
    Math.abs(orient2D(a, b, point)) <= SCREEN_OVERLAP_EPSILON &&
    point.x >= Math.min(a.x, b.x) - SCREEN_OVERLAP_EPSILON &&
    point.x <= Math.max(a.x, b.x) + SCREEN_OVERLAP_EPSILON &&
    point.y >= Math.min(a.y, b.y) - SCREEN_OVERLAP_EPSILON &&
    point.y <= Math.max(a.y, b.y) + SCREEN_OVERLAP_EPSILON;

const segmentsIntersect2D = (a: ScreenPoint, b: ScreenPoint, c: ScreenPoint, d: ScreenPoint): boolean => {
    const o1 = orient2D(a, b, c);
    const o2 = orient2D(a, b, d);
    const o3 = orient2D(c, d, a);
    const o4 = orient2D(c, d, b);

    if (((o1 > SCREEN_OVERLAP_EPSILON && o2 < -SCREEN_OVERLAP_EPSILON) ||
         (o1 < -SCREEN_OVERLAP_EPSILON && o2 > SCREEN_OVERLAP_EPSILON)) &&
        ((o3 > SCREEN_OVERLAP_EPSILON && o4 < -SCREEN_OVERLAP_EPSILON) ||
         (o3 < -SCREEN_OVERLAP_EPSILON && o4 > SCREEN_OVERLAP_EPSILON))) {
        return true;
    }

    return (Math.abs(o1) <= SCREEN_OVERLAP_EPSILON && pointOnSegment2D(c, a, b)) ||
        (Math.abs(o2) <= SCREEN_OVERLAP_EPSILON && pointOnSegment2D(d, a, b)) ||
        (Math.abs(o3) <= SCREEN_OVERLAP_EPSILON && pointOnSegment2D(a, c, d)) ||
        (Math.abs(o4) <= SCREEN_OVERLAP_EPSILON && pointOnSegment2D(b, c, d));
};

const segmentOverlapsScreenRect = (a: ScreenPoint, b: ScreenPoint, rect: ScreenRect): boolean => {
    if (pointInScreenRect(a, rect) || pointInScreenRect(b, rect)) return true;
    const corners: ScreenPoint[] = [
        { x: rect.left, y: rect.top },
        { x: rect.right, y: rect.top },
        { x: rect.right, y: rect.bottom },
        { x: rect.left, y: rect.bottom },
    ];
    const rectEdges: Array<[ScreenPoint, ScreenPoint]> = [
        [corners[0], corners[1]],
        [corners[1], corners[2]],
        [corners[2], corners[3]],
        [corners[3], corners[0]],
    ];
    return rectEdges.some(([start, end]) => segmentsIntersect2D(a, b, start, end));
};

const triangleOverlapsScreenRect = (
    a: ScreenPoint,
    b: ScreenPoint,
    c: ScreenPoint,
    rect: ScreenRect,
): boolean => {
    const triMinX = Math.min(a.x, b.x, c.x);
    const triMaxX = Math.max(a.x, b.x, c.x);
    const triMinY = Math.min(a.y, b.y, c.y);
    const triMaxY = Math.max(a.y, b.y, c.y);
    if (triMaxX < rect.left || triMinX > rect.right || triMaxY < rect.top || triMinY > rect.bottom) return false;

    if (pointInScreenRect(a, rect) || pointInScreenRect(b, rect) || pointInScreenRect(c, rect)) return true;

    const corners: ScreenPoint[] = [
        { x: rect.left, y: rect.top },
        { x: rect.right, y: rect.top },
        { x: rect.right, y: rect.bottom },
        { x: rect.left, y: rect.bottom },
    ];
    if (corners.some((corner) => pointInTriangle2D(corner, a, b, c))) return true;

    const triangleEdges: Array<[ScreenPoint, ScreenPoint]> = [[a, b], [b, c], [c, a]];
    const rectEdges: Array<[ScreenPoint, ScreenPoint]> = [
        [corners[0], corners[1]],
        [corners[1], corners[2]],
        [corners[2], corners[3]],
        [corners[3], corners[0]],
    ];
    return triangleEdges.some(([edgeStart, edgeEnd]) =>
        rectEdges.some(([rectStart, rectEnd]) => segmentsIntersect2D(edgeStart, edgeEnd, rectStart, rectEnd)),
    );
};

/**
 * Refines a projected-AABB marquee candidate against the actual projected mesh.
 * Returns null only when the asset has no triangle data that can be used for a
 * precise test; callers may then deliberately keep the coarse AABB fallback.
 */
const meshOverlapsScreenRect = (
    asset: StaticMeshAsset,
    worldMatrix: Float32Array,
    viewProj: Float32Array,
    viewportWidth: number,
    viewportHeight: number,
    rect: ScreenRect,
): boolean | null => {
    const vertices = asset.geometry.vertices;
    if (!vertices || vertices.length < 9) return null;

    const vertexCount = Math.floor(vertices.length / 3);
    const projected = new Array<ScreenPoint | null | undefined>(vertexCount);

    const projectVertex = (index: number): ScreenPoint | null => {
        if (!Number.isInteger(index) || index < 0 || index >= vertexCount) return null;
        const cached = projected[index];
        if (cached !== undefined) return cached;

        const local = {
            x: vertices[index * 3],
            y: vertices[index * 3 + 1],
            z: vertices[index * 3 + 2],
        };
        const world = Vec3Utils.transformMat4(local, worldMatrix, { x: 0, y: 0, z: 0 });
        const clipW = viewProj[3] * world.x + viewProj[7] * world.y + viewProj[11] * world.z + viewProj[15];
        if (clipW <= 0.001) {
            projected[index] = null;
            return null;
        }

        const ndc = Vec3Utils.transformMat4(world, viewProj, { x: 0, y: 0, z: 0 });
        const point = {
            x: (ndc.x * 0.5 + 0.5) * viewportWidth,
            y: (1.0 - (ndc.y * 0.5 + 0.5)) * viewportHeight,
        };
        projected[index] = point;
        return point;
    };

    let triangleDataCount = 0;
    const testTriangle = (ia: number, ib: number, ic: number): boolean => {
        const validIndex = (index: number) => Number.isInteger(index) && index >= 0 && index < vertexCount;
        if (!validIndex(ia) || !validIndex(ib) || !validIndex(ic)) return false;
        triangleDataCount++;
        const a = projectVertex(ia);
        const b = projectVertex(ib);
        const c = projectVertex(ic);
        if (!a || !b || !c) return false;
        return triangleOverlapsScreenRect(a, b, c, rect);
    };

    const faces = asset.topology?.faces ?? [];
    if (faces.length > 0) {
        for (const face of faces) {
            if (!face || face.length < 3) continue;
            const first = face[0];
            for (let i = 1; i < face.length - 1; i++) {
                if (testTriangle(first, face[i], face[i + 1])) return true;
            }
        }
    } else {
        const indices = asset.geometry.indices;
        if (indices && indices.length >= 3) {
            for (let i = 0; i + 2 < indices.length; i += 3) {
                if (testTriangle(indices[i], indices[i + 1], indices[i + 2])) return true;
            }
        }
    }

    return triangleDataCount > 0 ? false : null;
};

export class SelectionSystem {
    engine: IEngine;
    selectedIndices = new Set<number>();
    // Viewport-local helpers/entities that must not participate in object picking.
    // Example: the Scene Camera currently being viewed through sits at the ray origin
    // and would otherwise win every click through its camera pick sphere.
    private suppressedEntityIds = new Set<string>();
    subSelection = {
        vertexIds: new Set<number>(),
        edgeIds: new Set<string>(),
        faceIds: new Set<number>()
    };
    hoveredMeshComponent: HoveredMeshComponent | null = null;

    /** Backward-compatible vertex hover view for existing renderers/plugins. */
    get hoveredVertex(): { entityId: string; index: number } | null {
        const hovered = this.hoveredMeshComponent;
        return hovered?.mode === 'VERTEX'
            ? { entityId: hovered.entityId, index: hovered.vertexId }
            : null;
    }

    clearMeshComponentHover() {
        this.hoveredMeshComponent = null;
    }

    /**
     * Applies explicit component IDs to the active mesh sub-selection.
     * Hierarchy scopes, viewport modifier-clicks, and future automation should
     * use this instead of mutating subSelection sets directly so selection
     * operations, deformation/soft-selection, and UI invalidation stay unified.
     */
    setMeshComponentSelection(
        mode: Exclude<MeshComponentMode, 'OBJECT'>,
        ids: Iterable<number | string>,
        operation: MeshComponentSelectionOperation = 'REPLACE',
        notify: boolean = true,
    ) {
        this.engine.clearDeformation();

        // A mesh component selection always belongs to one active component domain.
        // Clear the other domains even for additive/toggle operations so callers cannot
        // accidentally create a mixed vertex/edge/face selection.
        const target = (mode === 'VERTEX'
            ? this.subSelection.vertexIds
            : mode === 'EDGE'
                ? this.subSelection.edgeIds
                : this.subSelection.faceIds) as Set<number | string>;

        const validIds: Array<number | string> = [];
        for (const id of ids) {
            if (mode === 'EDGE') {
                if (typeof id === 'string') validIds.push(id);
            } else if (typeof id === 'number' && Number.isInteger(id) && id >= 0) {
                validIds.push(id);
            }
        }
        const next = applyMeshComponentSelectionOperation(target, validIds, operation);

        this.subSelection.vertexIds.clear();
        this.subSelection.edgeIds.clear();
        this.subSelection.faceIds.clear();
        if (mode === 'VERTEX') this.subSelection.vertexIds = next as Set<number>;
        else if (mode === 'EDGE') this.subSelection.edgeIds = next as Set<string>;
        else this.subSelection.faceIds = next as Set<number>;

        this.hoveredMeshComponent = null;
        this.engine.recalculateSoftSelection();
        if (notify) this.engine.notifyUI();
    }

    get selectedEntities(): Set<string> {
        const set = new Set<string>();
        this.selectedIndices.forEach(idx => {
            const id = this.engine.ecs.store.ids[idx];
            if (id) set.add(id);
        });
        return set;
    }

    isSelected(id: string): boolean {
        const idx = this.engine.ecs.idToIndex.get(id);
        return idx !== undefined && this.selectedIndices.has(idx);
    }

    constructor(engine: IEngine) {
        this.engine = engine;
    }

    setSuppressedEntityIds(entityIds: Iterable<string>) {
        this.suppressedEntityIds = new Set(entityIds);
    }

    setSelected(ids: string[], notify: boolean = true) {
        this.engine.clearDeformation(); 
        this.selectedIndices.clear();
        ids.forEach(id => {
            const idx = this.engine.ecs.idToIndex.get(id);
            if (idx !== undefined) this.selectedIndices.add(idx);
        });
        this.subSelection.vertexIds.clear(); 
        this.subSelection.edgeIds.clear(); 
        this.subSelection.faceIds.clear();
        this.hoveredMeshComponent = null;
        this.engine.recalculateSoftSelection(); 
        if (notify) this.engine.notifyUI();
    }

    selectEntityAt(mx: number, my: number, width: number, height: number): string | null {
        if (!this.engine.currentViewProj) return null;
        
        const invVP = new Float32Array(16);
        if (!Mat4Utils.invert(this.engine.currentViewProj, invVP)) return null;

        const ray = RayUtils.create();
        RayUtils.fromScreen(mx, my, width, height, invVP, ray);

        let closestDist = Infinity;
        let closestId: string | null = null;

        for (let i = 0; i < this.engine.ecs.count; i++) {
            if (!this.engine.ecs.store.isActive[i]) continue;
            
            const mask = this.engine.ecs.store.componentMask[i];
            const hasMesh = !!(mask & COMPONENT_MASKS.MESH);
            
            // Only check non-mesh components if they are visible/selectable types
            if (!hasMesh && !((mask & COMPONENT_MASKS.LIGHT) || (mask & COMPONENT_MASKS.PARTICLE_SYSTEM) || (mask & COMPONENT_MASKS.VIRTUAL_PIVOT) || (mask & COMPONENT_MASKS.CAMERA))) continue;

            const id = this.engine.ecs.store.ids[i];
            if (this.suppressedEntityIds.has(id)) continue;
            const wmOffset = i * 16;
            const worldMat = this.engine.ecs.store.worldMatrix.subarray(wmOffset, wmOffset + 16);
            
            let t: number | null = null;

            if (hasMesh) {
                const meshIntId = this.engine.ecs.store.meshType[i];
                const uuid = assetManager.meshIntToUuid.get(meshIntId);
                const asset = uuid ? assetManager.getAsset(uuid) as StaticMeshAsset : null;
                
                if (asset && asset.geometry.aabb) {
                    const invWorld = Mat4Utils.create();
                    if (Mat4Utils.invert(worldMat, invWorld)) {
                        const localRay = RayUtils.create();
                        Vec3Utils.transformMat4(ray.origin, invWorld, localRay.origin);
                        Vec3Utils.transformMat4Normal(ray.direction, invWorld, localRay.direction);
                        Vec3Utils.normalize(localRay.direction, localRay.direction);
                        
                        const aabbT = RayUtils.intersectAABB(localRay, asset.geometry.aabb);

                        if (aabbT !== null) {
                            // IMPORTANT: localRay was transformed and re-normalized, so aabbT is in
                            // local-space distance units. Never compare it with closestDist, which is
                            // measured in world-space units. That incorrectly rejected scaled meshes.
                            if (asset.topology && asset.topology.faces.length > 0) {
                                const res = MeshTopologyUtils.raycastMesh(asset.topology, asset.geometry.vertices, localRay);
                                if (res) {
                                    const worldHit = Vec3Utils.transformMat4(res.worldPos, worldMat, {x:0,y:0,z:0});
                                    t = Vec3Utils.distance(ray.origin, worldHit);
                                }
                            } else {
                                // Assets without logical topology still need to be selectable. Use the
                                // broad-phase AABB hit as a deliberate fallback instead of making them
                                // impossible to click.
                                const localHit = Vec3Utils.add(
                                    localRay.origin,
                                    Vec3Utils.scale(localRay.direction, aabbT, {x:0,y:0,z:0}),
                                    {x:0,y:0,z:0},
                                );
                                const worldHit = Vec3Utils.transformMat4(localHit, worldMat, {x:0,y:0,z:0});
                                t = Vec3Utils.distance(ray.origin, worldHit);
                            }
                        }
                    }
                }
            } else {
                const pos = { x: worldMat[12], y: worldMat[13], z: worldMat[14] };
                t = RayUtils.intersectSphere(ray, pos, 0.5);
            }
            
            if (t !== null && t < closestDist) {
                closestDist = t;
                closestId = id;
            }
        }

        // Check bone segments across all skeletons so clicking a bone selects its parent joint (unifying joint + bone)
        if (this.engine.skeletonMap) {
            this.engine.skeletonMap.forEach((boneIds) => {
                for (let b = 0; b < boneIds.length; b++) {
                    const childId = boneIds[b];
                    const parentId = this.engine.sceneGraph.getParentId(childId);
                    if (parentId && boneIds.includes(parentId)) {
                        const pWm = this.engine.sceneGraph.getWorldMatrix(parentId);
                        const cWm = this.engine.sceneGraph.getWorldMatrix(childId);
                        if (pWm && cWm) {
                            const pPos = { x: pWm[12], y: pWm[13], z: pWm[14] };
                            const cPos = { x: cWm[12], y: cWm[13], z: cWm[14] };
                            const dist = RayUtils.distRaySegment(ray, pPos, cPos);
                            if (dist < 0.25) {
                                const midX = (pPos.x + cPos.x) * 0.5 - ray.origin.x;
                                const midY = (pPos.y + cPos.y) * 0.5 - ray.origin.y;
                                const midZ = (pPos.z + cPos.z) * 0.5 - ray.origin.z;
                                const rayT = midX * ray.direction.x + midY * ray.direction.y + midZ * ray.direction.z;
                                if (rayT > 0 && rayT < closestDist) {
                                    closestDist = rayT;
                                    closestId = parentId; // Selecting bone from Joint 1 to 2 selects Joint 1!
                                }
                            }
                        }
                    }
                }
            });
        }

        return closestId;
    }

    selectEntitiesInRect(
        x: number,
        y: number,
        w: number,
        h: number,
        viewportWidth: number = this.engine.currentWidth,
        viewportHeight: number = this.engine.currentHeight,
    ): string[] {
        if (!this.engine.currentViewProj) return [];
        const ids: string[] = [];

        const width = Math.max(1, viewportWidth);
        const height = Math.max(1, viewportHeight);
        const rawLeft = Math.min(x, x + w);
        const rawRight = Math.max(x, x + w);
        const rawTop = Math.min(y, y + h);
        const rawBottom = Math.max(y, y + h);
        const selLeft = Math.max(0, Math.min(width, rawLeft));
        const selRight = Math.max(0, Math.min(width, rawRight));
        const selTop = Math.max(0, Math.min(height, rawTop));
        const selBottom = Math.max(0, Math.min(height, rawBottom));

        if (selRight < selLeft || selBottom < selTop) return [];

        const selectionRect: ScreenRect = {
            left: selLeft,
            right: selRight,
            top: selTop,
            bottom: selBottom,
        };

        for (let i = 0; i < this.engine.ecs.count; i++) {
            if (!this.engine.ecs.store.isActive[i]) continue;
            
            const id = this.engine.ecs.store.ids[i];
            if (this.suppressedEntityIds.has(id)) continue;
            const mask = this.engine.ecs.store.componentMask[i];
            const hasMesh = !!(mask & COMPONENT_MASKS.MESH);
            
            const wmOffset = i * 16;
            const worldMatrix = this.engine.ecs.store.worldMatrix.subarray(wmOffset, wmOffset + 16);

            let screenMinX = Infinity, screenMinY = Infinity;
            let screenMaxX = -Infinity, screenMaxY = -Infinity;
            let pointsToCheck: {x:number, y:number, z:number}[] = [];
            let meshAsset: StaticMeshAsset | null = null;

            if (hasMesh) {
                const meshIntId = this.engine.ecs.store.meshType[i];
                const uuid = assetManager.meshIntToUuid.get(meshIntId);
                meshAsset = uuid ? assetManager.getAsset(uuid) as StaticMeshAsset : null;
                
                if (meshAsset && meshAsset.geometry.aabb) {
                    const { min, max } = meshAsset.geometry.aabb;
                    const localCorners = [
                        {x: min.x, y: min.y, z: min.z}, {x: max.x, y: min.y, z: min.z},
                        {x: min.x, y: max.y, z: min.z}, {x: max.x, y: max.y, z: min.z},
                        {x: min.x, y: min.y, z: max.z}, {x: max.x, y: min.y, z: max.z},
                        {x: min.x, y: max.y, z: max.z}, {x: max.x, y: max.y, z: max.z}
                    ];
                    pointsToCheck = localCorners.map(p => Vec3Utils.transformMat4(p, worldMatrix, {x:0,y:0,z:0}));
                }
            }

            if (pointsToCheck.length === 0) {
                pointsToCheck.push({ x: worldMatrix[12], y: worldMatrix[13], z: worldMatrix[14] });
            }

            let visiblePoints = 0;
            const m = this.engine.currentViewProj;

            for (const p of pointsToCheck) {
                const wVal = m[3]*p.x + m[7]*p.y + m[11]*p.z + m[15];
                if (wVal <= 0.001) continue; 

                const clip = Vec3Utils.transformMat4(p, m, {x:0, y:0, z:0});
                const sx = (clip.x * 0.5 + 0.5) * width;
                const sy = (1.0 - (clip.y * 0.5 + 0.5)) * height;

                screenMinX = Math.min(screenMinX, sx); screenMinY = Math.min(screenMinY, sy);
                screenMaxX = Math.max(screenMaxX, sx); screenMaxY = Math.max(screenMaxY, sy);
                visiblePoints++;
            }

            if (visiblePoints === 0) continue;

            const overlaps = !(screenMaxX < selLeft || screenMinX > selRight || screenMaxY < selTop || screenMinY > selBottom);
            if (!overlaps) continue;

            if (hasMesh && meshAsset) {
                // The projected AABB is only a broad phase. Its 3D corners do not lie on
                // curved/concave mesh silhouettes, so perspective projection can make the
                // screen bounds noticeably larger than the visible object (for example a
                // sphere can be selected while the marquee still has a visible air gap).
                // Refine candidates against projected mesh triangles before accepting them.
                const preciseOverlap = meshOverlapsScreenRect(
                    meshAsset,
                    worldMatrix,
                    m,
                    width,
                    height,
                    selectionRect,
                );
                if (preciseOverlap === false) continue;
            }

            ids.push(id);
        }
        return ids;
    }

    /**
     * Select mesh components whose projected geometry overlaps a screen-space marquee.
     *
     * This is deliberately topology-aware: edges come only from authored polygon
     * boundaries and faces use their logical polygon triangulation. The query is
     * select-through (occluded/back-side projected components can be included), which
     * matches the conventional modeling-editor marquee behavior and keeps visibility
     * filtering as a separate future policy.
     */
    selectMeshComponentsInRect(
        entityId: string,
        mode: MeshComponentMode,
        x: number,
        y: number,
        w: number,
        h: number,
        viewportWidth: number = this.engine.currentWidth,
        viewportHeight: number = this.engine.currentHeight,
        operation: MeshComponentSelectionOperation = 'REPLACE',
    ): number {
        if (mode === 'OBJECT' || !this.engine.currentViewProj) return 0;

        const idx = this.engine.ecs.idToIndex.get(entityId);
        if (idx === undefined) return 0;
        const meshIntId = this.engine.ecs.store.meshType[idx];
        const assetUuid = assetManager.meshIntToUuid.get(meshIntId);
        const asset = assetUuid ? assetManager.getAsset(assetUuid) as StaticMeshAsset : null;
        if (!asset?.topology) return 0;

        const worldMat = this.engine.sceneGraph.getWorldMatrix(entityId);
        if (!worldMat) return 0;

        const width = Math.max(1, viewportWidth);
        const height = Math.max(1, viewportHeight);
        const rawLeft = Math.min(x, x + w);
        const rawRight = Math.max(x, x + w);
        const rawTop = Math.min(y, y + h);
        const rawBottom = Math.max(y, y + h);
        const rect: ScreenRect = {
            left: Math.max(0, Math.min(width, rawLeft)),
            right: Math.max(0, Math.min(width, rawRight)),
            top: Math.max(0, Math.min(height, rawTop)),
            bottom: Math.max(0, Math.min(height, rawBottom)),
        };
        if (rect.right < rect.left || rect.bottom < rect.top) return 0;

        const vertices = asset.geometry.vertices;
        const vertexCount = Math.floor(vertices.length / 3);
        const projected = new Array<ScreenPoint | null | undefined>(vertexCount);
        const viewProj = this.engine.currentViewProj;

        const projectVertex = (vertexId: number): ScreenPoint | null => {
            if (!Number.isInteger(vertexId) || vertexId < 0 || vertexId >= vertexCount) return null;
            const cached = projected[vertexId];
            if (cached !== undefined) return cached;

            const offset = vertexId * 3;
            const local = { x: vertices[offset], y: vertices[offset + 1], z: vertices[offset + 2] };
            const world = Vec3Utils.transformMat4(local, worldMat, { x: 0, y: 0, z: 0 });
            const clipW = viewProj[3] * world.x + viewProj[7] * world.y + viewProj[11] * world.z + viewProj[15];
            if (clipW <= 0.001) {
                projected[vertexId] = null;
                return null;
            }

            const ndc = Vec3Utils.transformMat4(world, viewProj, { x: 0, y: 0, z: 0 });
            const point = {
                x: (ndc.x * 0.5 + 0.5) * width,
                y: (1.0 - (ndc.y * 0.5 + 0.5)) * height,
            };
            projected[vertexId] = point;
            return point;
        };

        const vertexHits = new Set<number>();
        const edgeHits = new Set<string>();
        const faceHits = new Set<number>();

        if (mode === 'VERTEX') {
            for (let vertexId = 0; vertexId < vertexCount; vertexId++) {
                const point = projectVertex(vertexId);
                if (point && pointInScreenRect(point, rect)) vertexHits.add(vertexId);
            }
        } else if (mode === 'EDGE') {
            const visited = new Set<string>();
            for (const face of asset.topology.faces) {
                if (!face || face.length < 2) continue;
                for (let i = 0; i < face.length; i++) {
                    const aId = face[i];
                    const bId = face[(i + 1) % face.length];
                    const key = meshEdgeKey(aId, bId);
                    if (visited.has(key)) continue;
                    visited.add(key);
                    const a = projectVertex(aId);
                    const b = projectVertex(bId);
                    if (a && b && segmentOverlapsScreenRect(a, b, rect)) edgeHits.add(key);
                }
            }
        } else if (mode === 'FACE') {
            asset.topology.faces.forEach((face, faceId) => {
                if (!face || face.length < 3) return;
                const first = projectVertex(face[0]);
                if (!first) return;
                for (let i = 1; i < face.length - 1; i++) {
                    const b = projectVertex(face[i]);
                    const c = projectVertex(face[i + 1]);
                    if (b && c && triangleOverlapsScreenRect(first, b, c, rect)) {
                        faceHits.add(faceId);
                        return;
                    }
                }
            });
        }

        const target = (mode === 'VERTEX'
            ? this.subSelection.vertexIds
            : mode === 'EDGE'
                ? this.subSelection.edgeIds
                : this.subSelection.faceIds) as Set<number | string>;
        const hits = (mode === 'VERTEX' ? vertexHits : mode === 'EDGE' ? edgeHits : faceHits) as Set<number | string>;
        const next = applyMeshComponentSelectionOperation(target, hits, operation);

        const changed = next.size !== target.size || Array.from(next).some(value => !target.has(value));
        if (!changed) return hits.size;

        this.engine.clearDeformation();
        if (mode === 'VERTEX') this.subSelection.vertexIds = next as Set<number>;
        else if (mode === 'EDGE') this.subSelection.edgeIds = next as Set<string>;
        else this.subSelection.faceIds = next as Set<number>;
        this.hoveredMeshComponent = null;
        this.engine.recalculateSoftSelection();
        this.engine.notifyUI();
        return hits.size;
    }

    pickMeshComponent(entityId: string, mx: number, my: number, width: number, height: number): MeshPickingResult | null {
        if (!this.engine.currentViewProj) return null;
        
        const idx = this.engine.ecs.idToIndex.get(entityId);
        if (idx === undefined) return null;
        
        const meshIntId = this.engine.ecs.store.meshType[idx];
        const assetUuid = assetManager.meshIntToUuid.get(meshIntId);
        if (!assetUuid) return null;
        
        const asset = assetManager.getAsset(assetUuid) as StaticMeshAsset;
        if (!asset || (asset.type !== 'MESH' && asset.type !== 'SKELETAL_MESH') || !asset.topology) return null;

        const worldMat = this.engine.sceneGraph.getWorldMatrix(entityId);
        if (!worldMat) return null;

        const invWorld = Mat4Utils.create();
        if (!Mat4Utils.invert(worldMat, invWorld)) return null;

        const invVP = new Float32Array(16);
        if (!Mat4Utils.invert(this.engine.currentViewProj, invVP)) return null;

        const rayWorld = RayUtils.create();
        RayUtils.fromScreen(mx, my, width, height, invVP, rayWorld);

        const rayLocal = RayUtils.create();
        Vec3Utils.transformMat4(rayWorld.origin, invWorld, rayLocal.origin);
        Vec3Utils.transformMat4Normal(rayWorld.direction, invWorld, rayLocal.direction);
        Vec3Utils.normalize(rayLocal.direction, rayLocal.direction);

        const result = MeshTopologyUtils.raycastMesh(asset.topology, asset.geometry.vertices, rayLocal);
        
        if (result) {
            Vec3Utils.transformMat4(result.worldPos, worldMat, result.worldPos);
            return result;
        }
        return null;
    }

    /**
     * Resolve hover for the active mesh component mode. The public command is
     * mode-agnostic so Scene View, asset editors, tests and future agent APIs
     * do not need separate vertex/edge/face interaction code.
     */
    hoverMeshComponentAt(mx: number, my: number, w: number, h: number): HoveredMeshComponent | null {
        const mode = this.engine.meshComponentMode as MeshComponentMode;
        if (mode === 'OBJECT' || this.selectedIndices.size === 0 || !this.engine.currentViewProj) {
            this.hoveredMeshComponent = null;
            return null;
        }

        const idx = Array.from(this.selectedIndices)[0];
        const entityId = this.engine.ecs.store.ids[idx];
        const meshIntId = this.engine.ecs.store.meshType[idx];
        const assetUuid = assetManager.meshIntToUuid.get(meshIntId);
        const asset = assetUuid ? assetManager.getAsset(assetUuid) as StaticMeshAsset : null;
        if (!asset || !asset.topology) {
            this.hoveredMeshComponent = null;
            return null;
        }

        const pick = this.pickMeshComponent(entityId, mx, my, w, h);
        if (!pick) {
            this.hoveredMeshComponent = null;
            return null;
        }

        if (mode === 'FACE') {
            this.hoveredMeshComponent = { entityId, mode: 'FACE', faceId: pick.faceId };
            return this.hoveredMeshComponent;
        }

        const worldMat = this.engine.sceneGraph.getWorldMatrix(entityId);
        if (!worldMat) {
            this.hoveredMeshComponent = null;
            return null;
        }

        const projectVertex = (vertexId: number): ScreenPoint | null => {
            const offset = vertexId * 3;
            if (offset < 0 || offset + 2 >= asset.geometry.vertices.length) return null;
            const local = {
                x: asset.geometry.vertices[offset],
                y: asset.geometry.vertices[offset + 1],
                z: asset.geometry.vertices[offset + 2],
            };
            const world = Vec3Utils.transformMat4(local, worldMat, { x: 0, y: 0, z: 0 });
            const viewProj = this.engine.currentViewProj!;
            const clipW = viewProj[3] * world.x + viewProj[7] * world.y + viewProj[11] * world.z + viewProj[15];
            if (clipW <= 0.001) return null;
            const projected = Vec3Utils.transformMat4(world, viewProj, { x: 0, y: 0, z: 0 });
            return {
                x: (projected.x * 0.5 + 0.5) * w,
                y: (1.0 - (projected.y * 0.5 + 0.5)) * h,
            };
        };

        if (mode === 'VERTEX') {
            const point = projectVertex(pick.vertexId);
            if (point && Math.hypot(point.x - mx, point.y - my) <= 12) {
                this.hoveredMeshComponent = { entityId, mode: 'VERTEX', vertexId: pick.vertexId };
                return this.hoveredMeshComponent;
            }
        } else if (mode === 'EDGE') {
            const a = projectVertex(pick.edgeId[0]);
            const b = projectVertex(pick.edgeId[1]);
            // Screen-space tolerance keeps edge hover stable across camera distance,
            // object scale and perspective projection.
            if (a && b && pointToSegmentDistance2D({ x: mx, y: my }, a, b) <= 9) {
                const edgeId: [number, number] = [pick.edgeId[0], pick.edgeId[1]];
                this.hoveredMeshComponent = {
                    entityId,
                    mode: 'EDGE',
                    edgeId,
                    edgeKey: meshEdgeKey(edgeId[0], edgeId[1]),
                };
                return this.hoveredMeshComponent;
            }
        }

        this.hoveredMeshComponent = null;
        return null;
    }

    /** @deprecated Use hoverMeshComponentAt(); retained for compatibility. */
    highlightVertexAt(mx: number, my: number, w: number, h: number) {
        if (this.engine.meshComponentMode !== 'VERTEX') {
            this.hoveredMeshComponent = null;
            return;
        }
        this.hoverMeshComponentAt(mx, my, w, h);
    }

    selectVerticesInBrush(mx: number, my: number, width: number, height: number, add: boolean = true) {
        if (this.selectedIndices.size === 0 || !this.engine.currentViewProj) return;

        const idx = Array.from(this.selectedIndices)[0];
        const entityId = this.engine.ecs.store.ids[idx];
        const meshIntId = this.engine.ecs.store.meshType[idx];
        const asset = assetManager.getAsset(assetManager.meshIntToUuid.get(meshIntId)!) as StaticMeshAsset;

        if (!asset || !asset.topology) return;

        const worldMat = this.engine.sceneGraph.getWorldMatrix(entityId);
        if (!worldMat) return;

        const pick = this.pickMeshComponent(entityId, mx, my, width, height);
        if (!pick) return;

        const invWorld = Mat4Utils.create();
        if (!Mat4Utils.invert(worldMat, invWorld)) return;
        const localCenter = Vec3Utils.transformMat4(pick.worldPos, invWorld, {x:0, y:0, z:0});

        const scale = Math.max(
            Math.abs(this.engine.ecs.store.scaleX[idx]),
            Math.abs(this.engine.ecs.store.scaleY[idx]),
            Math.abs(this.engine.ecs.store.scaleZ[idx]),
            1e-6,
        );
        const localRadius = (this.engine.softSelectionRadius * 0.5) / scale;

        // MeshTopologyUtils operates on local-space vertices/BVH, so both the center
        // and radius supplied here must be local-space values.
        const vertices = MeshTopologyUtils.getVerticesInWorldSphere(
            asset.topology,
            asset.geometry.vertices,
            localCenter,
            localRadius
        );

        if (add) {
            vertices.forEach(v => this.subSelection.vertexIds.add(v));
        } else {
            vertices.forEach(v => this.subSelection.vertexIds.delete(v));
        }
        
        this.engine.recalculateSoftSelection();
        this.engine.notifyUI();
    }

    private getSelectedMeshAsset(): StaticMeshAsset | null {
        if (this.selectedIndices.size === 0) return null;
        const idx = Array.from(this.selectedIndices)[0];
        const meshIntId = this.engine.ecs.store.meshType[idx];
        const assetUuid = assetManager.meshIntToUuid.get(meshIntId);
        if (!assetUuid) return null;
        const asset = assetManager.getAsset(assetUuid) as StaticMeshAsset;
        return asset?.topology ? asset : null;
    }

    private addVertexWithSiblings(target: Set<number>, topology: StaticMeshAsset['topology'], vertexId: number) {
        target.add(vertexId);
        topology?.siblings?.get(vertexId)?.forEach(sibling => target.add(sibling));
    }

    expandSelection(mode: MeshComponentMode) {
        const asset = this.getSelectedMeshAsset();
        if (!asset?.topology || mode === 'OBJECT') return;
        const topology = asset.topology;
        const vertexCount = Math.floor(asset.geometry.vertices.length / 3);
        this.engine.clearDeformation();

        if (mode === 'VERTEX') {
            const next = new Set(this.subSelection.vertexIds);
            this.subSelection.vertexIds.forEach(vertexId => {
                getVertexNeighbors(topology, vertexId, vertexCount).forEach(neighbor => {
                    this.addVertexWithSiblings(next, topology, neighbor);
                });
            });
            this.subSelection.vertexIds = next;
        } else if (mode === 'FACE') {
            const next = new Set(this.subSelection.faceIds);
            this.subSelection.faceIds.forEach(faceId => {
                const face = topology.faces[faceId];
                if (!face) return;
                for (let i = 0; i < face.length; i++) {
                    const a = face[i];
                    const b = face[(i + 1) % face.length];
                    getEdgeFaces(topology, a, b, vertexCount).forEach(neighborFace => next.add(neighborFace));
                }
            });
            this.subSelection.faceIds = next;
        } else if (mode === 'EDGE') {
            const next = new Set(this.subSelection.edgeIds);
            this.subSelection.edgeIds.forEach(key => {
                const [a, b] = key.split('-').map(Number);
                getEdgeFaces(topology, a, b, vertexCount).forEach(faceId => {
                    const face = topology.faces[faceId];
                    if (!face) return;
                    for (let i = 0; i < face.length; i++) {
                        next.add(meshEdgeKey(face[i], face[(i + 1) % face.length]));
                    }
                });
            });
            this.subSelection.edgeIds = next;
        }

        this.engine.recalculateSoftSelection();
        this.engine.notifyUI();
    }

    shrinkSelection(mode: MeshComponentMode) {
        const asset = this.getSelectedMeshAsset();
        if (!asset?.topology || mode === 'OBJECT') return;
        const topology = asset.topology;
        const vertexCount = Math.floor(asset.geometry.vertices.length / 3);
        this.engine.clearDeformation();

        if (mode === 'VERTEX') {
            const selected = this.subSelection.vertexIds;
            const next = new Set<number>();
            selected.forEach(vertexId => {
                const neighbors = getVertexNeighbors(topology, vertexId, vertexCount);
                if (neighbors.length > 0 && neighbors.every(neighbor => selected.has(neighbor) || topology.siblings?.get(neighbor)?.some(s => selected.has(s)))) {
                    this.addVertexWithSiblings(next, topology, vertexId);
                }
            });
            this.subSelection.vertexIds = next;
        } else if (mode === 'FACE') {
            const selected = this.subSelection.faceIds;
            const next = new Set<number>();
            selected.forEach(faceId => {
                const face = topology.faces[faceId];
                if (!face) return;
                let interior = true;
                for (let i = 0; i < face.length && interior; i++) {
                    const adjacent = getEdgeFaces(topology, face[i], face[(i + 1) % face.length], vertexCount);
                    if (adjacent.length < 2 || adjacent.some(neighborFace => !selected.has(neighborFace))) interior = false;
                }
                if (interior) next.add(faceId);
            });
            this.subSelection.faceIds = next;
        } else if (mode === 'EDGE') {
            const selected = this.subSelection.edgeIds;
            const next = new Set<string>();
            selected.forEach(key => {
                const [a, b] = key.split('-').map(Number);
                const incidentFaces = getEdgeFaces(topology, a, b, vertexCount);
                const belongsToFilledRegion = incidentFaces.some(faceId => {
                    const face = topology.faces[faceId];
                    if (!face) return false;
                    for (let i = 0; i < face.length; i++) {
                        if (!selected.has(meshEdgeKey(face[i], face[(i + 1) % face.length]))) return false;
                    }
                    return true;
                });
                if (belongsToFilledRegion) next.add(key);
            });
            this.subSelection.edgeIds = next;
        }

        this.engine.recalculateSoftSelection();
        this.engine.notifyUI();
    }

    selectRing(mode: MeshComponentMode) {
        if (mode !== 'EDGE') {
            consoleService.warn('Ring selection currently supports Edge mode only.', 'SelectionSystem');
            return;
        }
        const asset = this.getSelectedMeshAsset();
        if (!asset?.topology) return;
        const edges = Array.from(this.subSelection.edgeIds);
        if (edges.length === 0) {
            consoleService.warn('Select an edge first.', 'SelectionSystem');
            return;
        }

        const [a, b] = edges[edges.length - 1].split('-').map(Number);
        const ring = MeshTopologyUtils.getEdgeRing(asset.topology, a, b);
        if (ring.length === 0) {
            consoleService.warn('No edge ring found.', 'SelectionSystem');
            return;
        }
        this.engine.clearDeformation();
        ring.forEach(([v1, v2]) => this.subSelection.edgeIds.add(meshEdgeKey(v1, v2)));
        this.engine.recalculateSoftSelection();
        this.engine.notifyUI();
        consoleService.success(`Selected Edge Ring (${ring.length} edges)`, 'SelectionSystem');
    }

    selectLoop(mode: MeshComponentMode) {
        if (this.selectedIndices.size === 0) return;
        const idx = Array.from(this.selectedIndices)[0];
        const meshIntId = this.engine.ecs.store.meshType[idx];
        const assetUuid = assetManager.meshIntToUuid.get(meshIntId);
        const asset = assetManager.getAsset(assetUuid!) as StaticMeshAsset;
        if (!asset || !asset.topology) return;

        const topo = asset.topology;

        if (mode === 'EDGE') {
            const edges = Array.from(this.subSelection.edgeIds);
            if (edges.length === 0) return;
            const lastEdge = edges[edges.length - 1];
            const [v1, v2] = lastEdge.split('-').map(Number);
            
            const loop = MeshTopologyUtils.getEdgeLoop(topo, v1, v2);
            
            if (loop.length === 0) {
                consoleService.warn("No loop found. Mesh topology might be disconnected at UVs/Normals.", "SelectionSystem");
            } else {
                consoleService.success(`Selected Edge Loop (${loop.length} edges)`, "SelectionSystem");
            }

            if (loop.length > 0) this.engine.clearDeformation();
            loop.forEach(e => {
                const key = meshEdgeKey(e[0], e[1]);
                this.subSelection.edgeIds.add(key);
            });
        } 
        else if (mode === 'VERTEX') {
            const verts = Array.from(this.subSelection.vertexIds);
            if (verts.length < 2) {
                consoleService.warn('Select at least 2 vertices to define loop direction', "SelectionSystem");
                return;
            }
            // Sort by insertion order is not guaranteed in Set but usually stable. 
            // Better to assume user clicked last two.
            const v1 = verts[verts.length - 2];
            const v2 = verts[verts.length - 1];
            const vertexCount = Math.floor(asset.geometry.vertices.length / 3);
            if (areVerticesAdjacent(topo, v1, v2, vertexCount)) {
                this.engine.clearDeformation();
                const loop = MeshTopologyUtils.getVertexLoop(topo, v1, v2);
                loop.forEach(v => this.subSelection.vertexIds.add(v));
                consoleService.success(`Selected Vertex Loop`, "SelectionSystem");
            } else {
                consoleService.warn('Selected vertices are not connected', "SelectionSystem");
            }
        } 
        else if (mode === 'FACE') {
            const faces = Array.from(this.subSelection.faceIds);
            if (faces.length < 2) {
                consoleService.warn('Select at least 2 adjacent faces to define loop direction', "SelectionSystem");
                return;
            }
            const f1 = faces[faces.length - 2];
            const f2 = faces[faces.length - 1];
            
            const vertexCount = Math.floor(asset.geometry.vertices.length / 3);
            const sharedEdge = getSharedFaceEdge(topo, f1, f2, vertexCount);
            
            if (sharedEdge) {
                this.engine.clearDeformation();
                const loop = MeshTopologyUtils.getFaceLoop(topo, sharedEdge[0], sharedEdge[1]);
                loop.forEach(f => this.subSelection.faceIds.add(f));
                consoleService.success(`Selected Face Loop`, "SelectionSystem");
            } else {
                consoleService.warn('Faces are not adjacent', "SelectionSystem");
            }
        }
        
        this.engine.recalculateSoftSelection();
        this.engine.notifyUI();
    }

    getSelectionAsVertices(): Set<number> {
        if (this.selectedIndices.size === 0) return new Set();
        const idx = Array.from(this.selectedIndices)[0];
        const meshIntId = this.engine.ecs.store.meshType[idx];
        const assetUuid = assetManager.meshIntToUuid.get(meshIntId);
        if (!assetUuid) return new Set();
        const asset = assetManager.getAsset(assetUuid) as StaticMeshAsset;
        if (!asset) return new Set();

        const result = new Set<number>();

        if (this.engine.meshComponentMode === 'VERTEX') {
            return this.subSelection.vertexIds;
        }
        if (this.engine.meshComponentMode === 'EDGE') {
            this.subSelection.edgeIds.forEach(key => {
                const [vA, vB] = key.split('-').map(Number);
                result.add(vA); result.add(vB);
            });
        }
        if (this.engine.meshComponentMode === 'FACE') {
            const topo = asset.topology;
            if (topo?.faces?.length) {
                this.subSelection.faceIds.forEach(fIdx => {
                    topo.faces[fIdx]?.forEach(v => result.add(v));
                });
            } else {
                const indices = asset.geometry.indices;
                this.subSelection.faceIds.forEach(fIdx => {
                    const offset = fIdx * 3;
                    if (offset + 2 >= indices.length) return;
                    result.add(indices[offset]);
                    result.add(indices[offset + 1]);
                    result.add(indices[offset + 2]);
                });
            }
        }
        return result;
    }
}
