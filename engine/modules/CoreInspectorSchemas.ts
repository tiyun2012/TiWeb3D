import { CameraComponentData, CameraSettings } from '@/types';
import { inspectorRegistry } from '@/editor/inspector/InspectorRegistry';
import { LIGHT_TYPES } from '@/engine/constants';
import { InspectorSectionSchema } from '@/editor/inspector/InspectorSchema';

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
      },
      {
        path: 'fov',
        type: 'number',
        label: 'Field of View',
        min: 1,
        max: 179,
        step: 1,
        visibleWhen: ({ value }) => value.projection === 'PERSPECTIVE',
      },
      {
        path: 'orthoSize',
        type: 'number',
        label: 'Ortho Size',
        min: 0.01,
        step: 0.1,
        visibleWhen: ({ value }) => value.projection === 'ORTHOGRAPHIC',
      },
      { path: 'near', type: 'number', label: 'Near', min: 0.001, step: 0.01 },
      { path: 'far', type: 'number', label: 'Far', min: 0.01, step: 1 },
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
      },
      {
        path: 'clearColor',
        type: 'color',
        label: 'Clear Color',
        visibleWhen: ({ value }) => value.clearMode === 'COLOR',
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
      { path: 'postProcessEnabled', type: 'boolean', label: 'Enabled' },
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
        id: 'preset',
        label: 'Preset',
        fields: [
          {
            path: 'presetId',
            type: 'asset',
            label: 'Camera Preset',
            assetTypes: ['CAMERA_PRESET'],
            defaultLabel: 'Custom / No Preset',
            tooltip: 'Choosing a preset copies its camera settings into this Scene camera.',
          },
        ],
      },
      ...(cameraSettingSections as InspectorSectionSchema<CameraComponentData>[]),
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
          { path: 'color', type: 'color', label: 'Color' },
          { path: 'intensity', type: 'number', label: 'Intensity', min: 0, step: 0.1 },
        ],
      },
    ],
  });
};
