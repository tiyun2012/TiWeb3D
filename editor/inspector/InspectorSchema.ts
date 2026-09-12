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

export interface InspectorSchema<T = any> {
  id: string;
  title: string;
  icon?: string;
  sections: InspectorSectionSchema<T>[];
}
