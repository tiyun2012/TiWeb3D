import type { LogicalMesh } from '@/types';
import { meshEdgeKey } from '@/engine/MeshEdgeGeometry';

export interface MeshConnectivityIndex {
    vertexCount: number;
    canonicalVertex: Int32Array;
    membersByCanonical: Map<number, number[]>;
    neighborsByCanonical: Map<number, number[]>;
    facesByCanonical: Map<number, number[]>;
    faceCanonicalVertices: number[][];
    edgeFacesByCanonicalEdge: Map<string, number[]>;
}

export interface SurfaceDistanceResult {
    distances: Float32Array;
    visitedVertexCount: number;
}

export type MeshConnectivityConstraint = 'SAME_ISLAND' | 'FLOOD_WITHIN_RADIUS';

export interface ConnectedVertexMaskOptions {
    mode: MeshConnectivityConstraint;
    radius?: number;
    center?: { x: number; y: number; z: number };
}

export interface ShortestVertexPathResult {
    /** Canonical/welded logical vertex ids, including both endpoints. */
    vertices: number[];
    distance: number;
}


export interface MeshConnectivityView {
    readonly vertexCount: number;
    canonicalVertex(vertexId: number): number;
    neighbors(vertexId: number): readonly number[];
    areAdjacent(a: number, b: number): boolean;
    edgeFaces(a: number, b: number): readonly number[];
    sharedFaceEdge(faceA: number, faceB: number): [number, number] | null;
    surfaceDistances(sources: ReadonlySet<number>, maxDistance?: number): SurfaceDistanceResult;
    faceAwareSurfaceDistances(sources: ReadonlySet<number>, maxDistance?: number): SurfaceDistanceResult;
    connectedMask(sources: ReadonlySet<number>, options: ConnectedVertexMaskOptions): Uint8Array;
    shortestVertexPath(start: number, end: number): ShortestVertexPathResult | null;
}
/**
 * Runtime-only connectivity cache for a LogicalMesh.
 *
 * Connectivity depends on authored topology (faces + persistent sibling groups),
 * not on arbitrary positional proximity. Drag samples therefore do not invalidate
 * this cache. At a Static Mesh edit transaction boundary, an existing sibling weld
 * may be split if its members were edited apart; that reconciliation invalidates
 * this cache. Explicit topology-changing tools (extrude/weld/delete/etc.) MUST also
 * call invalidateMeshConnectivity(mesh) after rebuilding faces/siblings.
 */
const connectivityCache = new WeakMap<LogicalMesh, MeshConnectivityIndex>();

const canonicalEdgeKey = (a: number, b: number) => meshEdgeKey(a, b);

const edgeLength = (vertices: Float32Array, a: number, b: number) => {
    const ao = a * 3;
    const bo = b * 3;
    const dx = (vertices[ao] ?? 0) - (vertices[bo] ?? 0);
    const dy = (vertices[ao + 1] ?? 0) - (vertices[bo + 1] ?? 0);
    const dz = (vertices[ao + 2] ?? 0) - (vertices[bo + 2] ?? 0);
    return Math.hypot(dx, dy, dz);
};

class MinHeap {
    private heap: Array<{ id: number; dist: number }> = [];

    get length() { return this.heap.length; }

    push(node: { id: number; dist: number }) {
        this.heap.push(node);
        let index = this.heap.length - 1;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.heap[parent].dist <= this.heap[index].dist) break;
            [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
            index = parent;
        }
    }

    pop(): { id: number; dist: number } | undefined {
        if (this.heap.length === 0) return undefined;
        const root = this.heap[0];
        const tail = this.heap.pop();
        if (this.heap.length > 0 && tail) {
            this.heap[0] = tail;
            let index = 0;
            while (true) {
                const left = index * 2 + 1;
                const right = left + 1;
                let smallest = index;
                if (left < this.heap.length && this.heap[left].dist < this.heap[smallest].dist) smallest = left;
                if (right < this.heap.length && this.heap[right].dist < this.heap[smallest].dist) smallest = right;
                if (smallest === index) break;
                [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
                index = smallest;
            }
        }
        return root;
    }
}

function buildConnectivity(mesh: LogicalMesh, vertexCount: number): MeshConnectivityIndex {
    const canonicalVertex = new Int32Array(vertexCount);
    const membersByCanonical = new Map<number, number[]>();
    const neighborsByCanonicalSets = new Map<number, Set<number>>();
    const facesByCanonicalSets = new Map<number, Set<number>>();
    const faceCanonicalVertices: number[][] = [];
    const edgeFacesByCanonicalEdge = new Map<string, number[]>();

    for (let vertexId = 0; vertexId < vertexCount; vertexId += 1) {
        canonicalVertex[vertexId] = vertexId;
    }

    // Persistent sibling groups are authored/import-time weld information. Using
    // them avoids changing topology merely because a deformation moved vertices.
    mesh.siblings?.forEach((group, vertexId) => {
        if (vertexId < 0 || vertexId >= vertexCount) return;
        let canonical = vertexId;
        for (const member of group) {
            if (member >= 0 && member < vertexCount) canonical = Math.min(canonical, member);
        }
        canonicalVertex[vertexId] = canonical;
        for (const member of group) {
            if (member >= 0 && member < vertexCount) canonicalVertex[member] = canonical;
        }
    });

    for (let vertexId = 0; vertexId < vertexCount; vertexId += 1) {
        const canonical = canonicalVertex[vertexId];
        let members = membersByCanonical.get(canonical);
        if (!members) {
            members = [];
            membersByCanonical.set(canonical, members);
        }
        members.push(vertexId);
        if (!neighborsByCanonicalSets.has(canonical)) {
            neighborsByCanonicalSets.set(canonical, new Set());
        }
        if (!facesByCanonicalSets.has(canonical)) {
            facesByCanonicalSets.set(canonical, new Set());
        }
    }

    mesh.faces.forEach((face, faceId) => {
        if (!face || face.length < 2) {
            faceCanonicalVertices[faceId] = [];
            return;
        }

        const canonicalFace: number[] = [];
        const seenCanonical = new Set<number>();
        for (const rawVertex of face) {
            if (rawVertex < 0 || rawVertex >= vertexCount) continue;
            const canonical = canonicalVertex[rawVertex];
            facesByCanonicalSets.get(canonical)?.add(faceId);
            if (!seenCanonical.has(canonical)) {
                seenCanonical.add(canonical);
                canonicalFace.push(canonical);
            }
        }
        faceCanonicalVertices[faceId] = canonicalFace;

        for (let i = 0; i < face.length; i += 1) {
            const rawA = face[i];
            const rawB = face[(i + 1) % face.length];
            if (rawA < 0 || rawA >= vertexCount || rawB < 0 || rawB >= vertexCount) continue;
            const a = canonicalVertex[rawA];
            const b = canonicalVertex[rawB];
            if (a === b) continue;

            neighborsByCanonicalSets.get(a)?.add(b);
            neighborsByCanonicalSets.get(b)?.add(a);

            const key = canonicalEdgeKey(a, b);
            let faces = edgeFacesByCanonicalEdge.get(key);
            if (!faces) {
                faces = [];
                edgeFacesByCanonicalEdge.set(key, faces);
            }
            if (!faces.includes(faceId)) faces.push(faceId);
        }
    });

    const neighborsByCanonical = new Map<number, number[]>();
    neighborsByCanonicalSets.forEach((neighbors, canonical) => {
        neighborsByCanonical.set(canonical, Array.from(neighbors));
    });
    const facesByCanonical = new Map<number, number[]>();
    facesByCanonicalSets.forEach((faces, canonical) => {
        facesByCanonical.set(canonical, Array.from(faces));
    });

    return {
        vertexCount,
        canonicalVertex,
        membersByCanonical,
        neighborsByCanonical,
        facesByCanonical,
        faceCanonicalVertices,
        edgeFacesByCanonicalEdge,
    };
}

export function getMeshConnectivity(mesh: LogicalMesh, vertexCount: number): MeshConnectivityIndex {
    const cached = connectivityCache.get(mesh);
    if (cached && cached.vertexCount === vertexCount) return cached;
    const next = buildConnectivity(mesh, vertexCount);
    connectivityCache.set(mesh, next);
    return next;
}

export function invalidateMeshConnectivity(mesh: LogicalMesh) {
    connectivityCache.delete(mesh);
}

export interface MeshSiblingReconcileResult {
    changed: boolean;
    previousGroupCount: number;
    nextGroupCount: number;
}

export const MESH_SIBLING_POSITION_QUANTIZATION = 10000;

/**
 * Revalidates only the weld/sibling relationships that already exist. This is
 * intended for the transaction boundary after direct component deformation.
 *
 * A sibling group may split when some of its render vertices no longer occupy
 * the same quantized position. The function never creates a weld between
 * vertices that were not siblings before the edit, so merely moving unrelated
 * shells into contact cannot merge their topology.
 */
export function reconcileMeshSiblingGroupsAfterGeometryEdit(
    mesh: LogicalMesh,
    vertices: Float32Array,
    quantization = MESH_SIBLING_POSITION_QUANTIZATION,
): MeshSiblingReconcileResult {
    const vertexCount = Math.floor(vertices.length / 3);
    const previous = mesh.siblings;
    if (!previous || previous.size === 0 || vertexCount === 0) {
        return { changed: false, previousGroupCount: 0, nextGroupCount: 0 };
    }

    // Existing sibling maps store the whole group on each member. Build a small
    // union-find anyway so malformed/asymmetric imported maps are normalized
    // safely before position-based splitting.
    const parent = new Int32Array(vertexCount);
    for (let i = 0; i < vertexCount; i += 1) parent[i] = i;
    const find = (value: number): number => {
        let root = value;
        while (parent[root] !== root) root = parent[root];
        let current = value;
        while (parent[current] !== current) {
            const next = parent[current];
            parent[current] = root;
            current = next;
        }
        return root;
    };
    const unite = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra === rb) return;
        const root = Math.min(ra, rb);
        const child = root === ra ? rb : ra;
        parent[child] = root;
    };

    previous.forEach((group, vertexId) => {
        if (vertexId < 0 || vertexId >= vertexCount) return;
        for (const member of group) {
            if (member < 0 || member >= vertexCount) continue;
            unite(vertexId, member);
        }
    });

    const authoredRoots = new Set<number>();
    previous.forEach((_, vertexId) => {
        if (vertexId >= 0 && vertexId < vertexCount) authoredRoots.add(find(vertexId));
    });

    const oldGroups = new Map<number, number[]>();
    for (let vertexId = 0; vertexId < vertexCount; vertexId += 1) {
        const root = find(vertexId);
        if (!authoredRoots.has(root)) continue;
        let group = oldGroups.get(root);
        if (!group) {
            group = [];
            oldGroups.set(root, group);
        }
        group.push(vertexId);
    }

    const next = new Map<number, number[]>();
    let nextGroupCount = 0;
    const positionKey = (vertexId: number) => {
        const offset = vertexId * 3;
        const x = Math.round((vertices[offset] ?? 0) * quantization);
        const y = Math.round((vertices[offset + 1] ?? 0) * quantization);
        const z = Math.round((vertices[offset + 2] ?? 0) * quantization);
        return `${x},${y},${z}`;
    };

    oldGroups.forEach(group => {
        const buckets = new Map<string, number[]>();
        group.forEach(vertexId => {
            const key = positionKey(vertexId);
            let bucket = buckets.get(key);
            if (!bucket) {
                bucket = [];
                buckets.set(key, bucket);
            }
            bucket.push(vertexId);
        });

        buckets.forEach(bucket => {
            if (bucket.length < 2) return;
            bucket.sort((a, b) => a - b);
            const normalized = [...bucket];
            bucket.forEach(vertexId => next.set(vertexId, normalized));
            nextGroupCount += 1;
        });
    });

    const previousGroupSignatures = new Set<string>();
    previous.forEach((group, vertexId) => {
        if (vertexId < 0 || vertexId >= vertexCount) return;
        const valid = Array.from(new Set([vertexId, ...group].filter(id => id >= 0 && id < vertexCount))).sort((a, b) => a - b);
        if (valid.length > 1) previousGroupSignatures.add(valid.join(','));
    });
    const nextGroupSignatures = new Set<string>();
    next.forEach((group, vertexId) => {
        if (group[0] === vertexId) nextGroupSignatures.add(group.join(','));
    });

    const changed = previousGroupSignatures.size !== nextGroupSignatures.size
        || Array.from(previousGroupSignatures).some(signature => !nextGroupSignatures.has(signature));
    if (!changed) {
        return {
            changed: false,
            previousGroupCount: previousGroupSignatures.size,
            nextGroupCount: nextGroupSignatures.size,
        };
    }

    mesh.siblings = next;

    // vertexToFaces historically includes faces reached through sibling welds.
    // Rebuild it together with sibling changes so legacy topology utilities do
    // not retain stale cross-shell adjacency after a face is detached by edit.
    const vertexToFaces = new Map<number, number[]>();
    const addFace = (vertexId: number, faceId: number) => {
        let ids = vertexToFaces.get(vertexId);
        if (!ids) {
            ids = [];
            vertexToFaces.set(vertexId, ids);
        }
        if (!ids.includes(faceId)) ids.push(faceId);
    };
    mesh.faces.forEach((face, faceId) => {
        face.forEach(vertexId => {
            if (vertexId < 0 || vertexId >= vertexCount) return;
            addFace(vertexId, faceId);
            next.get(vertexId)?.forEach(siblingId => addFace(siblingId, faceId));
        });
    });
    mesh.vertexToFaces = vertexToFaces;
    mesh.bvh = undefined;
    invalidateMeshConnectivity(mesh);

    return {
        changed: true,
        previousGroupCount: previousGroupSignatures.size,
        nextGroupCount,
    };
}

export function getCanonicalVertex(mesh: LogicalMesh, vertexId: number, vertexCount: number): number {
    const connectivity = getMeshConnectivity(mesh, vertexCount);
    if (vertexId < 0 || vertexId >= connectivity.vertexCount) return -1;
    return connectivity.canonicalVertex[vertexId];
}

/** Returns logical polygon-edge neighbors as canonical/welded vertex ids. */
export function getVertexNeighbors(mesh: LogicalMesh, vertexId: number, vertexCount: number): readonly number[] {
    const connectivity = getMeshConnectivity(mesh, vertexCount);
    if (vertexId < 0 || vertexId >= connectivity.vertexCount) return [];
    const canonical = connectivity.canonicalVertex[vertexId];
    return connectivity.neighborsByCanonical.get(canonical) ?? [];
}

export function areVerticesAdjacent(mesh: LogicalMesh, a: number, b: number, vertexCount: number): boolean {
    const connectivity = getMeshConnectivity(mesh, vertexCount);
    if (a < 0 || a >= vertexCount || b < 0 || b >= vertexCount) return false;
    const ca = connectivity.canonicalVertex[a];
    const cb = connectivity.canonicalVertex[b];
    if (ca === cb) return false;
    return connectivity.neighborsByCanonical.get(ca)?.includes(cb) ?? false;
}

/** Returns authored/logical faces sharing an edge, seam-weld aware. */
export function getEdgeFaces(mesh: LogicalMesh, a: number, b: number, vertexCount: number): readonly number[] {
    const connectivity = getMeshConnectivity(mesh, vertexCount);
    if (a < 0 || a >= vertexCount || b < 0 || b >= vertexCount) return [];
    const ca = connectivity.canonicalVertex[a];
    const cb = connectivity.canonicalVertex[b];
    return connectivity.edgeFacesByCanonicalEdge.get(canonicalEdgeKey(ca, cb)) ?? [];
}

/**
 * Returns a shared logical edge between two faces using the first face's raw ids.
 * Unlike raw face intersection, this works across UV/normal seams represented by
 * persistent sibling groups.
 */
export function getSharedFaceEdge(
    mesh: LogicalMesh,
    faceA: number,
    faceB: number,
    vertexCount: number,
): [number, number] | null {
    const first = mesh.faces[faceA];
    if (!first || !mesh.faces[faceB]) return null;
    for (let i = 0; i < first.length; i += 1) {
        const a = first[i];
        const b = first[(i + 1) % first.length];
        if (getEdgeFaces(mesh, a, b, vertexCount).includes(faceB)) return [a, b];
    }
    return null;
}

/**
 * Multi-source Dijkstra on authored polygon edges. Distances are returned for raw
 * render vertices, but welded sibling vertices share one logical node/distance.
 */
export function computeSurfaceDistances(
    mesh: LogicalMesh,
    vertices: Float32Array,
    sourceVertices: ReadonlySet<number>,
    maxDistance = Infinity,
): SurfaceDistanceResult {
    const vertexCount = Math.floor(vertices.length / 3);
    const connectivity = getMeshConnectivity(mesh, vertexCount);
    const canonicalDistances = new Float32Array(vertexCount);
    canonicalDistances.fill(Infinity);
    const queue = new MinHeap();

    sourceVertices.forEach(rawVertex => {
        if (rawVertex < 0 || rawVertex >= vertexCount) return;
        const canonical = connectivity.canonicalVertex[rawVertex];
        if (canonicalDistances[canonical] !== 0) {
            canonicalDistances[canonical] = 0;
            queue.push({ id: canonical, dist: 0 });
        }
    });

    let visitedVertexCount = 0;
    while (queue.length > 0) {
        const current = queue.pop()!;
        if (current.dist !== canonicalDistances[current.id]) continue;
        if (current.dist > maxDistance) continue;
        visitedVertexCount += 1;

        const neighbors = connectivity.neighborsByCanonical.get(current.id) ?? [];
        for (const neighbor of neighbors) {
            const distance = edgeLength(vertices, current.id, neighbor);
            const nextDistance = current.dist + distance;
            if (nextDistance >= canonicalDistances[neighbor] || nextDistance > maxDistance) continue;
            canonicalDistances[neighbor] = nextDistance;
            queue.push({ id: neighbor, dist: nextDistance });
        }
    }

    const distances = new Float32Array(vertexCount);
    distances.fill(Infinity);
    for (let rawVertex = 0; rawVertex < vertexCount; rawVertex += 1) {
        distances[rawVertex] = canonicalDistances[connectivity.canonicalVertex[rawVertex]];
    }
    return { distances, visitedVertexCount };
}


/**
 * Face-aware geodesic approximation used by influence tools.
 *
 * Topology queries keep authored polygon edges as the only true neighbors, but
 * influence distance may travel through a virtual node at each polygon center.
 * This avoids treating render-triangulation diagonals as topology edges while
 * still letting falloff cross the interior of a quad/ngon instead of expanding
 * only in Manhattan-like edge rings.
 */
export function computeFaceAwareSurfaceDistances(
    mesh: LogicalMesh,
    vertices: Float32Array,
    sourceVertices: ReadonlySet<number>,
    maxDistance = Infinity,
): SurfaceDistanceResult {
    const vertexCount = Math.floor(vertices.length / 3);
    const connectivity = getMeshConnectivity(mesh, vertexCount);
    const faceCount = mesh.faces.length;
    const nodeCount = vertexCount + faceCount;
    const distances = new Float64Array(nodeCount);
    distances.fill(Infinity);
    const queue = new MinHeap();

    const faceCenters = new Float32Array(faceCount * 3);
    for (let faceId = 0; faceId < faceCount; faceId += 1) {
        const face = mesh.faces[faceId];
        if (!face || face.length === 0) continue;
        let x = 0;
        let y = 0;
        let z = 0;
        let count = 0;
        for (const rawVertex of face) {
            if (rawVertex < 0 || rawVertex >= vertexCount) continue;
            const offset = rawVertex * 3;
            x += vertices[offset] ?? 0;
            y += vertices[offset + 1] ?? 0;
            z += vertices[offset + 2] ?? 0;
            count += 1;
        }
        if (count > 0) {
            const offset = faceId * 3;
            faceCenters[offset] = x / count;
            faceCenters[offset + 1] = y / count;
            faceCenters[offset + 2] = z / count;
        }
    }

    const vertexToFaceCenterLength = (canonicalVertexId: number, faceId: number) => {
        const vo = canonicalVertexId * 3;
        const fo = faceId * 3;
        const dx = (vertices[vo] ?? 0) - faceCenters[fo];
        const dy = (vertices[vo + 1] ?? 0) - faceCenters[fo + 1];
        const dz = (vertices[vo + 2] ?? 0) - faceCenters[fo + 2];
        return Math.hypot(dx, dy, dz);
    };

    sourceVertices.forEach(rawVertex => {
        if (rawVertex < 0 || rawVertex >= vertexCount) return;
        const canonical = connectivity.canonicalVertex[rawVertex];
        if (distances[canonical] !== 0) {
            distances[canonical] = 0;
            queue.push({ id: canonical, dist: 0 });
        }
    });

    let visitedVertexCount = 0;
    while (queue.length > 0) {
        const current = queue.pop()!;
        if (current.dist !== distances[current.id]) continue;
        if (current.dist > maxDistance) continue;

        if (current.id < vertexCount) {
            visitedVertexCount += 1;
            const canonical = current.id;

            // Preserve authored polygon-edge travel; face-center links only add
            // metric shortcuts through face interiors, never topology neighbors.
            const neighbors = connectivity.neighborsByCanonical.get(canonical) ?? [];
            for (const neighbor of neighbors) {
                const nextDistance = current.dist + edgeLength(vertices, canonical, neighbor);
                if (nextDistance >= distances[neighbor] || nextDistance > maxDistance) continue;
                distances[neighbor] = nextDistance;
                queue.push({ id: neighbor, dist: nextDistance });
            }

            const faces = connectivity.facesByCanonical.get(canonical) ?? [];
            for (const faceId of faces) {
                const faceNode = vertexCount + faceId;
                const nextDistance = current.dist + vertexToFaceCenterLength(canonical, faceId);
                if (nextDistance >= distances[faceNode] || nextDistance > maxDistance) continue;
                distances[faceNode] = nextDistance;
                queue.push({ id: faceNode, dist: nextDistance });
            }
            continue;
        }

        const faceId = current.id - vertexCount;
        const faceVertices = connectivity.faceCanonicalVertices[faceId] ?? [];
        for (const canonical of faceVertices) {
            const nextDistance = current.dist + vertexToFaceCenterLength(canonical, faceId);
            if (nextDistance >= distances[canonical] || nextDistance > maxDistance) continue;
            distances[canonical] = nextDistance;
            queue.push({ id: canonical, dist: nextDistance });
        }
    }

    const rawDistances = new Float32Array(vertexCount);
    rawDistances.fill(Infinity);
    for (let rawVertex = 0; rawVertex < vertexCount; rawVertex += 1) {
        rawDistances[rawVertex] = distances[connectivity.canonicalVertex[rawVertex]];
    }
    return { distances: rawDistances, visitedVertexCount };
}

/**
 * Returns a raw-vertex mask constrained by logical connectivity.
 * SAME_ISLAND floods the complete connected component. FLOOD_WITHIN_RADIUS
 * stops a branch as soon as the next logical vertex is outside the Euclidean
 * brush radius; this is the cheap connected-volume behavior useful for skinning
 * and deformer/sculpt brushes.
 */
export function computeConnectedVertexMask(
    mesh: LogicalMesh,
    vertices: Float32Array,
    sourceVertices: ReadonlySet<number>,
    options: ConnectedVertexMaskOptions,
): Uint8Array {
    const vertexCount = Math.floor(vertices.length / 3);
    const connectivity = getMeshConnectivity(mesh, vertexCount);
    const mask = new Uint8Array(vertexCount);
    if (sourceVertices.size === 0) return mask;

    let cx = options.center?.x ?? 0;
    let cy = options.center?.y ?? 0;
    let cz = options.center?.z ?? 0;
    if (!options.center) {
        let count = 0;
        sourceVertices.forEach(rawVertex => {
            if (rawVertex < 0 || rawVertex >= vertexCount) return;
            const offset = rawVertex * 3;
            cx += vertices[offset] ?? 0;
            cy += vertices[offset + 1] ?? 0;
            cz += vertices[offset + 2] ?? 0;
            count += 1;
        });
        if (count > 0) {
            cx /= count;
            cy /= count;
            cz /= count;
        }
    }

    const safeRadius = Math.max(options.radius ?? Infinity, 1e-6);
    const sourceCanonical = new Set<number>();
    const queue: number[] = [];
    sourceVertices.forEach(rawVertex => {
        if (rawVertex < 0 || rawVertex >= vertexCount) return;
        const canonical = connectivity.canonicalVertex[rawVertex];
        if (sourceCanonical.has(canonical)) return;
        sourceCanonical.add(canonical);
        queue.push(canonical);
    });

    const visited = new Set<number>(sourceCanonical);
    let cursor = 0;
    while (cursor < queue.length) {
        const current = queue[cursor++];
        for (const neighbor of connectivity.neighborsByCanonical.get(current) ?? []) {
            if (visited.has(neighbor)) continue;

            if (options.mode === 'FLOOD_WITHIN_RADIUS') {
                const offset = neighbor * 3;
                const dx = (vertices[offset] ?? 0) - cx;
                const dy = (vertices[offset + 1] ?? 0) - cy;
                const dz = (vertices[offset + 2] ?? 0) - cz;
                if (Math.hypot(dx, dy, dz) > safeRadius) continue;
            }

            visited.add(neighbor);
            queue.push(neighbor);
        }
    }

    for (let rawVertex = 0; rawVertex < vertexCount; rawVertex += 1) {
        if (visited.has(connectivity.canonicalVertex[rawVertex])) mask[rawVertex] = 1;
    }
    return mask;
}

/** Generic shortest surface path, useful for future connect/cut/loop helpers. */
export function findShortestVertexPath(
    mesh: LogicalMesh,
    vertices: Float32Array,
    startVertex: number,
    endVertex: number,
): ShortestVertexPathResult | null {
    const vertexCount = Math.floor(vertices.length / 3);
    const connectivity = getMeshConnectivity(mesh, vertexCount);
    if (startVertex < 0 || startVertex >= vertexCount || endVertex < 0 || endVertex >= vertexCount) return null;

    const start = connectivity.canonicalVertex[startVertex];
    const end = connectivity.canonicalVertex[endVertex];
    if (start === end) return { vertices: [start], distance: 0 };

    const distances = new Float32Array(vertexCount);
    distances.fill(Infinity);
    const previous = new Int32Array(vertexCount);
    previous.fill(-1);
    const queue = new MinHeap();
    distances[start] = 0;
    queue.push({ id: start, dist: 0 });

    while (queue.length > 0) {
        const current = queue.pop()!;
        if (current.dist !== distances[current.id]) continue;
        if (current.id === end) break;

        const neighbors = connectivity.neighborsByCanonical.get(current.id) ?? [];
        for (const neighbor of neighbors) {
            const nextDistance = current.dist + edgeLength(vertices, current.id, neighbor);
            if (nextDistance >= distances[neighbor]) continue;
            distances[neighbor] = nextDistance;
            previous[neighbor] = current.id;
            queue.push({ id: neighbor, dist: nextDistance });
        }
    }

    if (!Number.isFinite(distances[end])) return null;
    const path: number[] = [];
    let cursor = end;
    while (cursor !== -1) {
        path.push(cursor);
        if (cursor === start) break;
        cursor = previous[cursor];
    }
    if (path[path.length - 1] !== start) return null;
    path.reverse();
    return { vertices: path, distance: distances[end] };
}

export function createMeshConnectivityView(
    mesh: LogicalMesh,
    vertices: Float32Array,
): MeshConnectivityView {
    const vertexCount = Math.floor(vertices.length / 3);
    // Warm the cache once for this view. Query methods still call through the
    // public helpers so invalidation/rebuild behavior stays centralized.
    getMeshConnectivity(mesh, vertexCount);
    return {
        vertexCount,
        canonicalVertex: vertexId => getCanonicalVertex(mesh, vertexId, vertexCount),
        neighbors: vertexId => getVertexNeighbors(mesh, vertexId, vertexCount),
        areAdjacent: (a, b) => areVerticesAdjacent(mesh, a, b, vertexCount),
        edgeFaces: (a, b) => getEdgeFaces(mesh, a, b, vertexCount),
        sharedFaceEdge: (faceA, faceB) => getSharedFaceEdge(mesh, faceA, faceB, vertexCount),
        surfaceDistances: (sources, maxDistance = Infinity) =>
            computeSurfaceDistances(mesh, vertices, sources, maxDistance),
        faceAwareSurfaceDistances: (sources, maxDistance = Infinity) =>
            computeFaceAwareSurfaceDistances(mesh, vertices, sources, maxDistance),
        connectedMask: (sources, options) =>
            computeConnectedVertexMask(mesh, vertices, sources, options),
        shortestVertexPath: (start, end) => findShortestVertexPath(mesh, vertices, start, end),
    };
}

/** Stable facade for editor tools, scripts, tests, and future agent commands. */
export const MeshConnectivityAPI = {
    getIndex: getMeshConnectivity,
    invalidate: invalidateMeshConnectivity,
    reconcileExistingSiblingsAfterGeometryEdit: reconcileMeshSiblingGroupsAfterGeometryEdit,
    canonicalVertex: getCanonicalVertex,
    neighbors: getVertexNeighbors,
    areAdjacent: areVerticesAdjacent,
    edgeFaces: getEdgeFaces,
    sharedFaceEdge: getSharedFaceEdge,
    surfaceDistances: computeSurfaceDistances,
    faceAwareSurfaceDistances: computeFaceAwareSurfaceDistances,
    connectedMask: computeConnectedVertexMask,
    shortestVertexPath: findShortestVertexPath,
    forMesh: createMeshConnectivityView,
} as const;
