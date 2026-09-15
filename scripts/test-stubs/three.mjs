// StaticMesh construction tests do not execute AssetManager's Three.js import paths.
// This stub only satisfies the runtime module import so the real asset/API code can load.
export class Matrix4 {
  fromArray() { return this; }
  invert() { return this; }
  toArray() { return []; }
}
