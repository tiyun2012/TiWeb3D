import { assetManager } from '@/engine/AssetManager';
import { eventBus } from '@/engine/EventBus';
import { SHADER_VARYINGS } from '@/engine/constants';
import { compileShader } from '@/engine/ShaderCompiler';
import { MaterialAsset, TextureAsset } from '@/types';

const TEXTURE_SIZE = 256;
const TEXTURE_LAYERS = 16;

function compileProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram | null {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('[MaterialPreview] shader compile failed', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };

  const vs = compile(gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vs || !fs) {
    if (vs) gl.deleteShader(vs);
    if (fs) gl.deleteShader(fs);
    return null;
  }

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[MaterialPreview] program link failed', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

function buildAssetMaterialVertexShader(compiledVertexLogic: string): string {
  const marker = '// --- Graph Body (VS) ---';
  const parts = compiledVertexLogic.split(marker);
  const globalLogic = (parts[0] || '').replace('// --- Global Functions (VS) ---', '');
  const graphBody = parts[1] || '';
  const varyings = SHADER_VARYINGS.map(v => `out ${v.type} ${v.name};`).join('\n');
  const defaults = SHADER_VARYINGS.map(v => `    ${v.name} = ${v.default};`).join('\n');

  return `#version 300 es
precision highp float;
precision highp sampler2DArray;
layout(location=0) in vec3 a_position;
layout(location=1) in vec3 a_normal;
layout(location=8) in vec2 a_uv;
layout(location=13) in vec3 a_vertexColor;
layout(location=14) in float a_softWeight;
uniform mat4 u_mvp;
uniform mat4 u_model;
uniform float u_time;
uniform vec3 u_cameraPos;
uniform sampler2DArray u_textures;
${varyings}
${globalLogic}
void main() {
${defaults}
    v_uv = a_uv;
    v_color = a_vertexColor;
    v_softWeight = a_softWeight;
    v_normal = normalize(mat3(u_model) * a_normal);
    v_objectPos = a_position;
    v_worldPos = (u_model * vec4(a_position, 1.0)).xyz;

    vec3 vertexOffset = vec3(0.0);
    ${graphBody}

    vec3 localPosition = a_position + vertexOffset;
    vec4 worldPosition = u_model * vec4(localPosition, 1.0);
    v_worldPos = worldPosition.xyz;
    gl_Position = u_mvp * vec4(localPosition, 1.0);
}`;
}

/**
 * Compiles project Material assets for a direct-to-canvas asset viewport.
 * Empty material id intentionally means "use host Standard Lambert fallback".
 */
export class MaterialPreviewRenderer {
  private program: WebGLProgram | null = null;
  private materialId = '';
  private materialRevision = -1;
  private textureArray: WebGLTexture | null = null;
  private disposed = false;
  private unsubscribeTextureLoaded: (() => void) | null = null;

  init(gl: WebGL2RenderingContext): void {
    this.disposed = false;
    const texture = gl.createTexture();
    if (!texture) return;
    this.textureArray = texture;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, TEXTURE_SIZE, TEXTURE_SIZE, TEXTURE_LAYERS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);

    // Keep every unused layer valid/white so materials without loaded textures
    // remain readable instead of sampling an incomplete texture array.
    const white = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
    white.fill(255);
    for (let layer = 0; layer < TEXTURE_LAYERS; layer++) {
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        0,
        0,
        layer,
        TEXTURE_SIZE,
        TEXTURE_SIZE,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        white,
      );
    }

    for (const asset of assetManager.getAssetsByType('TEXTURE')) {
      this.loadTextureAsset(gl, asset as TextureAsset);
    }
    this.unsubscribeTextureLoaded = eventBus.on('TEXTURE_LOADED', payload => {
      if (this.disposed || !this.textureArray || !payload?.image) return;
      this.uploadImage(gl, payload.layerIndex, payload.image as HTMLImageElement);
    });
  }

  private loadTextureAsset(gl: WebGL2RenderingContext, asset: TextureAsset): void {
    if (!asset.source || asset.layerIndex < 0 || asset.layerIndex >= TEXTURE_LAYERS) return;
    const image = new Image();
    image.onload = () => this.uploadImage(gl, asset.layerIndex, image);
    image.src = asset.source;
  }


  private uploadImage(gl: WebGL2RenderingContext, layerIndex: number, image: HTMLImageElement): void {
    if (this.disposed || !this.textureArray || layerIndex < 0 || layerIndex >= TEXTURE_LAYERS) return;
    const canvas = document.createElement('canvas');
    canvas.width = TEXTURE_SIZE;
    canvas.height = TEXTURE_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(image, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureArray);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layerIndex,
      TEXTURE_SIZE,
      TEXTURE_SIZE,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      canvas,
    );
  }

  setMaterial(gl: WebGL2RenderingContext, materialId: string, revision = 0): WebGLProgram | null {
    if (materialId === this.materialId && revision === this.materialRevision) return this.program;

    if (this.program) gl.deleteProgram(this.program);
    this.program = null;
    this.materialId = materialId;
    this.materialRevision = revision;
    if (!materialId) return null;

    const asset = assetManager.getAsset(materialId) as MaterialAsset | undefined;
    if (!asset || asset.type !== 'MATERIAL') return null;
    const compiled = compileShader(asset.data.nodes, asset.data.connections, {
      directToDisplay: true,
      singleTarget: true,
    });
    if (!compiled || typeof compiled === 'string') return null;

    const vertexSource = buildAssetMaterialVertexShader(compiled.vs);
    this.program = compileProgram(gl, vertexSource, compiled.fs);
    return this.program;
  }

  bindCommonUniforms(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    options: {
      mvp: Float32Array;
      model: Float32Array;
      cameraPosition: { x: number; y: number; z: number };
      renderMode: number;
      timeSeconds: number;
      lightDirection: readonly [number, number, number];
      lightColor: readonly [number, number, number];
      lightIntensity: number;
      softSelectionHeatmapVisible?: boolean;
    },
  ): void {
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_mvp'), false, options.mvp);
    gl.uniformMatrix4fv(gl.getUniformLocation(program, 'u_model'), false, options.model);
    gl.uniform1f(gl.getUniformLocation(program, 'u_time'), options.timeSeconds);
    gl.uniform3f(
      gl.getUniformLocation(program, 'u_cameraPos'),
      options.cameraPosition.x,
      options.cameraPosition.y,
      options.cameraPosition.z,
    );
    gl.uniform1i(gl.getUniformLocation(program, 'u_renderMode'), options.renderMode);
    gl.uniform3f(gl.getUniformLocation(program, 'u_lightDir'), ...options.lightDirection);
    gl.uniform3f(gl.getUniformLocation(program, 'u_lightColor'), ...options.lightColor);
    gl.uniform1f(gl.getUniformLocation(program, 'u_lightIntensity'), options.lightIntensity);
    gl.uniform1f(gl.getUniformLocation(program, 'u_showHeatmap'), options.softSelectionHeatmapVisible ? 1.0 : 0.0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_isParticle'), 0);

    if (this.textureArray) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureArray);
      gl.uniform1i(gl.getUniformLocation(program, 'u_textures'), 0);
    }
  }

  dispose(gl: WebGL2RenderingContext): void {
    this.disposed = true;
    this.unsubscribeTextureLoaded?.();
    this.unsubscribeTextureLoaded = null;
    if (this.program) gl.deleteProgram(this.program);
    if (this.textureArray) gl.deleteTexture(this.textureArray);
    this.program = null;
    this.textureArray = null;
  }
}
