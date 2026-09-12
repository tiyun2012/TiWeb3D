import {
  InspectorContext,
  InspectorFieldSchema,
  InspectorSchema,
  InspectorSchemaExtension,
  InspectorSectionSchema,
} from './InspectorSchema';

const cloneField = <T>(field: InspectorFieldSchema<any>): InspectorFieldSchema<T> => ({ ...field });

const composeInheritedField = <T>(
  field: InspectorFieldSchema<any>,
  extension: InspectorSchemaExtension<T>,
): InspectorFieldSchema<T> => {
  const inherited = cloneField<T>(field);
  const baseVisible = field.visibleWhen;
  const baseEnabled = field.enabledWhen;

  inherited.visibleWhen = (ctx: InspectorContext<T>) =>
    extension.visibleWhen?.(ctx) !== false &&
    baseVisible?.(ctx as InspectorContext<any>) !== false;

  inherited.enabledWhen = (ctx: InspectorContext<T>) =>
    extension.enabledWhen?.(ctx) !== false &&
    baseEnabled?.(ctx as InspectorContext<any>) !== false;

  return inherited;
};

const mergeSections = <T>(
  groups: Array<{ sections: InspectorSectionSchema<T>[]; localWins: boolean }>,
): InspectorSectionSchema<T>[] => {
  const ordered: InspectorSectionSchema<T>[] = [];
  const byId = new Map<string, InspectorSectionSchema<T>>();

  const merge = (section: InspectorSectionSchema<T>, localWins: boolean) => {
    const existing = byId.get(section.id);
    if (!existing) {
      const copy = { ...section, fields: section.fields.map(field => ({ ...field })) };
      byId.set(section.id, copy);
      ordered.push(copy);
      return;
    }

    const fields = new Map(existing.fields.map(field => [field.path, field]));
    for (const field of section.fields) {
      if (localWins || !fields.has(field.path)) fields.set(field.path, { ...field });
    }
    existing.fields = Array.from(fields.values());
    if (localWins) existing.label = section.label;
  };

  for (const group of groups) {
    group.sections.forEach(section => merge(section, group.localWins));
  }
  return ordered;
};

class InspectorRegistryService {
  private schemas = new Map<string, InspectorSchema<any>>();

  register<T>(schema: InspectorSchema<T>) {
    this.schemas.set(schema.id, schema as InspectorSchema<any>);
    return schema;
  }

  /** Returns a fully resolved schema with inherited sections/fields composed in. */
  get<T = any>(id: string): InspectorSchema<T> | undefined {
    return this.resolve<T>(id, new Set());
  }

  getRaw<T = any>(id: string): InspectorSchema<T> | undefined {
    return this.schemas.get(id) as InspectorSchema<T> | undefined;
  }

  private resolve<T>(id: string, resolving: Set<string>): InspectorSchema<T> | undefined {
    const raw = this.schemas.get(id) as InspectorSchema<T> | undefined;
    if (!raw) return undefined;
    if (resolving.has(id)) throw new Error(`Inspector schema inheritance cycle detected at ${id}`);

    resolving.add(id);
    const inheritedBefore: InspectorSectionSchema<T>[] = [];
    const inheritedAfter: InspectorSectionSchema<T>[] = [];

    for (const entry of raw.extends ?? []) {
      const extension: InspectorSchemaExtension<T> = typeof entry === 'string' ? { schemaId: entry } : entry;
      const parent = this.resolve<any>(extension.schemaId, resolving);
      if (!parent) {
        console.warn(`Inspector schema ${id} extends missing schema ${extension.schemaId}`);
        continue;
      }

      const target = extension.placement === 'after' ? inheritedAfter : inheritedBefore;
      for (const section of parent.sections) {
        target.push({
          ...section,
          fields: section.fields.map(field => composeInheritedField<T>(field, extension)),
        });
      }
    }

    resolving.delete(id);
    return {
      ...raw,
      extends: raw.extends ? [...raw.extends] : undefined,
      sections: mergeSections([
        { sections: inheritedBefore, localWins: false },
        { sections: raw.sections, localWins: true },
        { sections: inheritedAfter, localWins: false },
      ]),
    };
  }

  has(id: string) {
    return this.schemas.has(id);
  }

  getAll() {
    return Array.from(this.schemas.keys()).map(id => this.get(id)!).filter(Boolean);
  }
}

export const inspectorRegistry = new InspectorRegistryService();
