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
  "smTest()           // fresh 4-point panel",
  "smTest('inset')    // panel already inset; select center face to Extrude/Delete",
  "smTest('opening')  // inset ring with center face deleted",
  "smTest('box')      // simple extruded box",
  "smTest('split')    // two authored triangles sharing one edge; use Edge mode + Split Edge",
  "smTest('cut')      // one authored quad; select opposite vertices A/C + Cut Face",
  "smTest('ring')     // four connected quads; select the center vertical edge, then Edge Ring / Quad Strip",
  'smTest.clear()     // remove TEST_StaticMesh_* fixtures',
].join('\n');

export function installStaticMeshTestConsoleCommand(): StaticMeshTestConsoleCommand {
  const command = ((fixture: StaticMeshTestFixtureKind = 'panel') => {
    const result = createStaticMeshTestFixture(fixture);
    console.info(
      `[smTest] '${fixture}' ready as ${result.asset.name}. `
      + `Open Content > Meshes and select '${result.asset.name}'.`,
    );
    if (result.primaryFaceId) {
      console.info(`[smTest] primaryFaceId: ${result.primaryFaceId}`);
    }
    if (result.primaryEdgePointIds) {
      console.info(`[smTest] primaryEdgePoints: ${result.primaryEdgePointIds[0]} <-> ${result.primaryEdgePointIds[1]}`);
    }
    if (result.primaryCutPointIds) {
      console.info(`[smTest] primaryCutPoints: ${result.primaryCutPointIds[0]} <-> ${result.primaryCutPointIds[1]}`);
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
