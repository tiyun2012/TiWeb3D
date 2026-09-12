
export type Vec3Like = { x: number; y: number; z: number } | [number, number, number];

export function toVec3Tuple(v?: Vec3Like, fallback: [number, number, number] = [0, 0, 0]): [number, number, number] {
    if (!v) return fallback;
    if (Array.isArray(v)) return [v[0], v[1], v[2]];
    return [v.x, v.y, v.z];
}

/**
 * Shared utility to generate 3D wireframe sphere lines (3 orthogonal circles: XY, YZ, XZ).
 * Appends line endpoints (x1, y1, z1, x2, y2, z2, ...) to the provided `out` array.
 */
export function generateWireSphereLines(
    center: Vec3Like,
    radius: number,
    out: number[],
    segments: number = 12,
    xAxis: Vec3Like = [1, 0, 0],
    yAxis: Vec3Like = [0, 1, 0],
    zAxis: Vec3Like = [0, 0, 1]
): void {
    const [cx, cy, cz] = toVec3Tuple(center, [0, 0, 0]);
    const [xx, xy, xz] = toVec3Tuple(xAxis, [1, 0, 0]);
    const [yx, yy, yz] = toVec3Tuple(yAxis, [0, 1, 0]);
    const [zx, zy, zz] = toVec3Tuple(zAxis, [0, 0, 1]);

    const getPoint = (
        ux: number, uy: number, uz: number,
        vx: number, vy: number, vz: number,
        theta: number
    ): [number, number, number] => {
        const cos = Math.cos(theta);
        const sin = Math.sin(theta);
        return [
            cx + (ux * cos + vx * sin) * radius,
            cy + (uy * cos + vy * sin) * radius,
            cz + (uz * cos + vz * sin) * radius
        ];
    };

    const step = (Math.PI * 2) / segments;

    // 1. XY Circle (rotates around Z)
    let prev = getPoint(xx, xy, xz, yx, yy, yz, 0);
    for (let i = 1; i <= segments; i++) {
        const theta = i * step;
        const next = getPoint(xx, xy, xz, yx, yy, yz, theta);
        out.push(prev[0], prev[1], prev[2], next[0], next[1], next[2]);
        prev = next;
    }

    // 2. YZ Circle (rotates around X)
    prev = getPoint(yx, yy, yz, zx, zy, zz, 0);
    for (let i = 1; i <= segments; i++) {
        const theta = i * step;
        const next = getPoint(yx, yy, yz, zx, zy, zz, theta);
        out.push(prev[0], prev[1], prev[2], next[0], next[1], next[2]);
        prev = next;
    }

    // 3. XZ Circle (rotates around Y)
    prev = getPoint(xx, xy, xz, zx, zy, zz, 0);
    for (let i = 1; i <= segments; i++) {
        const theta = i * step;
        const next = getPoint(xx, xy, xz, zx, zy, zz, theta);
        out.push(prev[0], prev[1], prev[2], next[0], next[1], next[2]);
        prev = next;
    }
}

/**
 * Shared skeleton visual sizing. The structural joint radius is independent of
 * parent-child distance; selection/hover may enlarge the sphere without changing
 * the bone base that is anchored to the parent joint.
 */
export type SkeletonJointVisualState = 'normal' | 'hovered' | 'selected';

export function getSkeletonJointRadius(
    isRoot: boolean,
    jointRadius: number = 10,
    rootScale: number = 1.6,
    state: SkeletonJointVisualState = 'normal'
): number {
    const baseRadius = state === 'selected'
        ? 0.08
        : state === 'hovered'
        ? 0.07
        : isRoot
        ? 0.06
        : 0.045;
    const radiusScale = Math.max(0.01, jointRadius / 10);
    return baseRadius * radiusScale * (isRoot ? rootScale : 1.0);
}

export interface SkeletonVisualAxes {
    x: [number, number, number];
    y: [number, number, number];
    z: [number, number, number];
}

export function getMatrixUnitAxes(matrix: ArrayLike<number>): SkeletonVisualAxes {
    return {
        x: normalizeTuple([matrix[0] ?? 1, matrix[1] ?? 0, matrix[2] ?? 0], [1, 0, 0]),
        y: normalizeTuple([matrix[4] ?? 0, matrix[5] ?? 1, matrix[6] ?? 0], [0, 1, 0]),
        z: normalizeTuple([matrix[8] ?? 0, matrix[9] ?? 0, matrix[10] ?? 1], [0, 0, 1])
    };
}

export function transformLocalDirectionByAxes(
    localDirection: Vec3Like | undefined,
    parentAxes: SkeletonVisualAxes,
    fallback: Vec3Like = [0, 1, 0]
): [number, number, number] {
    if (!localDirection) return normalizeTuple(toVec3Tuple(fallback, [0, 1, 0]), [0, 1, 0]);
    const [lx, ly, lz] = toVec3Tuple(localDirection, [0, 1, 0]);
    const localLen = Math.hypot(lx, ly, lz);
    if (localLen < 1e-7) return normalizeTuple(toVec3Tuple(fallback, [0, 1, 0]), [0, 1, 0]);
    const nx = lx / localLen;
    const ny = ly / localLen;
    const nz = lz / localLen;
    return normalizeTuple([
        parentAxes.x[0] * nx + parentAxes.y[0] * ny + parentAxes.z[0] * nz,
        parentAxes.x[1] * nx + parentAxes.y[1] * ny + parentAxes.z[1] * nz,
        parentAxes.x[2] * nx + parentAxes.y[2] * ny + parentAxes.z[2] * nz
    ], [0, 1, 0]);
}

export function getBoneRestDirectionWorld(
    childBindPose: ArrayLike<number> | undefined,
    parentAxes: SkeletonVisualAxes,
    fallback: Vec3Like = [0, 1, 0]
): [number, number, number] {
    if (!childBindPose) return transformLocalDirectionByAxes(undefined, parentAxes, fallback);
    return transformLocalDirectionByAxes(
        [childBindPose[12] ?? 0, childBindPose[13] ?? 0, childBindPose[14] ?? 0],
        parentAxes,
        fallback
    );
}

export interface BoneOctahedronOptions {
    /** Stable structural size of the parent joint. Bone width derives from this, never child distance. */
    parentRadius?: number;
    /** Structural size of the child joint. Used to stop the visible bone at the child sphere surface. */
    childRadius?: number;
    /** Parent joint local frame expressed in world space. */
    parentXAxis?: Vec3Like;
    parentYAxis?: Vec3Like;
    parentZAxis?: Vec3Like;
    /** Rest/bind bone direction in world space. Used only as the no-twist roll reference. */
    restDirection?: Vec3Like;
    /** Radius multiplier for the parent-side four-point base ring. */
    widthScale?: number;
    /** Multiplier applied to parentRadius before placing the base-ring center along the live direction. */
    baseOffsetScale?: number;
}

function normalizeTuple(v: [number, number, number], fallback: [number, number, number]): [number, number, number] {
    const len = Math.hypot(v[0], v[1], v[2]);
    if (len < 1e-7) return fallback;
    return [v[0] / len, v[1] / len, v[2] / len];
}

function projectAxisToPlane(
    axis: [number, number, number],
    normal: [number, number, number]
): [number, number, number] {
    const dot = axis[0] * normal[0] + axis[1] * normal[1] + axis[2] * normal[2];
    return [
        axis[0] - normal[0] * dot,
        axis[1] - normal[1] * dot,
        axis[2] - normal[2] * dot
    ];
}

function crossTuple(
    a: [number, number, number],
    b: [number, number, number]
): [number, number, number] {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

function dotTuple(a: [number, number, number], b: [number, number, number]): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Rotate a vector by the shortest rotation taking `from` to `to`.
 * The 180-degree case uses a caller-provided stable axis so the visual frame
 * stays deterministic instead of flipping to an arbitrary world-up choice.
 */
function rotateByShortestArc(
    vector: [number, number, number],
    from: [number, number, number],
    to: [number, number, number],
    oppositeAxis: [number, number, number]
): [number, number, number] {
    const d = Math.max(-1, Math.min(1, dotTuple(from, to)));
    if (d > 1 - 1e-7) return vector;

    if (d < -1 + 1e-6) {
        const axis = normalizeTuple(projectAxisToPlane(oppositeAxis, from), [1, 0, 0]);
        // Rodrigues for PI radians: v' = 2 axis (axis dot v) - v.
        const axisDotV = dotTuple(axis, vector);
        return [
            2 * axis[0] * axisDotV - vector[0],
            2 * axis[1] * axisDotV - vector[1],
            2 * axis[2] * axisDotV - vector[2]
        ];
    }

    const qv = crossTuple(from, to);
    const qw = 1 + d;
    const qLen = Math.hypot(qv[0], qv[1], qv[2], qw) || 1;
    const qx = qv[0] / qLen;
    const qy = qv[1] / qLen;
    const qz = qv[2] / qLen;
    const qwn = qw / qLen;

    const qVec: [number, number, number] = [qx, qy, qz];
    const t = crossTuple(qVec, vector);
    const twoT: [number, number, number] = [t[0] * 2, t[1] * 2, t[2] * 2];
    const qCrossT = crossTuple(qVec, twoT);
    return [
        vector[0] + qwn * twoT[0] + qCrossT[0],
        vector[1] + qwn * twoT[1] + qCrossT[1],
        vector[2] + qwn * twoT[2] + qCrossT[2]
    ];
}

/**
 * Shared utility to generate the wireframe bone shape connecting parent P to child C.
 *
 * Important visual contract:
 * - The parent joint center is the pivot; the bone swings with the live parent->child direction.
 * - Visible geometry starts outside the parent joint sphere and stops at the child sphere surface.
 * - Cross-section size is fixed from the parent joint radius, never parent-child distance.
 * - Roll is transported from the parent's local rest frame onto the live direction, avoiding
 *   arbitrary corkscrew twist while the child moves around the parent.
 */
export function generateBoneOctahedronLines(
    p: Vec3Like,
    c: Vec3Like,
    outLines: number[],
    options: BoneOctahedronOptions = {}
): void {
    const [px, py, pz] = toVec3Tuple(p);
    const [cx, cy, cz] = toVec3Tuple(c);

    const liveVector: [number, number, number] = [cx - px, cy - py, cz - pz];
    const len = Math.hypot(liveVector[0], liveVector[1], liveVector[2]);
    if (len < 0.001) return;
    const liveForward = normalizeTuple(liveVector, [0, 1, 0]);

    const parentX = normalizeTuple(toVec3Tuple(options.parentXAxis, [1, 0, 0]), [1, 0, 0]);
    const parentY = normalizeTuple(toVec3Tuple(options.parentYAxis, [0, 1, 0]), [0, 1, 0]);
    const parentZ = normalizeTuple(toVec3Tuple(options.parentZAxis, [0, 0, 1]), [0, 0, 1]);
    const restForward = normalizeTuple(toVec3Tuple(options.restDirection, liveForward), liveForward);

    // Build the authored roll frame at rest from the parent's own axes.
    let restRightProjected = projectAxisToPlane(parentX, restForward);
    if (Math.hypot(...restRightProjected) < 1e-4) restRightProjected = projectAxisToPlane(parentZ, restForward);
    if (Math.hypot(...restRightProjected) < 1e-4) restRightProjected = projectAxisToPlane(parentY, restForward);
    let restRight = normalizeTuple(restRightProjected, [1, 0, 0]);
    let restUp = normalizeTuple(crossTuple(restRight, restForward), [0, 0, 1]);

    // Keep the authored frame's handedness aligned with the parent's local Z.
    if (dotTuple(restUp, parentZ) < 0) {
        restRight = [-restRight[0], -restRight[1], -restRight[2]];
        restUp = [-restUp[0], -restUp[1], -restUp[2]];
    }

    // Swing the entire rest frame onto the live direction. This is what makes the bone
    // rotate about the parent center when the child moves, without inventing extra axial roll.
    let liveRight = rotateByShortestArc(restRight, restForward, liveForward, restUp);
    liveRight = normalizeTuple(projectAxisToPlane(liveRight, liveForward), restRight);
    const liveUp = normalizeTuple(crossTuple(liveRight, liveForward), restUp);

    const parentRadius = Math.max(0.001, Math.abs(options.parentRadius ?? 0.045));
    const childRadius = Math.max(0, Math.abs(options.childRadius ?? parentRadius));
    const widthScale = options.widthScale ?? 0.85;
    const baseOffsetScale = Math.max(1.0, options.baseOffsetScale ?? 1.05);
    const baseRadius = parentRadius * widthScale;

    // The visible bone occupies only the free space between the two joint spheres.
    // Parent/child centers remain the transform pivots, not rendered bone endpoints.
    const baseDist = parentRadius * baseOffsetScale;
    const tipDist = len - childRadius;
    if (tipDist <= baseDist + 1e-5) return;

    const bx = px + liveForward[0] * baseDist;
    const by = py + liveForward[1] * baseDist;
    const bz = pz + liveForward[2] * baseDist;
    const tx = px + liveForward[0] * tipDist;
    const ty = py + liveForward[1] * tipDist;
    const tz = pz + liveForward[2] * tipDist;

    const k1: [number, number, number] = [bx + liveRight[0] * baseRadius, by + liveRight[1] * baseRadius, bz + liveRight[2] * baseRadius];
    const k2: [number, number, number] = [bx + liveUp[0] * baseRadius, by + liveUp[1] * baseRadius, bz + liveUp[2] * baseRadius];
    const k3: [number, number, number] = [bx - liveRight[0] * baseRadius, by - liveRight[1] * baseRadius, bz - liveRight[2] * baseRadius];
    const k4: [number, number, number] = [bx - liveUp[0] * baseRadius, by - liveUp[1] * baseRadius, bz - liveUp[2] * baseRadius];
    const tip: [number, number, number] = [tx, ty, tz];

    const addLine = (a: [number, number, number], b: [number, number, number]) => {
        outLines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    };

    // Four-point parent-side base ring + four tapered rails to the child sphere surface.
    // Deliberately no line is emitted from the parent center: the joint sphere owns that region.
    addLine(k1, k2); addLine(k2, k3); addLine(k3, k4); addLine(k4, k1);
    addLine(k1, tip); addLine(k2, tip); addLine(k3, tip); addLine(k4, tip);
}

/**
 * Shared utility to generate RGB coordinate axes lines.
 */
export function generateAxisLines(
    origin: Vec3Like,
    xAxis: Vec3Like,
    yAxis: Vec3Like,
    zAxis: Vec3Like,
    scale: number,
    outX: number[],
    outY: number[],
    outZ: number[]
): void {
    const [ox, oy, oz] = toVec3Tuple(origin);
    const [xx, xy, xz] = toVec3Tuple(xAxis, [1, 0, 0]);
    const [yx, yy, yz] = toVec3Tuple(yAxis, [0, 1, 0]);
    const [zx, zy, zz] = toVec3Tuple(zAxis, [0, 0, 1]);

    outX.push(ox, oy, oz, ox + xx * scale, oy + xy * scale, oz + xz * scale);
    outY.push(ox, oy, oz, ox + yx * scale, oy + yy * scale, oz + yz * scale);
    outZ.push(ox, oy, oz, ox + zx * scale, oy + zy * scale, oz + zz * scale);
}

export class DebugRenderer {
    gl: WebGL2RenderingContext | null = null;
    program: WebGLProgram | null = null;
    
    // Lines
    maxLines = 150000; 
    lineBufferData = new Float32Array(this.maxLines * 12); 
    lineCount = 0;
    lineVAO: WebGLVertexArrayObject | null = null;
    lineVBO: WebGLBuffer | null = null;

    // Points
    maxPoints = 100000;
    pointBufferData = new Float32Array(this.maxPoints * 8); // x, y, z, r, g, b, size, border
    pointCount = 0;
    pointVAO: WebGLVertexArrayObject | null = null;
    pointVBO: WebGLBuffer | null = null;

    uniforms: { u_vp: WebGLUniformLocation | null } = { u_vp: null };

    init(gl: WebGL2RenderingContext) {
        if (!gl) return;
        this.gl = gl;
        
        // Updated Shader to support Point Size and Border (Circle)
        // Reduced Depth Bias (0.002 -> 0.00005) to prevent "see-through" edges near vertices
        const vs = `#version 300 es
        layout(location=0) in vec3 a_pos; 
        layout(location=1) in vec3 a_color; 
        layout(location=2) in float a_size; 
        layout(location=3) in float a_border;
        uniform mat4 u_vp; 
        out vec3 v_color; 
        out float v_border;
        void main() { 
            gl_Position = u_vp * vec4(a_pos, 1.0); 
            
            // Bias: Pulls geometry slightly towards camera to overlay on meshes.
            // Value tuned to 0.00005 to fix back-face bleed-through while preventing Z-fighting.
            gl_Position.z -= 0.00005 * gl_Position.w;
            
            v_color = a_color; 
            v_border = a_border;
            gl_PointSize = a_size;
        }`;
        const fs = `#version 300 es
        precision mediump float; 
        in vec3 v_color; 
        in float v_border;
        out vec4 color; 
        void main() { 
            vec2 coord = gl_PointCoord - vec2(0.5);
            float dist = length(coord);
            
            // Hard circle cut
            if (dist > 0.5) discard;
            
            vec3 c = v_color;
            
            // Draw Border (Yellow #f9ea4e)
            // v_border is normalized thickness relative to point size (0.0 - 0.5)
            if (v_border > 0.0 && dist > (0.5 - v_border)) {
                c = vec3(1.0, 0.9, 0.0); // Bright Yellow
            }
            
            // Minimal AA to prevent jagglies but keep it sharp (no large smoothstep gradient)
            float alpha = smoothstep(0.5, 0.45, dist);
            
            color = vec4(c, alpha); 
        }`;
        
        const createShader = (type: number, src: string) => {
            const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s);
            if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
            return s;
        };
        const p = gl.createProgram()!;
        const vShader = createShader(gl.VERTEX_SHADER, vs); const fShader = createShader(gl.FRAGMENT_SHADER, fs);
        if (!vShader || !fShader) return;
        gl.attachShader(p, vShader); gl.attachShader(p, fShader); gl.linkProgram(p);
        this.program = p;
        this.uniforms.u_vp = gl.getUniformLocation(p, 'u_vp');
        
        // Init Line VAO
        this.lineVAO = gl.createVertexArray(); this.lineVBO = gl.createBuffer();
        gl.bindVertexArray(this.lineVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVBO);
        gl.bufferData(gl.ARRAY_BUFFER, this.lineBufferData.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0); 
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
        gl.bindVertexArray(null);

        // Init Point VAO
        this.pointVAO = gl.createVertexArray(); this.pointVBO = gl.createBuffer();
        gl.bindVertexArray(this.pointVAO); gl.bindBuffer(gl.ARRAY_BUFFER, this.pointVBO);
        gl.bufferData(gl.ARRAY_BUFFER, this.pointBufferData.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0); 
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 24); // Size
        gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 32, 28); // Border
        gl.bindVertexArray(null);
    }

    begin() { 
        this.lineCount = 0; 
        this.pointCount = 0;
    }

    drawLine(p1: {x:number, y:number, z:number}, p2: {x:number, y:number, z:number}, color: {r:number, g:number, b:number}) {
        if (this.lineCount >= this.maxLines) return;
        const i = this.lineCount * 12;
        this.lineBufferData[i] = p1.x; this.lineBufferData[i+1] = p1.y; this.lineBufferData[i+2] = p1.z;
        this.lineBufferData[i+3] = color.r; this.lineBufferData[i+4] = color.g; this.lineBufferData[i+5] = color.b;
        this.lineBufferData[i+6] = p2.x; this.lineBufferData[i+7] = p2.y; this.lineBufferData[i+8] = p2.z;
        this.lineBufferData[i+9] = color.r; this.lineBufferData[i+10] = color.g; this.lineBufferData[i+11] = color.b;
        this.lineCount++;
    }

    drawPoint(p: {x:number, y:number, z:number}, color: {r:number, g:number, b:number}, size: number, border: number = 0.0) {
        this.drawPointRaw(p.x, p.y, p.z, color.r, color.g, color.b, size, border);
    }

    drawPointRaw(x: number, y: number, z: number, r: number, g: number, b: number, size: number, border: number = 0.0) {
        if (this.pointCount >= this.maxPoints) return;
        const i = this.pointCount * 8;
        this.pointBufferData[i] = x;   this.pointBufferData[i+1] = y;   this.pointBufferData[i+2] = z;
        this.pointBufferData[i+3] = r; this.pointBufferData[i+4] = g; this.pointBufferData[i+5] = b;
        this.pointBufferData[i+6] = size;
        this.pointBufferData[i+7] = border;
        this.pointCount++;
    }

    drawWireSphere(
        center: Vec3Like,
        radius: number,
        color: { r: number; g: number; b: number },
        segments: number = 12,
        xAxis: Vec3Like = [1, 0, 0],
        yAxis: Vec3Like = [0, 1, 0],
        zAxis: Vec3Like = [0, 0, 1]
    ) {
        const lines: number[] = [];
        generateWireSphereLines(center, radius, lines, segments, xAxis, yAxis, zAxis);
        for (let i = 0; i < lines.length; i += 6) {
            this.drawLine(
                { x: lines[i], y: lines[i + 1], z: lines[i + 2] },
                { x: lines[i + 3], y: lines[i + 4], z: lines[i + 5] },
                color
            );
        }
    }

    drawAxis(
        origin: Vec3Like,
        xAxis: Vec3Like = [1, 0, 0],
        yAxis: Vec3Like = [0, 1, 0],
        zAxis: Vec3Like = [0, 0, 1],
        scale: number = 0.3
    ) {
        const xLines: number[] = [];
        const yLines: number[] = [];
        const zLines: number[] = [];
        generateAxisLines(origin, xAxis, yAxis, zAxis, scale, xLines, yLines, zLines);

        this.drawLine({ x: xLines[0], y: xLines[1], z: xLines[2] }, { x: xLines[3], y: xLines[4], z: xLines[5] }, { r: 1, g: 0, b: 0 });
        this.drawLine({ x: yLines[0], y: yLines[1], z: yLines[2] }, { x: yLines[3], y: yLines[4], z: yLines[5] }, { r: 0, g: 1, b: 0 });
        this.drawLine({ x: zLines[0], y: zLines[1], z: zLines[2] }, { x: zLines[3], y: zLines[4], z: zLines[5] }, { r: 0, g: 0, b: 1 });
    }

    drawBoneOctahedron(
        p: Vec3Like,
        c: Vec3Like,
        color: { r: number; g: number; b: number },
        options: BoneOctahedronOptions = {}
    ) {
        const lines: number[] = [];
        generateBoneOctahedronLines(p, c, lines, options);
        for (let i = 0; i < lines.length; i += 6) {
            this.drawLine(
                { x: lines[i], y: lines[i + 1], z: lines[i + 2] },
                { x: lines[i + 3], y: lines[i + 4], z: lines[i + 5] },
                color
            );
        }
    }

    render(viewProjection: Float32Array) {
        if (!this.gl || !this.program) return;
        const gl = this.gl;
        gl.useProgram(this.program);
        gl.uniformMatrix4fv(this.uniforms.u_vp, false, viewProjection);
        
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        
        // Enable blending for anti-aliased points
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Render Lines
        if (this.lineCount > 0 && this.lineVAO) {
            gl.bindVertexArray(this.lineVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVBO);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lineBufferData.subarray(0, this.lineCount * 12));
            gl.drawArrays(gl.LINES, 0, this.lineCount * 2);
        }

        // Render Points
        if (this.pointCount > 0 && this.pointVAO) {
            gl.bindVertexArray(this.pointVAO);
            gl.bindBuffer(gl.ARRAY_BUFFER, this.pointVBO);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pointBufferData.subarray(0, this.pointCount * 8));
            gl.drawArrays(gl.POINTS, 0, this.pointCount);
        }

        gl.bindVertexArray(null);
        gl.disable(gl.BLEND);
    }
}
