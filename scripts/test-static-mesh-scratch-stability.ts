import { runStaticMeshScratchStabilitySuite } from '@/engine/dev/StaticMeshScratchBenchmarks';

const report = runStaticMeshScratchStabilitySuite({ keepAssets: false });

console.log('=== Static Mesh From-Scratch Stability Suite ===');
for (const c of report.cases) {
  const status = c.passed ? 'PASS' : 'FAIL';
  console.log(
    `[${status}] [${c.tier}] ${c.name} `
    + `| verts=${c.integrity.vertexCount} faces=${c.integrity.faceCount} tris=${c.integrity.triangleCount} shells=${c.integrity.shellCount} `
    + `| boundary=${c.integrity.boundaryEdgeCount} nonManifold=${c.integrity.nonManifoldEdgeCount} degen=${c.integrity.degenerateTriangleCount} `
    + `| rayHit=${c.integrity.raycastHitCount} | ${c.durationMs.toFixed(1)}ms`,
  );
  if (c.integrity.issues.length > 0) {
    for (const issue of c.integrity.issues) {
      console.error(`   ! ${issue}`);
    }
  }
}

console.log(
  `Rollback verified: ${report.rollbackVerified} | Undo/Redo verified: ${report.undoRedoVerified} | Adversarial guards: ${report.adversarialGuardsVerified} | Total: ${report.totalDurationMs.toFixed(1)}ms`,
);

if (!report.passed) {
  console.error('\nFAILURES:');
  for (const err of report.errors) {
    console.error(` - ${err}`);
  }
  process.exit(1);
}

console.log('\nAll progressive scratch modeling stability tests PASSED.');
