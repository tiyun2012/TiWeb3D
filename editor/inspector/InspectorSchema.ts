import { AssetType } from '@/types';

export type InspectorFieldType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'enum'
  | 'color'
  | 'vector3'
  | 'asset'
  | 'readonly';

export interface InspectorOption {
  label: string;
  value: string | number;
}

export interface InspectorContext<T = any> {
  value: T;
  scope: 'scene' | 'asset' | 'viewport' | 'generic';
}

export interface InspectorFieldSchema<T = any> {
  path: string;
  type: InspectorFieldType;
  label: string;
  tooltip?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: InspectorOption[];
  assetTypes?: AssetType[];
  defaultLabel?: string;
  readOnly?: boolean;
  /** Field can be driven by a sequencer/timeline. UI hosts may expose a keyframe control. */
  animatable?: boolean;
  /** Discrete fields keyframe by stepping values; continuous fields may interpolate. */
  animationMode?: 'continuous' | 'discrete';
  visibleWhen?: (ctx: InspectorContext<T>) => boolean;
  enabledWhen?: (ctx: InspectorContext<T>) => boolean;
  normalize?: (value: unknown, ctx: InspectorContext<T>) => unknown;
}

export interface InspectorSectionSchema<T = any> {
  id: string;
  label: string;
  fields: InspectorFieldSchema<T>[];
}

export interface InspectorSchemaExtension<T = any> {
  /** Base schema whose sections/fields are inherited by this schema. */
  schemaId: string;
  /** Where inherited sections appear relative to this schema's local sections. */
  placement?: 'before' | 'after';
  /** Optional gate applied to every inherited field without modifying the base schema. */
  enabledWhen?: (ctx: InspectorContext<T>) => boolean;
  /** Optional visibility gate applied to every inherited field. */
  visibleWhen?: (ctx: InspectorContext<T>) => boolean;
}

export interface InspectorSchema<T = any> {
  id: string;
  title: string;
  icon?: string;
  /**
   * Schema inheritance is for data/UI contracts (for example CameraComponent extends CameraSettings).
   * Runtime entity inheritance remains ECS composition through ComponentDefinitionRegistry.requires.
   */
  extends?: Array<string | InspectorSchemaExtension<T>>;
  sections: InspectorSectionSchema<T>[];
}
