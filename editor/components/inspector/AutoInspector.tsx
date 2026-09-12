import React, { useEffect, useMemo, useState } from 'react';
import { assetManager } from '@/engine/AssetManager';
import { eventBus } from '@/engine/EventBus';
import { inspectorRegistry } from '@/editor/inspector/InspectorRegistry';
import { InspectorContext, InspectorFieldSchema } from '@/editor/inspector/InspectorSchema';
import { Select } from '@/editor/components/ui/Select';
import { CheckboxInput, ColorInput, DraggableNumber, Vector3Input } from '@/editor/components/ui/InputControls';

export interface AutoInspectorProps<T = any> {
  schemaId: string;
  value: T;
  scope?: InspectorContext<T>['scope'];
  onChange: (path: string, value: unknown) => void;
  onStartUpdate?: () => void;
  onCommit?: () => void;
}

const getPathValue = (value: any, path: string) =>
  path.split('.').reduce((current, key) => current?.[key], value);

const clampNumber = (value: number, field: InspectorFieldSchema<any>) => {
  let next = value;
  if (field.min !== undefined) next = Math.max(field.min, next);
  if (field.max !== undefined) next = Math.min(field.max, next);
  return next;
};

export const AutoInspector = <T,>({
  schemaId,
  value,
  scope = 'generic',
  onChange,
  onStartUpdate,
  onCommit,
}: AutoInspectorProps<T>) => {
  const schema = inspectorRegistry.get<T>(schemaId);
  const [assetRevision, setAssetRevision] = useState(0);

  useEffect(() => {
    const refresh = () => setAssetRevision(v => v + 1);
    const offCreated = eventBus.on('ASSET_CREATED', refresh);
    const offUpdated = eventBus.on('ASSET_UPDATED', refresh);
    const offDeleted = eventBus.on('ASSET_DELETED', refresh);
    return () => { offCreated(); offUpdated(); offDeleted(); };
  }, []);

  const ctx: InspectorContext<T> = useMemo(() => ({ value, scope }), [value, scope]);
  if (!schema) {
    return <div className="text-xs text-red-300">Missing inspector schema: {schemaId}</div>;
  }

  const commit = (field: InspectorFieldSchema<T>, raw: unknown) => {
    if (field.readOnly || field.enabledWhen?.(ctx) === false) return;
    let next = raw;
    if (field.type === 'number' && typeof next === 'number') next = clampNumber(next, field);
    if (field.normalize) next = field.normalize(next, ctx);
    onStartUpdate?.();
    onChange(field.path, next);
    onCommit?.();
  };

  return (
    <div className="space-y-4">
      {schema.sections.map(section => {
        const visibleFields = section.fields.filter(field => field.visibleWhen?.(ctx) !== false);
        if (visibleFields.length === 0) return null;
        return (
          <section key={section.id} className="space-y-2">
            <div className="text-[10px] uppercase font-bold text-text-secondary tracking-wider border-b border-white/5 pb-1">
              {section.label}
            </div>
            {visibleFields.map(field => {
              const fieldValue = getPathValue(value, field.path);
              const disabled = field.readOnly || field.enabledWhen?.(ctx) === false;

              if (field.type === 'number') {
                return (
                  <div key={field.path} className="flex items-center gap-2 py-1" title={field.tooltip}>
                    <span className="w-24 shrink-0 text-text-secondary text-[10px]">{field.label}</span>
                    <div className="flex-1">
                      <DraggableNumber label="" value={Number(fieldValue ?? 0)} step={field.step ?? 0.01} disabled={disabled} onChange={v => commit(field, v)} />
                    </div>
                  </div>
                );
              }

              if (field.type === 'boolean') {
                return <div key={field.path} title={field.tooltip}><CheckboxInput label={field.label} checked={!!fieldValue} disabled={disabled} onChange={v => commit(field, v)} /></div>;
              }

              if (field.type === 'color') {
                return <div key={field.path} title={field.tooltip}><ColorInput label={field.label} value={String(fieldValue || '#000000')} disabled={disabled} onChange={v => commit(field, v)} /></div>;
              }

              if (field.type === 'vector3') {
                return <div key={field.path} title={field.tooltip}><Vector3Input label={field.label} value={fieldValue || { x: 0, y: 0, z: 0 }} disabled={disabled} step={field.step} onChange={v => commit(field, v)} /></div>;
              }

              if (field.type === 'enum') {
                return (
                  <div key={field.path} className="flex items-center gap-2 py-1" title={field.tooltip}>
                    <span className="w-24 shrink-0 text-text-secondary text-[10px]">{field.label}</span>
                    <div className="flex-1 min-w-0">
                      <Select value={fieldValue ?? ''} options={field.options ?? []} disabled={disabled} onChange={v => commit(field, v)} />
                    </div>
                  </div>
                );
              }

              if (field.type === 'asset') {
                const assets = assetManager.getAllAssets().filter(asset => field.assetTypes?.includes(asset.type));
                const options = [
                  { label: field.defaultLabel ?? 'None', value: '' },
                  ...assets.map(asset => ({ label: asset.name, value: asset.id })),
                ];
                void assetRevision;
                return (
                  <div key={field.path} className="flex items-center gap-2 py-1" title={field.tooltip}>
                    <span className="w-24 shrink-0 text-text-secondary text-[10px]">{field.label}</span>
                    <div className="flex-1 min-w-0">
                      <Select value={String(fieldValue || '')} options={options} disabled={disabled} onChange={v => commit(field, String(v))} />
                    </div>
                  </div>
                );
              }

              if (field.type === 'readonly') {
                return (
                  <div key={field.path} className="flex items-center gap-2 py-1" title={field.tooltip}>
                    <span className="w-24 shrink-0 text-text-secondary text-[10px]">{field.label}</span>
                    <span className="flex-1 text-[10px] text-white/70 truncate">{String(fieldValue ?? '')}</span>
                  </div>
                );
              }

              return (
                <div key={field.path} className="flex items-center gap-2 py-1" title={field.tooltip}>
                  <span className="w-24 shrink-0 text-text-secondary text-[10px]">{field.label}</span>
                  <input
                    type="text"
                    value={String(fieldValue ?? '')}
                    disabled={disabled}
                    onChange={e => commit(field, e.target.value)}
                    className="flex-1 bg-input-bg rounded px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                    aria-label={field.label}
                    title={field.tooltip || field.label}
                  />
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
};
