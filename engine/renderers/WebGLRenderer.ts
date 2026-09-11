
// services/renderers/WebGLRenderer.ts

import { ComponentStorage } from '../ecs/ComponentStorage';
import { COMPONENT_MASKS } from '../constants';
import { DebugRenderer } from './DebugRenderer';
import { moduleManager } from '../ModuleManager';
import { MeshRenderSystem } from '../systems/MeshRenderSystem';
import { effectRegistry } from '../EffectRegistry';
import { ParticleSystem } from '../systems/ParticleSystem';
import { GizmoRenderer, GizmoHoverAxis } from './GizmoRenderer';

export interface PostProcessConfig {
    enabled: boolean;
    vignetteStrength: number;   
    aberrationStrength: number; 
    toneMapping: boolean;
}

const GRID_VS = `#version 300 es
layout(location=0) in vec2 a_position;
uniform mat4 u_viewProjection;
out vec3 v_worldPos;
void main() {
    v_worldPos = vec3(a_position.x, 0.0, a_position.y) * 15000.0;
    gl_Position = u_viewProjection * vec4(v_worldPos, 1.0);
}`;

const GRID_FS = `#version 300 es
precision mediump float;
in vec3 v_worldPos;
layout(location=0) out vec4 outColor;

uniform float u_opacity, u_gridSize, u_subdivisions, u_fadeDist;
uniform vec3 u_gridColor;

float getGrid(vec2 pos, float size, float thickness) {
    vec2 r = pos / size;
    vec2 grid = abs(fract(r - 0.5) - 0.5) / fwidth(r);
    float line = min(grid.x, grid.y);
    return 1.0 - smoothstep(thickness - 0.5, thickness + 0.5, line);
}

void main() {
    float major = getGrid(v_worldPos.xz, u_gridSize, 0.6); 
    float minor = getGrid(v_worldPos.xz, u_gridSize / u_subdivisions, 0.3);
    
    float xAxis = 1.0 - smoothstep(0.0, fwidth(v_worldPos.z) * 1.5, abs(v_worldPos.z));
    float zAxis = 1.0 - smoothstep(0.0, fwidth(v_worldPos.x) * 1.5, abs(v_worldPos.x));
    
    float dist = length(v_worldPos.xz);
    float fade = max(0.0, 1.0 - dist / u_fadeDist);
    
    vec3 color = u_gridColor;
    float alpha = max(major * u_opacity, minor * u_opacity * 0.3);

    if (xAxis > 0.01) {
        color = mix(color, vec3(0.9, 0.1, 0.1), xAxis);
        alpha = max(alpha, xAxis * u_opacity * 1.5);
    }
    if (zAxis > 0.01) {
        color = mix(color, vec3(0.1, 0.2, 0.9), zAxis);
        alpha = max(alpha, zAxis * u_opacity * 1.5);
    }
    
    if (alpha * fade < 0.005) discard;
    outColor = vec4(color, alpha * fade);
}`;

const PP_VS = `#version 300 es
layout(location=0) in vec2 a_position;
out vec2 v_uv;
void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const PP_FS_TEMPLATE = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_scene;    
uniform sampler2D u_data;     
uniform sampler2D u_excluded; 
uniform sampler2D u_excludedData; 
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_enabled;
uniform float u_vignetteStrength;
uniform float u_aberrationStrength;
uniform float u_toneMapping;

out vec4 outColor;

vec3 aces(vec3 x) {
  const float a = 2.51; const float b = 0.03; const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// INJECT_EFFECTS_HERE

void main() {
    vec3 baseColor = texture(u_scene, v_uv).rgb;
    float effectId = floor(mod(texture(u_data, v_uv).r * 255.0 + 0.5, 255.0));
    
    // Apply Per-Object Effect (Pass 1)
    baseColor = processCustomEffects(baseColor, effectId, v_uv, u_time, u_scene);

    if (u_enabled > 0.5) {
        if (u_aberrationStrength > 0.0) {
            float r = texture(u_scene, v_uv + vec2(u_aberrationStrength, 0.0)).r;
            float b = texture(u_scene, v_uv - vec2(u_aberrationStrength, 0.0)).b;
            baseColor.r = r; baseColor.b = b;
        }
        if (u_vignetteStrength > 0.0) {
            vec2 uv = v_uv * (1.0 - v_uv.yx); float vig = uv.x * uv.y * 15.0;
            baseColor *= pow(vig, 0.15 * u_vignetteStrength);
        }
        if (u_toneMapping > 0.5) baseColor = aces(baseColor);
    }
    
    baseColor = pow(baseColor, vec3(1.0 / 2.2));

    vec4 exclSample = texture(u_excluded, v_uv);
    if (exclSample.a > 0.0) {
        vec3 exclColor = exclSample.rgb;
        float exclEffectId = floor(mod(texture(u_excludedData, v_uv).r * 255.0 + 0.5, 255.0));
        
        vec3 straightColor = exclColor / exclSample.a;
        
        // Apply Per-Object Effect (Pass 2 - Overlay)
        straightColor = processCustomEffects(straightColor, exclEffectId, v_uv, u_time, u_excluded);
        
        vec3 gammaOverlay = pow(straightColor, vec3(1.0 / 2.2));
        baseColor = baseColor * (1.0 - exclSample.a) + gammaOverlay * exclSample.a;
    }

    outColor = vec4(baseColor, 1.0);
}`;

export class WebGLRenderer {
    gl: WebGL2RenderingContext | null = null;
    gridProgram: WebGLProgram | null = null;
    
    // --- Systems ---
    meshSystem: MeshRenderSystem;

    // --- Post Process ---
    depthRenderbuffer: WebGLRenderbuffer | null = null;
    fboIncluded: WebGLFramebuffer | null = null;
    texColorIncluded: WebGLTexture | null = null;
    texDataIncluded: WebGLTexture | null = null;
    
    fboExcluded: WebGLFramebuffer | null = null;
    texColorExcluded: WebGLTexture | null = null;
    texDataExcluded: WebGLTexture | null = null;
    
    ppProgram: WebGLProgram | null = null;
    quadVAO: WebGLVertexArrayObject | null = null;
    
    private fboWidth: number = 0;
    private fboHeight: number = 0;
    
    drawCalls = 0; triangleCount = 0; showGrid = true;
    gridOpacity = 0.9; gridSize = 1.0; gridSubdivisions = 10; gridFadeDistance = 400.0;
    gridColor = [0.5, 0.5, 0.5]; gridExcludePP = true; 
    renderMode: number = 0;
    ppConfig: PostProcessConfig = { enabled: true, vignetteStrength: 1.0, aberrationStrength: 0.002, toneMapping: true };
    
    // --- GIZMO ---
    gizmoProgram: WebGLProgram | null = null;
    gizmoVAO: WebGLVertexArrayObject | null = null;
    gizmoOffsets = { cylinder:0, cylinderCount:0, cone:0, coneCount:0, quad:0, quadCount:0, quadBorder:0, quadBorderCount:0, sphere:0, sphereCount:0 };
    private sharedGizmoRenderer = new GizmoRenderer();

    constructor() {
        this.meshSystem = new MeshRenderSystem();
    }

    init(canvas: HTMLCanvasElement) {
        this.gl = canvas.getContext('webgl2', { alpha: false, antialias: false, powerPreference: "high-performance" });
        if (!this.gl) return;
        const gl = this.gl;
        gl.getExtension("EXT_color_buffer_float");
        gl.enable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE); 
        gl.clearColor(0.1, 0.1, 0.1, 1.0);
        
        this.meshSystem.init(gl);
        this.initPostProcess(gl);
        this.gridProgram = this.createProgram(gl, GRID_VS, GRID_FS);
    }

    initPostProcess(gl: WebGL2RenderingContext) {
        this.fboWidth = 1; this.fboHeight = 1;
        this.depthRenderbuffer = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRenderbuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.fboWidth, this.fboHeight);
        
        this.fboIncluded = gl.createFramebuffer();
        this.texColorIncluded = this.createTexture(gl, gl.RGBA, gl.UNSIGNED_BYTE);
        this.texDataIncluded = this.createTexture(gl, gl.RGBA32F, gl.FLOAT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboIncluded);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texColorIncluded, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.texDataIncluded, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRenderbuffer);
        
        this.fboExcluded = gl.createFramebuffer();
        this.texColorExcluded = this.createTexture(gl, gl.RGBA, gl.UNSIGNED_BYTE);
        this.texDataExcluded = this.createTexture(gl, gl.RGBA32F, gl.FLOAT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboExcluded);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texColorExcluded, 0);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.texDataExcluded, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthRenderbuffer);
        
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this.quadVAO = gl.createVertexArray(); const quadVBO = gl.createBuffer();
        gl.bindVertexArray(this.quadVAO); gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        
        // Compile Dynamic Post Process Shader
        this.recompilePostProcess();
    }

    recompilePostProcess() {
        if (!this.gl) return;
        
        const effectLogic = effectRegistry.getShaderCode();
        const fullSource = PP_FS_TEMPLATE.replace('// INJECT_EFFECTS_HERE', effectLogic);
        
        if (this.ppProgram) this.gl.deleteProgram(this.ppProgram);
        this.ppProgram = this.createProgram(this.gl, PP_VS, fullSource);
        
        if (!this.ppProgram) {
            console.error("Failed to compile Post-Process Shader");
        }
    }

    private createTexture(gl: WebGL2RenderingContext, format: number, type: number) {
        const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, format, this.fboWidth, this.fboHeight, 0, gl.RGBA, type, null);
        return tex;
    }

    createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
        const vs = gl.createShader(gl.VERTEX_SHADER)!; gl.shaderSource(vs, vsSrc); gl.compileShader(vs);
        const fs = gl.createShader(gl.FRAGMENT_SHADER)!; gl.shaderSource(fs, fsSrc); gl.compileShader(fs);
        const prog = gl.createProgram()!; gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error('Link Error', gl.getProgramInfoLog(prog));
            console.error('VS Log', gl.getShaderInfoLog(vs));
            console.error('FS Log', gl.getShaderInfoLog(fs));
            return null;
        }
        return prog;
    }

    resize(width: number, height: number) {
        if (!this.gl) return;
        const gl = this.gl;
        const canvas = gl.canvas as HTMLCanvasElement;
        canvas.width = width; canvas.height = height;
        gl.viewport(0, 0, width, height);
        if (this.fboWidth !== width || this.fboHeight !== height) {
            this.fboWidth = width; this.fboHeight = height;
            gl.bindTexture(gl.TEXTURE_2D, this.texColorIncluded); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindTexture(gl.TEXTURE_2D, this.texDataIncluded); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
            gl.bindTexture(gl.TEXTURE_2D, this.texColorExcluded); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
            gl.bindTexture(gl.TEXTURE_2D, this.texDataExcluded); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
            gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRenderbuffer); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
        }
    }

    render(store: ComponentStorage, count: number, selectedIndices: Set<number>, vp: Float32Array, width: number, height: number, cam: any, softSelData: { enabled: boolean, center: {x:number,y:number,z:number}, radius: number }, debugRenderer?: DebugRenderer, particleSystem?: ParticleSystem) {
        if (!this.gl || !this.ppProgram) return;
        const gl = this.gl; const time = performance.now() / 1000;
        
        // --- State Reset ---
        // Crucial for correcting state leakage from PostProcess (which disables Depth Test)
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        // Reset draw buffer blending states if any were modified by particles in previous frame
        // (Though technically we do it right before particles)
        // Check for WebGL 2 features
        const hasDrawBuffersIndexed = (gl as any).enablei && (gl as any).disablei;
        if (hasDrawBuffersIndexed) {
            (gl as any).enablei(gl.BLEND, 0); 
            (gl as any).enablei(gl.BLEND, 1);
        }

        // Prepare light data
        let lightDir = [0.5, -1.0, 0.5], lightColor = [1, 1, 1], lightIntensity = 1.0;
        for (let i = 0; i < count; i++) {
            if (store.isActive[i] && (store.componentMask[i] & COMPONENT_MASKS.LIGHT)) {
                const base = i * 16;
                lightDir[0] = store.worldMatrix[base + 8]; lightDir[1] = store.worldMatrix[base + 9]; lightDir[2] = store.worldMatrix[base + 10];
                lightColor[0] = store.colorR[i]; lightColor[1] = store.colorG[i]; lightColor[2] = store.colorB[i];
                lightIntensity = store.lightIntensity[i]; break;
            }
        }

        // --- Prepare Mesh Buckets ---
        this.meshSystem.prepareBuckets(store, count);

        this.drawCalls = 0; this.triangleCount = 0;
        
        // --- Pass 1: Opaque Scene ---
        // Render Particles into the Opaque pass so they interact with PP correctly
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboIncluded);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        gl.clearColor(0.1, 0.1, 0.1, 1.0); 
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); 
        
        this.meshSystem.render(store, selectedIndices, vp, cam, time, lightDir, lightColor, lightIntensity, this.renderMode, 'OPAQUE', softSelData);
        
        // Render Particles
        if (particleSystem) {
            if (hasDrawBuffersIndexed) {
                // [CRITICAL] Disable blending for the Data buffer (1) to prevent ID corruption
                // Enable blending for Color buffer (0) for transparency
                (gl as any).enablei(gl.BLEND, 0);
                (gl as any).disablei(gl.BLEND, 1);
                
                particleSystem.render(vp, cam, this.meshSystem.textureArray, time, store);
                
                // Restore for standard rendering
                (gl as any).enablei(gl.BLEND, 1);
            } else {
                // Fallback for systems without indexed blending (unlikely for WebGL 2 but safe)
                // Just render standard blending to all targets
                gl.enable(gl.BLEND);
                particleSystem.render(vp, cam, this.meshSystem.textureArray, time, store);
            }
        }

        if (this.showGrid && !this.gridExcludePP) { 
            gl.drawBuffers([gl.COLOR_ATTACHMENT0]); 
            this.renderGrid(gl, vp); 
        }

        // --- Pass 2: Overlays / Excluded ---
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboExcluded);
        gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
        gl.clearColor(0, 0, 0, 0); 
        gl.clear(gl.COLOR_BUFFER_BIT); 
        
        this.meshSystem.render(store, selectedIndices, vp, cam, time, lightDir, lightColor, lightIntensity, this.renderMode, 'OVERLAY', softSelData);
        
        // Render Custom Modules
        gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
        moduleManager.render(gl, vp);

        if (this.showGrid && this.gridExcludePP) { 
            this.renderGrid(gl, vp); 
        }

        if (debugRenderer) { 
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL); 
            debugRenderer.render(vp); 
        }

        // --- Pass 3: Post Processing Composite ---
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); 
        gl.disable(gl.DEPTH_TEST); // This disables depth test for the next frame unless re-enabled!
        
        gl.useProgram(this.ppProgram);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.texColorIncluded); gl.uniform1i(gl.getUniformLocation(this.ppProgram!, 'u_scene'), 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.texDataIncluded); gl.uniform1i(gl.getUniformLocation(this.ppProgram!, 'u_data'), 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.texColorExcluded); gl.uniform1i(gl.getUniformLocation(this.ppProgram!, 'u_excluded'), 2);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.texDataExcluded); gl.uniform1i(gl.getUniformLocation(this.ppProgram!, 'u_excludedData'), 3);
        
        const setU = (n: string, v: number) => { const l = gl.getUniformLocation(this.ppProgram!, n); if(l) gl.uniform1f(l, v); };
        setU('u_time', time);
        setU('u_enabled', this.ppConfig.enabled?1:0); setU('u_vignetteStrength', this.ppConfig.vignetteStrength);
        setU('u_aberrationStrength', this.ppConfig.aberrationStrength); setU('u_toneMapping', this.ppConfig.toneMapping?1:0);
        gl.bindVertexArray(this.quadVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); 
        gl.enable(gl.DEPTH_TEST); // Restore just in case, though we do it at top of frame now too.
    }

    private renderGrid(gl: WebGL2RenderingContext, vp: Float32Array) {
        if (!this.gridProgram || !this.quadVAO) return;
        gl.useProgram(this.gridProgram); 
        gl.enable(gl.BLEND); 
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); 
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);

        gl.uniformMatrix4fv(gl.getUniformLocation(this.gridProgram, 'u_viewProjection'), false, vp);
        gl.uniform1f(gl.getUniformLocation(this.gridProgram, 'u_opacity'), this.gridOpacity);
        gl.uniform1f(gl.getUniformLocation(this.gridProgram, 'u_gridSize'), this.gridSize);
        gl.uniform1f(gl.getUniformLocation(this.gridProgram, 'u_subdivisions'), this.gridSubdivisions);
        gl.uniform1f(gl.getUniformLocation(this.gridProgram, 'u_fadeDist'), this.gridFadeDistance);
        gl.uniform3fv(gl.getUniformLocation(this.gridProgram, 'u_gridColor'), this.gridColor);
        
        gl.bindVertexArray(this.quadVAO); 
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); 
        
        gl.depthMask(true); 
        gl.disable(gl.BLEND);
    }

    // ... (Gizmo Rendering, unchanged) ...

    initGizmo() {
        if (!this.gl) return;
        this.sharedGizmoRenderer.init(this.gl);
    }

    renderGizmos(vp: Float32Array, pos: {x:number, y:number, z:number}, scale: number, hoverAxis: string | null, activeAxis: string | null) {
        // Delegate to shared gizmo renderer so other viewports can reuse it.
        this.sharedGizmoRenderer.renderGizmos(vp, pos, scale, hoverAxis as GizmoHoverAxis, activeAxis as GizmoHoverAxis);
    }
}