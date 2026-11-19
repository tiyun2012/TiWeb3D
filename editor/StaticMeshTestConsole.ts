import {
  clearStaticMeshTestFixtures,
  createStaticMeshTestFixture,
  type StaticMeshTestFixtureKind,
  type StaticMeshTestFixtureResult,
} from '@/engine/dev/StaticMeshTestFixtures';
import {
  clearScratchShowcaseMeshes,
  runStaticMeshScratchStabilitySuite,
  type ScratchStabilitySuiteReport,
} from '@/engine/dev/StaticMeshScratchBenchmarks';
import {
  staticMeshAssetAPI,
  type AddStaticMeshPrimitiveArgs,
  type CreateStaticMeshPrimitiveArgs,
  type RunStaticMeshModelingStepsArgs,
  type RunStaticMeshModelingStepsResult,
  type StaticMeshEdgeQuery,
  type StaticMeshFaceQuery,
  type StaticMeshInspectedEdge,
  type StaticMeshInspectedFace,
  type StaticMeshInspectionReport,
  type StaticMeshPrimitiveResult,
} from '@/engine/api/StaticMeshAssetAPI';
import type { StaticMeshAsset } from '@/types';

export interface StaticMeshTestConsoleCommand {
  (fixture?: StaticMeshTestFixtureKind): StaticMeshTestFixtureResult;
  clear(): number;
  help(): string;
}

export interface StaticMeshModelingConsoleHelper {
  api: typeof staticMeshAssetAPI;
  createPrimitiveMesh(args: CreateStaticMeshPrimitiveArgs): StaticMeshAsset;
  addPrimitive(args: AddStaticMeshPrimitiveArgs): StaticMeshPrimitiveResult;
  inspect(assetId: string): StaticMeshInspectionReport;
  findFaces(assetId: string, query?: StaticMeshFaceQuery): StaticMeshInspectedFace[];
  findEdges(assetId: string, query?: StaticMeshEdgeQuery): StaticMeshInspectedEdge[];
  runSteps(args: RunStaticMeshModelingStepsArgs): RunStaticMeshModelingStepsResult;
  runScratchBenchmarks(options?: { keepAssets?: boolean; path?: string }): ScratchStabilitySuiteReport;
  clearScratchShowcase(): number;
}

const HELP = [
  'All smTest fixtures are normal Logical Mesh assets (no Construction metadata).',
  "smTest()           // fresh 4-vertex logical quad",
  "smTest('inset')    // normal panel already inset; select center face to Extrude/Delete",
  "smTest('opening')  // normal inset ring with center face deleted",
  "smTest('box')      // normal closed box fixture",
  "smTest('normal')   // normal closed box; edit directly, no Adopt step",
  "smTest('split')    // two normal triangles sharing one edge; use Edge mode + Split Edge",
  "smTest('cut')      // one normal quad; select the logged opposite vertices + Cut Face",
  "smTest('ring')     // four connected normal quads; use Edge Ring / Quad Strip",
  "smTest('bevel')    // normal valence-3 box edge; select the logged edge + Bevel",
  "smTest('bevel-valence') // normal valence-4 endpoints; tests higher-valence Bevel",
  "smTest('extrude-normal') // tilted normal quad; Face Extrude follows its surface normal",
  "smTest('inset-orient') // horizontal + vertical/collinear + warped/sloped faces for relative Inset/normal display",
  'smTest.clear()     // remove TEST_StaticMesh_* fixtures',
  "smModel.createPrimitiveMesh({ name: 'Tower', kind: 'BOX' }) // scratch primitive mesh",
  'smModel.inspect(assetId) // semantic face/edge inspection report',
  'smModel.runSteps({ assetId, steps: [...] }) // declarative AI modeling pipeline',
  'smModel.runScratchBenchmarks() // builds & audits 10 simple-to-complex scratch meshes in /Content/Meshes',
  'smModel.clearScratchShowcase() // removes Scratch_* showcase meshes',
].join('\n');

export function installStaticMeshTestConsoleCommand(): StaticMeshTestConsoleCommand {
  const command = ((fixture: StaticMeshTestFixtureKind = 'panel') => {
    const result = createStaticMeshTestFixture(fixture);
    console.info(
      `[smTest] '${fixture}' ready as ${result.asset.name}. `
      + `Open Content > Meshes and select '${result.asset.name}'.`,
    );
    console.info('[smTest] normal Logical Mesh fixture; Construction metadata: none');
    if (result.primaryFaceId !== undefined) {
      console.info(`[smTest] primaryFaceId: ${result.primaryFaceId}`);
    }
    if (result.primaryEdgeVertexIds) {
      console.info(`[smTest] primaryEdgeVertices: v${result.primaryEdgeVertexIds[0]} <-> v${result.primaryEdgeVertexIds[1]}`);
    }
    if (result.primaryCutVertexIds) {
      console.info(`[smTest] primaryCutVertices: v${result.primaryCutVertexIds[0]} <-> v${result.primaryCutVertexIds[1]}`);
    }
    if (fixture === 'inset-orient') {
      console.info('[smTest] inset-orient faces: 0=horizontal, 1=vertical+collinear boundary, 2=warped/sloped');
    }
    return result;
  }) as StaticMeshTestConsoleCommand;

  command.clear = () => {
    const removed = clearStaticMeshTestFixtures();
    console.info(`[smTest] removed ${removed} test fixture${removed === 1 ? '' : 's'}.`);
    return removed;
  };

  command.help = () => {
    console.info(HELP);
    return HELP;
  };

  const smModel: StaticMeshModelingConsoleHelper = {
    api: staticMeshAssetAPI,
    createPrimitiveMesh: args => staticMeshAssetAPI.createPrimitiveMesh(args),
    addPrimitive: args => staticMeshAssetAPI.addPrimitive(args),
    inspect: assetId => staticMeshAssetAPI.inspectMesh(assetId),
    findFaces: (assetId, query = {}) => staticMeshAssetAPI.findFaces({ assetId, ...query }),
    findEdges: (assetId, query = {}) => staticMeshAssetAPI.findEdges({ assetId, ...query }),
    runSteps: args => staticMeshAssetAPI.runModelingSteps(args),
    runScratchBenchmarks: (options = {}) => {
      const report = runStaticMeshScratchStabilitySuite({ keepAssets: true, ...options });
      console.info(
        `[smModel] Scratch Stability Suite ${report.passed ? 'PASSED' : 'FAILED'} `
        + `(${report.cases.length} meshes in ${report.totalDurationMs.toFixed(1)}ms; rollback=${report.rollbackVerified}, undoRedo=${report.undoRedoVerified}).`,
      );
      return report;
    },
    clearScratchShowcase: () => {
      const removed = clearScratchShowcaseMeshes();
      console.info(`[smModel] removed ${removed} scratch showcase mesh${removed === 1 ? '' : 'es'}.`);
      return removed;
    },
  };

  const globalScope = globalThis as typeof globalThis & {
    smTest?: StaticMeshTestConsoleCommand;
    smModel?: StaticMeshModelingConsoleHelper;
  };
  globalScope.smTest = command;
  globalScope.smModel = smModel;
  return command;
}
