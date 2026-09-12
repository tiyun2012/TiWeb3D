/**
 * Shared mesh-surface rendering contract used by the Scene renderer and 3D asset
 * preview viewports.
 *
 * The Scene pipeline renders linear color into an off-screen target and converts
 * it to display space in the composite pass. Asset previews render directly to
 * the canvas, so their preview shader performs the same display transfer at the
 * end of the fragment shader.
 */

export const MESH_SURFACE_RENDER_MODE = {
    LIT: 0,
    NORMALS: 1,
    UNLIT: 2,
} as const;

export type MeshSurfaceRenderMode =
    (typeof MESH_SURFACE_RENDER_MODE)[keyof typeof MESH_SURFACE_RENDER_MODE];

export type MeshSurfaceLight = {
    direction: readonly [number, number, number];
    color: readonly [number, number, number];
    intensity: number;
};

export type MeshSurfaceMaterial = {
    albedo: readonly [number, number, number];
    metallic: number;
    smoothness: number;
};

export const DEFAULT_MESH_SURFACE_MATERIAL: MeshSurfaceMaterial = {
    albedo: [0.8, 0.8, 0.8],
    metallic: 0.0,
    smoothness: 0.5,
};

/** Neutral preview light. Hosts may override it, but the shading math stays shared. */
export const DEFAULT_MESH_PREVIEW_LIGHT: MeshSurfaceLight = {
    direction: [0.5, -1.0, 0.5],
    color: [1.0, 1.0, 1.0],
    intensity: 1.0,
};

/** Linear background used by the Scene off-screen targets. */
export const VIEWPORT_BACKGROUND_LINEAR_COLOR = [0.1, 0.1, 0.1, 1.0] as const;

export function linearToDisplayChannel(value: number): number {
    return Math.pow(Math.max(0, value), 1.0 / 2.2);
}

/** Direct-to-canvas previews must clear in display space because no composite pass follows. */
export const VIEWPORT_BACKGROUND_DISPLAY_COLOR = [
    linearToDisplayChannel(VIEWPORT_BACKGROUND_LINEAR_COLOR[0]),
    linearToDisplayChannel(VIEWPORT_BACKGROUND_LINEAR_COLOR[1]),
    linearToDisplayChannel(VIEWPORT_BACKGROUND_LINEAR_COLOR[2]),
    VIEWPORT_BACKGROUND_LINEAR_COLOR[3],
] as const;

/**
 * Scene rendering goes through non-multisampled off-screen FBOs, so enabling
 * canvas MSAA only in an asset editor creates false visual parity. Keep the
 * context contract shared; component overlays still use their own explicit
 * antialias-friendly screen-space sizes.
 */
export const VIEWPORT_WEBGL_CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
    alpha: false,
    antialias: false,
    powerPreference: 'high-performance',
};

/** Linear-light -> display transfer. Shared by Scene composite and direct previews. */
export const DISPLAY_TRANSFER_GLSL = `
vec3 linearToDisplay(vec3 linearColor) {
    return pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.2));
}
`;


/** Built-in neutral fallback used when no project Material asset is assigned. */
export const LAMBERT_SURFACE_GLSL = `
vec3 shadeLambertSurface(
    vec3 N,
    vec3 lightDir,
    vec3 albedo,
    vec3 lightColor,
    float lightIntensity
) {
    vec3 L = normalize(-lightDir);
    float diffuse = max(dot(N, L), 0.0);
    float hemi = max(0.0, 0.5 + 0.5 * N.y);
    vec3 ambient = vec3(0.10) + vec3(0.10, 0.10, 0.20) * hemi;
    return ambient * albedo + diffuse * albedo * lightColor * lightIntensity;
}
`;

/**
 * Standard/PBR BRDF used by generated project Material graphs. The no-material
 * Scene/asset fallback intentionally uses LAMBERT_SURFACE_GLSL instead.
 *
 * IMPORTANT: this function returns LINEAR color. Do not apply display gamma here.
 */
export const STANDARD_SURFACE_GLSL = `
const float MESH_PI = 3.14159265359;

float meshDistributionGGX(vec3 N, vec3 H, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;
    float num = a2;
    float denom = NdotH2 * (a2 - 1.0) + 1.0;
    denom = MESH_PI * denom * denom;
    return num / max(denom, 0.0000001);
}

float meshGeometrySchlickGGX(float NdotV, float roughness) {
    float r = roughness + 1.0;
    float k = (r * r) / 8.0;
    return NdotV / (NdotV * (1.0 - k) + k);
}

float meshGeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    return meshGeometrySchlickGGX(max(dot(N, V), 0.0), roughness) *
           meshGeometrySchlickGGX(max(dot(N, L), 0.0), roughness);
}

vec3 meshFresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

vec3 meshFakeIBL(vec3 N, vec3 V, float roughness, vec3 F0, vec3 albedo, float metallic) {
    vec3 R = reflect(-V, N);
    float skyMix = smoothstep(-0.2, 0.2, R.y);
    vec3 skyColor = vec3(0.3, 0.5, 0.8) * 1.2;
    vec3 groundColor = vec3(0.1, 0.1, 0.1);
    vec3 envColor = mix(groundColor, skyColor, skyMix) * (1.0 - roughness * 0.5);
    vec3 F = meshFresnelSchlick(max(dot(N, V), 0.0), F0);
    return mix(
        envColor * albedo * (vec3(1.0) - F) * (1.0 - metallic) * 0.2,
        envColor * F * (1.0 - roughness),
        1.0
    );
}

vec3 shadeStandardSurface(
    vec3 N,
    vec3 V,
    vec3 lightDir,
    vec3 albedo,
    float metallic,
    float roughness,
    vec3 lightColor,
    float lightIntensity
) {
    vec3 L = normalize(-lightDir);
    vec3 H = normalize(V + L);
    vec3 F0 = mix(vec3(0.04), albedo, metallic);
    float NDF = meshDistributionGGX(N, H, roughness);
    float G = meshGeometrySmith(N, V, L, roughness);
    vec3 F = meshFresnelSchlick(max(dot(H, V), 0.0), F0);
    vec3 specular = (NDF * G * F) /
        (4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001);
    vec3 directLight = (
        (vec3(1.0) - F) * (1.0 - metallic) * albedo / MESH_PI + specular
    ) * lightColor * lightIntensity * max(dot(N, L), 0.0);

    return directLight + meshFakeIBL(N, V, roughness, F0, albedo, metallic);
}
`;

export const ASSET_MESH_SURFACE_VS = `#version 300 es
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
uniform mat4 u_mvp;
uniform mat4 u_model;
out vec3 v_normal;
out vec3 v_worldPos;
void main() {
    vec4 worldPos = u_model * vec4(a_pos, 1.0);
    v_worldPos = worldPos.xyz;
    v_normal = normalize(mat3(u_model) * a_normal);
    gl_Position = u_mvp * vec4(a_pos, 1.0);
}`;

export const ASSET_MESH_SURFACE_FS = `#version 300 es
precision highp float;
in vec3 v_normal;
in vec3 v_worldPos;
uniform vec3 u_cameraPos;
uniform vec3 u_lightDir;
uniform vec3 u_lightColor;
uniform float u_lightIntensity;
uniform vec3 u_albedo;
uniform float u_metallic;
uniform float u_smoothness;
uniform int u_renderMode;
out vec4 outColor;

${LAMBERT_SURFACE_GLSL}
${DISPLAY_TRANSFER_GLSL}

void main() {
    vec3 N = normalize(v_normal);
    vec3 V = normalize(u_cameraPos - v_worldPos);
    vec3 linearColor;

    if (u_renderMode == ${MESH_SURFACE_RENDER_MODE.NORMALS}) {
        linearColor = N * 0.5 + 0.5;
    } else if (u_renderMode == ${MESH_SURFACE_RENDER_MODE.UNLIT}) {
        linearColor = u_albedo;
    } else {
        linearColor = shadeLambertSurface(
            N,
            u_lightDir,
            u_albedo,
            u_lightColor,
            u_lightIntensity
        );
    }

    outColor = vec4(linearToDisplay(linearColor), 1.0);
}`;

export type ApplyMeshSurfaceUniformsOptions = {
    cameraPosition: { x: number; y: number; z: number };
    renderMode: number;
    light?: MeshSurfaceLight;
    material?: MeshSurfaceMaterial;
};

/** Bind the shared preview-surface uniforms without making hosts know shader names. */
export function applyMeshSurfaceUniforms(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    options: ApplyMeshSurfaceUniformsOptions,
): void {
    const light = options.light ?? DEFAULT_MESH_PREVIEW_LIGHT;
    const material = options.material ?? DEFAULT_MESH_SURFACE_MATERIAL;

    const uniform3 = (name: string, value: readonly [number, number, number]) => {
        const location = gl.getUniformLocation(program, name);
        if (location !== null) gl.uniform3f(location, value[0], value[1], value[2]);
    };
    const uniform1f = (name: string, value: number) => {
        const location = gl.getUniformLocation(program, name);
        if (location !== null) gl.uniform1f(location, value);
    };
    const uniform1i = (name: string, value: number) => {
        const location = gl.getUniformLocation(program, name);
        if (location !== null) gl.uniform1i(location, value);
    };

    uniform3('u_cameraPos', [
        options.cameraPosition.x,
        options.cameraPosition.y,
        options.cameraPosition.z,
    ]);
    uniform3('u_lightDir', light.direction);
    uniform3('u_lightColor', light.color);
    uniform1f('u_lightIntensity', light.intensity);
    uniform3('u_albedo', material.albedo);
    uniform1f('u_metallic', material.metallic);
    uniform1f('u_smoothness', material.smoothness);
    uniform1i('u_renderMode', options.renderMode);
}
