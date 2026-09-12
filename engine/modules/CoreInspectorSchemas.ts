import type { CameraComponentData, CameraSettings } from '@/types';
import { inspectorRegistry } from '@/editor/inspector/InspectorRegistry';
import { LIGHT_TYPES } from '@/engine/constants';
import type {
  InspectorFieldSchema,
  InspectorSectionSchema,
} from '@/editor/inspector/InspectorSchema';

let registered = false;

const cameraSettingSections: InspectorSectionSchema<CameraSettings>[] = [
  {
    id: 'projection',
    label: 'Projection',
    fields: [
      {
        path: 'projection',
        type: 'enum',
        label: 'Projection',
        options: [
          { label: 'Perspective', value: 'PERSPECTIVE' },
          { label: 'Orthographic', value: 'ORTHOGRAPHIC' },
        ],
        animatable: true,
        animationMode: 'discrete',
      },
      {
        path: 'fov',
        type: 'number',
        label: 'Field of View',
        min: 1,
        max: 179,
        step: 1,
        visibleWhen: ({ value }) => value.projection === 'PERSPECTIVE',
        animatable: true,
        animationMode: 'continuous',
      },
      {
        path: 'orthoSize',
        type: 'number',
        label: 'Ortho Size',
        min: 0.01,
        step: 0.1,
        visibleWhen: ({ value }) => value.projection === 'ORTHOGRAPHIC',
        animatable: true,
        animationMode: 'continuous',
      },
      {
        path: 'near',
        type: 'number',
        label: 'Near',
        min: 0.001,
        step: 0.01,
        animatable: true,
        animationMode: 'continuous',
      },
      {
        path: 'far',
        type: 'number',
        label: 'Far',
        min: 0.01,
        step: 1,
        animatable: true,
        animationMode: 'continuous',
      },
    ],
  },
  {
    id: 'rendering',
    label: 'Rendering',
    fields: [
      {
        path: 'clearMode',
        type: 'enum',
        label: 'Clear Mode',
        options: [
          { label: 'Sky', value: 'SKY' },
          { label: 'Color', value: 'COLOR' },
          { label: 'None', value: 'NONE' },
        ],
        animatable: true,
        animationMode: 'discrete',
      },
      {
        path: 'clearColor',
        type: 'color',
        label: 'Clear Color',
        visibleWhen: ({ value }) => value.clearMode === 'COLOR',
        animatable: true,
        animationMode: 'continuous',
      },
      {
        path: 'renderLayerMask',
        type: 'number',
        label: 'Layer Mask',
        min: 0,
        step: 1,
        tooltip: 'Bit mask of render layers visible to this camera.',
        normalize: value => Math.max(0, Math.floor(Number(value) || 0)),
      },
    ],
  },
  {
    id: 'post-process',
    label: 'Post Process',
    fields: [
      {
        path: 'postProcessEnabled',
        type: 'boolean',
        label: 'Enabled',
        animatable: true,
        animationMode: 'discrete',
      },
      {
        path: 'postProcessProfileId',
        type: 'asset',
        label: 'Profile',
        assetTypes: ['POST_PROCESS_PROFILE'],
        defaultLabel: 'Inherit Scene / None',
        enabledWhen: ({ value }) => value.postProcessEnabled,
        tooltip: 'Camera profile overrides the Scene profile. Empty inherits from the Scene.',
      },
    ],
  },
];

const buildCameraComponentSettingSections = (): InspectorSectionSchema<CameraComponentData>[] =>
  cameraSettingSections.map(section => ({
    ...section,
    fields: section.fields.map(baseField => {
      const field = baseField as InspectorFieldSchema<CameraSettings>;
      return {
        ...field,
        visibleWhen: field.visibleWhen
          ? (ctx => field.visibleWhen?.({ value: ctx.value, scope: ctx.scope }) !== false)
          : undefined,
        enabledWhen: ctx => {
          if (ctx.value.configSource === 'PRESET') return false;
          return field.enabledWhen?.({ value: ctx.value, scope: ctx.scope }) !== false;
        },
        normalize: field.normalize
          ? ((value, ctx) => field.normalize?.(value, { value: ctx.value, scope: ctx.scope }))
          : undefined,
      } satisfies InspectorFieldSchema<CameraComponentData>;
    }),
  }));

export const registerCoreInspectorSchemas = () => {
  if (registered) return;
  registered = true;

  inspectorRegistry.register<CameraSettings>({
    id: 'CameraSettings',
    title: 'Camera Settings',
    icon: 'Camera',
    sections: cameraSettingSections,
  });

  inspectorRegistry.register<CameraComponentData>({
    id: 'CameraComponent',
    title: 'Camera',
    icon: 'Camera',
    sections: [
      {
        id: 'configuration',
        label: 'Configuration',
        fields: [
          {
            path: 'configSource',
            type: 'enum',
            label: 'Source',
            options: [
              { label: 'Local', value: 'LOCAL' },
              { label: 'Camera Preset', value: 'PRESET' },
            ],
            tooltip: 'Preset uses the referenced Camera Preset as the serialized base. Local uses this component\'s values.',
          },
          {
            path: 'presetId',
            type: 'asset',
            label: 'Camera Preset',
            assetTypes: ['CAMERA_PRESET'],
            defaultLabel: 'None (local fallback)',
            visibleWhen: ({ value }) => value.configSource === 'PRESET',
            tooltip: 'Reusable base configuration. Runtime/cinematic drivers never modify the preset asset.',
          },
          {
            path: 'controlMode',
            type: 'enum',
            label: 'Control Mode',
            options: [
              { label: 'Manual', value: 'MANUAL' },
              { label: 'Runtime', value: 'RUNTIME' },
              { label: 'Cinematic', value: 'CINEMATIC' },
            ],
            tooltip: 'Manual uses base settings. Runtime accepts gameplay/script overrides. Cinematic accepts timeline/sequencer overrides.',
          },
        ],
      },
      ...buildCameraComponentSettingSections(),
    ],
  });

  inspectorRegistry.register<any>({
    id: 'SceneRendering',
    title: 'Scene Rendering',
    icon: 'Clapperboard',
    sections: [
      {
        id: 'post-process',
        label: 'Post Process',
        fields: [
          {
            path: 'postProcessProfileId',
            type: 'asset',
            label: 'Scene Profile',
            assetTypes: ['POST_PROCESS_PROFILE'],
            defaultLabel: 'None',
            tooltip: 'Default profile inherited by cameras that do not override it.',
          },
        ],
      },
    ],
  });

  inspectorRegistry.register<any>({
    id: 'Light',
    title: 'Light Source',
    icon: 'Sun',
    sections: [
      {
        id: 'light',
        label: 'Light Source',
        fields: [
          {
            path: 'lightType',
            type: 'enum',
            label: 'Type',
            options: LIGHT_TYPES.map(value => ({ label: value, value })),
          },
          { path: 'color', type: 'color', label: 'Color', animatable: true, animationMode: 'continuous' },
          { path: 'intensity', type: 'number', label: 'Intensity', min: 0, step: 0.1, animatable: true, animationMode: 'continuous' },
        ],
      },
    ],
  });
};
