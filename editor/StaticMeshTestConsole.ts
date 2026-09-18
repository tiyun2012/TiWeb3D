import {
  clearStaticMeshTestFixtures,
  createStaticMeshTestFixture,
  type StaticMeshTestFixtureKind,
  type StaticMeshTestFixtureResult,
} from '@/engine/dev/StaticMeshTestFixtures';

export interface StaticMeshTestConsoleCommand {
  (fixture?: StaticMeshTestFixtureKind): StaticMeshTestFixtureResult;
  clear(): number;
  help(): string;
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

  (globalThis as typeof globalThis & { smTest?: StaticMeshTestConsoleCommand }).smTest = command;
  return command;
}
