import { InspectorSchema } from './InspectorSchema';

class InspectorRegistryService {
  private schemas = new Map<string, InspectorSchema<any>>();

  register<T>(schema: InspectorSchema<T>) {
    this.schemas.set(schema.id, schema as InspectorSchema<any>);
    return schema;
  }

  get<T = any>(id: string): InspectorSchema<T> | undefined {
    return this.schemas.get(id) as InspectorSchema<T> | undefined;
  }

  has(id: string) {
    return this.schemas.has(id);
  }

  getAll() {
    return Array.from(this.schemas.values());
  }
}

export const inspectorRegistry = new InspectorRegistryService();
