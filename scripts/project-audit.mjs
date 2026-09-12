import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const warnings = [];

const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const tsconfig = JSON.parse(read('tsconfig.json'));
assert(tsconfig.compilerOptions?.strict === true, 'tsconfig.json must keep compilerOptions.strict=true');
assert(!('baseUrl' in (tsconfig.compilerOptions ?? {})), 'tsconfig.json must not use deprecated compilerOptions.baseUrl; paths are resolved relative to tsconfig');
assert(
  tsconfig.compilerOptions?.forceConsistentCasingInFileNames === true,
  'tsconfig.json must keep compilerOptions.forceConsistentCasingInFileNames=true',
);
assert(
  Array.isArray(tsconfig.exclude) && tsconfig.exclude.includes('drafts'),
  'tsconfig.json must exclude drafts/ from production type-checking',
);

const indexHtml = read('index.html');
assert(!/<script\s+[^>]*type=["']importmap["']/i.test(indexHtml), 'index.html must not contain a CDN import map');
assert(!indexHtml.includes('cdn.tailwindcss.com'), 'index.html must use local Tailwind/PostCSS instead of the Tailwind CDN runtime');
assert(exists('tailwind.config.cjs'), 'tailwind.config.cjs must exist for local Tailwind builds');
assert(exists('postcss.config.cjs'), 'postcss.config.cjs must exist for local Tailwind/PostCSS builds');
const indexCss = read('index.css');
assert(indexCss.includes('@tailwind base;') && indexCss.includes('@tailwind utilities;'), 'index.css must include Tailwind build directives');

for (const editor of ['editor/components/StaticMeshEditor.tsx', 'editor/components/SkeletonEditor.tsx']) {
  const source = read(editor);
  assert(source.includes('AssetViewport3D'), `${editor} must reuse AssetViewport3D`);
  assert(source.includes('AssetEditorTemplate'), `${editor} must reuse AssetEditorTemplate`);
  assert(source.includes('assetType={currentAsset.type}') || source.includes('assetType={editorAsset.type}'), `${editor} must pass its asset type to the shared viewport/frame`);
}

assert(exists('editor/components/SkeletalMeshEditor.tsx'), 'SkeletalMeshEditor must exist');
const skeletalMeshEditor = read('editor/components/SkeletalMeshEditor.tsx');
assert(
  skeletalMeshEditor.includes('StaticMeshEditor') && skeletalMeshEditor.includes('SkeletonEditor'),
  'SkeletalMeshEditor must expose both geometry and skeleton workspaces',
);

assert(exists('editor/components/asset-editor/AssetEditorTemplate.tsx'), 'AssetEditorTemplate must exist');
assert(exists('editor/components/asset-editor/assetViewportCapabilities.ts'), 'asset viewport capability registry must exist');
assert(exists('editor/components/asset-editor/MeshAssetHierarchy.tsx'), 'MeshAssetHierarchy must exist');
assert(exists('editor/components/asset-editor/MeshAssetInspector.tsx'), 'MeshAssetInspector must exist');
const toolOptionsPanel = read('editor/components/ToolOptionsPanel.tsx');
for (const unsupportedSpace of ['Gimbal', 'VirtualPivot', 'Parent', 'Normal', 'Average']) {
  assert(!toolOptionsPanel.includes(`value: '${unsupportedSpace}'`), `ToolOptionsPanel must not expose unsupported TransformSpace ${unsupportedSpace}`);
}

const assetViewport = read('editor/components/AssetViewport3D.tsx');
assert(assetViewport.includes('assetViewportAllows'), 'AssetViewport3D must capability-filter viewport actions');
assert(assetViewport.includes('toolbarActions'), 'AssetViewport3D must render asset toolbar actions through descriptors');
const projectPanel = read('editor/components/ProjectPanel.tsx');
assert(exists('editor/AssetEditorRegistry.ts'), 'AssetEditorRegistry must exist for Content Browser double-click routing');
assert(exists('editor/BuiltInAssetEditors.tsx'), 'BuiltInAssetEditors must exist');
const builtInAssetEditors = read('editor/BuiltInAssetEditors.tsx');
assert(
  builtInAssetEditors.includes("type: 'SKELETAL_MESH'") && builtInAssetEditors.includes('<SkeletalMeshEditor assetId={asset.id} />'),
  'SKELETAL_MESH assets must route through SkeletalMeshEditor via AssetEditorRegistry',
);
assert(
  builtInAssetEditors.includes("type: 'CAMERA_PRESET'") && builtInAssetEditors.includes('<CameraPresetEditor assetId={asset.id} />'),
  'CAMERA_PRESET must register CameraPresetEditor for double-click opening',
);
assert(
  projectPanel.includes('assetEditorRegistry.get(asset.type)') &&
    !projectPanel.includes("asset.type === 'CAMERA_PRESET'") &&
    !projectPanel.includes('<StaticMeshEditor') &&
    !projectPanel.includes('<SkeletonEditor'),
  'ProjectPanel must resolve asset editors through AssetEditorRegistry instead of hardcoded editor components',
);

assert(exists('editor/components/viewport/ViewportTemplate.tsx'), 'ViewportTemplate must exist');
assert(exists('editor/viewports/viewportCamera.ts'), 'shared viewportCamera utilities must exist');
for (const host of ['editor/components/AssetViewport3D.tsx', 'editor/components/SceneView.tsx']) {
  const source = read(host);
  assert(source.includes('ViewportTemplate'), `${host} must compose through ViewportTemplate`);
  assert(source.includes('viewportCamera'), `${host} must reuse shared viewportCamera utilities`);
}

const sceneView = read('editor/components/SceneView.tsx');
assert(
  sceneView.includes("window.addEventListener('mouseup', handleGlobalMouseUp)"),
  'SceneView rectangle selection must finalize through the global mouseup path so edge/corner releases are not lost',
);
assert(
  sceneView.includes('rect.width,') && sceneView.includes('rect.height,'),
  'SceneView rectangle selection must pass live viewport CSS dimensions to SelectionSystem',
);
assert(
  sceneView.includes('pendingObjectPressRef') &&
    sceneView.includes('MARQUEE_DRAG_THRESHOLD_PX') &&
    sceneView.includes('No drag threshold was crossed: this was a true click'),
  'SceneView object picking must defer click commitment until mouseup so mesh/bone ray hits do not block marquee drag starts',
);
const debugRendererSource = read('engine/renderers/DebugRenderer.ts');
assert(
  debugRendererSource.includes('const baseRadius = parentRadius * widthScale'),
  'Bone visual width must derive from the parent joint radius',
);
assert(
  debugRendererSource.includes('const baseDist = parentRadius * baseOffsetScale') &&
    debugRendererSource.includes('const tipDist = len - childRadius'),
  'Bone geometry must render between the parent and child joint surfaces instead of from joint centers',
);
assert(
  debugRendererSource.includes('rotateByShortestArc(restRight, restForward, liveForward, restUp)'),
  'Bone geometry must swing with the live child direction while transporting parent-local roll without arbitrary twist',
);
assert(
  !debugRendererSource.includes('Math.min(len * 0.12'),
  'Bone visual width must not scale with parent-child distance',
);
const skeletonEditorSource = read('editor/components/SkeletonEditor.tsx');
assert(
  skeletonEditorSource.includes('boneVisualRestDirectionsRef') && skeletonEditorSource.includes('transformLocalDirectionByAxes'),
  'SkeletonEditor must keep a stable parent-local visual rest direction while translating child joints',
);
assert(
  skeletonEditorSource.includes('editBonesRef') &&
    skeletonEditorSource.includes('beginSkeletonEdit') &&
    skeletonEditorSource.includes('confirmSkeletonEdit') &&
    skeletonEditorSource.includes('cancelSkeletonEdit') &&
    skeletonEditorSource.includes('editAssetIdRef.current !== assetId') &&
    skeletonEditorSource.includes('if (!isEditMode'),
  'SkeletonEditor must keep skeleton edits in a private draft until explicit Confirm/Cancel',
);
assert(
  skeletonEditorSource.includes("allowedTools={isEditMode ? ['SELECT', 'MOVE', 'ROTATE', 'SCALE'] : ['SELECT']}") &&
    skeletonEditorSource.includes('gizmoSystem={isEditMode ? gizmoSystem : null}'),
  'SkeletonEditor must lock transform tools/gizmos outside skeleton edit mode',
);
const skeletonEditorAssetUpdateCalls = skeletonEditorSource.match(/assetManager\.updateAsset\(/g) ?? [];
assert(
  skeletonEditorAssetUpdateCalls.length === 1 &&
    skeletonEditorSource.indexOf('assetManager.updateAsset(') > skeletonEditorSource.indexOf('const confirmSkeletonEdit'),
  'SkeletonEditor must persist its skeleton draft only from explicit Confirm',
);
assert(
  assetViewport.includes('allowedTools?: readonly ToolType[]') && assetViewport.includes('const toolAllowed ='),
  'AssetViewport3D must support reusable host-scoped tool filtering',
);
const inputControlsSource = read('editor/components/ui/InputControls.tsx');
assert(
  !inputControlsSource.includes('React.useEffect(() => {\n    if (!isFocused)'),
  'DraggableNumber must not mirror unfocused numeric props through a passive setState effect',
);
const skeletonToolSource = read('engine/tools/SkeletonTool.ts');
assert(
  skeletonToolSource.includes('visualRestDirections') && skeletonToolSource.includes("'normal'"),
  'SkeletonTool must cache visual rest directions and derive bone thickness from the normal parent joint radius',
);


assert(exists('engine/MeshEdgeGeometry.ts'), 'shared MeshEdgeGeometry must exist');
assert(exists('editor/viewports/MeshEdgeOverlay.ts'), 'shared MeshEdgeOverlay must exist');
assert(exists('editor/viewports/MeshVertexOverlay.ts'), 'shared MeshVertexOverlay must exist');
assert(exists('engine/MeshComponentVisualStyle.ts'), 'shared MeshComponentVisualStyle must exist');
const meshEdgeGeometrySource = read('engine/MeshEdgeGeometry.ts');
assert(
  meshEdgeGeometrySource.includes('forEachUniqueMeshEdge') &&
    meshEdgeGeometrySource.includes('buildMeshEdgeIndices') &&
    meshEdgeGeometrySource.includes('meshEdgeKey'),
  'MeshEdgeGeometry must remain the canonical edge identity/extraction contract',
);
const staticMeshEditorSource = read('editor/components/StaticMeshEditor.tsx');
assert(
  staticMeshEditorSource.includes('MeshEdgeOverlay') &&
    staticMeshEditorSource.includes('MeshVertexOverlay') &&
    staticMeshEditorSource.includes('buildMeshEdgeIndices') &&
    staticMeshEditorSource.includes('collectFaceEdgeKeys') &&
    !staticMeshEditorSource.includes('function buildWireframeIndices'),
  'StaticMeshEditor must reuse shared polygon-edge extraction plus shared edge/vertex component overlays',
);
assert(
  skeletonEditorSource.includes('meshEdgeOverlay') &&
    skeletonEditorSource.includes('buildMeshEdgeIndices') &&
    skeletonEditorSource.includes('gl.colorMask(false, false, false, false)'),
  'SkeletonEditor associated-mesh wireframe must reuse the shared edge overlay with a hidden-line depth prepass',
);
const meshEdgeOverlaySource = read('editor/viewports/MeshEdgeOverlay.ts');
assert(
  meshEdgeOverlaySource.includes('gl.depthMask(false)') && meshEdgeOverlaySource.includes('gl.depthFunc(gl.LEQUAL)'),
  'MeshEdgeOverlay must not let the dim cage depth-block selected edge/face highlight passes',
);
const meshVertexOverlaySource = read('editor/viewports/MeshVertexOverlay.ts');
assert(
  meshVertexOverlaySource.includes('gl.POINTS') &&
    meshVertexOverlaySource.includes('drawSelected') &&
    meshVertexOverlaySource.includes('drawHovered'),
  'MeshVertexOverlay must render base, selected, and hovered vertex points',
);
assert(exists('engine/renderers/MeshSurfaceContract.ts'), 'shared MeshSurfaceContract must exist');
const meshSurfaceContractSource = read('engine/renderers/MeshSurfaceContract.ts');
assert(
  meshSurfaceContractSource.includes('STANDARD_SURFACE_GLSL') &&
    meshSurfaceContractSource.includes('LAMBERT_SURFACE_GLSL') &&
    meshSurfaceContractSource.includes('DISPLAY_TRANSFER_GLSL') &&
    meshSurfaceContractSource.includes('applyMeshSurfaceUniforms') &&
    meshSurfaceContractSource.includes('VIEWPORT_BACKGROUND_LINEAR_COLOR') &&
    meshSurfaceContractSource.includes('VIEWPORT_BACKGROUND_DISPLAY_COLOR'),
  'MeshSurfaceContract must own shared surface shading, display transfer, and direct-vs-linear background rules',
);
const shaderCompilerSource = read('engine/ShaderCompiler.ts');
assert(
  shaderCompilerSource.includes('STANDARD_SURFACE_GLSL') && shaderCompilerSource.includes('shadeStandardSurface('),
  'generated Standard materials must reuse the shared Standard surface BRDF',
);
const meshRenderSystemSource = read('engine/systems/MeshRenderSystem.ts');
assert(
  meshRenderSystemSource.includes('LAMBERT_SURFACE_GLSL') && meshRenderSystemSource.includes('shadeLambertSurface('),
  'Scene fallback mesh shading must reuse the shared Standard Lambert fallback',
);
assert(
  meshRenderSystemSource.includes('assetMaterialId') && meshRenderSystemSource.includes('assetManager.getMaterialID(assetMaterialId)'),
  'Scene mesh buckets must inherit the mesh asset material when the entity has no override',
);
assert(exists('engine/renderers/MaterialPreviewRenderer.ts'), 'shared MaterialPreviewRenderer must exist');
const materialPreviewSource = read('engine/renderers/MaterialPreviewRenderer.ts');
assert(
  materialPreviewSource.includes('compileShader') &&
    materialPreviewSource.includes('directToDisplay: true') &&
    materialPreviewSource.includes('singleTarget: true'),
  'asset material preview must compile project materials for direct-to-canvas rendering',
);
assert(exists('editor/components/inspector/MaterialSlotField.tsx'), 'shared MaterialSlotField must exist');
const materialSlotSource = read('editor/components/inspector/MaterialSlotField.tsx');
const materialCoreModulesSource = read('engine/modules/CoreModules.tsx');
const materialMeshAssetInspectorSource = read('editor/components/asset-editor/MeshAssetInspector.tsx');
assert(
  materialSlotSource.includes('Standard Lambert') &&
    materialCoreModulesSource.includes('<MaterialSlotField') &&
    materialMeshAssetInspectorSource.includes('<MaterialSlotField'),
  'Scene and mesh asset inspectors must reuse MaterialSlotField for material assignment',
);
const webglRendererSource = read('engine/renderers/WebGLRenderer.ts');
assert(
  webglRendererSource.includes('DISPLAY_TRANSFER_GLSL') &&
    webglRendererSource.includes('linearToDisplay(baseColor)') &&
    webglRendererSource.includes('VIEWPORT_WEBGL_CONTEXT_ATTRIBUTES') &&
    webglRendererSource.includes('VIEWPORT_BACKGROUND_LINEAR_COLOR'),
  'Scene renderer must reuse shared display/context/background contracts',
);
assert(
  webglRendererSource.includes('Per-object effects are part of the post-process contract'),
  'Post Process Off must bypass per-object effects while retaining display transfer',
);
assert(
  assetViewport.includes('ASSET_MESH_SURFACE_VS') &&
    assetViewport.includes('ASSET_MESH_SURFACE_FS') &&
    assetViewport.includes('VIEWPORT_BACKGROUND_DISPLAY_COLOR') &&
    assetViewport.includes('VIEWPORT_WEBGL_CONTEXT_ATTRIBUTES') &&
    assetViewport.includes('linearToDisplay(u_color.rgb)'),
  'AssetViewport3D must reuse shared surface/color/context contracts for direct rendering',
);
assert(
  staticMeshEditorSource.includes('applyMeshSurfaceUniforms') &&
    staticMeshEditorSource.includes('MESH_SURFACE_RENDER_MODE.UNLIT') &&
    !staticMeshEditorSource.includes("label: 'Flat'"),
  'StaticMeshEditor must use shared surface uniforms and Scene-compatible Lit/Normals/Unlit IDs',
);
assert(
  skeletonEditorSource.includes('applyMeshSurfaceUniforms'),
  'SkeletonEditor associated mesh preview must reuse the shared mesh surface contract',
);

const meshComponentVisualStyleSource = read('engine/MeshComponentVisualStyle.ts');
assert(
  meshComponentVisualStyleSource.includes('getMeshVertexPointSizes') &&
    meshComponentVisualStyleSource.includes('getViewportPixelRatio'),
  'mesh vertex marker size must use the shared CSS-pixel/DPR sizing contract',
);
const coreModulesSource = read('engine/modules/CoreModules.tsx');
assert(
  coreModulesSource.includes('forEachUniqueMeshEdge') && coreModulesSource.includes('collectFaceEdgeKeys'),
  'Scene mesh overlays must reuse unique polygon edges and shared selected-face boundaries',
);
assert(
  staticMeshEditorSource.includes('getMeshVertexPointSizes') &&
    coreModulesSource.includes('getMeshVertexPointSizes'),
  'Scene and StaticMeshEditor vertex markers must share one point-size policy',
);
for (const edgeKeyConsumer of [
  'engine/MeshTopologyUtils.ts',
  'engine/systems/SelectionSystem.ts',
  'editor/components/SceneView.tsx',
  'editor/components/StaticMeshEditor.tsx',
]) {
  assert(read(edgeKeyConsumer).includes('meshEdgeKey'), `${edgeKeyConsumer} must use the canonical meshEdgeKey`);
}

const selectionSystem = read('engine/systems/SelectionSystem.ts');
assert(
  !selectionSystem.includes('if (aabbT < closestDist)'),
  'SelectionSystem must not compare local-space AABB distance against world-space closest-hit distance',
);
assert(
  selectionSystem.includes('meshOverlapsScreenRect') && selectionSystem.includes('preciseOverlap'),
  'SelectionSystem marquee picking must refine projected mesh AABB candidates against projected mesh triangles',
);
const viewportTemplate = read('editor/components/viewport/ViewportTemplate.tsx');
assert(
  viewportTemplate.includes('onMouseDown={(event) => event.stopPropagation()}'),
  'Viewport toolbar chrome must stop mousedown propagation so toolbar clicks do not trigger scene selection',
);


assert(exists('editor/inspector/InspectorSchema.ts'), 'InspectorSchema must exist');
assert(exists('editor/inspector/InspectorRegistry.ts'), 'InspectorRegistry must exist');
assert(exists('editor/components/inspector/AutoInspector.tsx'), 'AutoInspector must exist');
assert(exists('engine/modules/CoreInspectorSchemas.ts'), 'core inspector schemas must exist');
assert(exists('engine/postprocess/PostProcessProfile.ts'), 'PostProcessProfile resolver must exist');
const coreInspectorSchemas = read('engine/modules/CoreInspectorSchemas.ts');
assert(
  coreInspectorSchemas.includes("id: 'CameraSettings'") &&
    coreInspectorSchemas.includes("id: 'CameraComponent'") &&
    coreInspectorSchemas.includes("assetTypes: ['POST_PROCESS_PROFILE']") &&
    coreInspectorSchemas.includes("assetTypes: ['CAMERA_PRESET']"),
  'Camera component/preset inspectors must reuse registered schemas with typed asset slots',
);
assert(
  coreModulesSource.includes('schemaId="CameraComponent"') && coreModulesSource.includes('schemaId="Light"'),
  'Camera and Light Scene components must use AutoInspector schemas instead of duplicated property UIs',
);
const postProcessProfileSource = read('engine/postprocess/PostProcessProfile.ts');
assert(
  postProcessProfileSource.includes('viewportProfileId') &&
    postProcessProfileSource.includes('postProcessProfileId') &&
    postProcessProfileSource.includes('sceneProfileId'),
  'post-process profile resolution must preserve Viewport -> Camera -> Scene precedence',
);
assert(
  read('types.ts').includes("| 'CAMERA_PRESET'") && read('types.ts').includes("| 'POST_PROCESS_PROFILE'"),
  'Camera Preset and Post Process Profile must remain first-class asset types',
);
assert(exists('engine/AssetTypeRegistry.ts'), 'AssetTypeRegistry must exist');
assert(exists('engine/BuiltInAssetTypes.ts'), 'built-in asset type registrations must exist');
const assetTypeRegistrySource = read('engine/AssetTypeRegistry.ts');
const builtInAssetTypesSource = read('engine/BuiltInAssetTypes.ts');
assert(
  assetTypeRegistrySource.includes('getCreatable()') &&
    assetTypeRegistrySource.includes('create(type: AssetType') &&
    assetTypeRegistrySource.includes('subscribe(listener: RegistryListener)'),
  'AssetTypeRegistry must expose creatable definitions, a generic create API, and runtime subscriptions',
);
assert(
  builtInAssetTypesSource.includes("type: 'CAMERA_PRESET'") &&
    builtInAssetTypesSource.includes('assetManager.createCameraPreset') &&
    builtInAssetTypesSource.includes("type: 'POST_PROCESS_PROFILE'"),
  'Camera Preset and Post Process Profile creation must be registered through BuiltInAssetTypes',
);
assert(
  projectPanel.includes('assetTypeRegistry.getCreatable()') &&
    projectPanel.includes('assetTypeRegistry.create(type, { path: currentPath })') &&
    projectPanel.includes('assetTypeRegistry.subscribe('),
  'ProjectPanel Create UI must be generated from and subscribed to AssetTypeRegistry',
);
assert(
  !projectPanel.includes("if (type === 'CAMERA_PRESET') assetManager.createCameraPreset") &&
    !projectPanel.includes("if (type === 'POST_PROCESS_PROFILE') assetManager.createPostProcessProfile"),
  'ProjectPanel must not reintroduce hardcoded asset creation factories',
);
assert(
  read('index.tsx').includes('registerBuiltInAssetTypes();'),
  'built-in asset types must register during application bootstrap before editor UI mounts',
);
assert(
  read('index.tsx').includes('registerBuiltInAssetEditors();'),
  'built-in asset editors must register during application bootstrap before Content Browser interaction',
);
assert(exists('editor/components/CameraPresetEditor.tsx'), 'CameraPresetEditor must exist');
const cameraPresetEditorSource = read('editor/components/CameraPresetEditor.tsx');
assert(
  cameraPresetEditorSource.includes('AssetViewport3D') &&
    cameraPresetEditorSource.includes('AssetEditorTemplate') &&
    cameraPresetEditorSource.includes('schemaId="CameraSettings"'),
  'CameraPresetEditor must reuse AssetViewport3D, AssetEditorTemplate, and the shared CameraSettings schema',
);
assert(
  read('editor/components/asset-editor/assetViewportCapabilities.ts').includes('CAMERA_PRESET') &&
    read('editor/components/asset-editor/assetViewportCapabilities.ts').includes('hasHierarchy: false'),
  'Camera Preset editor capabilities must keep hierarchy disabled while retaining inspector support',
);
assert(
  read('engine/ecs/EntitySystem.ts').includes('ComponentType.CAMERA') &&
    read('engine/ecs/ComponentStorage.ts').includes('cameraPostProcessProfileId'),
  'Camera must remain a first-class ECS component with serialized camera/post-process fields',
);

assert(exists('engine/camera/CameraResolver.ts'), 'CameraResolver must exist');
const cameraResolverSource = read('engine/camera/CameraResolver.ts');
assert(
  cameraResolverSource.includes("controlMode === 'RUNTIME'") &&
    cameraResolverSource.includes("controlMode === 'CINEMATIC'") &&
    cameraResolverSource.includes("configSource === 'PRESET'"),
  'CameraResolver must preserve separate base-source and runtime/cinematic driver layers',
);
assert(
  read('types.ts').includes("CameraConfigSource = 'LOCAL' | 'PRESET'") &&
    read('types.ts').includes("CameraControlMode = 'MANUAL' | 'RUNTIME' | 'CINEMATIC'"),
  'Camera source/control mode enums must remain explicit',
);
assert(
  read('engine/ecs/ComponentStorage.ts').includes('cameraConfigSource') &&
    read('engine/ecs/ComponentStorage.ts').includes('cameraControlMode') &&
    read('engine/ecs/EntitySystem.ts').includes('get configSource()') &&
    read('engine/ecs/EntitySystem.ts').includes('get controlMode()'),
  'Camera source/control modes must remain serialized ECS fields',
);
assert(
  coreInspectorSchemas.includes("path: 'configSource'") &&
    coreInspectorSchemas.includes("path: 'controlMode'") &&
    coreInspectorSchemas.includes("value: 'CINEMATIC'"),
  'Camera Inspector must expose source and Manual/Runtime/Cinematic control modes',
);
assert(
  cameraPresetEditorSource.includes("'THROUGH_CAMERA'") &&
    cameraPresetEditorSource.includes("'INSPECT_CAMERA'") &&
    cameraPresetEditorSource.includes('projectionSettings={previewMode'),
  'CameraPresetEditor must offer Through Camera and Inspect Camera preview modes',
);
assert(
  assetViewport.includes('projectionSettings?:') && assetViewport.includes('Mat4Utils.orthographic('),
  'AssetViewport3D must support reusable perspective/orthographic projection overrides',
);
assert(
  assetTypeRegistrySource.includes('contentVisibility') &&
    assetTypeRegistrySource.includes('isVisibleInContentBrowser') &&
    projectPanel.includes('assetTypeRegistry.isVisibleInContentBrowser(a.type)'),
  'Content Browser visibility must be controlled by AssetTypeRegistry metadata, not editability',
);
assert(
  read('engine/api/EngineAPI.ts').includes('setRuntimeOverride') &&
    read('engine/api/EngineAPI.ts').includes('setCinematicOverride') &&
    read('engine/api/createEngineAPI.ts').includes('getResolvedCamera'),
  'EngineAPI must expose camera runtime/cinematic driver overrides and resolved-camera queries',
);

const engineSource = read('engine/engine.ts');
assert(
  engineSource.includes("camera.configSource = 'PRESET'") &&
    !engineSource.includes('Object.assign(camera, asset.data)'),
  'placing a Camera Preset must keep a live preset reference instead of copying preset settings into the Camera component',
);
assert(
  coreModulesSource.includes("if (presetId) onUpdate('configSource', 'PRESET')") &&
    coreModulesSource.includes('Preserve the current preset appearance when detaching to local editing'),
  'Camera Inspector must assign presets by reference and copy only when explicitly detaching to Local',
);

const sourceFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'drafts' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(full);
  }
};
walk(root);

const importPattern = /(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const candidatesFor = (base) => [
  base,
  `${base}.ts`,
  `${base}.tsx`,
  `${base}.js`,
  `${base}.jsx`,
  path.join(base, 'index.ts'),
  path.join(base, 'index.tsx'),
  path.join(base, 'index.js'),
  path.join(base, 'index.jsx'),
];

for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8');
  assert(!source.includes('selectionSystem.selectedEntityIds'), `${path.relative(root, file)} uses stale SelectionSystem.selectedEntityIds; use selectedEntities or selectedIndices`);
  assert(!source.includes('.sceneGraph.detach('), `${path.relative(root, file)} uses nonexistent SceneGraph.detach; use sceneGraph.attach(childId, null)`);
  assert(!source.includes('.ecs.setName('), `${path.relative(root, file)} uses nonexistent SoAEntitySystem.setName; update the entity proxy/store through the supported API`);
  assert(!source.includes('name="Tool"'), `${path.relative(root, file)} uses invalid Lucide icon name Tool; use a valid icon such as Wrench`);
  for (const match of source.matchAll(importPattern)) {
    const spec = match[1];
    if (!(spec.startsWith('.') || spec.startsWith('@/'))) continue;
    const base = spec.startsWith('@/')
      ? path.join(root, spec.slice(2))
      : path.resolve(path.dirname(file), spec);
    if (!candidatesFor(base).some(fs.existsSync)) {
      failures.push(`${path.relative(root, file)} has unresolved local import: ${spec}`);
    }
  }
}

// Lightweight JSX accessibility scan. This intentionally warns rather than fails because
// some labels are injected through wrapper components and require semantic review.
const interactiveTag = /<(button|input|select)\b/g;
for (const file of sourceFiles.filter((f) => f.endsWith('.tsx'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(interactiveTag)) {
    const start = match.index;
    let i = start;
    let braceDepth = 0;
    let quote = null;
    let escaped = false;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') quote = ch;
      else if (ch === '{') braceDepth++;
      else if (ch === '}' && braceDepth > 0) braceDepth--;
      else if (ch === '>' && braceDepth === 0) break;
    }
    const tag = source.slice(start, i + 1);
    if (!tag.includes('title=') || !tag.includes('aria-label=')) {
      const line = source.slice(0, start).split('\n').length;
      warnings.push(`${path.relative(root, file)}:${line} ${match[1]} is missing title or aria-label`);
    }
  }
}

console.log(`Project audit: ${sourceFiles.length} TypeScript source files checked.`);
if (warnings.length) {
  console.log(`Accessibility warnings: ${warnings.length}`);
  for (const warning of warnings.slice(0, 20)) console.log(`  WARN ${warning}`);
  if (warnings.length > 20) console.log(`  ... ${warnings.length - 20} more`);
}

if (failures.length) {
  console.error(`Audit failed with ${failures.length} issue(s):`);
  for (const failure of failures) console.error(`  ERROR ${failure}`);
  process.exit(1);
}

console.log('Audit passed.');
